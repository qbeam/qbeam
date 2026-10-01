// qbeam protocol v3 (protocol/SPEC.md, "v3"): code framing, segment layout, fountain coefficients, container.
// Written from the spec; Tests/QBeamKitTests check it against protocol/test-vectors/v3.json.
import Foundation

public enum QBeam3 {
    public static let magic: [UInt8] = [0xB3, 0x71]
    public static let version: UInt8 = 3
    public static let header = 18
    public static let overhead = header + 4
    public static let kmax = 2048
    public static let flagEncrypted: UInt8 = 0x01
    static let mustUnderstand: UInt8 = 0x0F
    static let knownFlags: UInt8 = flagEncrypted

    // Session limits (SPEC v3 §2), checked before anything is allocated.
    public static let tMin = 8, tMax = 2931
    public static let maxL = 256 * 1024 * 1024, maxK = 1 << 20

    public static func limitsError(L: Int, T: Int) -> String? {
        if T < tMin || T > tMax { return "symbol size \(T) outside \(tMin)-\(tMax)" }
        if L > maxL { return "payload of \(L) bytes exceeds \(maxL)" }
        if max(1, (L + T - 1) / T) > maxK { return "more than \(maxK) blocks" }
        return nil
    }
}

// MARK: - CRC-32 (IEEE 802.3, as zlib)

