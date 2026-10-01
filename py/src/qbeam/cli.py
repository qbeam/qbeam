"""
qbeam: send a file from this machine to a phone (or another computer) over animated QR codes.
No network, no USB, no admin rights. Uses protocol v3 (protocol/SPEC.md).

Usage:
    qbeam send app.log                     # writes app.log.sender.html and opens it
    qbeam send ./project                   # a folder goes as one archive (.gitignore respected)
    cat trace.txt | qbeam send - --name trace.txt
    qbeam send secrets.env --encrypt       # prints a passphrase to type on the phone
    qbeam send big.bin --speed max         # 3x2 large codes at 30 fps (needs a 60 fps phone camera)
    qbeam receive                          # opens the camera receiver page

On the phone, open the receiver page (`qbeam receive` prints its path; copy it over once, it works offline)
and point the camera at the sender page. Folders arrive as <folder>.tar.xz: extract with `tar -xf`.
"""
import argparse
import base64
import fnmatch
import gzip
import hashlib
import html
import io
import json
import lzma
import os
import pathlib
import secrets
import sys
import tarfile
import webbrowser

from . import __version__
from . import crypto_v3, protocol_v3

HERE = pathlib.Path(__file__).resolve().parent
PACKAGED = HERE / "assets"            # filled by py/sync_assets.py when building a release
REPO = HERE.parents[2]                # repo root, when running from a checkout

# Published name -> location in the repo checkout.
REPO_ASSETS = {
    "sender_shell.html": REPO / "web" / "sender_shell.html",
    "sender_app.js": REPO / "web" / "sender_app.js",
    "qrcodegen.js": REPO / "web" / "vendor" / "qrcodegen.js",
    "qbeam3.js": REPO / "js" / "qbeam3.js",
    "decoder.html": REPO / "web" / "dist" / "decoder.html",
}

# Raw bytes the sender offers per second for each preset (codes x T x fps); must match web/sender_app.js.
SPEEDS = {"safe": 4 * 1251 * 10, "fast": 6 * 1251 * 15, "max": 6 * 1710 * 30}
TYPICAL_EFFICIENCY = 0.75  # share of offered codes a phone camera reads (bench/RESULTS.md)

# Never worth sending: OS metadata, regenerable caches and test artifacts.
JUNK_PATTERNS = [
    ".git", ".DS_Store", "__pycache__", "*.pyc", ".pytest_cache", ".mypy_cache",
    ".ruff_cache", ".coverage", "htmlcov", "node_modules", ".venv",
]


def asset(name: str) -> pathlib.Path:
    # In a checkout the repo's own files win, so a stale assets/ copy from an earlier release build is never used.
    repo = REPO_ASSETS[name]
    return repo if repo.is_file() else PACKAGED / name


def is_sender_page(p: pathlib.Path) -> bool:
    return p.name.endswith(".sender.html")


def gitignore_patterns(dir_path: pathlib.Path):
    """Plain patterns from the folder's top-level .gitignore (no negation or nested files; good enough to skip
    build output and dependencies)."""
    f = dir_path / ".gitignore"
    if not f.is_file():
        return []
    out = []
    for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "!")):
            continue
        out.append(line.strip("/"))
    return out


def archive_dir(dir_path: pathlib.Path, excludes=()) -> bytes:
    """Pack a directory into an uncompressed tar. Patterns match a name (e.g. "*.log") or a path relative to the
    folder (e.g. "services/*/vendor"); a matched directory is skipped entirely."""
    root = dir_path.resolve().name
    patterns = JUNK_PATTERNS + gitignore_patterns(dir_path) + list(excludes)
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


def make_container(raw: bytes, filename: str, method: str):
    """Returns (container bytes, saved filename, description). The SHA-256 covers what the receiver saves."""
    if method == "xz":
        data = lzma.compress(raw, format=lzma.FORMAT_XZ, preset=9 | lzma.PRESET_EXTREME)
        name = filename + ".xz"
        return protocol_v3.encode_container(name, "raw", hashlib.sha256(data).digest(), data), name, "xz"
    data = gzip.compress(raw, compresslevel=9, mtime=0)
    if len(data) < 0.98 * len(raw):
        return protocol_v3.encode_container(filename, "gzip", hashlib.sha256(raw).digest(), data), filename, "gzip"
    # Already compressed (images, archives): sending gzip would only add bytes.
    return protocol_v3.encode_container(filename, "raw", hashlib.sha256(raw).digest(), raw), filename, "none"


def new_passphrase() -> str:
    alphabet = "23456789abcdefghjkmnpqrstuvwxyz"  # no 0/o, 1/l/i: easy to type on a phone
    return "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(5))


