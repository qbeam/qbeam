// Encryption envelope (SPEC v3 §7): PBKDF2-HMAC-SHA256 key, AES-256-GCM, the 33-byte prefix authenticated.
import CommonCrypto
import CryptoKit
import Foundation

public enum Envelope {
    static let prefixLength = 33
    static let maxIterations: UInt32 = 10_000_000

    static func key(passphrase: String, salt: [UInt8], iterations: UInt32) -> SymmetricKey {
        var out = [UInt8](repeating: 0, count: 32)
        let pass = Array(passphrase.utf8)
        let status = pass.withUnsafeBufferPointer { p in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), p.baseAddress.map { UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self) },
                                 pass.count, salt, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), iterations, &out, out.count)
        }
        precondition(status == kCCSuccess, "PBKDF2 failed: \(status)")
        return SymmetricKey(data: out)
    }

    /// Decrypts an envelope to the container bytes. Throws .envelope("short" | "scheme" | "iterations" | "auth").
    public static func open(_ env: [UInt8], passphrase: String) throws -> [UInt8] {
        guard env.count >= prefixLength + 16 else { throw QBeamError.envelope("short") }
        guard env[0] == 1 else { throw QBeamError.envelope("scheme") }
        let iterations = be32(env, 1)
        guard iterations >= 1, iterations <= maxIterations else { throw QBeamError.envelope("iterations") }
        let prefix = Array(env[0..<prefixLength])
        let k = key(passphrase: passphrase, salt: Array(env[5..<21]), iterations: iterations)
        do {
            let ct = env[prefixLength..<(env.count - 16)], tag = env[(env.count - 16)...]
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: env[21..<33]), ciphertext: ct, tag: tag)
            return Array(try AES.GCM.open(box, using: k, authenticating: prefix))
        } catch {
            throw QBeamError.envelope("auth")
        }
    }

    /// Encrypts a container (for sending from the phone). Salt and nonce are random unless given (tests only).
    public static func seal(_ container: [UInt8], passphrase: String, iterations: UInt32 = 600_000,
                            salt: [UInt8]? = nil, nonce: [UInt8]? = nil) throws -> [UInt8] {
        let salt = salt ?? (0..<16).map { _ in UInt8.random(in: 0...255) }
        let nonce = nonce ?? (0..<12).map { _ in UInt8.random(in: 0...255) }
        let prefix = [1] + be(iterations) + salt + nonce
        let box = try AES.GCM.seal(container, using: key(passphrase: passphrase, salt: salt, iterations: iterations),
                                   nonce: AES.GCM.Nonce(data: nonce), authenticating: prefix)
        return prefix + Array(box.ciphertext) + Array(box.tag)
    }
}
