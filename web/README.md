# web

Sender and decoder pages. Everything is inlined into single offline HTML files.

- `sender_shell.html`, `sender_app.js` — sender template; `py/encode.py` fills the placeholders.
- `decoder_shell.html`, `decoder_app.js` — camera decoder.
- `vendor/` — third-party libraries (see `../THIRD_PARTY_NOTICES.md`).
- `build.py` — rebuilds `dist/decoder.html`. Run after changing the decoder files or `../js/fountain.js`:

```bash
python3 web/build.py
```

`dist/decoder.html` is generated; don't edit it by hand.
