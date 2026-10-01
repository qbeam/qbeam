# web

Sender and receiver pages (protocol v3). Everything is inlined into single offline HTML files.

- `sender_shell.html`, `sender_app.js` — sender: a grid of QR codes, a new set every frame (speed presets safe /
  fast / max, fixed mask). The CLIs fill the placeholders with the payload and `js/qbeam3.js`.
- `decoder_shell.html`, `decoder_app.js`, `decode_worker.js` — receiver: camera → zxing-cpp (WASM) in a worker pool,
  WebCodecs Y-plane frame copy with fallbacks, v3 decoding, passphrase prompt, SHA-256 check, save.
- `vendor/` — third-party code (see `../THIRD_PARTY_NOTICES.md`): `qrcodegen.js` (patched with `setMask`),
  `zxing-reader.js` + `zxing_reader.wasm` (zxing-wasm 3.1.4).
- `build.py` — rebuilds `dist/decoder.html`. Run after changing any receiver file, `vendor/zxing-*` or `../js/qbeam3.js`:

```bash
python3 web/build.py
```

`dist/decoder.html` is generated; don't edit it by hand. CI fails if it's stale.

## End-to-end test

`test/e2e.html` loads a real sender page and the receiver side by side and decodes the sender canvas's video stream:

```bash
python3 py/encode.py some.file --no-open --out web/test/tmp/some.sender.html
python3 -m http.server 8010 --bind 127.0.0.1
# open http://localhost:8010/web/test/e2e.html?sender=tmp/some.sender.html&sha=<sha256 of some.file>
```

The page title becomes PASS or FAIL. Keep the window visible; hidden tabs pause the sender's animation.