def json_for_script(obj) -> str:
    # Safe inside <script>: no "</script>" or HTML comment sequences can appear.
    return json.dumps(obj).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def build_page(raw: bytes, filename: str, label: str, out_path: pathlib.Path, method: str, speed: str,
               passphrase: str = None) -> dict:
    container, saved_name, how = make_container(raw, filename, method)
    payload, flags = container, 0
    if passphrase is not None:
        payload, flags = crypto_v3.seal(container, passphrase), protocol_v3.FLAG_ENCRYPTED
    session = secrets.randbits(32)

    page = (
        asset("sender_shell.html").read_text(encoding="utf-8")
        .replace("__TITLE__", html.escape(saved_name))
        .replace("/*__QRCODEGEN__*/", asset("qrcodegen.js").read_text(encoding="utf-8"))
        .replace("/*__QBEAM3__*/", asset("qbeam3.js").read_text(encoding="utf-8"))
        .replace("/*__PAYLOAD__*/", json_for_script({"session": session, "flags": flags,
                                                     "dataB64": base64.b64encode(payload).decode("ascii")}))
        .replace("/*__META__*/", json_for_script({"filename": saved_name, "size": len(raw),
                                                  "encrypted": passphrase is not None}))
        .replace("/*__SPEED__*/", json_for_script(speed))
        .replace("/*__APP__*/", asset("sender_app.js").read_text(encoding="utf-8"))
    )
    out_path.write_text(page, encoding="utf-8")

    seconds = len(payload) / (SPEEDS[speed] * TYPICAL_EFFICIENCY)
    print(f"Input:       {label} ({len(raw):,} bytes)")
    print(f"Sending:     {saved_name} as {len(payload):,} bytes"
          f" ({'gzip' if how == 'gzip' else 'xz' if how == 'xz' else 'uncompressed'}"
          f"{', encrypted' if passphrase is not None else ''})")
    print(f"Speed:       {speed}, about {max(1, round(seconds))} s with a good camera")
    print(f"Sender page: {out_path}")
    return {"payload_len": len(payload), "session": session, "saved_name": saved_name}


def receive(no_open: bool) -> None:
    path = asset("decoder.html")
    print(f"Receiver page: {path}")
    print("Copy it to your phone once (it works offline) and open it there, or use this computer's webcam.")
    if not no_open:
        webbrowser.open(path.as_uri())


def main(argv=None) -> None:
    # Filenames can be any Unicode; don't crash printing them to a cp1252 console or a pipe.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    parser = argparse.ArgumentParser(prog="qbeam", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", action="version", version=f"qbeam {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("send", help="Send a file, folder or stdin as animated QR codes")
    sp.add_argument("path", help="File or folder to send, or - for stdin")
    sp.add_argument("--speed", choices=list(SPEEDS), default="fast",
                    help="safe: 2x2 codes at 10 fps; fast (default): 3x2 at 15 fps; "
                         "max: 3x2 large codes at 30 fps, needs a 60 fps phone camera")
    sp.add_argument("--encrypt", action="store_true",
                    help="Encrypt with a generated passphrase, printed here (never on the QR screen). "
                         "Set QBEAM_PASSPHRASE to choose your own. Needs: pip install \"qbeam[crypto]\"")
    sp.add_argument("--name", help="Filename the receiver saves (default: the input's name; stdin.txt for stdin)")
    sp.add_argument("--out", type=pathlib.Path, help="Where to write the sender page (default: next to the input)")
    sp.add_argument("--no-open", action="store_true", help="Don't open the sender page in a browser")
    sp.add_argument("--exclude", action="append", default=[], metavar="PATTERN",
                    help="Folders: skip files/dirs matching this glob (name or relative path). Repeatable. "
                         ".git, caches and the folder's .gitignore patterns are always skipped.")
    sp.add_argument("--compress", choices=["gzip", "xz"], default=None,
                    help="gzip: the receiver gets the original file (default for files); "
                         "xz: smaller, the receiver saves a .xz (default for folders)")
    sp.add_argument("--archive", action="store_true", help=argparse.SUPPRESS)  # folders are always archived now

    rp = sub.add_parser("receive", help="Open the camera receiver page")
    rp.add_argument("--no-open", action="store_true", help="Only print the receiver page's path")

    args = parser.parse_args(argv)
    if args.command == "receive":
        receive(args.no_open)
    else:
        send(args)


def send(args) -> None:
    passphrase = None
    if args.encrypt:
        if not crypto_v3.available():
            print('error: --encrypt needs the optional package: pip install "qbeam[crypto]"', file=sys.stderr)
            sys.exit(2)
        passphrase = os.environ.get("QBEAM_PASSPHRASE") or new_passphrase()

    if args.path == "-":
        raw = sys.stdin.buffer.read()
        name = args.name or "stdin.txt"
        out_path = args.out or pathlib.Path.cwd() / f"{name}.sender.html"
        build_page(raw, name, "stdin", out_path, args.compress or "gzip", args.speed, passphrase)
    else:
        path = pathlib.Path(args.path)
        if path.is_dir():
            folder = path.resolve().name
            raw = archive_dir(path, args.exclude)
            method = args.compress or "xz"
            out_path = args.out or path.resolve().parent / f"{folder}.tar.sender.html"
            build_page(raw, args.name or f"{folder}.tar", f"{path}/ (folder)", out_path, method, args.speed, passphrase)
            print(f"On the receiver, extract with:  tar -xf {folder}.tar{'.xz' if method == 'xz' else ''}")
        elif path.is_file():
            out_path = args.out or path.with_suffix(path.suffix + ".sender.html")
            build_page(path.read_bytes(), args.name or path.name, str(path), out_path, args.compress or "gzip",
                       args.speed, passphrase)
        else:
            print(f"error: {path} is not a file or folder", file=sys.stderr)
            sys.exit(1)

    if passphrase is not None:
        print()
        print(f"Passphrase:  {passphrase}")
        print("             Type it on the phone when asked. Don't show it on the screen the camera sees.")
    print()
    if args.no_open or not webbrowser.open(out_path.resolve().as_uri()):
        print(f"Open {out_path} in a browser, then point the phone's qbeam receiver at it.")
    else:
        print("Opened the sender page. Point the phone's qbeam receiver at it; press Fullscreen for best results.")


if __name__ == "__main__":
    main()
