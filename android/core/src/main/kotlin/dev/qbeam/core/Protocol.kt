// qbeam protocol v3 (protocol/SPEC.md, "v3"): code framing, segment layout, fountain coefficients, container.
// Written from the spec; the tests check it against protocol/test-vectors/v3.json.
package dev.qbeam.core

import java.util.zip.CRC32

object QBeam3 {
    val MAGIC = byteArrayOf(0xB3.toByte(), 0x71)
    const val VERSION = 3
    const val HEADER = 18
    const val OVERHEAD = HEADER + 4
    const val KMAX = 2048
    const val FLAG_ENCRYPTED = 0x01
    private const val MUST_UNDERSTAND = 0x0F
    private const val KNOWN_FLAGS = FLAG_ENCRYPTED

    // Session limits (SPEC v3 §2), checked before anything is allocated.
    const val T_MIN = 8
    const val T_MAX = 2931
    const val MAX_L = 256 * 1024 * 1024
    const val MAX_K = 1 shl 20

    fun limitsError(L: Long, T: Int): String? = when {
        T < T_MIN || T > T_MAX -> "symbol size $T outside $T_MIN-$T_MAX"
        L > MAX_L -> "payload of $L bytes exceeds $MAX_L"
        maxOf(1L, (L + T - 1) / T) > MAX_K -> "more than $MAX_K blocks"
        else -> null
    }

    fun crc32(b: ByteArray, from: Int = 0, to: Int = b.size): Long = CRC32().apply { update(b, from, to - from) }.value

    /** Parses one QR code's bytes (SPEC v3 §2, receiver checks in order). */
    fun parse(b: ByteArray): ParseResult {
        if (b.size < 3 || b[0] != MAGIC[0] || b[1] != MAGIC[1]) return ParseResult.NotQBeam
        if (b[2].toInt() and 0xFF != VERSION) return ParseResult.Rejected("version")
        if (b.size < OVERHEAD + 1) return ParseResult.Rejected("short")
        val t = be16(b, 12)
        if (t < 1 || b.size != OVERHEAD + t) return ParseResult.Rejected("length")
        if (be32(b, HEADER + t) != crc32(b, 0, HEADER + t)) return ParseResult.Rejected("crc")
        val flags = b[3].toInt() and 0xFF
        if (flags and MUST_UNDERSTAND and KNOWN_FLAGS.inv() != 0) return ParseResult.Rejected("flags")
        val l = be32(b, 8)
        if (limitsError(l, t) != null) return ParseResult.Rejected("limits")
        return ParseResult.Code(be32(b, 4), l.toInt(), t, be32(b, 14), flags, b.copyOfRange(HEADER, HEADER + t))
    }

    fun encode(session: Long, L: Int, T: Int, esi: Long, symbol: ByteArray, flags: Int = 0): ByteArray {
        limitsError(L.toLong(), T)?.let { throw QBeamException("limits", it) }
        require(symbol.size == T) { "symbol must be T bytes" }
        val b = ByteArray(OVERHEAD + T)
        b[0] = MAGIC[0]; b[1] = MAGIC[1]; b[2] = VERSION.toByte(); b[3] = flags.toByte()
        put32(b, 4, session); put32(b, 8, L.toLong()); b[12] = (T ushr 8).toByte(); b[13] = T.toByte(); put32(b, 14, esi)
        symbol.copyInto(b, HEADER)
        put32(b, HEADER + T, crc32(b, 0, HEADER + T))
        return b
    }
}

sealed class ParseResult {
    object NotQBeam : ParseResult()                        // not a v3 code (v1/v2 text frames included)
    data class Rejected(val reason: String) : ParseResult() // ours but unusable
    class Code(val session: Long, val L: Int, val T: Int, val esi: Long, val flags: Int, val symbol: ByteArray) : ParseResult()
}

class QBeamException(val reason: String, message: String = reason) : Exception(message)

internal fun be16(b: ByteArray, i: Int) = (b[i].toInt() and 0xFF shl 8) or (b[i + 1].toInt() and 0xFF)
internal fun be32(b: ByteArray, i: Int): Long =
    ((b[i].toLong() and 0xFF) shl 24) or ((b[i + 1].toLong() and 0xFF) shl 16) or ((b[i + 2].toLong() and 0xFF) shl 8) or (b[i + 3].toLong() and 0xFF)
