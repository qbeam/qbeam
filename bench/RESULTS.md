# Benchmark results

Goodput = unique payload bytes received per second. Newest first within each section.

## P0.13 speed spike

### Offline (no camera), 2026-10-01

MacBook Air (Apple silicon, 10 cores), Node 26, zxing-wasm 3.1.4. Codes rendered into a simulated 1920x1080
capture filling 90% of the frame; "blur" = 3x3 box blur. Source: `bench/spike/offline.mjs`, `mask_bench.mjs`.

| Grid | QR | Bytes/code | px/module in 1080p | Decoded | Decoded, blurred | KB/frame | Decode ms/frame | KB/s @15 fps | KB/s @30 fps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1x1 | v25-L | 1273 | 7.8 | 6/6 | 6/6 | 1.2 | 9.2 | 19 | 37 |
| 1x1 | v40-L | 2953 | 5.3 | 6/6 | 6/6 | 2.9 | 6.3 | 43 | 87 |
| 2x1 | v30-L | 1732 | 6.0 | 12/12 | 12/12 | 3.4 | 7.1 | 51 | 101 |
| 2x1 | v40-L | 2953 | 4.7 | 12/12 | 12/12 | 5.8 | 8.3 | 87 | 173 |
| 2x2 | v25-L | 1273 | 3.9 | 24/24 | 24/24 | 5.0 | 8.0 | 75 | 149 |
| 2x2 | v30-L | 1732 | 3.4 | 24/24 | 24/24 | 6.8 | 9.0 | 101 | 203 |
| 2x2 | v30-M | 1370 | 3.4 | 24/24 | 24/24 | 5.4 | 9.3 | 80 | 161 |
| 2x2 | v40-L | 2953 | 2.6 | 24/24 | **0/24** | 11.5 | 11.7 | 173 | 346 |
| 3x2 | v25-L | 1273 | 3.9 | 36/36 | 36/36 | 7.5 | 9.6 | 112 | 224 |
| 3x2 | v30-L | 1732 | 3.4 | 36/36 | 36/36 | 10.1 | 11.3 | 152 | 304 |

QR encoding, v30-L, 1,732 bytes:

| Encoder | ms/code | Decodes (clean / blurred) |
| --- | --- | --- |
| qrcode-generator (current), mask searched | 18.0 | 24/24 / 24/24 |
| qrcode-generator, fixed mask (0, 2, 4 or 6) | 1.1 | 24/24 / 24/24 |
| zxing-cpp writer (WASM) | 23.6 | not tested further |

Browser loopback (sender canvas → captureStream → worker pool, no optics), Chrome in the app's browser pane,
2x2 v30-L: every code of every displayed frame decoded, 0 torn frames, 27.5 ms per 1080p frame per worker
(4 workers). The pane was hidden, which throttled the sender to ~2 fps, so this run confirms correctness, not rate.

**Findings so far**

1. The decoder is not the bottleneck: 7–12 ms per 1080p frame with up to 6 codes (Node), ~28 ms in a browser worker.
2. Camera resolution is: codes need about ≥ 3.3 camera pixels per module. At 1080p that allows ~10 KB per frame
   (3x2 v30-L); 2x2 v40-L at 2.6 px/module fails once blurred.
3. The sender's QR mask search was the real cost (18 ms/code). A fixed mask cuts it to ~1.1 ms with no decode loss,
   so a 6-code frame builds in ~7 ms and the sender can run at 30–60 fps.
4. On paper, 3x2 v30-L at 15 fps offers 152 KB/s, above the ~130 KB/s parity target. Whether a phone camera
   delivers it (focus, moiré, motion blur, frame tearing, phone CPU) is the open question for the camera runs.

### Camera runs

Not run yet. Use `bench/spike/README.md`; paste each receiver "Copy result" JSON here with phone model and notes.

| Date | Phone | Camera | Sender | Offered KB/s | Goodput KB/s | Codes recovered | Torn frames | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-01 | Android (model not recorded) | Chrome 154, 1080x1920 @30 requested, **14.8 fps** delivered | 2x2 v25-L @10 | 49.7 | **10.2** avg, 23.6 best 5 s | 21% (814 codes) | 24 | 0.91 of 4 codes read per decoded frame; decode 162 ms/frame (Mac: ~28); 10.5 frames decoded/s. Camera fell to 15 fps, so a 10 fps sender tears often. Next: 5 fps sender to separate tearing from optics; receiver now splits copy vs zxing time and counts located-but-unreadable codes. |
| 2026-10-01 | Android 16 (model not recorded) | Firefox 156, **640x480** @30 (asked for 1080p) | 2x2 v30-L @15 | 101.5 | 0.1 | 1 code | 0 | Invalid run: Firefox ignored the `ideal` 1080p request. 1.5 camera px/module vs ~3.3 needed. Decode 80.7 ms/frame. Receiver now requests `min` resolution and warns below 1280 px. |
