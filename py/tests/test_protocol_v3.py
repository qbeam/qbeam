"""Checks the Python v3 encoder (written from protocol/SPEC.md) against protocol/test-vectors/v3.json,
which is generated from the JS reference codec. If this fails while the JS tests pass, the spec text and
the reference codec disagree."""
import hashlib
import json
import pathlib
import struct
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from qbeam import protocol_v3 as p3  # noqa: E402

V = json.loads((pathlib.Path(__file__).resolve().parents[2] / "protocol" / "test-vectors" / "v3.json")
               .read_text(encoding="utf-8"))


def vector_payload(n):
    return bytes((i * 31 + 7) & 0xFF for i in range(n))


def coef_hex(local_blocks, n):
    out = bytearray((n + 7) // 8)
    for j in local_blocks:
        out[j >> 3] |= 1 << (j & 7)
    return out.hex()


class ProtocolV3VectorTest(unittest.TestCase):
    def test_constants(self):
        c = V["constants"]
        self.assertEqual(list(p3.MAGIC), c["magic"])
        self.assertEqual((p3.VERSION, p3.HEADER, p3.OVERHEAD, p3.KMAX),
                         (c["version"], c["headerBytes"], c["overheadBytes"], c["kmax"]))

    def test_crc32(self):
        for case in V["crc32"]:
            self.assertEqual(p3.crc32(case["asciiInput"].encode("ascii")), case["crc32"])

    def test_layouts(self):
        for case in V["layouts"]:
            lay = p3.layout(case["L"], case["T"])
            with self.subTest(L=case["L"], T=case["T"]):
                self.assertEqual((lay.K, lay.S), (case["K"], case["S"]))
                self.assertEqual([[s.start, s.size] for s in lay.segments], case["segments"])

    def test_fountain_symbols(self):
        for case in V["fountain"]:
            enc = p3.Encoder(vector_payload(case["L"]), case["T"])
            for s in case["symbols"]:
                with self.subTest(K=case["K"], esi=s["esi"]):
                    seg, blocks = p3.coefficients(enc.lay, s["esi"])
                    self.assertEqual(seg.index, s["segment"])
                    self.assertEqual(coef_hex(blocks, seg.size), s["coefHex"])
                    self.assertEqual(enc.symbol(s["esi"]).hex(), s["symbolHex"])

    def test_session_container_and_codes(self):
        s = V["session"]
        data = vector_payload(s["fileLen"])
        sha = hashlib.sha256(data).digest()
        self.assertEqual(sha.hex(), s["sha256Hex"])
        container = p3.encode_container(s["filename"], s["encoding"], sha, data)
        self.assertEqual(container.hex(), s["containerHex"])
        enc = p3.Encoder(container, s["T"])
        for c in s["codes"]:
            with self.subTest(esi=c["esi"]):
                code = p3.encode_code(s["sessionId"], len(container), s["T"], c["esi"], enc.symbol(c["esi"]))
                self.assertEqual(code.hex(), c["codeHex"])

    def test_reject_vectors_are_rejectable(self):
        """The reject cases must fail the spec's receiver checks (§2) in the stated way."""
        for case in V["reject"]:
            b = bytes.fromhex(case["codeHex"])
            with self.subTest(reason=case["reason"]):
                self.assertEqual(b[:2], p3.MAGIC)
                T = struct.unpack(">H", b[12:14])[0]
                if case["reason"] == "version":
                    self.assertNotEqual(b[2], p3.VERSION)
                elif case["reason"] == "length":
                    self.assertNotEqual(len(b), T + p3.OVERHEAD)
                elif case["reason"] == "crc":
                    self.assertNotEqual(p3.crc32(b[:-4]), struct.unpack(">I", b[-4:])[0])
                elif case["reason"] == "flags":
                    self.assertEqual(p3.crc32(b[:-4]), struct.unpack(">I", b[-4:])[0])
                    self.assertTrue(b[3] & 0x0F)


if __name__ == "__main__":
    unittest.main()
