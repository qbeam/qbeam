// QR payload parsing, gunzip with a cap, and the Receiver (sessions, hint, finishing) — mirrors android ReceiverTest.
import CryptoKit
import Foundation
import Testing
@testable import QBeamKit

/// A byte-mode segment as QR data codewords: mode 0100, count, data, terminator, padding (ISO 18004 §7.4).
func byteModeCodewords(_ data: [UInt8], version: Int, eci: Bool = false) -> Data {
    var bits = [Int]()
    func put(_ v: Int, _ n: Int) { for i in stride(from: n - 1, through: 0, by: -1) { bits.append((v >> i) & 1) } }
    if eci { put(0b0111, 4); put(26, 8) }           // ECI 26 (UTF-8), as some encoders add
    put(0b0100, 4); put(data.count, version < 10 ? 8 : 16)
    for b in data { put(Int(b), 8) }
    put(0, 4)
    while bits.count % 8 != 0 { bits.append(0) }
    var out = (0..<(bits.count / 8)).map { i in UInt8(bits[(i * 8)..<(i * 8 + 8)].reduce(0) { $0 << 1 | $1 }) }
    var pad: [UInt8] = [0xEC, 0x11], k = 0
    for _ in 0..<5 { out.append(pad[k % 2]); k += 1 }
    _ = pad.popLast()
    return Data(out)
}

func gzipped(_ b: [UInt8]) -> [UInt8] {
    let p = Process(), inPipe = Pipe(), outPipe = Pipe()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/gzip")
    p.arguments = ["-c", "-n"]
    p.standardInput = inPipe; p.standardOutput = outPipe
    try! p.run()
    inPipe.fileHandleForWriting.write(Data(b)); try! inPipe.fileHandleForWriting.close()
    let out = outPipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return Array(out)
}

func sha(_ b: [UInt8]) -> [UInt8] { Array(SHA256.hash(data: b)) }

@Test func qrPayloadByteMode() {
    let data = (0..<300).map { UInt8($0 & 0xFF) }
    #expect(QRPayload.bytes(fromDataCodewords: byteModeCodewords(data, version: 25), version: 25) == data)
    #expect(QRPayload.bytes(fromDataCodewords: byteModeCodewords(Array(data.prefix(40)), version: 5), version: 5) == Array(data.prefix(40)))
    #expect(QRPayload.bytes(fromDataCodewords: byteModeCodewords(data, version: 25, eci: true), version: 25) == data)
    #expect(QRPayload.bytes(fromDataCodewords: Data([0b0001_0000, 0]), version: 1) == nil)  // numeric mode: not ours
}

@Test func gunzipAndCap() throws {
    let text = Array(String(repeating: "hello qbeam\n", count: 5000).utf8)
    #expect(try Gzip.decompress(gzipped(text), maxBytes: 1 << 20) == text)
    #expect(throws: QBeamError.container("too-large")) { try Gzip.decompress(gzipped([UInt8](repeating: 0, count: 1 << 20)), maxBytes: 512 * 1024) }
    var bad = gzipped(text); bad[bad.count - 6] ^= 1                                         // trailer CRC
    #expect(throws: QBeamError.self) { try Gzip.decompress(bad, maxBytes: 1 << 20) }
}

final class FakeClock { var now: TimeInterval = 1000 }

func codes(_ payload: [UInt8], session: UInt32, T: Int = 300, flags: UInt8 = 0, extra: Int = 50) -> [[UInt8]] {
    let enc = Encoder(payload: payload, T: T)
    return (0..<(enc.layout.K + extra)).map { try! QBeam3.encode(session: session, L: payload.count, T: T, esi: UInt32($0), symbol: enc.symbol(esi: UInt32($0)), flags: flags) }
}

func receive(_ rx: Receiver, _ clock: FakeClock, _ all: [[UInt8]], loss: Double = 0) -> Receiver.Session? {
    for c in all {
        if Double.random(in: 0..<1) < loss { continue }
        clock.now += 0.01
        if case .complete(let s) = rx.onCode(c) { return s }
    }
    return nil
}

