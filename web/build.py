#!/usr/bin/env python3
"""Assembles dist/decoder.html, the single-file offline receiver (protocol v3).

Inlines the zxing-cpp WASM reader (web/vendor), its decode worker, the v3 codec (js/qbeam3.js) and the app.
Run whenever any of those change:  python3 web/build.py
"""
import base64
import pathlib

here = pathlib.Path(__file__).resolve().parent


def read(p: pathlib.Path) -> str:
    text = p.read_text(encoding="utf-8")
    if "</script" in text.lower():
        raise SystemExit(f"{p} contains '</script', which would break inlining")
    return text


shell = (here / "decoder_shell.html").read_text(encoding="utf-8")
wasm_b64 = base64.b64encode((here / "vendor" / "zxing_reader.wasm").read_bytes()).decode("ascii")

out = (
    shell
    .replace("/*__ZXING__*/", read(here / "vendor" / "zxing-reader.js"))
    .replace("/*__WORKER__*/", read(here / "decode_worker.js"))
    .replace("__ZXING_WASM_B64__", wasm_b64)
    .replace("/*__QBEAM3__*/", read(here.parent / "js" / "qbeam3.js"))
    .replace("/*__APP__*/", read(here / "decoder_app.js"))
)

out_path = here / "dist" / "decoder.html"
out_path.parent.mkdir(exist_ok=True)
out_path.write_text(out, encoding="utf-8")
print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")
