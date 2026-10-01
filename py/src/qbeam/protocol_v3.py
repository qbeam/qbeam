"""qbeam protocol v3 encoder (protocol/SPEC.md, "v3"), stdlib only.

Written from the spec, independently of the JS reference codec; py/tests/test_protocol_v3.py checks it
against protocol/test-vectors/v3.json. Sending side only: the receivers are the web page and the apps.
"""
import struct
import zlib
from typing import List, NamedTuple

MAGIC = b"\xb3\x71"
VERSION = 3
HEADER = 18
OVERHEAD = HEADER + 4
KMAX = 2048
ENCODINGS = {"raw": 0, "gzip": 1}
FLAG_ENCRYPTED = 0x01  # SPEC v3 §2, bit 0; payload is an encryption envelope (§7)

_M32 = 0xFFFFFFFF


def crc32(data: bytes) -> int:
    return zlib.crc32(data) & _M32


def _imul(a: int, b: int) -> int:
    return (a * b) & _M32


def _mulberry32(seed: int):
    a = seed & _M32
    while True:
        a = (a + 0x6D2B79F5) & _M32
        t = _imul(a ^ (a >> 15), 1 | a)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & _M32) ^ t
        yield (t ^ (t >> 14)) & _M32


class Segment(NamedTuple):
    index: int
    start: int  # first block
    size: int   # number of blocks


class Layout(NamedTuple):
    L: int
    T: int
    K: int
    S: int
    segments: List[Segment]


def layout(L: int, T: int) -> Layout:
    """SPEC v3 §3."""
    K = max(1, -(-L // T))
    S = -(-K // KMAX)
    base, extra = divmod(K, S)
    segments, start = [], 0
    for s in range(S):
        size = base + (1 if s < extra else 0)
        segments.append(Segment(s, start, size))
        start += size
    return Layout(L, T, K, S, segments)


def segment_of_block(lay: Layout, block: int) -> Segment:
    base, extra = divmod(lay.K, lay.S)
    big = extra * (base + 1)
    s = block // (base + 1) if block < big else extra + (block - big) // base
    return lay.segments[s]


def coefficients(lay: Layout, esi: int):
    """SPEC v3 §4: (segment, sorted list of the segment's local block indices mixed into symbol `esi`)."""
    if esi < lay.K:
        seg = segment_of_block(lay, esi)
        return seg, [esi - seg.start]
    r = esi - lay.K
    seg, j = lay.segments[r % lay.S], r // lay.S
    n = seg.size
    rand = _mulberry32(_imul(j + 1, 0x9E3779B1) ^ _imul(seg.index + 1, 0x85EBCA6B) ^ n)
    words = [next(rand) for _ in range((n + 31) // 32)]
    if n % 32:
        words[-1] &= (1 << (n % 32)) - 1
    blocks = [32 * w + b for w, word in enumerate(words) for b in range(32) if word >> b & 1]
    return seg, (blocks or [j % n])


class Encoder:
    """Fountain symbols for one payload. Blocks are held as ints so XOR runs in C."""

    def __init__(self, payload: bytes, T: int):
        self.lay = layout(len(payload), T)
        self.T = T
        self._blocks = [int.from_bytes(payload[i * T:(i + 1) * T].ljust(T, b"\0"), "big") for i in range(self.lay.K)]

    def symbol(self, esi: int) -> bytes:
        seg, blocks = coefficients(self.lay, esi)
        acc = 0
        for b in blocks:
            acc ^= self._blocks[seg.start + b]
        return acc.to_bytes(self.T, "big")


def encode_code(session: int, L: int, T: int, esi: int, symbol: bytes, flags: int = 0) -> bytes:
    """SPEC v3 §2: one QR code's bytes."""
    if len(symbol) != T:
        raise ValueError("symbol must be T bytes")
    body = MAGIC + struct.pack(">BBIIHI", VERSION, flags, session, L, T, esi) + symbol
    return body + struct.pack(">I", crc32(body))


def encode_container(filename: str, encoding: str, sha256: bytes, data: bytes) -> bytes:
    """SPEC v3 §5. `sha256` is the digest of the bytes the receiver will save."""
    name = filename.encode("utf-8")
    if len(name) > 0xFFFF:
        raise ValueError("filename too long")
    if len(sha256) != 32:
        raise ValueError("sha256 must be 32 bytes")
    return struct.pack(">BBH", 1, ENCODINGS[encoding], len(name)) + name + sha256 + data
