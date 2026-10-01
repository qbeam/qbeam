package dev.qbeam.core

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.zip.GZIPOutputStream
import kotlin.random.Random

class ReceiverTest {
    private var now = 1_000L
    private val rx = Receiver({ now })

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b)
    private fun gzip(b: ByteArray) = ByteArrayOutputStream().also { GZIPOutputStream(it).use { g -> g.write(b) } }.toByteArray()

    /** All the codes a sender would show for `container`, in order. */
    private fun codes(payload: ByteArray, session: Long, T: Int = 300, flags: Int = 0, extra: Int = 50): List<ByteArray> {
        val enc = Encoder(payload, T)
        return (0 until enc.layout.K + extra).map { QBeam3.encode(session, payload.size, T, it.toLong(), enc.symbol(it.toLong()), flags) }
    }

    private fun receive(codes: List<ByteArray>, loss: Double = 0.0): Receiver.Session {
        for (c in codes) {
            if (Random.nextDouble() < loss) continue
            now += 10
            val e = rx.onCode(c)
            if (e is Receiver.Event.Complete) return e.session
        }
        error("did not complete")
    }

    @Test fun plainAndGzipTransfersVerify() {
        val data = Random.nextBytes(20_000)
        val s = receive(codes(Container(Container.RAW, "a.bin", sha(data), data).encoded(), 1), loss = 0.3)
        val saved = rx.finish(s)
        assertEquals("a.bin", saved.filename); assertArrayEquals(data, saved.bytes)

        val text = "hello qbeam\n".repeat(5000).toByteArray()
        now += Receiver.STALE_MS + 1
        val s2 = receive(codes(Container(Container.GZIP, "../../notes.txt", sha(text), gzip(text)).encoded(), 2))
        val saved2 = rx.finish(s2)
        assertEquals("notes.txt", saved2.filename); assertArrayEquals(text, saved2.bytes)
    }

    @Test fun encryptedNeedsTheRightPassphrase() {
        val data = Random.nextBytes(3000)
        val env = Envelope.seal(Container(Container.RAW, "s.env", sha(data), data).encoded(), "pass", iterations = 1000)
        val s = receive(codes(env, 3, flags = QBeam3.FLAG_ENCRYPTED))
        assertTrue(s.encrypted)
        assertEquals("passphrase", assertThrows<QBeamException> { rx.finish(s) }.reason)
        assertEquals("auth", assertThrows<QBeamException> { rx.finish(s, "nope") }.reason)
        assertArrayEquals(data, rx.finish(s, "pass").bytes)
    }

    @Test fun misreadSymbolIsCaughtAndSessionDropped() {
        val data = Random.nextBytes(5000)
        val good = codes(Container(Container.RAW, "x", sha(data), data).encoded(), 4)
        // Corrupt one symbol but recompute the CRC, as if the QR decoded wrongly yet consistently.
        val bad = good.toMutableList()
        val b = bad[2].copyOf(); b[QBeam3.HEADER] = (b[QBeam3.HEADER].toInt() xor 0x40).toByte()
        val p = QBeam3.parse(good[2]) as ParseResult.Code
        val sym = b.copyOfRange(QBeam3.HEADER, QBeam3.HEADER + p.T)
        bad[2] = QBeam3.encode(p.session, p.L, p.T, p.esi, sym)
        val s = receive(bad)
        assertEquals("checksum", assertThrows<QBeamException> { rx.finish(s) }.reason)
        assertNull(rx.session)
    }

    @Test fun gzipBombIsRefused() {
        val small = Receiver({ now }, maxSavedBytes = 512 * 1024)   // the real cap is 1 GiB; same code path
        val bomb = gzip(ByteArray(1 shl 20))                         // 1 MiB of zeros in ~1 KB
        val all = codes(Container(Container.GZIP, "b", sha(ByteArray(1 shl 20)), bomb).encoded(), 5)
        var s: Receiver.Session? = null
        for (c in all) { val e = small.onCode(c); if (e is Receiver.Event.Complete) { s = e.session; break } }
        assertEquals("too-large", assertThrows<QBeamException> { small.finish(s!!) }.reason)
        assertArrayEquals(ByteArray(1 shl 20), Receiver({ now }).also { r -> all.forEach { r.onCode(it) } }
            .let { r -> r.finish(r.session!!).bytes })                // under the cap it unpacks fine
    }

    @Test fun sessionSwitchingFollowsSpec() {
        val a = codes(Random.nextBytes(4000), 10)
        val b = codes(Random.nextBytes(4000), 11)
        rx.onCode(a[0]); rx.onCode(a[1])
        val active = rx.session
        assertSame(Receiver.Event.Ignored, rx.onCode(b[0]))       // another sender briefly in view: ignored
        assertSame(active, rx.session)
        now += Receiver.STALE_MS + 1
        assertTrue(rx.onCode(b[0]) is Receiver.Event.Progress)     // the first went quiet: follow the new one
        assertEquals(11L, rx.session!!.id)
    }

    @Test fun noticesForCodesWeCantUse() {
        assertTrue(rx.onCode("Q2HTEST01|4|1000|".toByteArray()) is Receiver.Event.Notice)
        val big = ByteArray(23).also {
            it[0] = 0xB3.toByte(); it[1] = 0x71; it[2] = 3; put32(it, 8, 0xFFFFFFFFL); it[13] = 1
            put32(it, 19, QBeam3.crc32(it, 0, 19))
        }
        assertEquals(Receiver.Event.Notice("The sender is offering a transfer larger than qbeam accepts (256 MB)."), rx.onCode(big))
        assertNull(rx.session)
    }

    @Test fun catchRateReflectsLoss() {
        val all = codes(Random.nextBytes(200_000), 12, T = 1000, extra = 0)
        all.forEachIndexed { i, c -> if (i % 3 == 0) { now += 20; rx.onCode(c) } } // catch one code in three
        val rate = rx.catchRate()
        assertNotNull(rate)
        assertTrue(rate!! in 0.3..0.37, "rate $rate")
    }
}
