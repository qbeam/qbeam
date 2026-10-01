# qbeam — files over light

Move a file from one screen to another device's camera as an animated QR stream. No network, no USB,
no install on the receiving side. Transfers are verified with SHA-256.

> Status: early alpha. See [PLAN.md](PLAN.md) for what's next.

## Try it today

```bash
uvx qbeam send path/to/file      # or: pipx install qbeam · npx qbeam send path/to/file
```

1. The sender page opens in your browser. Press Fullscreen.
2. On your phone, open [qbeam.dev/r](https://qbeam.dev/r) in Chrome or Safari (it works offline once added to the
   home screen), or use the Android app below, and point the camera at the codes.
3. The file saves once every block is received and its SHA-256 matches.

Folders go as one archive (`qbeam send ./project`, `.gitignore` respected). `--speed max` reached 246 KB/s on an
iPhone in testing; `--encrypt` adds AES-256-GCM with a passphrase you type on the phone
(`pip install "qbeam[crypto]"`). Over SSH or without a browser, `--tty` draws the codes in the terminal instead
(automatic over SSH). No install at all: download `qbeam-<version>.pyz` from the GitHub release and run
`python3 qbeam-<version>.pyz send file`. From a checkout: `python3 py/encode.py path/to/file`.

## Android app

Download `qbeam-<version>.apk` from the [latest release](https://github.com/qbeam/qbeam/releases/latest) and open it
on the phone (Android 10+; allow installs from your browser when asked). It reads the codes natively, at about
280 KB/s in testing, saves to Downloads/qbeam, and has no internet permission. Check the download against the
`.sha256` file next to it. The app's signing certificate (SHA-256) is:

```
C9:FC:71:E0:52:E3:2A:50:B3:79:74:C7:03:67:9F:5C:FE:68:A3:6E:DA:37:E3:EA:C8:99:D9:34:0B:50:72:14
```

To verify an APK before installing: `apksigner verify --print-certs qbeam-<version>.apk`. Updates must be signed
with the same certificate. An iPhone app is planned; until then use qbeam.dev/r in Safari.

## Repository layout

| Path | What |
| --- | --- |
| `protocol/` | Wire-format spec and shared test vectors |
| `py/` | Python package `qbeam` on PyPI (stdlib only) |
| `js/` | Protocol v3 reference codec (`qbeam3.js`) and npm package `qbeam` |
| `web/` | Sender and receiver pages; `web/build.py` builds `web/dist/decoder.html` |
| `android/`, `ios/` | Native receiver apps (Kotlin + CameraX, Swift + AVFoundation; both use zxing-cpp) |
| `go/` | Standalone binaries (planned) |
| `bench/` | Benchmark rig and results (planned) |
| `docs/` | User docs (planned) |

## Acceptable use

Use this only to move data you are authorised to move, on systems you are allowed to use it on.

## License

Apache-2.0 — see [LICENSE](LICENSE). Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
