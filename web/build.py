#!/usr/bin/env python3
"""Assembles dist/decoder.html by inlining jsQR.js, fountain.js and decoder_app.js into decoder_shell.html.
Run whenever decoder_app.js, decoder_shell.html or js/fountain.js changes.
"""
import pathlib

here = pathlib.Path(__file__).resolve().parent

shell = (here / "decoder_shell.html").read_text(encoding="utf-8")
jsqr = (here / "vendor" / "jsQR.js").read_text(encoding="utf-8")
app = (here / "decoder_app.js").read_text(encoding="utf-8")
fountain = (here.parent / "js" / "fountain.js").read_text(encoding="utf-8")

out = (
    shell
    .replace("/*__JSQR__*/", jsqr)
    .replace("/*__FOUNTAIN__*/", fountain)
    .replace("/*__APP__*/", app)
)

out_path = here / "dist" / "decoder.html"
out_path.parent.mkdir(exist_ok=True)
out_path.write_text(out, encoding="utf-8")
print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")
