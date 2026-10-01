"""End-to-end tests for `qbeam send` / `qbeam receive` with protocol v3 (stdlib only).

Each test reads back the sender page the CLI wrote, extracts the payload, and checks it decodes to the input:
container fields, compression and SHA-256 (protocol/SPEC.md v3 §5).

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
import struct
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from qbeam import __version__, crypto_v3  # noqa: E402
from qbeam.cli import main  # noqa: E402

PLACEHOLDER = re.compile(r"__(TITLE|QRCODEGEN|QBEAM3|PAYLOAD|META|SPEED|APP)__")


def run(*argv, stdin: bytes = None):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), mock.patch("webbrowser.open", return_value=False):
        if stdin is None:
            main(list(argv))
        else:
            with mock.patch.object(sys, "stdin", io.TextIOWrapper(io.BytesIO(stdin))):
                main(list(argv))
    return out.getvalue()


def page_globals(page: pathlib.Path):
    html = page.read_text(encoding="utf-8")
    assert not PLACEHOLDER.search(html), f"unfilled placeholder in {page}"
    get = lambda name: json.loads(re.search(r"var %s = (.*?);\n" % name, html).group(1))  # noqa: E731
    return get("PAYLOAD"), get("META"), get("SPEED"), html


def parse_container(c: bytes):
    """SPEC v3 §5."""
    version, encoding, n = struct.unpack(">BBH", c[:4])
    assert version == 1
    return {"encoding": encoding, "filename": c[4:4 + n].decode("utf-8"), "sha256": c[4 + n:36 + n], "data": c[36 + n:]}


def saved_bytes(container):
    """What a receiver saves: gunzip for encoding 1, as-is for 0; the SHA-256 must match."""
    data = gzip.decompress(container["data"]) if container["encoding"] == 1 else container["data"]
    assert hashlib.sha256(data).digest() == container["sha256"], "sha256 mismatch"
    return data


class SendTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def sent(self, page):
        payload, meta, speed, html = page_globals(page)
        self.assertEqual(payload["flags"], 0)
        c = parse_container(base64.b64decode(payload["dataB64"]))
        return c, meta, speed, html

    def test_text_file_is_gzipped_and_round_trips(self):
        src = self.dir / "notes.txt"
        src.write_text("hello qbeam\n" * 2000, encoding="utf-8")
        out = self.dir / "page.html"
        text = run("send", str(src), "--out", str(out), "--no-open")
        c, meta, speed, _ = self.sent(out)
        self.assertEqual((c["encoding"], c["filename"], speed), (1, "notes.txt", "fast"))
        self.assertEqual(saved_bytes(c), src.read_bytes())
        self.assertEqual(meta["size"], src.stat().st_size)
        self.assertIn("Sending:     notes.txt", text)

    def test_incompressible_file_is_sent_as_is(self):
        src = self.dir / "photo.jpg"
        src.write_bytes(os.urandom(40_000))
        out = self.dir / "page.html"
        run("send", str(src), "--out", str(out), "--no-open", "--speed", "max")
        c, _, speed, _ = self.sent(out)
        self.assertEqual((c["encoding"], speed), (0, "max"))
        self.assertEqual(saved_bytes(c), src.read_bytes())

    def test_unicode_filename_is_escaped_in_html(self):
        src = self.dir / "ünï 名.txt"
        src.write_text("héllo\n" * 100, encoding="utf-8")
        out = self.dir / "page.html"
        # Windows forbids < and > in filenames, so the markup-looking name comes in through --name.
        run("send", str(src), "--name", "<ünï> 名.txt", "--out", str(out), "--no-open")
        c, meta, _, html = self.sent(out)
        self.assertEqual(c["filename"], "<ünï> 名.txt")
        self.assertEqual(meta["filename"], "<ünï> 名.txt")
        self.assertIn("&lt;ünï&gt; 名.txt", html)  # in <title>, escaped
        self.assertNotIn("<ünï>", html)  # never raw markup

    def test_stdin(self):
        out = self.dir / "page.html"
        run("send", "-", "--name", "trace.txt", "--out", str(out), "--no-open", stdin=b"line\n" * 500)
        c, _, _, _ = self.sent(out)
        self.assertEqual(c["filename"], "trace.txt")
        self.assertEqual(saved_bytes(c), b"line\n" * 500)

    def test_folder_is_one_xz_archive_honouring_gitignore(self):
        root = self.dir / "proj"
        (root / "src").mkdir(parents=True)
        (root / "src" / "main.py").write_text("print('hi')\n")
        (root / "build").mkdir()
        (root / "build" / "out.bin").write_bytes(b"\0" * 100)
        (root / "__pycache__").mkdir()
        (root / "__pycache__" / "x.pyc").write_bytes(b"\0")
        (root / "notes.plan").write_text("skip me")
        (root / ".gitignore").write_text("# comment\nbuild/\n!keep\n")
        out = self.dir / "proj.html"
        text = run("send", str(root), "--exclude", "*.plan", "--out", str(out), "--no-open")
        c, _, _, _ = self.sent(out)
        self.assertEqual((c["encoding"], c["filename"]), (0, "proj.tar.xz"))
        with tarfile.open(fileobj=io.BytesIO(lzma.decompress(saved_bytes(c)))) as tar:
            names = tar.getnames()
        self.assertIn("proj/src/main.py", names)
        self.assertIn("proj/.gitignore", names)
        for skipped in ("build", "__pycache__", ".plan"):
            self.assertFalse([n for n in names if skipped in n], (skipped, names))
        self.assertIn("tar -xf proj.tar.xz", text)

    @unittest.skipUnless(crypto_v3.available(), 'needs: pip install "qbeam[crypto]"')
    def test_encrypt_prints_passphrase_and_seals_payload(self):
        src = self.dir / "secret.env"
        src.write_text("TOKEN=abc\n", encoding="utf-8")
        out = self.dir / "page.html"
        with mock.patch.dict(os.environ, {"QBEAM_PASSPHRASE": "correct horse"}):
            text = run("send", str(src), "--encrypt", "--out", str(out), "--no-open")
        payload, meta, _, html = page_globals(out)
        self.assertEqual(payload["flags"], 1)
        self.assertTrue(meta["encrypted"])
        self.assertIn("Passphrase:  correct horse", text)
        self.assertNotIn("correct horse", html)  # never on the QR screen
        c = parse_container(crypto_v3.open_envelope(base64.b64decode(payload["dataB64"]), "correct horse"))
        self.assertEqual(saved_bytes(c), src.read_bytes())

    def test_encrypt_without_package_explains(self):
        src = self.dir / "a.txt"
        src.write_text("x")
        with mock.patch.object(crypto_v3, "available", return_value=False), \
                contextlib.redirect_stderr(io.StringIO()) as err, self.assertRaises(SystemExit) as cm:
            run("send", str(src), "--encrypt", "--no-open")
        self.assertEqual(cm.exception.code, 2)
        self.assertIn('pip install "qbeam[crypto]"', err.getvalue())

    def test_receive_prints_existing_receiver(self):
        text = run("receive", "--no-open")
        path = pathlib.Path(text.splitlines()[0].split(": ", 1)[1])
        self.assertTrue(path.is_file())
        self.assertIn("qbeam receiver", path.read_text(encoding="utf-8"))

    def test_version(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit):
            main(["--version"])
        self.assertEqual(out.getvalue().strip(), f"qbeam {__version__}")


if __name__ == "__main__":
    unittest.main()
