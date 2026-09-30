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

### Competitors (researched 2026-10-01, not yet measured on our setup)

| Tool | Approach | Published result | Notes |
| --- | --- | --- | --- |
| [Decimen](https://decimen.app) v0.4.0 | Monochrome QR v40-L, 4 codes/frame, pinned mask, LT fountain (1.04x useful overhead), zxing-cpp WASM worker pool, crop tracking after 2 full scans, camera 960x1280 @60 | **418.5 KB/s sustained, 601.5 peak** (1 MB in 2.45 s) | 49" Odyssey G9 → iPhone 17 Pro Max (Safari); phone→phone 199.2. AGPL-3.0 since v0.4.0: study only, don't copy code |
| [libcimbar / CameraFileCopy](https://github.com/sz3/libcimbar) | Colour tile barcode (4 symbol bits + 2 colour bits per tile, ~9,300 B/image), Reed-Solomon, wirehair fountain, zstd | ~106 KB/s | MPL-2.0 |

Monochrome QR (Decimen) beats colour tiles (cimbar) by ~4x, so colour is not the main lever.

### Decode cost by zxing setting (Node, Mac, 2026-10-01)

6 v30-L codes at 3.5 px/module, blurred + noise, 1920x1080 (`bench/spike/decode_opts.mjs`): 8.1–11.0 ms per frame
for full-frame scans and 8.9–10.0 ms for per-code crops, across LocalAverage / GlobalHistogram / FixedThreshold
binarizers and tryHarder on/off; all read 6/6. The cost is per-code decoding (~1.5 ms/code here, ~7 ms on the
phone), so crop tracking only pays off when codes cover a small part of the frame.

### Camera runs

**Verdict (2026-10-01): plain QR reaches competitor speed in a browser. P0.13 answered; no colour fallback needed.**

**Best so far: 246 KB/s average, 293 KB/s best 5 s** — iPhone, Chrome (WebKit), 3x2 v30-L at 30 fps, camera 58 fps. Android best: 203 / 267 at the same settings with the camera stuck at 30 fps.

Chrome on a mid-range Android phone, 1080p camera at 60 fps, decoded a 3x2 grid of v30-L codes shown at 15 fps at
**128 KB/s average, 149 KB/s best 5 s** (84% of codes recovered). Competitors report ~100 KB/s (cimbar) and
~129 KB/s (Decimen); those still need measuring on this same setup (P0.12).

What it took, in order of impact:

1. **Y-plane frame copy** (WebCodecs VideoFrame in its native format, luma plane straight into zxing's greyscale
   entry point): per-frame copy 90–107 ms → ~1 ms, so every camera frame gets decoded.
2. **Fixed QR mask** on the sender: 18 → 1.1 ms per code.
3. **tryHarder**: 77% → 93% code recovery at no extra decode time.
4. **Chrome, not Firefox** on Android: Firefox delivers 640x480 regardless of constraints.
5. **Density matched to 1080p**: 6 codes of v25–v30 (~3.3+ camera px/module); v40 fails once blurred.

Caveats: raw channel only (unique code bytes), not yet through the fountain code; one phone, one screen, one
room; phone model unknown. Per-code headers and fountain overhead should cost a few percent. At this rate a
10 MB file is ~6,000 symbols, so the dense GF(2) decoder (O(K²)) must be replaced (P0.5a).

Use `bench/spike/README.md`; paste each receiver "Copy result" JSON here with phone model and notes.

| Date | Phone | Camera | Sender | Offered KB/s | Goodput KB/s | Codes recovered | Torn frames | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-01 | same | same | 1x1 v25-L @5 | 6.2 | 6.2 | 100% | 0 | Optics fine for one code. **Frame copy 107 ms vs zxing 41 ms**: browser copy dominates. |
| 2026-10-01 | same | same | 2x2 v25-L @5 | 24.9 | 19.4 | 77% | 0 | 1.9 read / 2.93 located per capture: codes found but not read. Copy 104 + zxing 40 ms. |
| 2026-10-01 | same | same, phone upright | 2x2 v25-L @10, tryHarder | 49.7 | **47.2** | 95% | 5 | Doubling fps costs almost nothing. |
| 2026-10-01 | same | same, phone sideways | 3x2 v25-L @10, tryHarder | 74.6 | 55.4 | 74% | 0 | 3.71 read / 5.44 located per capture. |
| 2026-10-01 | same | same, sideways | 3x2 v25-L @15, **VideoFrame RGBA** copy | 111.9 | 57.5 avg, 87.6 best 5 s | 51% | 0 | Copy 85.1 ms vs 92.7 canvas: RGBA conversion is the cost, not the canvas. 24.5 decoded fps. Fewer codes read per capture (2.57 / 4.81 located), likely aim/distance over a longer run. Next: Y-plane path (native NV12, no colour conversion). |
| 2026-10-01 | same | Chrome 154, 1080x1920 @29.9 | 3x2 v25-L @15, Y plane, tryHarder | 111.9 | 84.8 avg, 111.0 best 5 s | 75% | 0 | Copy 0.9 ms (was ~90 with canvas/RGBA); every camera frame decoded (29.9/29.9). |
| 2026-10-01 | **iPhone** (model not recorded), iOS 27.0.1 | **Chrome 155 on iOS (WebKit)**, 1920x1080 @58.1 | **3x2 v30-L @30, Y plane**, tryHarder | 304.5 | **246.4 avg, 293.4 best 5 s** | 81% | 0 | Best so far. Y-plane copy works on WebKit (0.9 ms). 47.9 decoded fps with 3 workers (45.5 ms/frame); 4.15 read / 7.61 located per capture. ~2 captures per sender frame at 60 fps. |
| 2026-10-01 | Android (model not recorded) | Chrome 154, 1080x1920, **29.8 fps** (asked 60) | **3x2 v30-L @30, Y plane**, tryHarder | 304.5 | **203.4 avg, 267.3 best 5 s** | 67% | 0 | One capture per sender frame (camera at 30): 3.68 read / 6.35 located per capture; every camera frame decoded (46.6 ms). A 60 fps camera should give two chances per frame. Receiver now demands `min` frame rate first. |
| 2026-10-01 | Android (model not recorded) | **Chrome 154, 1080x1920, 59.2 fps** | **3x2 v30-L @15, Y plane**, tryHarder | 152.2 | **128.1 avg, 149.2 best 5 s** | 84% | 0 | **Parity.** Copy 1.1 + zxing 44.2 ms; 50.9 of 59.2 camera fps decoded; 3.32 read / 6.04 located per capture. |
| 2026-10-01 | same | **Firefox 156, 640x480** @30 | 3x2 v25-L @15, **Y plane** | 111.9 | 76.8 avg, **107.2 best 5 s** | 69% | 0 | **Copy 0.3 ms**, zxing 41.8 ms, decoded 29.8 of 29.8 camera fps: every frame decoded. 3.09 read / 7.45 located per capture at only ~1.7 px/module. Needs a Chrome 1080p rerun. |
| 2026-10-01 | same | **Firefox 156, 640x480** @30 | 3x2 **v30**-L @15, Y plane | 152.2 | 0.9 | 1% | 0 | 10.3 located but 0.02 read per capture: ~1.5 camera px/module. Resolution-limited, not a v30 verdict. |
| 2026-10-01 | same | same, sideways | 3x2 v25-L @15, canvas copy | 111.9 | 78.0 avg, 87.9 best 5 s | 70% | 0 | Baseline for the copy comparison: copy 92.7 + zxing 41.6 ms, 23.9 decoded fps, 3.76 read / 4.91 located. |
| 2026-10-01 | same | same, phone sideways | **3x2 v25-L @15**, tryHarder | 111.9 | **87.0 avg, 97.2 best 5 s** | 78% | 0 | Near parity in a browser. Decoded 20.3 of 29.8 camera fps (copy 106.6 + zxing 60.6 ms): ~1.4 decoded captures per sender frame. Receiver compute is the limit, not optics. |
| 2026-10-01 | same | same, phone upright | 2x2 **v30**-L @10, tryHarder | 67.7 | **64.2** | 95% | 0 | 1080p resolves v30 at 2x2. copy 85.6 + zxing 53.7 ms. |
| 2026-10-01 | Android (model not recorded) | Chrome 154, 1080x1920 **@30** (bright room) | 2x2 v25-L @5, tryHarder | 24.9 | **23.5** | 93% | 0 | 3.33 read / 4.19 located per capture; copy 72.5 + zxing 38 ms; 26.6 decoded fps. tryHarder costs no extra time and lifts recovery 77% → 93%: now default. |
| 2026-10-01 | Android (model not recorded) | Chrome 154, 1080x1920 @30 requested, **14.8 fps** delivered | 2x2 v25-L @10 | 49.7 | **10.2** avg, 23.6 best 5 s | 21% (814 codes) | 24 | 0.91 of 4 codes read per decoded frame; decode 162 ms/frame (Mac: ~28); 10.5 frames decoded/s. Camera fell to 15 fps, so a 10 fps sender tears often. Next: 5 fps sender to separate tearing from optics; receiver now splits copy vs zxing time and counts located-but-unreadable codes. |
| 2026-10-01 | Android 16 (model not recorded) | Firefox 156, **640x480** @30 (asked for 1080p) | 2x2 v30-L @15 | 101.5 | 0.1 | 1 code | 0 | Invalid run: Firefox ignored the `ideal` 1080p request. 1.5 camera px/module vs ~3.3 needed. Decode 80.7 ms/frame. Receiver now requests `min` resolution and warns below 1280 px. |
