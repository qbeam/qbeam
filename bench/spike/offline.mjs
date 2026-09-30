// PLAN P0.13, offline half: CPU cost of the sender and receiver for dense multi-code frames, no camera.
//
// For each config it renders a "screen" with a grid of QR codes (binary payloads), then simulates what a camera
// sees: the screen scaled into a 1920x1080 capture (with optional blur), and times zxing-cpp (WASM) decoding it.
// It prints the offered rate (what the sender shows) and the decoder's ceiling (frames/s this CPU can decode).
//
//   node bench/spike/offline.mjs
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { readBarcodes, prepareZXingModule } from "zxing-wasm/reader";

const require = createRequire(import.meta.url);
const qrcode = require("../../web/vendor/qrcodegen.js");
await prepareZXingModule({ fireImmediately: true });

// Byte-mode capacity per QR version at ECC L / M (ISO 18004 table 7), for the versions we test.
const CAP = { L: { 20: 858, 25: 1273, 30: 1732, 35: 2303, 40: 2953 }, M: { 20: 666, 25: 997, 30: 1370, 35: 1809, 40: 2331 } };

function makeQr(bytes, version, ecc) {
  const qr = qrcode(version, ecc);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b); // library maps chars to bytes with & 0xff (ISO-8859-1)
  qr.addData(s, "Byte");
  qr.make();
  return qr;
}

// Grayscale "camera frame": grid of codes laid out on a screen, scaled into W x H with a quiet zone of 4 modules.
function renderFrame(qrs, cols, rows, W, H, fill, blur) {
  const n = qrs[0].getModuleCount(), cell = n + 8;
  const px = Math.floor(Math.min((W * fill) / (cols * cell), (H * fill) / (rows * cell)) * 100) / 100; // pixels per module
  const gray = new Uint8ClampedArray(W * H).fill(255);
  const x0 = Math.floor((W - cols * cell * px) / 2), y0 = Math.floor((H - rows * cell * px) / 2);
  qrs.forEach((qr, idx) => {
    const cx = x0 + (idx % cols) * cell * px + 4 * px, cy = y0 + Math.floor(idx / cols) * cell * px + 4 * px;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      const xa = Math.round(cx + c * px), xb = Math.round(cx + (c + 1) * px);
      const ya = Math.round(cy + r * px), yb = Math.round(cy + (r + 1) * px);
      for (let y = ya; y < yb; y++) gray.fill(0, y * W + xa, y * W + xb);
    }
  });
  let g = gray;
  if (blur) { // 3x3 box blur, a cheap stand-in for camera softness
    g = new Uint8ClampedArray(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += gray[(y + dy) * W + x + dx];
      g[y * W + x] = s / 9;
    }
  }
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = g[i]; rgba[4 * i + 3] = 255; }
  return { data: rgba, width: W, height: H, px };
}

const configs = [
  // [grid cols, rows, QR version, ECC]
  [1, 1, 25, "L"], [1, 1, 40, "L"],
  [2, 1, 30, "L"], [2, 1, 40, "L"],
  [2, 2, 25, "L"], [2, 2, 30, "L"], [2, 2, 40, "L"],
  [3, 2, 25, "L"], [3, 2, 30, "L"],
  [2, 2, 30, "M"],
];
const W = 1920, H = 1080, FILL = 0.9, REPS = 6;
const opts = { formats: ["QRCode"], tryHarder: false, tryRotate: false, tryInvert: false, tryDownscale: false, maxNumberOfSymbols: 8 };

console.log(`capture ${W}x${H}, grid fills ${FILL * 100}% of the frame, ${REPS} frames per config, zxing-cpp WASM on ${process.platform}/${process.arch}\n`);
console.log("grid  ver ecc  bytes/code  px/module  encode ms/code  decode ms/frame  read/codes  blur-read  KB/frame  decoder ceiling fps  KB/s @15fps  KB/s @30fps");
for (const [cols, rows, ver, ecc] of configs) {
  const per = CAP[ecc][ver], count = cols * rows;
  let encMs = 0, decMs = 0, read = 0, blurRead = 0, px = 0;
  for (let rep = 0; rep < REPS; rep++) {
    const qrs = [];
    for (let i = 0; i < count; i++) {
      const bytes = new Uint8Array(per).map(() => (Math.random() * 256) | 0);
      const t = performance.now();
      qrs.push(makeQr(bytes, ver, ecc));
      encMs += performance.now() - t;
    }
    const frame = renderFrame(qrs, cols, rows, W, H, FILL, false);
    px = frame.px;
    const t = performance.now();
    const res = await readBarcodes(frame, opts);
    decMs += performance.now() - t;
    read += res.filter((r) => r.isValid && r.bytes.length === per).length;
    const soft = renderFrame(qrs, cols, rows, W, H, FILL, true);
    blurRead += (await readBarcodes(soft, opts)).filter((r) => r.isValid && r.bytes.length === per).length;
  }
  const dec = decMs / REPS, kbFrame = (per * count) / 1024;
  console.log([
    `${cols}x${rows}`.padEnd(5), String(ver).padStart(3), ` ${ecc}  `, String(per).padStart(10), px.toFixed(2).padStart(10),
    (encMs / (REPS * count)).toFixed(1).padStart(15), dec.toFixed(1).padStart(16),
    `${read}/${REPS * count}`.padStart(11), `${blurRead}/${REPS * count}`.padStart(10), kbFrame.toFixed(1).padStart(9),
    (1000 / dec).toFixed(1).padStart(20), (kbFrame * 15).toFixed(0).padStart(12), (kbFrame * 30).toFixed(0).padStart(12),
  ].join(""));
}
