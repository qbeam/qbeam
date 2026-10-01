// Segmented systematic fountain code over GF(2) (SPEC v3 §3–§4): encoder (for sending from the phone) and decoder.
import Foundation

@inline(__always)
func xorInto(_ dst: inout [UInt32], _ src: [UInt32], from start: Int = 0) {
    dst.withUnsafeMutableBufferPointer { d in
        src.withUnsafeBufferPointer { s in
            var i = start
            while i < d.count { d[i] ^= s[i]; i += 1 }
        }
    }
}

func words(_ bytes: ArraySlice<UInt8>, T: Int) -> [UInt32] {
    var w = [UInt32](repeating: 0, count: (T + 3) / 4)
    for (k, b) in bytes.prefix(T).enumerated() { w[k >> 2] |= UInt32(b) << UInt32((k & 3) * 8) } // little-endian packing
    return w
}

func bytes(_ w: [UInt32], T: Int) -> [UInt8] {
    (0..<T).map { k in UInt8(truncatingIfNeeded: w[k >> 2] >> UInt32((k & 3) * 8)) }
}

public final class Encoder {
    public let layout: Layout
    let blocks: [[UInt32]]

    public init(payload: [UInt8], T: Int) {
        layout = Layout(L: payload.count, T: T)
        blocks = (0..<layout.K).map { i in
            let lo = min(i * T, payload.count), hi = min((i + 1) * T, payload.count)
            return words(payload[lo..<hi], T: T)
        }
    }

    public func symbol(esi: UInt32) -> [UInt8] {
        let (seg, coef) = layout.coefficients(esi: esi)
        var out = [UInt32](repeating: 0, count: (layout.T + 3) / 4)
        for (w, word) in coef.enumerated() {
            var bits = word
            while bits != 0 {
                let low = bits.trailingZeroBitCount
                xorInto(&out, blocks[seg.start + w * 32 + low])
                bits &= bits - 1
            }
        }
        return bytes(out, T: layout.T)
    }
}

final class SegmentDecoder {
    let n: Int, wordCount: Int, T: Int
    var pivots: [(coef: [UInt32], data: [UInt32])?]
    var rank = 0
    var solved: [UInt8]?

    init(size: Int, T: Int) {
        n = size
        wordCount = (size + 31) / 32
        self.T = T
        pivots = Array(repeating: nil, count: size)
    }

    func add(coef c: [UInt32], symbol: [UInt8]) -> Bool {
        if solved != nil || rank == n { return false }
        var coef = c, data = words(symbol[...], T: T), w = 0
        while true {
            while w < wordCount && coef[w] == 0 { w += 1 }
            if w == wordCount { return false } // nothing new
            let bit = w * 32 + coef[w].trailingZeroBitCount
            guard let p = pivots[bit] else {
                pivots[bit] = (coef, data)
                rank += 1
                if rank == n { solve() }
                return true
            }
            xorInto(&coef, p.coef, from: w)
            xorInto(&data, p.data)
        }
    }

    func solve() {
        for col in stride(from: n - 1, through: 0, by: -1) {
            var p = pivots[col]!
            let w0 = col >> 5
            for w in w0..<wordCount {
                var bits = p.coef[w]
                if w == w0 { bits &= ~((UInt32(2) << UInt32(col & 31)) &- 1) } // only columns above `col`
                while bits != 0 {
                    xorInto(&p.data, pivots[w * 32 + bits.trailingZeroBitCount]!.data)
                    bits &= bits - 1
                }
            }
            pivots[col] = p
        }
        var out = [UInt8](); out.reserveCapacity(n * T)
        for i in 0..<n { out += bytes(pivots[i]!.data, T: T) }
        solved = out
        pivots = [] // free the working rows
    }
}

public final class Decoder {
    public let layout: Layout
    public private(set) var rank = 0
    var seen = Set<UInt32>()
    var segments: [SegmentDecoder?]

    /// Throws `.limits` for sessions outside SPEC v3 §2, before allocating anything.
    public init(L: Int, T: Int) throws {
        if let err = QBeam3.limitsError(L: L, T: T) { throw QBeamError.limits(err) }
        layout = Layout(L: L, T: T)
        segments = Array(repeating: nil, count: layout.S) // created when their first symbol arrives
    }

    public var isComplete: Bool { rank == layout.K }

    /// Adds one symbol; returns true if it carried new information.
    @discardableResult
    public func add(esi: UInt32, symbol: [UInt8]) -> Bool {
        guard symbol.count == layout.T, seen.insert(esi).inserted else { return false }
        let (seg, coef) = layout.coefficients(esi: esi)
        let sd = segments[seg.index] ?? SegmentDecoder(size: seg.size, T: layout.T)
        segments[seg.index] = sd
        let added = sd.add(coef: coef, symbol: symbol)
        if added { rank += 1 }
        return added
    }

    public func payload() -> [UInt8] {
        precondition(isComplete, "payload() before the decoder is complete")
        var out = [UInt8](); out.reserveCapacity(layout.L)
        for s in segments { out += s!.solved! }
        return Array(out.prefix(layout.L))
    }
}
