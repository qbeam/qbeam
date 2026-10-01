// Segmented systematic fountain code over GF(2) (SPEC v3 §3–§4): encoder (for sending from the phone) and decoder.
package dev.qbeam.core

internal fun words(b: ByteArray, from: Int, to: Int, T: Int): IntArray {
    val w = IntArray((T + 3) / 4)
    for (k in 0 until minOf(T, to - from)) w[k ushr 2] = w[k ushr 2] or ((b[from + k].toInt() and 0xFF) shl ((k and 3) * 8))
    return w
}

internal fun toBytes(w: IntArray, T: Int) = ByteArray(T) { k -> (w[k ushr 2] ushr ((k and 3) * 8)).toByte() }

internal fun xorInto(dst: IntArray, src: IntArray, start: Int = 0) {
    for (i in start until dst.size) dst[i] = dst[i] xor src[i]
}

class Encoder(payload: ByteArray, val T: Int) {
    val layout = Layout(payload.size, T)
    private val blocks = Array(layout.K) { i ->
        words(payload, minOf(i * T, payload.size), minOf((i + 1) * T, payload.size), T)
    }

    fun symbol(esi: Long): ByteArray {
        val (seg, coef) = layout.coefficients(esi)
        val out = IntArray((T + 3) / 4)
        for (w in coef.indices) {
            var bits = coef[w]
            while (bits != 0) {
                xorInto(out, blocks[seg.start + w * 32 + Integer.numberOfTrailingZeros(bits)])
                bits = bits and (bits - 1)
            }
        }
        return toBytes(out, T)
    }
}

internal class SegmentDecoder(private val n: Int, private val T: Int) {
    private val wordCount = (n + 31) / 32
    private var pivotCoef = arrayOfNulls<IntArray>(n)
    private var pivotData = arrayOfNulls<IntArray>(n)
    var rank = 0; private set
    var solved: ByteArray? = null; private set

    fun add(c: IntArray, symbol: ByteArray): Boolean {
        if (solved != null || rank == n) return false
        val coef = c.copyOf()
        val data = words(symbol, 0, symbol.size, T)
        var w = 0
        while (true) {
            while (w < wordCount && coef[w] == 0) w++
            if (w == wordCount) return false // nothing new
            val bit = w * 32 + Integer.numberOfTrailingZeros(coef[w])
            val pc = pivotCoef[bit]
            if (pc == null) {
                pivotCoef[bit] = coef; pivotData[bit] = data
                if (++rank == n) solve()
                return true
            }
            xorInto(coef, pc, w)
            xorInto(data, pivotData[bit]!!)
        }
    }

    private fun solve() {
        for (col in n - 1 downTo 0) {
            val coef = pivotCoef[col]!!
            val data = pivotData[col]!!
            val w0 = col ushr 5
            for (w in w0 until wordCount) {
                var bits = coef[w]
                if (w == w0) bits = bits and ((2 shl (col and 31)) - 1).inv() // only columns above `col`
                while (bits != 0) {
                    xorInto(data, pivotData[w * 32 + Integer.numberOfTrailingZeros(bits)]!!)
                    bits = bits and (bits - 1)
                }
            }
        }
        val out = ByteArray(n * T)
        for (i in 0 until n) toBytes(pivotData[i]!!, T).copyInto(out, i * T)
        solved = out
        pivotCoef = arrayOfNulls(0); pivotData = arrayOfNulls(0) // free the working rows
    }
}

/** Throws QBeamException("limits") for sessions outside SPEC v3 §2, before allocating anything. */
class Decoder(L: Int, T: Int) {
    val layout: Layout
    var rank = 0; private set
    private val seen = HashSet<Long>()
    private val segments: Array<SegmentDecoder?>

    init {
        QBeam3.limitsError(L.toLong(), T)?.let { throw QBeamException("limits", it) }
        layout = Layout(L, T)
        segments = arrayOfNulls(layout.S) // created when their first symbol arrives
    }

    val isComplete get() = rank == layout.K

    /** Adds one symbol; returns true if it carried new information. */
    fun add(esi: Long, symbol: ByteArray): Boolean {
        if (symbol.size != layout.T || !seen.add(esi)) return false
        val (seg, coef) = layout.coefficients(esi)
        val sd = segments[seg.index] ?: SegmentDecoder(seg.size, layout.T).also { segments[seg.index] = it }
        return sd.add(coef, symbol).also { if (it) rank++ }
    }

    fun payload(): ByteArray {
        check(isComplete) { "payload() before the decoder is complete" }
        val out = ByteArray(layout.L)
        var pos = 0
        for (s in segments) {
            val d = s!!.solved!!
            val n = minOf(d.size, layout.L - pos)
            d.copyInto(out, pos, 0, n)
            pos += n
        }
        return out
    }
}
