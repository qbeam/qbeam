// QBeamKit against protocol/test-vectors/v3.json (generated from the JS reference codec) plus decode round trips.
// Run: cd ios/QBeamKit && swift test
import CryptoKit
import Foundation
import Testing
@testable import QBeamKit

let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
let vectors = try! JSONSerialization.jsonObject(
    with: Data(contentsOf: repoRoot.appendingPathComponent("protocol/test-vectors/v3.json"))) as! [String: Any]

func hex(_ b: [UInt8]) -> String { b.map { String(format: "%02x", $0) }.joined() }
func unhex(_ s: String) -> [UInt8] {
    var out = [UInt8](), chars = Array(s.utf8), i = 0
    while i < chars.count { out.append(UInt8(String(decoding: chars[i..<(i + 2)], as: UTF8.self), radix: 16)!); i += 2 }
    return out
}
func vectorPayload(_ n: Int) -> [UInt8] { (0..<n).map { UInt8(($0 * 31 + 7) & 0xFF) } }
func coefHex(_ words: [UInt32], n: Int) -> String {
    var out = [UInt8](repeating: 0, count: (n + 7) / 8)
    for j in 0..<n where words[j >> 5] & (1 << UInt32(j & 31)) != 0 { out[j >> 3] |= 1 << UInt8(j & 7) }
    return hex(out)
}

@Test func constants() {
    let c = vectors["constants"] as! [String: Any]
    #expect(QBeam3.magic == (c["magic"] as! [Int]).map(UInt8.init))
    #expect(Int(QBeam3.version) == c["version"] as! Int)
    #expect(QBeam3.header == c["headerBytes"] as! Int && QBeam3.overhead == c["overheadBytes"] as! Int)
    #expect(QBeam3.kmax == c["kmax"] as! Int && QBeam3.tMin == c["tMin"] as! Int && QBeam3.tMax == c["tMax"] as! Int)
    #expect(QBeam3.maxL == c["maxL"] as! Int && QBeam3.maxK == c["maxK"] as! Int)
}

@Test func crc32() {
    for c in vectors["crc32"] as! [[String: Any]] {
        #expect(CRC32.checksum(Array((c["asciiInput"] as! String).utf8)) == UInt32(c["crc32"] as! Int))
    }
}

@Test func layouts() {
    for c in vectors["layouts"] as! [[String: Any]] {
        let lay = Layout(L: c["L"] as! Int, T: c["T"] as! Int)
        #expect(lay.K == c["K"] as! Int && lay.S == c["S"] as! Int)
        #expect(lay.segments.map { [$0.start, $0.size] } == c["segments"] as! [[Int]])
    }
}

@Test func fountainSymbols() {
    for c in vectors["fountain"] as! [[String: Any]] {
        let enc = Encoder(payload: vectorPayload(c["L"] as! Int), T: c["T"] as! Int)
        for s in c["symbols"] as! [[String: Any]] {
            let esi = UInt32(s["esi"] as! Int)
            let (seg, coef) = enc.layout.coefficients(esi: esi)
            #expect(seg.index == s["segment"] as! Int, "esi \(esi)")
            #expect(coefHex(coef, n: seg.size) == s["coefHex"] as! String, "esi \(esi)")
            #expect(hex(enc.symbol(esi: esi)) == s["symbolHex"] as! String, "esi \(esi)")
        }
    }
}

@Test func sessionCodesAndContainer() throws {
    let s = vectors["session"] as! [String: Any], T = s["T"] as! Int
    let data = vectorPayload(s["fileLen"] as! Int)
    #expect(hex(Array(SHA256.hash(data: data))) == s["sha256Hex"] as! String)
    let container = Container(encoding: .raw, filename: s["filename"] as! String, sha256: Array(SHA256.hash(data: data)), data: data)
    #expect(hex(container.encoded()) == s["containerHex"] as! String)
    #expect(try Container(parsing: container.encoded()) == container)
    let enc = Encoder(payload: container.encoded(), T: T)
    for c in s["codes"] as! [[String: Any]] {
        let esi = UInt32(c["esi"] as! Int)
        let code = try QBeam3.encode(session: UInt32(s["sessionId"] as! Int), L: container.encoded().count, T: T, esi: esi, symbol: enc.symbol(esi: esi))
        #expect(hex(code) == c["codeHex"] as! String)
        guard case .code(let p) = QBeam3.parse(code) else { Issue.record("vector code rejected"); continue }
        #expect(p.esi == esi && p.T == T)
    }
}

@Test func rejectVectors() {
    for c in vectors["reject"] as! [[String: Any]] {
        guard case .rejected(let reason) = QBeam3.parse(unhex(c["codeHex"] as! String)) else {
            Issue.record("not rejected: \(c["reason"]!)"); continue
        }
        #expect(reason == c["reason"] as! String)
    }
    #expect({ if case .notQBeam = QBeam3.parse(Array("Q2HTEST01|4|1000|".utf8)) { return true }; return false }())
    #expect(throws: QBeamError.self) { try Decoder(L: Int(UInt32.max), T: 1) }
}

@Test func encryptionVector() throws {
    let e = vectors["encryption"] as! [String: Any], s = vectors["session"] as! [String: Any]
    let container = unhex(s["containerHex"] as! String), pass = e["passphrase"] as! String
    let sealed = try Envelope.seal(container, passphrase: pass, iterations: UInt32(e["iterations"] as! Int),
                                   salt: unhex(e["saltHex"] as! String), nonce: unhex(e["nonceHex"] as! String))
    #expect(hex(sealed) == e["envelopeHex"] as! String)
    #expect(try Envelope.open(unhex(e["envelopeHex"] as! String), passphrase: pass) == container)
    #expect(throws: QBeamError.envelope("auth")) { try Envelope.open(sealed, passphrase: "wrong") }
    var tampered = sealed; tampered[10] ^= 1
    #expect(throws: QBeamError.envelope("auth")) { try Envelope.open(tampered, passphrase: pass) }
    guard case .code(let p) = QBeam3.parse(unhex(e["codeHex"] as! String)) else { Issue.record("encrypted code rejected"); return }
    #expect(p.flags == QBeam3.flagEncrypted)
}

@Test(arguments: [(5000, 1710, 0.3), (2049 * 100, 100, 0.25), (700_000, 1710, 0.2), (0, 300, 0.0)])
func roundTripUnderLoss(L: Int, T: Int, loss: Double) throws {
    var rng = SystemRandomNumberGenerator()
    let payload = (0..<L).map { _ in UInt8.random(in: 0...255, using: &rng) }
    let enc = Encoder(payload: payload, T: T), dec = try Decoder(L: L, T: T)
    var esi: UInt32 = 0
    while !dec.isComplete {
        let code = try QBeam3.encode(session: 7, L: L, T: T, esi: esi, symbol: enc.symbol(esi: esi))
        esi += 1
        if Double.random(in: 0..<1) < loss { continue }
        guard case .code(let p) = QBeam3.parse(code) else { Issue.record("own code rejected"); return }
        dec.add(esi: p.esi, symbol: p.symbol)
        #expect(Int(esi) < enc.layout.K * 3 + 100, "decoder did not converge")
    }
    #expect(dec.payload() == payload)
}

@Test func safeFilenames() {
    func name(_ n: String) -> String { Container(encoding: .raw, filename: n, sha256: [], data: []).safeFilename }
    #expect(name("../../etc/passwd") == "passwd")
    #expect(name("C:\\Users\\x\\a.txt") == "a.txt")
    #expect(name("..") == "qbeam-file")
    #expect(name("ok 名.txt") == "ok 名.txt")
}
