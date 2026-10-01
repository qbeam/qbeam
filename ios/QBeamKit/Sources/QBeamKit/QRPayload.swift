// Recovers the bytes of a QR code from its error-corrected data codewords (what Vision exposes through
// CIQRCodeDescriptor.errorCorrectedPayload). Vision's string payload can't carry binary data; qbeam codes are one
// byte-mode segment (ISO 18004 §7.4), so the bytes are read straight from the bitstream.
import Foundation

public enum QRPayload {
    /// Concatenated bytes of all byte-mode segments, skipping ECI headers; nil for other modes (not qbeam).
    public static func bytes(fromDataCodewords cw: Data, version: Int) -> [UInt8]? {
        var r = BitReader(Array(cw))
        var out = [UInt8]()
        while r.remaining >= 4 {
            switch r.read(4) {
            case 0b0000: return out                                  // terminator
            case 0b0100:                                             // byte mode
                let count = r.read(version < 10 ? 8 : 16)
                guard r.remaining >= count * 8 else { return nil }
                for _ in 0..<count { out.append(UInt8(r.read(8))) }
            case 0b0111:                                             // ECI designator: 1, 2 or 3 bytes
                let first = r.read(8)
                if first & 0x80 == 0 { break }
                _ = r.read(first & 0x40 == 0 ? 8 : 16)
            default:
                return nil                                           // numeric / alphanumeric / kanji: not ours
            }
        }
        return out
    }
}

struct BitReader {
    let bytes: [UInt8]
    var pos = 0
    init(_ b: [UInt8]) { bytes = b }
    var remaining: Int { bytes.count * 8 - pos }
    mutating func read(_ n: Int) -> Int {
        var v = 0
        for _ in 0..<n {
            let bit = pos < bytes.count * 8 ? (bytes[pos >> 3] >> (7 - UInt8(pos & 7))) & 1 : 0
            v = v << 1 | Int(bit)
            pos += 1
        }
        return v
    }
}