enum CRC32 {
    static let table: [UInt32] = (0..<256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func checksum<C: Collection>(_ bytes: C) -> UInt32 where C.Element == UInt8 {
        var c: UInt32 = 0xFFFF_FFFF
        for b in bytes { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }
}

// MARK: - mulberry32 (SPEC v2 §4, reused by v3)

struct Mulberry32 {
    var a: UInt32
    mutating func next() -> UInt32 {
        a = a &+ 0x6D2B_79F5
        var t = (a ^ (a >> 15)) &* (1 | a)
        t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
        return t ^ (t >> 14)
    }
}

// MARK: - Segments and coefficients (SPEC v3 §3, §4)

public struct Segment: Equatable {
    public let index: Int
    public let start: Int
    public let size: Int
}

public struct Layout {
    public let L: Int
    public let T: Int
    public let K: Int
    public let S: Int
    public let segments: [Segment]

    public init(L: Int, T: Int) {
        self.L = L
        self.T = T
        K = max(1, (L + T - 1) / T)
        S = (K + QBeam3.kmax - 1) / QBeam3.kmax
        let base = K / S, extra = K % S
        var segs: [Segment] = [], start = 0
        for s in 0..<S {
            let size = base + (s < extra ? 1 : 0)
            segs.append(Segment(index: s, start: start, size: size))
            start += size
        }
        segments = segs
    }

    /// The segment an ESI belongs to and the coefficient bitset over that segment's blocks (bit j = local block j).
    public func coefficients(esi: UInt32) -> (segment: Segment, coef: [UInt32]) {
        let e = Int(esi)
        if e < K {
            let base = K / S, extra = K % S, big = extra * (base + 1)
            let s = e < big ? e / (base + 1) : extra + (e - big) / base
            let seg = segments[s], local = e - seg.start
            var c = [UInt32](repeating: 0, count: (seg.size + 31) / 32)
            c[local >> 5] = 1 << UInt32(local & 31)
            return (seg, c)
        }
        let r = e - K, seg = segments[r % S], j = r / S, n = seg.size
        var rng = Mulberry32(a: (UInt32(truncatingIfNeeded: j + 1) &* 0x9E37_79B1)
                                ^ (UInt32(truncatingIfNeeded: seg.index + 1) &* 0x85EB_CA6B)
                                ^ UInt32(truncatingIfNeeded: n))
        var c = (0..<((n + 31) / 32)).map { _ in rng.next() }
        if n & 31 != 0 { c[c.count - 1] &= (UInt32(1) << UInt32(n & 31)) &- 1 }
        if c.allSatisfy({ $0 == 0 }) { let b = j % n; c[b >> 5] = 1 << UInt32(b & 31) }
        return (seg, c)
    }
}

// MARK: - Code framing (SPEC v3 §2)

public struct Code {
    public let session: UInt32
    public let L: Int
    public let T: Int
    public let esi: UInt32
    public let flags: UInt8
    public let symbol: [UInt8]
}

public enum ParseResult {
    case notQBeam            // not a v3 code (could be anything, including v1/v2 text frames)
    case rejected(String)    // ours but unusable: "version", "short", "length", "crc", "flags", "limits"
    case code(Code)
}

extension QBeam3 {
    public static func parse(_ b: [UInt8]) -> ParseResult {
        guard b.count >= 3, b[0] == magic[0], b[1] == magic[1] else { return .notQBeam }
        guard b[2] == version else { return .rejected("version") }
        guard b.count >= overhead + 1 else { return .rejected("short") }
        let T = Int(be16(b, 12))
        guard T >= 1, b.count == overhead + T else { return .rejected("length") }
        guard be32(b, header + T) == CRC32.checksum(b[0..<(header + T)]) else { return .rejected("crc") }
        guard b[3] & mustUnderstand & ~knownFlags == 0 else { return .rejected("flags") }
        let L = Int(be32(b, 8))
        guard limitsError(L: L, T: T) == nil else { return .rejected("limits") }
        return .code(Code(session: be32(b, 4), L: L, T: T, esi: be32(b, 14), flags: b[3], symbol: Array(b[header..<(header + T)])))
    }

    public static func encode(session: UInt32, L: Int, T: Int, esi: UInt32, symbol: [UInt8], flags: UInt8 = 0) throws -> [UInt8] {
        if let err = limitsError(L: L, T: T) { throw QBeamError.limits(err) }
        precondition(symbol.count == T, "symbol must be T bytes")
        var b = magic + [version, flags]
        b += be(session) + be(UInt32(L)) + [UInt8(T >> 8), UInt8(T & 0xFF)] + be(esi) + symbol
        return b + be(CRC32.checksum(b))
    }
}

public enum QBeamError: Error, Equatable {
    case limits(String)
    case container(String)
    case envelope(String)   // "short", "scheme", "iterations", "auth"
}

func be16(_ b: [UInt8], _ i: Int) -> UInt16 { UInt16(b[i]) << 8 | UInt16(b[i + 1]) }
func be32(_ b: [UInt8], _ i: Int) -> UInt32 {
    UInt32(b[i]) << 24 | UInt32(b[i + 1]) << 16 | UInt32(b[i + 2]) << 8 | UInt32(b[i + 3])
}
func be(_ v: UInt32) -> [UInt8] { [UInt8(v >> 24), UInt8(v >> 16 & 0xFF), UInt8(v >> 8 & 0xFF), UInt8(v & 0xFF)] }

// MARK: - Container (SPEC v3 §5)

public struct Container: Equatable {
    public enum Encoding: UInt8 { case raw = 0, gzip = 1 }
    public let encoding: Encoding
    public let filename: String
    public let sha256: [UInt8]
    public let data: [UInt8]

    public init(encoding: Encoding, filename: String, sha256: [UInt8], data: [UInt8]) {
        self.encoding = encoding
        self.filename = filename
        self.sha256 = sha256
        self.data = data
    }

    public init(parsing b: [UInt8]) throws {
        guard b.count >= 36, b[0] == 1 else { throw QBeamError.container("unknown container version") }
        let n = Int(be16(b, 2))
        guard b.count >= 36 + n else { throw QBeamError.container("container too short") }
        guard let enc = Encoding(rawValue: b[1]) else { throw QBeamError.container("unknown encoding \(b[1])") }
        encoding = enc
        filename = String(decoding: b[4..<(4 + n)], as: UTF8.self)
        sha256 = Array(b[(4 + n)..<(36 + n)])
        data = Array(b[(36 + n)...])
    }

    public func encoded() -> [UInt8] {
        let name = Array(filename.utf8)
        return [1, encoding.rawValue, UInt8(name.count >> 8), UInt8(name.count & 0xFF)] + name + sha256 + data
    }

    /// The filename made safe to save: no directories, no control characters, never "." or "..".
    public var safeFilename: String {
        let base = filename.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
        let clean = String(base.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7F }).trimmingCharacters(in: .whitespaces)
        return clean.isEmpty || clean == "." || clean == ".." ? "qbeam-file" : clean
    }
}
