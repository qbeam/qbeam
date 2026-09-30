#!/usr/bin/env python3
"""
Turn any file into a self-contained HTML page that displays it as a looping
animated QR code sequence. Open the generated page in a browser (just
double-click it, no server needed) and scan it with web/dist/decoder.html on the
receiving device.

Usage:
    python3 py/encode.py myfile.py
    python3 py/encode.py myfile.py --chunk-size 300 --out out.html
    python3 py/encode.py myfolder --archive          # whole folder as one transfer
    python3 py/encode.py myfolder                    # one page per file

With --archive the folder is packed into a tar, compressed with xz (LZMA,
typically 20-40% smaller than gzip) and sent as a single QR sequence. The
receiver saves <folder>.tar.xz; extract it with:  tar -xf <folder>.tar.xz

--compress picks the algorithm:
    gzip  the decoder decompresses in the browser and saves the original file
          (default for single files)
    xz    much smaller payload; the decoder saves the .xz file as-is
          (default for --archive; for a single file extract with: xz -d file.xz)
"""
import argparse
import base64
import fnmatch
import gzip
import hashlib
import io
import json
import lzma
import pathlib
import random
import string
import sys
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
JS = ROOT / "js"


def build(input_path: pathlib.Path, chunk_size: int, out_path: pathlib.Path, method: str = "gzip") -> None:
    build_bytes(input_path.read_bytes(), input_path.name, str(input_path), chunk_size, out_path, method)


def is_sender_page(p: pathlib.Path) -> bool:
    return p.name.endswith(".sender.html")


# Never worth sending: OS metadata, regenerable caches and test artifacts.
JUNK_PATTERNS = [
    ".DS_Store", "__pycache__", "*.pyc", ".pytest_cache", ".mypy_cache",
    ".ruff_cache", ".coverage", "htmlcov",
]


def compress(raw: bytes, method: str) -> bytes:
    if method == "xz":
        return lzma.compress(raw, format=lzma.FORMAT_XZ, preset=9 | lzma.PRESET_EXTREME)
    return gzip.compress(raw, compresslevel=9, mtime=0)


def archive_dir(dir_path: pathlib.Path, excludes=()) -> bytes:
    """Pack a directory into an uncompressed tar (compression is applied later).

    Patterns match a file/dir name (e.g. "*.plan") or a path relative to the
    folder (e.g. "services/*/vendor"); a matched directory is skipped entirely.
    """
    root = dir_path.resolve().name
    patterns = JUNK_PATTERNS + list(excludes)
    skipped = []

    def exclude(info: tarfile.TarInfo):
        rel = pathlib.PurePosixPath(info.name).relative_to(root).as_posix() if info.name != root else ""
        name = pathlib.PurePosixPath(info.name).name
        if rel and (is_sender_page(pathlib.Path(name)) or
                    any(fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(rel, pat) for pat in patterns)):
            skipped.append(rel)
            return None
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        return info

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tar:
        tar.add(dir_path, arcname=root, recursive=True, filter=exclude)
    if skipped:
        print(f"Excluded:    {len(skipped)} path(s), e.g. {', '.join(skipped[:5])}")
    return buf.getvalue()


