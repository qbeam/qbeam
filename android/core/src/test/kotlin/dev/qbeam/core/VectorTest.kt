// qbeam-core against protocol/test-vectors/v3.json (generated from the JS reference codec) plus decode round trips.
package dev.qbeam.core

import org.json.JSONObject
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import java.io.File
import java.security.MessageDigest
import kotlin.random.Random

class VectorTest {
    private val v = JSONObject(File(System.getProperty("qbeam.vectors") ?: "../../protocol/test-vectors/v3.json").readText())

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    private fun unhex(s: String) = ByteArray(s.length / 2) { s.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
    private fun vectorPayload(n: Int) = ByteArray(n) { ((it * 31 + 7) and 0xFF).toByte() }
    private fun sha256(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b)
    private fun coefHex(w: IntArray, n: Int): String {
        val out = ByteArray((n + 7) / 8)
        for (j in 0 until n) if (w[j ushr 5] and (1 shl (j and 31)) != 0) out[j ushr 3] = (out[j ushr 3].toInt() or (1 shl (j and 7))).toByte()
        return hex(out)
    }

    @Test fun constants() {
        val c = v.getJSONObject("constants")
        assertEquals(listOf(c.getJSONArray("magic").getInt(0), c.getJSONArray("magic").getInt(1)), QBeam3.MAGIC.map { it.toInt() and 0xFF })
        assertEquals(listOf(c.getInt("version"), c.getInt("headerBytes"), c.getInt("overheadBytes"), c.getInt("kmax"),
                            c.getInt("tMin"), c.getInt("tMax"), c.getInt("maxL"), c.getInt("maxK")),
                     listOf(QBeam3.VERSION, QBeam3.HEADER, QBeam3.OVERHEAD, QBeam3.KMAX, QBeam3.T_MIN, QBeam3.T_MAX, QBeam3.MAX_L, QBeam3.MAX_K))
    }

    @Test fun crc32() {
        val a = v.getJSONArray("crc32")
        for (i in 0 until a.length()) {
            val c = a.getJSONObject(i)
            assertEquals(c.getLong("crc32"), QBeam3.crc32(c.getString("asciiInput").toByteArray(Charsets.US_ASCII)))
        }
    }

    @Test fun layouts() {
        val a = v.getJSONArray("layouts")
        for (i in 0 until a.length()) {
            val c = a.getJSONObject(i)
            val lay = Layout(c.getInt("L"), c.getInt("T"))
            assertEquals(c.getInt("K"), lay.K); assertEquals(c.getInt("S"), lay.S)
            val segs = c.getJSONArray("segments")
            assertEquals((0 until segs.length()).map { listOf(segs.getJSONArray(it).getInt(0), segs.getJSONArray(it).getInt(1)) },
                         lay.segments.map { listOf(it.start, it.size) })
        }
    }

    @Test fun fountainSymbols() {
        val a = v.getJSONArray("fountain")
        for (i in 0 until a.length()) {
            val c = a.getJSONObject(i)
            val enc = Encoder(vectorPayload(c.getInt("L")), c.getInt("T"))
            val syms = c.getJSONArray("symbols")
            for (k in 0 until syms.length()) {
                val s = syms.getJSONObject(k)
                val esi = s.getLong("esi")
                val (seg, coef) = enc.layout.coefficients(esi)
                assertEquals(s.getInt("segment"), seg.index, "esi $esi")
                assertEquals(s.getString("coefHex"), coefHex(coef, seg.size), "esi $esi")
                assertEquals(s.getString("symbolHex"), hex(enc.symbol(esi)), "esi $esi")
            }
        }
    }

    @Test fun sessionCodesAndContainer() {
        val s = v.getJSONObject("session")
        val data = vectorPayload(s.getInt("fileLen"))
        assertEquals(s.getString("sha256Hex"), hex(sha256(data)))
        val container = Container(Container.RAW, s.getString("filename"), sha256(data), data).encoded()
        assertEquals(s.getString("containerHex"), hex(container))
        val parsed = Container.parse(container)
        assertEquals(s.getString("filename"), parsed.filename); assertArrayEquals(data, parsed.data)
        val T = s.getInt("T")
        val enc = Encoder(container, T)
        val codes = s.getJSONArray("codes")
        for (k in 0 until codes.length()) {
            val c = codes.getJSONObject(k)
            val esi = c.getLong("esi")
            val code = QBeam3.encode(s.getLong("sessionId"), container.size, T, esi, enc.symbol(esi))
            assertEquals(c.getString("codeHex"), hex(code))
            val p = QBeam3.parse(code) as ParseResult.Code
            assertEquals(esi, p.esi); assertEquals(T, p.T)
        }
    }

    @Test fun rejectVectors() {
        val a = v.getJSONArray("reject")
        for (i in 0 until a.length()) {
            val c = a.getJSONObject(i)
            assertEquals(ParseResult.Rejected(c.getString("reason")), QBeam3.parse(unhex(c.getString("codeHex"))))
        }
        assertEquals(ParseResult.NotQBeam, QBeam3.parse("Q2HTEST01|4|1000|".toByteArray()))
        assertThrows<QBeamException> { Decoder(Int.MAX_VALUE, 1) }
    }

    @Test fun encryptionVector() {
        val e = v.getJSONObject("encryption")
        val container = unhex(v.getJSONObject("session").getString("containerHex"))
        val pass = e.getString("passphrase")
        val sealed = Envelope.seal(container, pass, e.getInt("iterations"), unhex(e.getString("saltHex")), unhex(e.getString("nonceHex")))
        assertEquals(e.getString("envelopeHex"), hex(sealed))
        assertArrayEquals(container, Envelope.open(sealed, pass))
        assertEquals("auth", assertThrows<QBeamException> { Envelope.open(sealed, "wrong") }.reason)
        val tampered = sealed.copyOf().also { it[10] = (it[10].toInt() xor 1).toByte() }
        assertEquals("auth", assertThrows<QBeamException> { Envelope.open(tampered, pass) }.reason)
        val p = QBeam3.parse(unhex(e.getString("codeHex"))) as ParseResult.Code
        assertEquals(QBeam3.FLAG_ENCRYPTED, p.flags)
    }

    @ParameterizedTest
    @CsvSource("5000,1710,0.3", "204900,100,0.25", "700000,1710,0.2", "0,300,0.0")
    fun roundTripUnderLoss(L: Int, T: Int, loss: Double) {
        val payload = Random.nextBytes(L)
        val enc = Encoder(payload, T)
        val dec = Decoder(L, T)
        var esi = 0L
        while (!dec.isComplete) {
            val code = QBeam3.encode(7, L, T, esi, enc.symbol(esi))
            esi++
            if (Random.nextDouble() < loss) continue
            val p = QBeam3.parse(code) as ParseResult.Code
            dec.add(p.esi, p.symbol)
            assertTrue(esi < enc.layout.K * 3L + 100, "decoder did not converge")
        }
        assertArrayEquals(payload, dec.payload())
    }

    @Test fun safeFilenames() {
        fun name(n: String) = Container(Container.RAW, n, ByteArray(32), ByteArray(0)).safeFilename
        assertEquals("passwd", name("../../etc/passwd"))
        assertEquals("a.txt", name("C:\\Users\\x\\a.txt"))
        assertEquals("qbeam-file", name(".."))
        assertEquals("ok 名.txt", name("ok 名.txt"))
    }
}
