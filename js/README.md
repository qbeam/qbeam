# qbeam

Send a file from your terminal or browser to your phone over animated QR codes. No network, no USB,
no admin rights, and nothing to install on the receiving side. Transfers are verified with SHA-256.

```bash
npx qbeam send app.log
cat trace.txt | npx qbeam send - --name trace.txt
```

1. `qbeam send <file>` writes a self-contained `<file>.sender.html` and opens it in your browser (works offline).
   Press Fullscreen for the best speed.
2. On the phone, open the qbeam receiver page (`qbeam receive` prints its path; copy it to the phone once, it works
   offline) in Chrome or Safari and point the camera at the codes. The file saves once it's complete and its
   SHA-256 matches.

Options: `--speed safe|fast|max` (default fast; max needs a 60 fps phone camera), `--encrypt` (prints a passphrase
to type on the phone; never shown on the QR screen), `--name` and `-` for stdin, `--no-open`.

Over SSH or without a browser, `--tty` draws the codes in the terminal (automatic over SSH and on Linux without a
display; slower than the browser page). Folders: use the Python version, `uvx qbeam send myfolder` (one `.tar.xz`).

This package also exports the protocol v3 codec: `require("qbeam")` returns `{ Encoder, Decoder, encodeCode, parseCode, ... }`.

Status: early alpha. Encryption needs Node 18+ (built in). Source and roadmap: https://github.com/qbeam/qbeam

Use it only to move data you're authorised to move. Apache-2.0 licensed.

## Developing in this repo

- `qbeam3.js` is the protocol v3 reference codec (framing, segmented fountain code, container, encryption), inlined into
  the sender and receiver pages. `fountain.js` is the old v2 codec, kept as the reference for the v2 test vectors.
- `npm pack` runs `scripts/sync-assets.js`, which copies the page templates, decoder and license files into this folder (gitignored).