def build_bytes(raw: bytes, filename: str, label: str, chunk_size: int, out_path: pathlib.Path,
                method: str = "gzip") -> None:
    compressed = compress(raw, method)
    if method == "xz":
        # The browser can't decompress xz, so the receiver saves the .xz as-is.
        filename += ".xz"
    sha = hashlib.sha256(compressed).hexdigest()

    session_id = "".join(random.choices(string.ascii_letters + string.digits, k=6))
    filename_b64 = base64.b64encode(filename.encode()).decode("ascii")

    total = max(1, -(-len(compressed) // chunk_size))

    # Frames are generated in the page (fountain.js): systematic blocks plus
    # recovery frames, so the receiver never has to wait for a full loop.
    payload = {
        "id": session_id,
        "blockSize": chunk_size,
        "sha": sha,
        "filenameB64": filename_b64,
        "encoding": "raw" if method == "xz" else "gz",
        "data": base64.b64encode(compressed).decode("ascii"),
    }

    meta = {
        "filename": filename,
        "originalSize": len(raw),
        "compressedSize": len(compressed),
        "method": method,
    }

    shell = (WEB / "sender_shell.html").read_text()
    qrcodegen = (WEB / "vendor" / "qrcodegen.js").read_text()
    fountain = (JS / "fountain.js").read_text()
    app = (WEB / "sender_app.js").read_text()

    out = (
        shell
        .replace("__TITLE__", filename)
        .replace("/*__QRCODEGEN__*/", qrcodegen)
        .replace("/*__FOUNTAIN__*/", fountain)
        .replace("/*__PAYLOAD__*/", json.dumps(payload))
        .replace("/*__META__*/", json.dumps(meta))
        .replace("/*__APP__*/", app)
    )

    out_path.write_text(out)

    print(f"Input:       {label} ({len(raw)} bytes)")
    print(f"Compressed:  {len(compressed)} bytes ({method}, {100 * len(compressed) / max(1, len(raw)):.0f}% of original)")
    print(f"Blocks:      {total} x {chunk_size} bytes (+ recovery frames)")
    print(f"SHA-256:     {sha}")
    print(f"Wrote:       {out_path}")
    print()
    print(f"Open {out_path} in a browser on the sending device (double-click it),")
    print("then open web/dist/decoder.html on the receiving device and point its camera at the screen.")


def default_out_path(input_path: pathlib.Path) -> pathlib.Path:
    return input_path.with_suffix(input_path.suffix + ".sender.html")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", type=pathlib.Path, help="File or directory to encode")
    parser.add_argument("--chunk-size", type=int, default=300,
                         help="Raw bytes per QR frame before base64 (default: 300). "
                              "Smaller = more frames but easier to scan reliably.")
    parser.add_argument("--out", type=pathlib.Path, default=None,
                         help="Output HTML path (single file input) or output directory "
                              "(directory input). Defaults to <file>.sender.html next to "
                              "each input file.")
    parser.add_argument("--archive", action="store_true",
                         help="For a directory input: pack the whole folder into a single "
                              "tar archive and encode it as ONE QR sequence, instead of one "
                              "page per file. Receiver gets <folder>.tar.xz.")
    parser.add_argument("--exclude", action="append", default=[], metavar="PATTERN",
                         help="With --archive: skip files/dirs matching this glob (name or "
                              "relative path). Repeatable. Caches like __pycache__, *.pyc, "
                              ".pytest_cache, .coverage and .DS_Store are always skipped.")
    parser.add_argument("--compress", choices=["gzip", "xz"], default=None,
                         help="Compression: xz = smallest payload, receiver saves the .xz file "
                              "(default with --archive); gzip = receiver gets the original "
                              "file directly (default otherwise).")
    args = parser.parse_args()

    if args.path.is_dir() and args.archive:
        name = args.path.resolve().name
        raw = archive_dir(args.path, args.exclude)
        out_path = args.out or args.path.resolve().parent / f"{name}.tar.sender.html"
        method = args.compress or "xz"
        build_bytes(raw, f"{name}.tar", f"{args.path}/ (tar archive)", args.chunk_size, out_path, method)
        print(f"On the receiver, extract with:  tar -xf {name}.tar{'.xz' if method == 'xz' else ''}")
        return

    if args.path.is_dir():
        files = sorted(
            p for p in args.path.rglob("*")
            if p.is_file() and not is_sender_page(p)
        )
        if not files:
            print(f"error: {args.path} contains no files", file=sys.stderr)
            sys.exit(1)

        failures = []
        for i, file_path in enumerate(files, 1):
            rel = file_path.relative_to(args.path)
            if args.out is not None:
                out_path = args.out / rel.with_suffix(rel.suffix + ".sender.html")
                out_path.parent.mkdir(parents=True, exist_ok=True)
            else:
                out_path = default_out_path(file_path)

            print(f"[{i}/{len(files)}] {rel}")
            try:
                build(file_path, args.chunk_size, out_path, args.compress or "gzip")
            except Exception as e:
                print(f"error: failed to encode {file_path}: {e}", file=sys.stderr)
                failures.append(file_path)
            print()

        if failures:
            print(f"{len(failures)} of {len(files)} file(s) failed to encode", file=sys.stderr)
            sys.exit(1)
        return

    if not args.path.is_file():
        print(f"error: {args.path} is not a file or directory", file=sys.stderr)
        sys.exit(1)

    out_path = args.out or default_out_path(args.path)
    build(args.path, args.chunk_size, out_path, args.compress or "gzip")


if __name__ == "__main__":
    main()
