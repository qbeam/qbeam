"""Checks protocol/test-vectors/v2.json against an implementation written from protocol/SPEC.md alone.

If this fails while js/test passes, the spec text and the reference codec disagree.
"""
import base64
import hashlib
import json
import pathlib
import unittest

VECTORS = json.loads((pathlib.Path(__file__).resolve().parents[2] / "protocol" / "test-vectors" / "v2.json")
                     .read_text(encoding="utf-8"))
M32 = 0xFFFFFFFF


def imul(a, b):
    return (a * b) & M32


def mulberry32(seed):
    a = seed & M32
    while True:
        a = (a + 0x6D2B79F5) & M32
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & M32) ^ t
        yield (t ^ (t >> 14)) & M32


def coefficient_blocks(esi, k):
    """SPEC v2 §4: the source blocks mixed into symbol `esi`."""
    if esi < k:
        return [esi]
    rand = mulberry32(imul(esi, 0x9E3779B1) ^ k)
    words = [next(rand) for _ in range((k + 31) // 32)]
    if k % 32:
        words[-1] &= (1 << (k % 32)) - 1
    blocks = [32 * w + j for w, word in enumerate(words) for j in range(32) if word >> j & 1]
    return blocks or [esi % k]


def source_blocks(payload, block_size):
    k = max(1, -(-len(payload) // block_size))
    return [payload[i * block_size:(i + 1) * block_size].ljust(block_size, b"\0") for i in range(k)]


def symbol(blocks, esi):
    out = bytearray(len(blocks[0]))
    for b in coefficient_blocks(esi, len(blocks)):
        for i, byte in enumerate(blocks[b]):
            out[i] ^= byte
    return bytes(out)


def vector_payload(n):
    return bytes((i * 31 + 7) & 0xFF for i in range(n))


class ProtocolV2VectorTest(unittest.TestCase):
    def test_fountain_symbols(self):
        for case in VECTORS["fountain"]:
            blocks = source_blocks(vector_payload(case["payloadLen"]), case["blockSize"])
            self.assertEqual(len(blocks), case["K"], case["name"])
            for s in case["symbols"]:
                with self.subTest(case=case["name"], esi=s["esi"]):
                    self.assertEqual(coefficient_blocks(s["esi"], case["K"]), s["blocks"])
                    self.assertEqual(symbol(blocks, s["esi"]).hex(), s["symbolHex"])

    def test_frame_text(self):
        f = VECTORS["frames"]
        payload = vector_payload(f["payloadLen"])
        blocks = source_blocks(payload, f["blockSize"])
        self.assertEqual(hashlib.sha256(payload).hexdigest(), f["sha"])
        common = f"{f['id']}|{len(blocks)}|{len(payload)}|"
        name_b64 = base64.b64encode(f["filename"].encode("utf-8")).decode("ascii")
        self.assertEqual(f"Q2H{common}{f['sha']}|{name_b64}|{f['encoding']}", f["header"])
        for d in f["data"]:
            sym = base64.b64encode(symbol(blocks, d["esi"])).decode("ascii")
            self.assertEqual(f"Q2D{common}{d['esi']}|{sym}", d["frame"])


if __name__ == "__main__":
    unittest.main()
