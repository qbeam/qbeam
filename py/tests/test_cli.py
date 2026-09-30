"""End-to-end tests for `qbeam send` / `qbeam receive` (stdlib only).

Run from the repo root:  python3 -m unittest discover -s py/tests -v
"""
import base64
import contextlib
import gzip
import hashlib
import io
import json
import lzma
import os
import pathlib
import re
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from qbeam import __version__  # noqa: E402
from qbeam.cli import main  # noqa: E402

PLACEHOLDER = re.compile(r"__(TITLE|QRCODEGEN|FOUNTAIN|PAYLOAD|META|APP)__")


def run(*argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        main(list(argv))
    return out.getvalue()


def payload_of(page: pathlib.Path) -> dict:
    html = page.read_text(encoding="utf-8")
    assert not PLACEHOLDER.search(html), f"unfilled placeholder in {page}"
    return json.loads(re.search(r"var PAYLOAD = (\{.*?\});", html).group(1))


def decoded(payload: dict) -> bytes:
    data = base64.b64decode(payload["data"])
    assert hashlib.sha256(data).hexdigest() == payload["sha"], "checksum mismatch"
    return data


class SendTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_single_file_round_trips_through_gzip(self):
        src = self.dir / "data.bin"
        src.write_bytes(os.urandom(50_000) + b"text" * 1000)
        out = self.dir / "page.html"
        run("send", str(src), "--out", str(out))
        p = payload_of(out)
        self.assertEqual(p["encoding"], "gz")
        self.assertEqual(p["blockSize"], 300)
        self.assertEqual(gzip.decompress(decoded(p)), src.read_bytes())
        self.assertEqual(base64.b64decode(p["filenameB64"]).decode(), "data.bin")

    def test_unicode_filename_and_chunk_size(self):
        src = self.dir / "ünïcode 名.txt"
        src.write_text("héllo\n" * 100, encoding="utf-8")
        out = self.dir / "page.html"
        run("send", str(src), "--chunk-size", "120", "--out", str(out))
        p = payload_of(out)
        self.assertEqual(p["blockSize"], 120)
        self.assertEqual(base64.b64decode(p["filenameB64"]).decode(), "ünïcode 名.txt")
        self.assertIn("ünïcode 名.txt", out.read_text(encoding="utf-8"))

    def test_folder_archive_skips_junk_and_excludes(self):
        root = self.dir / "proj"
        (root / "src").mkdir(parents=True)
        (root / "src" / "main.py").write_text("print('hi')\n")
        (root / "__pycache__").mkdir()
        (root / "__pycache__" / "x.pyc").write_bytes(b"\0")
        (root / "notes.plan").write_text("skip me")
        out = self.dir / "proj.html"
        run("send", str(root), "--archive", "--exclude", "*.plan", "--out", str(out))
        p = payload_of(out)
        self.assertEqual(p["encoding"], "raw")
        self.assertEqual(base64.b64decode(p["filenameB64"]).decode(), "proj.tar.xz")
        with tarfile.open(fileobj=io.BytesIO(lzma.decompress(decoded(p)))) as tar:
            names = tar.getnames()
        self.assertIn("proj/src/main.py", names)
        self.assertFalse([n for n in names if "__pycache__" in n or n.endswith(".plan")], names)

    def test_folder_without_archive_writes_one_page_per_file(self):
        root = self.dir / "many"
        root.mkdir()
        for name in ("a.txt", "b.txt"):
            (root / name).write_text(name)
        run("send", str(root))
        self.assertTrue((root / "a.txt.sender.html").is_file())
        self.assertTrue((root / "b.txt.sender.html").is_file())

    def test_receive_prints_existing_decoder(self):
        text = run("receive", "--no-open")
        path = pathlib.Path(text.splitlines()[0].split(": ", 1)[1])
        self.assertTrue(path.is_file())
        self.assertIn("QR File Receiver", path.read_text(encoding="utf-8"))

    def test_version(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit):
            main(["--version"])
        self.assertEqual(out.getvalue().strip(), f"qbeam {__version__}")


if __name__ == "__main__":
    unittest.main()
