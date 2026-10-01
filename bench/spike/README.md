# Speed spike

Question: can plain QR codes reach competitor speed (~100–130 KB/s goodput) screen-to-phone?
This is throwaway prototype code: no fountain code, no files, just the raw channel. Each QR code carries random
bytes with an 11-byte header (sender config, frame number, code index), and the receiver counts unique codes.

## Setup

```bash
cd bench/spike && npm install && cd ../..
python3 bench/spike/serve.py
```

It prints three URLs:

- **Sender**, on the Mac: `http://localhost:8000/sender.html`. Pick grid, QR version, ECC and fps, then press Start (fullscreen).
- **Receiver**, on the phone (same Wi-Fi), in **Chrome** (Firefox on Android gave only 640x480): `https://<Mac LAN IP>:8443/receiver.html`. Accept the certificate warning
  once (self-signed, local only), press Start camera and hold the phone so the grid fills most of the camera view.
- **Loopback self-test**, on the Mac: `http://localhost:8000/receiver.html?loopback=2x2,30,L,15`. Decodes the sender's
  canvas directly, with no camera. Keep the window visible: hidden tabs throttle the sender to ~2 fps.

The receiver shows goodput (unique payload KB/s), offered rate, the share of codes recovered, camera and decode
frame rates, and torn frames (a camera frame that caught two sender frames). **Copy result** puts a JSON summary on
the clipboard; paste it into `bench/RESULTS.md`.

## Suggested runs

Hold still, tripod or phone stand if possible, room lights normal, screen brightness high. For each, let it run 20 s.

| # | Sender | Offered | What it tells us |
| --- | --- | --- | --- |
| 1 | 2x2, v25, L, 10 fps | 50 KB/s | Baseline: does multi-code capture work at all on this phone? |
| 2 | 2x2, v30, L, 15 fps | 101 KB/s | Parity attempt, moderate density |
| 3 | 3x2, v25, L, 15 fps | 112 KB/s | More, smaller codes |
| 4 | 3x2, v30, L, 15 fps | 152 KB/s | Beats parity if it holds |
| 5 | 2x2, v30, L, 20 fps | 135 KB/s | Frame-rate limit (needs a 60 fps camera) |
| 6 | Best of the above at 1080p vs 4K camera | | Does camera resolution buy density? |

## Files

| File | What |
| --- | --- |
| `offline.mjs` | CPU-only benchmark: renders grids into a simulated 1080p capture, times encode and zxing-cpp decode |
| `mask_bench.mjs` | Fixed vs searched QR mask: encode time and decode reliability |
| `enc_bench.mjs` | Current QR library vs zxing-cpp's encoder |
| `sender.html` | Full-screen grid sender (double-buffered, frame switch on vsync) |
| `receiver.html`, `worker.js` | Camera receiver; zxing-cpp WASM in a pool of workers |
| `qrcode-fastmask.cjs` | `web/vendor/qrcodegen.js` with a `setMask()` patch |
| `serve.py` | Local http (8000) + https (8443, self-signed) server |
