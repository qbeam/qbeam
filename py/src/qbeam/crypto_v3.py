"""qbeam protocol v3 encryption envelope (protocol/SPEC.md, v3 §7).

PBKDF2-HMAC-SHA256 comes from the standard library; AES-256-GCM needs the optional `cryptography` package:
    pip install "qbeam[crypto]"
Without it qbeam still works; only encrypted sending is unavailable.
"""
import hashlib
import os
import struct

SCHEME = 1
PREFIX = 33
DEFAULT_ITERATIONS = 600_000
MAX_ITERATIONS = 10_000_000


class CryptoUnavailable(RuntimeError):
    pass


def _aesgcm(key: bytes):
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as e:
        raise CryptoUnavailable('Encryption needs the optional package: pip install "qbeam[crypto]"') from e
    return AESGCM(key)


def available() -> bool:
    try:
        _aesgcm(bytes(32))
        return True
    except CryptoUnavailable:
        return False


def _key(passphrase: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, iterations, dklen=32)


def seal(container: bytes, passphrase: str, iterations: int = DEFAULT_ITERATIONS,
         salt: bytes = None, nonce: bytes = None) -> bytes:
    """Encrypt a container into an envelope. Salt and nonce are random unless given (tests only)."""
    salt = os.urandom(16) if salt is None else salt
    nonce = os.urandom(12) if nonce is None else nonce
    if len(salt) != 16 or len(nonce) != 12:
        raise ValueError("salt must be 16 bytes and nonce 12 bytes")
    prefix = struct.pack(">BI", SCHEME, iterations) + salt + nonce
    return prefix + _aesgcm(_key(passphrase, salt, iterations)).encrypt(nonce, container, prefix)


def open_envelope(envelope: bytes, passphrase: str) -> bytes:
    """Decrypt an envelope. Raises ValueError on a malformed envelope, wrong passphrase or tampering."""
    if len(envelope) < PREFIX + 16:
        raise ValueError("envelope too short")
    scheme, iterations = struct.unpack(">BI", envelope[:5])
    if scheme != SCHEME:
        raise ValueError(f"unknown encryption scheme {scheme}")
    if not 1 <= iterations <= MAX_ITERATIONS:
        raise ValueError(f"iteration count {iterations} out of range")
    prefix, salt, nonce = envelope[:PREFIX], envelope[5:21], envelope[21:33]
    try:
        return _aesgcm(_key(passphrase, salt, iterations)).decrypt(nonce, envelope[PREFIX:], prefix)
    except CryptoUnavailable:
        raise
    except Exception as e:  # cryptography raises InvalidTag
        raise ValueError("wrong passphrase or damaged transfer") from e
