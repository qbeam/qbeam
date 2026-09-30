"""Encryption envelope (protocol v3 §7) against protocol/test-vectors/v3.json.

Needs the optional `cryptography` package; skipped without it. CI runs it with the package installed.
"""
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from qbeam import crypto_v3, protocol_v3 as p3  # noqa: E402

V = json.loads((pathlib.Path(__file__).resolve().parents[2] / "protocol" / "test-vectors" / "v3.json")
               .read_text(encoding="utf-8"))
E = V["encryption"]
CONTAINER = bytes.fromhex(V["session"]["containerHex"])


@unittest.skipUnless(crypto_v3.available(), 'optional package missing: pip install "qbeam[crypto]"')
class EnvelopeVectorTest(unittest.TestCase):
    def test_seal_matches_vector(self):
        env = crypto_v3.seal(CONTAINER, E["passphrase"], E["iterations"],
                             bytes.fromhex(E["saltHex"]), bytes.fromhex(E["nonceHex"]))
        self.assertEqual(env.hex(), E["envelopeHex"])

    def test_open_vector(self):
        self.assertEqual(crypto_v3.open_envelope(bytes.fromhex(E["envelopeHex"]), E["passphrase"]), CONTAINER)

    def test_encrypted_code_matches_vector(self):
        env = bytes.fromhex(E["envelopeHex"])
        s = V["session"]
        code = p3.encode_code(s["sessionId"], len(env), s["T"], 0, p3.Encoder(env, s["T"]).symbol(0), flags=0x01)
        self.assertEqual(code.hex(), E["codeHex"])

    def test_wrong_passphrase_and_tampering_fail(self):
        env = bytearray.fromhex(E["envelopeHex"])
        with self.assertRaises(ValueError):
            crypto_v3.open_envelope(bytes(env), "wrong passphrase")
        env[40] ^= 1  # ciphertext
        with self.assertRaises(ValueError):
            crypto_v3.open_envelope(bytes(env), E["passphrase"])
        env[40] ^= 1
        env[10] ^= 1  # salt, part of the authenticated prefix
        with self.assertRaises(ValueError):
            crypto_v3.open_envelope(bytes(env), E["passphrase"])

    def test_iteration_limit(self):
        env = bytearray.fromhex(E["envelopeHex"])
        env[1:5] = (crypto_v3.MAX_ITERATIONS + 1).to_bytes(4, "big")
        with self.assertRaisesRegex(ValueError, "out of range"):
            crypto_v3.open_envelope(bytes(env), E["passphrase"])

    def test_fresh_salt_and_nonce(self):
        a = crypto_v3.seal(b"x", "p", iterations=1000)
        b = crypto_v3.seal(b"x", "p", iterations=1000)
        self.assertNotEqual(a[5:33], b[5:33])
        self.assertEqual(crypto_v3.open_envelope(a, "p"), b"x")


class WithoutPackageTest(unittest.TestCase):
    def test_module_imports_without_cryptography(self):
        # Importing crypto_v3 must never require the optional package.
        self.assertTrue(hasattr(crypto_v3, "seal"))


if __name__ == "__main__":
    unittest.main()
