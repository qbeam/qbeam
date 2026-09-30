# qbeam

Move a file from a locked-down machine to your phone over animated QR codes. No network, no USB,
no admin rights, and nothing to install on the receiving side. Transfers are verified with SHA-256.

```bash
npx qbeam send app.log
```

1. `qbeam send <file>` writes a self-contained `<file>.sender.html`. Open it in a browser (works offline).
2. On the receiving device, open the decoder page (`qbeam receive` prints its path; copy it to your phone)
   and point the camera at the screen. The file saves once every block arrives and the checksum matches.

Folders: use the Python version for now, `uvx qbeam send myfolder --archive`.

This package also exports the fountain codec: `require("qbeam")` returns `{ Encoder, Decoder, HEADER_EVERY }`.

Status: early alpha (0.0.x). Source and roadmap: https://github.com/qbeam/qbeam

Use it only to move data you're authorised to move. Apache-2.0 licensed.

## Developing in this repo

- `fountain.js` is the shared codec, inlined into the sender and decoder pages at build time.
- `npm pack` runs `scripts/sync-assets.js`, which copies the page templates, decoder and license files into this folder (gitignored).