@Test func receiverPlainGzipAndEncrypted() throws {
    let clock = FakeClock(), rx = Receiver(clock: { clock.now })
    let data = (0..<20_000).map { _ in UInt8.random(in: 0...255) }
    let s1 = try #require(receive(rx, clock, codes(Container(encoding: .raw, filename: "a.bin", sha256: sha(data), data: data).encoded(), session: 1), loss: 0.3))
    let saved = try rx.finish(s1)
    #expect(saved.filename == "a.bin" && saved.bytes == data)

    let text = Array(String(repeating: "hello qbeam\n", count: 5000).utf8)
    clock.now += Receiver.staleSeconds + 1
    let s2 = try #require(receive(rx, clock, codes(Container(encoding: .gzip, filename: "../../notes.txt", sha256: sha(text), data: gzipped(text)).encoded(), session: 2)))
    let saved2 = try rx.finish(s2)
    #expect(saved2.filename == "notes.txt" && saved2.bytes == text)

    let env = try Envelope.seal(Container(encoding: .raw, filename: "s.env", sha256: sha(data), data: data).encoded(), passphrase: "pass", iterations: 1000)
    clock.now += Receiver.staleSeconds + 1
    let s3 = try #require(receive(rx, clock, codes(env, session: 3, flags: QBeam3.flagEncrypted)))
    #expect(s3.encrypted)
    #expect(throws: QBeamError.envelope("passphrase")) { try rx.finish(s3) }
    #expect(throws: QBeamError.envelope("auth")) { try rx.finish(s3, passphrase: "nope") }
    #expect(try rx.finish(s3, passphrase: "pass").bytes == data)
}

@Test func completedAtIsTheLastNeededCodeNotTheSave() throws {
    let clock = FakeClock(), rx = Receiver(clock: { clock.now })
    let data = (0..<5000).map { _ in UInt8.random(in: 0...255) }
    let s = try #require(receive(rx, clock, codes(Container(encoding: .raw, filename: "t", sha256: sha(data), data: data).encoded(), session: 7)))
    let done = clock.now
    #expect(s.completedAt == done)
    clock.now += 60                       // the user takes a minute (typing a passphrase, say)
    _ = try rx.finish(s)
    #expect(s.completedAt == done && done > s.started)
}

@Test func receiverCatchesMisreadAndBomb() throws {
    let clock = FakeClock(), rx = Receiver(clock: { clock.now })
    let data = (0..<5000).map { _ in UInt8.random(in: 0...255) }
    var all = codes(Container(encoding: .raw, filename: "x", sha256: sha(data), data: data).encoded(), session: 4)
    guard case .code(let p) = QBeam3.parse(all[2]) else { Issue.record("parse"); return }
    var sym = p.symbol; sym[0] ^= 0x40
    all[2] = try QBeam3.encode(session: p.session, L: p.L, T: p.T, esi: p.esi, symbol: sym) // wrong but CRC-valid
    let s = try #require(receive(rx, clock, all))
    #expect(throws: QBeamError.container("checksum")) { try rx.finish(s) }
    #expect(rx.session == nil)

    let small = Receiver(clock: { clock.now }, maxSavedBytes: 512 * 1024)
    let zeros = [UInt8](repeating: 0, count: 1 << 20)
    let sb = try #require(receive(small, clock, codes(Container(encoding: .gzip, filename: "b", sha256: sha(zeros), data: gzipped(zeros)).encoded(), session: 5)))
    #expect(throws: QBeamError.container("too-large")) { try small.finish(sb) }
}

@Test func receiverSessionSwitchingAndNotices() {
    let clock = FakeClock(), rx = Receiver(clock: { clock.now })
    let a = codes((0..<4000).map { _ in UInt8.random(in: 0...255) }, session: 10)
    let b = codes((0..<4000).map { _ in UInt8.random(in: 0...255) }, session: 11)
    _ = rx.onCode(a[0]); _ = rx.onCode(a[1])
    if case .ignored = rx.onCode(b[0]) {} else { Issue.record("second sender should be ignored while the first is active") }
    clock.now += Receiver.staleSeconds + 1
    if case .progress = rx.onCode(b[0]) {} else { Issue.record("should follow the new sender") }
    #expect(rx.session?.id == 11)
    if case .notice = rx.onCode(Array("Q2HTEST01|4|1000|".utf8)) {} else { Issue.record("old sender notice") }
}

@Test func receiverCatchRate() {
    let clock = FakeClock(), rx = Receiver(clock: { clock.now })
    let all = codes((0..<200_000).map { _ in UInt8.random(in: 0...255) }, session: 12, T: 1000, extra: 0)
    for (i, c) in all.enumerated() where i % 3 == 0 { clock.now += 0.02; _ = rx.onCode(c) }
    let rate = rx.catchRate()
    #expect(rate != nil && (0.3...0.37).contains(rate!))
}