internal fun put32(b: ByteArray, i: Int, v: Long) {
    b[i] = (v ushr 24).toByte(); b[i + 1] = (v ushr 16).toByte(); b[i + 2] = (v ushr 8).toByte(); b[i + 3] = v.toByte()
}

/** mulberry32 (SPEC v2 §4, reused by v3). Int arithmetic wraps mod 2^32, like JavaScript's Math.imul. */
internal class Mulberry32(private var a: Int) {
    fun next(): Int {
        a += 0x6D2B79F5
        var t = (a xor (a ushr 15)) * (1 or a)
        t = (t + ((t xor (t ushr 7)) * (61 or t))) xor t
        return t xor (t ushr 14)
    }
}

data class Segment(val index: Int, val start: Int, val size: Int)

/** Blocks and segments of a payload (SPEC v3 §3) and each ESI's coefficients (§4). */
class Layout(val L: Int, val T: Int) {
    val K = maxOf(1, ((L.toLong() + T - 1) / T).toInt())
    val S = (K + QBeam3.KMAX - 1) / QBeam3.KMAX
    val segments: List<Segment>

    init {
        val base = K / S
        val extra = K % S
        var start = 0
        segments = (0 until S).map { s -> Segment(s, start, base + if (s < extra) 1 else 0).also { start += it.size } }
    }

    /** The segment `esi` belongs to and its coefficient bitset over that segment's blocks (bit j = local block j). */
    fun coefficients(esi: Long): Pair<Segment, IntArray> {
        if (esi < K) {
            val e = esi.toInt()
            val base = K / S
            val extra = K % S
            val big = extra * (base + 1)
            val seg = segments[if (e < big) e / (base + 1) else extra + (e - big) / base]
            val local = e - seg.start
            return seg to IntArray((seg.size + 31) / 32).also { it[local ushr 5] = 1 shl (local and 31) }
        }
        val r = esi - K
        val seg = segments[(r % S).toInt()]
        val j = r / S
        val n = seg.size
        val rng = Mulberry32(((j + 1).toInt() * 0x9E3779B1.toInt()) xor ((seg.index + 1) * 0x85EBCA6B.toInt()) xor n)
        val c = IntArray((n + 31) / 32) { rng.next() }
        if (n and 31 != 0) c[c.size - 1] = c[c.size - 1] and ((1 shl (n and 31)) - 1)
        if (c.all { it == 0 }) { val b = (j % n).toInt(); c[b ushr 5] = 1 shl (b and 31) }
        return seg to c
    }
}

/** The payload a transfer carries (SPEC v3 §5). */
class Container(val encoding: Int, val filename: String, val sha256: ByteArray, val data: ByteArray) {
    companion object {
        const val RAW = 0
        const val GZIP = 1

        fun parse(b: ByteArray): Container {
            if (b.size < 36 || b[0].toInt() != 1) throw QBeamException("container", "unknown container version")
            val n = be16(b, 2)
            if (b.size < 36 + n) throw QBeamException("container", "container too short")
            val enc = b[1].toInt() and 0xFF
            if (enc != RAW && enc != GZIP) throw QBeamException("container", "unknown encoding $enc")
            return Container(enc, String(b, 4, n, Charsets.UTF_8), b.copyOfRange(4 + n, 36 + n), b.copyOfRange(36 + n, b.size))
        }
    }

    fun encoded(): ByteArray {
        val name = filename.toByteArray(Charsets.UTF_8)
        return byteArrayOf(1, encoding.toByte(), (name.size ushr 8).toByte(), name.size.toByte()) + name + sha256 + data
    }

    /** The filename made safe to save: no directories, no control characters, never "." or "..". */
    val safeFilename: String
        get() {
            val base = filename.split('/', '\\').last().filter { it.code >= 0x20 && it.code != 0x7F }.trim()
            return if (base.isEmpty() || base == "." || base == "..") "qbeam-file" else base
        }
}
