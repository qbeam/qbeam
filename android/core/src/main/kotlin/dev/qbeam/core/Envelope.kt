// Encryption envelope (SPEC v3 §7): PBKDF2-HMAC-SHA256 key, AES-256-GCM, the 33-byte prefix authenticated.
package dev.qbeam.core

import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

object Envelope {
    private const val PREFIX = 33
    private const val MAX_ITERATIONS = 10_000_000L

    private fun key(passphrase: String, salt: ByteArray, iterations: Int): SecretKeySpec {
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, iterations, 256)
        return SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded, "AES")
    }

    /** Decrypts an envelope to the container bytes. Throws QBeamException("short" | "scheme" | "iterations" | "auth"). */
    fun open(env: ByteArray, passphrase: String): ByteArray {
        if (env.size < PREFIX + 16) throw QBeamException("short")
        if (env[0].toInt() != 1) throw QBeamException("scheme")
        val iterations = be32(env, 1)
        if (iterations < 1 || iterations > MAX_ITERATIONS) throw QBeamException("iterations")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(passphrase, env.copyOfRange(5, 21), iterations.toInt()),
                    GCMParameterSpec(128, env.copyOfRange(21, 33)))
        cipher.updateAAD(env, 0, PREFIX)
        return try { cipher.doFinal(env, PREFIX, env.size - PREFIX) } catch (e: AEADBadTagException) { throw QBeamException("auth") }
    }

    /** Encrypts a container (for sending from the phone). Salt and nonce are random unless given (tests only). */
    fun seal(container: ByteArray, passphrase: String, iterations: Int = 600_000,
             salt: ByteArray? = null, nonce: ByteArray? = null): ByteArray {
        val rnd = SecureRandom()
        val s = salt ?: ByteArray(16).also { rnd.nextBytes(it) }
        val iv = nonce ?: ByteArray(12).also { rnd.nextBytes(it) }
        val prefix = ByteArray(PREFIX)
        prefix[0] = 1; put32(prefix, 1, iterations.toLong()); s.copyInto(prefix, 5); iv.copyInto(prefix, 21)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(passphrase, s, iterations), GCMParameterSpec(128, iv))
        cipher.updateAAD(prefix)
        return prefix + cipher.doFinal(container)
    }
}
