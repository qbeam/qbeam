// Receiver logic for the iOS app, mirroring android/core Receiver.kt and web/decoder_app.js: sessions, the
// catch-rate hint, and finishing a transfer (decrypt, gunzip with a cap, SHA-256). Platform-free so it's unit-tested.
import CryptoKit
import Foundation

public final class Receiver {
    public static let staleSeconds: TimeInterval = 3     // follow a new sender after this long without new symbols
    static let hintWindow: TimeInterval = 5

    public final class Session {
        public let id: UInt32, L: Int, T: Int, flags: UInt8, started: TimeInterval
        let decoder: Decoder
        var lastNew: TimeInterval
        var recent: [(t: TimeInterval, esi: UInt32)] = []
        public internal(set) var finished = false
        /// When the last needed code arrived (clock time): the transfer's end, before any passphrase or saving.
        public internal(set) var completedAt: TimeInterval?
        public var encrypted: Bool { flags & QBeam3.flagEncrypted != 0 }
        public var progress: Double { Double(decoder.rank) / Double(decoder.layout.K) }
        public var isComplete: Bool { decoder.isComplete }

        init(_ c: Code, now: TimeInterval) throws {
            id = c.session; L = c.L; T = c.T; flags = c.flags; started = now; lastNew = now
            decoder = try Decoder(L: c.L, T: c.T)
        }
        var key: [UInt64] { [UInt64(id), UInt64(L), UInt64(T), UInt64(flags & 0x0F)] }
    }

    public enum Event {
        case ignored
        case notice(String)          // codes we can't use, and why
        case progress(Session)
        case complete(Session)       // call finish(), with a passphrase if encrypted
    }

    public struct Saved { public let filename: String; public let bytes: [UInt8] }

    public private(set) var session: Session?
    let clock: () -> TimeInterval
    let maxSavedBytes: Int

    public init(clock: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 }, maxSavedBytes: Int = 1 << 30) {
        self.clock = clock
        self.maxSavedBytes = maxSavedBytes
    }

    public func onCode(_ bytes: [UInt8]) -> Event {
        if bytes.count >= 3, bytes[0] == UInt8(ascii: "Q"), bytes[1] == UInt8(ascii: "1") || bytes[1] == UInt8(ascii: "2") {
            return .notice("This sender was made by an older qbeam. Regenerate it with the latest version.")
        }
        let c: Code
        switch QBeam3.parse(bytes) {
        case .notQBeam: return .ignored
        case .rejected("version"): return .notice("The sender uses a different qbeam protocol version. Update the older side.")
        case .rejected("flags"): return .notice("The sender uses a feature this app doesn't support yet. Update the app.")
        case .rejected("limits"): return .notice("The sender is offering a transfer larger than qbeam accepts (256 MB).")
        case .rejected: return .ignored  // crc / length: a misread, just drop it
        case .code(let code): c = code
        }
        let now = clock()
        let key: [UInt64] = [UInt64(c.session), UInt64(c.L), UInt64(c.T), UInt64(c.flags & 0x0F)]
        if session == nil || session!.key != key {
            if let s = session, !(s.finished || s.decoder.rank == 0 || now - s.lastNew > Self.staleSeconds) { return .ignored }
            guard let s = try? Session(c, now: now) else { return .ignored }
            session = s
        }
        let s = session!
        if s.finished || s.isComplete { return .ignored }
        let fresh = s.decoder.add(esi: c.esi, symbol: c.symbol)
        if fresh || !s.recent.contains(where: { $0.esi == c.esi }) { s.recent.append((now, c.esi)) }
        if fresh { s.lastNew = now }
        guard s.isComplete else { return .progress(s) }
        s.completedAt = now
        return .complete(s)
    }

    /// Share of codes caught over the last few seconds (senders number codes consecutively), or nil if too early.
    public func catchRate() -> Double? {
        guard let s = session else { return nil }
        let now = clock()
        s.recent.removeAll { now - $0.t > Self.hintWindow }
        guard s.recent.count >= 20 else { return nil }
        let esis = s.recent.map(\.esi), span = Int(esis.max()! - esis.min()!) + 1
        return span >= 30 ? Double(s.recent.count) / Double(span) : nil
    }

    /// Throws .envelope("passphrase") when one is needed, .envelope("auth") for a wrong one, .container("too-large"),
    /// and .container("checksum") when a code was misread (the session is dropped so it can be received again).
    public func finish(_ s: Session, passphrase: String? = nil) throws -> Saved {
        precondition(s.isComplete, "finish() before the session is complete")
        var payload = s.decoder.payload()
        if s.encrypted {
            guard let pass = passphrase else { throw QBeamError.envelope("passphrase") }
            payload = try Envelope.open(payload, passphrase: pass)
        }
        let c = try Container(parsing: payload)
        let data = c.encoding == .gzip ? try Gzip.decompress(c.data, maxBytes: maxSavedBytes) : c.data
        guard Array(SHA256.hash(data: data)) == c.sha256 else {
            if session === s { session = nil }
            throw QBeamError.container("checksum")
        }
        s.finished = true
        return Saved(filename: c.safeFilename, bytes: data)
    }

    public func reset() { session = nil }
}
