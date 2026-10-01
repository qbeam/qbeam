// Receiver logic shared by the Android app (and mirrored by web/decoder_app.js): sessions, progress, catch-rate hint,
// and finishing a transfer (decrypt, decompress with a size cap, verify SHA-256). Platform-free so it's unit-tested.
package dev.qbeam.core

import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.zip.GZIPInputStream

class Receiver(
    private val clock: () -> Long = System::currentTimeMillis,
    private val maxSavedBytes: Long = MAX_SAVED_BYTES,
) {
    companion object {
        const val STALE_MS = 3_000L                 // follow a new sender after this long without new symbols (SPEC v3 §2)
        const val HINT_WINDOW_MS = 5_000L
        const val MAX_SAVED_BYTES = 1L shl 30        // refuse gzip that expands past 1 GiB
    }

    class Session internal constructor(val id: Long, val L: Int, val T: Int, val flags: Int, val started: Long) {
        internal val decoder = Decoder(L, T)
        internal var lastNew = started
        internal val recent = ArrayDeque<Pair<Long, Long>>() // (time, esi) of codes not seen before, for the hint
        var finished = false; internal set
        val encrypted get() = flags and QBeam3.FLAG_ENCRYPTED != 0
        val progress get() = decoder.rank.toDouble() / decoder.layout.K
        val isComplete get() = decoder.isComplete
    }

    sealed class Event {
        object Ignored : Event()
        data class Notice(val message: String) : Event()          // codes we can't use, and why
        data class Progress(val session: Session) : Event()
        data class Complete(val session: Session) : Event()       // call finish(), with a passphrase if encrypted
    }

    var session: Session? = null; private set

    private fun key(c: ParseResult.Code) = listOf(c.session, c.L.toLong(), c.T.toLong(), (c.flags and 0x0F).toLong())
    private fun Session.key() = listOf(id, L.toLong(), T.toLong(), (flags and 0x0F).toLong())

    /** Feeds one decoded QR code's bytes. */
    fun onCode(bytes: ByteArray): Event {
        if (bytes.size >= 3 && bytes[0] == 'Q'.code.toByte() && (bytes[1] == '1'.code.toByte() || bytes[1] == '2'.code.toByte())) {
            return Event.Notice("This sender was made by an older qbeam. Regenerate it with the latest version.")
        }
        val c = when (val p = QBeam3.parse(bytes)) {
            is ParseResult.NotQBeam -> return Event.Ignored
            is ParseResult.Rejected -> return when (p.reason) {
                "version" -> Event.Notice("The sender uses a different qbeam protocol version. Update the older side.")
                "flags" -> Event.Notice("The sender uses a feature this app doesn't support yet. Update the app.")
                "limits" -> Event.Notice("The sender is offering a transfer larger than qbeam accepts (256 MB).")
                else -> Event.Ignored // crc / length: a misread, just drop it
            }
            is ParseResult.Code -> p
        }
        val now = clock()
        var s = session
        if (s == null || s.key() != key(c)) {
            val idle = s == null || s.finished || s.decoder.rank == 0 || now - s.lastNew > STALE_MS
            if (!idle) return Event.Ignored
            s = Session(c.session, c.L, c.T, c.flags, now)
            session = s
        }
        if (s.finished || s.isComplete) return Event.Ignored
        val fresh = s.decoder.add(c.esi, c.symbol)
        if (fresh || !s.recent.any { it.second == c.esi }) s.recent.addLast(now to c.esi)
        if (fresh) s.lastNew = now
        return if (s.isComplete) Event.Complete(s) else Event.Progress(s)
    }

    /** Share of codes caught over the last few seconds (senders number codes consecutively), or null if too early. */
    fun catchRate(): Double? {
        val s = session ?: return null
        val now = clock()
        while (s.recent.isNotEmpty() && now - s.recent.first().first > HINT_WINDOW_MS) s.recent.removeFirst()
        if (s.recent.size < 20) return null
        val esis = s.recent.map { it.second }
        val span = esis.max() - esis.min() + 1
        return if (span >= 30) s.recent.size.toDouble() / span else null
    }

    class Saved(val filename: String, val bytes: ByteArray)

    /**
     * Turns a completed session into the file to save: decrypts (encrypted transfers need the passphrase), gunzips
     * with a size cap, and checks the SHA-256. Throws QBeamException: "passphrase" (needed), "auth" (wrong passphrase
     * or damaged), "too-large", "checksum" (a code was misread: the session is discarded, receive again), "container".
     */
    fun finish(s: Session, passphrase: String? = null): Saved {
        check(s.isComplete) { "finish() before the session is complete" }
        var payload = s.decoder.payload()
        if (s.encrypted) {
            payload = Envelope.open(payload, passphrase ?: throw QBeamException("passphrase"))
        }
        val c = Container.parse(payload)
        val data = if (c.encoding == Container.GZIP) gunzipCapped(c.data) else c.data
        if (!MessageDigest.getInstance("SHA-256").digest(data).contentEquals(c.sha256)) {
            if (session === s) session = null
            throw QBeamException("checksum", "Checksum mismatch: a code was misread. Keep the camera on the sender to receive it again.")
        }
        s.finished = true
        return Saved(c.safeFilename, data)
    }

    fun reset() { session = null }

    private fun gunzipCapped(gz: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        GZIPInputStream(gz.inputStream()).use { input ->
            val buf = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                if (total > maxSavedBytes) throw QBeamException("too-large", "The file expands to more than 1 GB; refusing to unpack it.")
                out.write(buf, 0, n)
            }
        }
        return out.toByteArray()
    }
}
