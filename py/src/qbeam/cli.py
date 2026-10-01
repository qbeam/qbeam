"""
qbeam: send a file from this machine to a phone (or another computer) over animated QR codes.
No network, no USB, no admin rights. Uses protocol v3 (protocol/SPEC.md).

Usage:
    qbeam send app.log                     # writes app.log.sender.html and opens it
    qbeam send ./project                   # a folder goes as one archive (.gitignore respected)
    cat trace.txt | qbeam send - --name trace.txt
    qbeam send secrets.env --encrypt       # prints a passphrase to type on the phone
    qbeam send big.bin --speed max         # 3x2 large codes at 30 fps (needs a 60 fps phone camera)
    qbeam send app.log --tty               # draw the codes in this terminal (automatic over SSH)
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
import pkgutil
import secrets
import sys
import tarfile
import time
import webbrowser

from . import __version__
from . import crypto_v3, protocol_v3, terminal

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


def read_asset(name: str) -> str:
    """Asset text from the checkout, the installed package, or, inside qbeam.pyz, the zip itself."""
    path = asset(name)
    if path.is_file():
        return path.read_text(encoding="utf-8")
    data = pkgutil.get_data(__package__, "assets/" + name)
    if data is None:
        raise FileNotFoundError(name)
    return data.decode("utf-8")


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


def prepare(raw: bytes, filename: str, method: str, passphrase: str = None) -> dict:
    """The v3 payload for one transfer: container, optionally sealed in an encryption envelope."""
    container, saved_name, how = make_container(raw, filename, method)
    payload, flags = container, 0
    if passphrase is not None:
        payload, flags = crypto_v3.seal(container, passphrase), protocol_v3.FLAG_ENCRYPTED
    return {"payload": payload, "flags": flags, "session": secrets.randbits(32), "saved_name": saved_name,
            "how": how, "raw_len": len(raw), "encrypted": passphrase is not None}


def write_page(prep: dict, out_path: pathlib.Path, speed: str) -> None:
    page = (
        read_asset("sender_shell.html")
        .replace("__TITLE__", html.escape(prep["saved_name"]))
        .replace("/*__QRCODEGEN__*/", read_asset("qrcodegen.js"))
        .replace("/*__QBEAM3__*/", read_asset("qbeam3.js"))
        .replace("/*__PAYLOAD__*/", json_for_script({"session": prep["session"], "flags": prep["flags"],
                                                     "dataB64": base64.b64encode(prep["payload"]).decode("ascii")}))
        .replace("/*__META__*/", json_for_script({"filename": prep["saved_name"], "size": prep["raw_len"],
                                                  "encrypted": prep["encrypted"]}))
        .replace("/*__SPEED__*/", json_for_script(speed))
        .replace("/*__APP__*/", read_asset("sender_app.js"))
    )
    out_path.write_text(page, encoding="utf-8")


def print_summary(prep: dict, label: str, speed: str, terminal_mode: bool) -> None:
    how = {"gzip": "gzip", "xz": "xz"}.get(prep["how"], "uncompressed")
    print(f"Input:       {label} ({prep['raw_len']:,} bytes)")
    print(f"Sending:     {prep['saved_name']} as {len(prep['payload']):,} bytes"
          f" ({how}{', encrypted' if prep['encrypted'] else ''})")
    if terminal_mode:
        print(f"Speed:       {speed}, terminal mode (a few KB/s; the browser sender is much faster)")
    else:
        seconds = len(prep["payload"]) / (SPEEDS[speed] * TYPICAL_EFFICIENCY)
        print(f"Speed:       {speed}, about {max(1, round(seconds))} s with a good camera")


def want_terminal(args) -> bool:
    """Terminal mode when asked, or when there's evidently no browser to show a page in."""
    if args.tty:
        return True
    if args.browser or not sys.stdout.isatty():
        return False
    if os.environ.get("SSH_CONNECTION") or os.environ.get("SSH_TTY"):
        return True
    return sys.platform.startswith("linux") and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def wait_before_codes(seconds: int = 15) -> None:
    """In terminal mode the terminal is the QR screen: let the user note the passphrase before codes replace it."""
    print("             Note it now; it's cleared before the codes appear. Press Enter to start.")
    try:
        if sys.stdin.isatty():
            input()
            return
        with open("CON" if os.name == "nt" else "/dev/tty", encoding="utf-8") as tty:  # stdin may be the data pipe
            tty.readline()
    except OSError:
        for left in range(seconds, 0, -1):
            print(f"\r             Starting in {left:2d} s… ", end="", flush=True)
            time.sleep(1)
        print()


def receive(no_open: bool) -> None:
    path = asset("decoder.html")
    if not path.is_file():  # running from qbeam.pyz: write the page out so a browser (or a phone) can open it
        path = pathlib.Path.cwd() / "qbeam-receiver.html"
        path.write_text(read_asset("decoder.html"), encoding="utf-8")
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
    mode = sp.add_mutually_exclusive_group()
    mode.add_argument("--tty", action="store_true",
                      help="Draw the codes in this terminal instead of a browser page (automatic over SSH and on "
                           "Linux without a display). Slower; works anywhere")
    mode.add_argument("--browser", action="store_true", help="Always write and open the browser sender page")
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

    extract_hint = None
    if args.path == "-":
        raw, name, label, method = sys.stdin.buffer.read(), args.name or "stdin.txt", "stdin", args.compress or "gzip"
        default_out = pathlib.Path.cwd() / f"{name}.sender.html"
    else:
        path = pathlib.Path(args.path)
        if path.is_dir():
            folder = path.resolve().name
            raw, name, label, method = archive_dir(path, args.exclude), args.name or f"{folder}.tar", f"{path}/ (folder)", args.compress or "xz"
            default_out = path.resolve().parent / f"{folder}.tar.sender.html"
            extract_hint = f"On the receiver, extract with:  tar -xf {folder}.tar{'.xz' if method == 'xz' else ''}"
        elif path.is_file():
            raw, name, label, method = path.read_bytes(), args.name or path.name, str(path), args.compress or "gzip"
            default_out = path.with_suffix(path.suffix + ".sender.html")
        else:
            print(f"error: {path} is not a file or folder", file=sys.stderr)
            sys.exit(1)

    terminal_mode = want_terminal(args)
    prep = prepare(raw, name, method, passphrase)
    print_summary(prep, label, args.speed, terminal_mode)
    out_path = args.out or (None if terminal_mode else default_out)
    if out_path is not None:
        write_page(prep, out_path, args.speed)
        print(f"Sender page: {out_path}")
    if extract_hint:
        print(extract_hint)
    if passphrase is not None:
        print()
        print(f"Passphrase:  {passphrase}")
        print("             Type it on the phone when asked. Don't show it on the screen the camera sees.")

    if terminal_mode:
        if passphrase is not None:
            wait_before_codes()
        terminal.run(prep["payload"], prep["flags"], prep["session"], args.speed, prep["saved_name"])
        print("Stopped. If the phone didn't save the file yet, run the same command again.")
        return
    print()
    if args.no_open or not webbrowser.open(out_path.resolve().as_uri()):
        print(f"Open {out_path} in a browser, then point the phone's qbeam receiver at it.")
    else:
        print("Opened the sender page. Point the phone's qbeam receiver at it; press Fullscreen for best results.")


if __name__ == "__main__":
    main()
