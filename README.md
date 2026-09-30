# qbeam — files over light

Move a file from one screen to another device's camera as an animated QR stream. No network, no USB,
no install on the receiving side. Transfers are verified with SHA-256.

> Status: early. Packaging and speed work are in progress; see [PLAN.md](PLAN.md).

## Try it today

```bash
uvx qbeam send path/to/file      # or: pipx install qbeam · npx qbeam send path/to/file
```

From a checkout, without installing: `python3 py/encode.py path/to/file`.

1. Open the generated `file.sender.html` in a browser on the sending machine (double-click; works offline).
2. Open the decoder page on the receiving device (`qbeam receive` prints its path; or use [`web/dist/decoder.html`](web/dist/decoder.html)) and point its camera at the screen.
3. The file saves automatically once every block is received and the checksum matches.

Send a whole folder as one archive: `qbeam send myfolder --archive` (Python version only for now).

## Repository layout

| Path | What |
| --- | --- |
| `protocol/` | Wire-format spec and shared test vectors |
| `py/` | Python package `qbeam` on PyPI (stdlib only) |
| `js/` | Shared JS codec (fountain code) and npm package `qbeam` |
| `web/` | Sender and decoder pages; `web/build.py` builds `web/dist/decoder.html` |
| `android/`, `ios/`, `go/` | Native apps and standalone binaries (planned) |
| `bench/` | Benchmark rig and results (planned) |
| `docs/` | User docs (planned) |

## Acceptable use

Use this only to move data you are authorised to move, on systems you are allowed to use it on.

## License

Apache-2.0 — see [LICENSE](LICENSE). Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
