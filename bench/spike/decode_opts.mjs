// Where does zxing spend time on a 1080p frame of 6 v30 codes? Full frame vs per-code crops, binarizer, tryHarder.
// Frame: codes at 3.5 px/module with a 3x3 blur and mild noise, roughly what a phone camera sees.
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { prepareZXingModule } from "zxing-wasm/reader";
const require = createRequire(import.meta.url);
const qrcode = require("./qrcode-fastmask.cjs");
const zx = await prepareZXingModule({ fireImmediately: true });

const W = 1920, H = 1080, ver = 30, n = 17 + 4 * ver, cell = n + 8, px = 3.5;
const g = new Uint8Array(W * H).fill(230), sent = [], boxes = [];
for (let i = 0; i < 6; i++) {
  const b = new Uint8Array(1732).map(() => (Math.random() * 256) | 0); sent.push(Buffer.from(b).toString("hex"));
  const q = qrcode(ver, "L"); q.setMask(2); q.addData(String.fromCharCode(...b), "Byte"); q.make();
  const x0 = 100 + (i % 3) * cell * px + 4 * px, y0 = 20 + Math.floor(i / 3) * cell * px + 4 * px;
  boxes.push({ x: x0 - 3 * px, y: y0 - 3 * px, w: (n + 6) * px, h: (n + 6) * px });
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c))
    for (let y = Math.round(y0 + r * px); y < Math.round(y0 + (r + 1) * px); y++) g.fill(25, y * W + Math.round(x0 + c * px), y * W + Math.round(x0 + (c + 1) * px));
}
const f = new Uint8Array(W * H);
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * W + x + dx];
  f[y * W + x] = Math.max(0, Math.min(255, s / 9 + (Math.random() - 0.5) * 20));
}

const opts = (tryHarder, binarizer, max) => ({ formats: "QRCode", tryHarder, tryRotate: false, tryInvert: false, tryDownscale: false,
  tryDenoise: false, binarizer, isPure: false, downscaleFactor: 3, downscaleThreshold: 500, minLineCount: 2, maxNumberOfSymbols: max,
  validateOptionalChecksum: false, returnErrors: false, eanAddOnSymbol: 0, textMode: 2, characterSet: 0, tryCode39ExtendedMode: true });
function read(buf, w, h, o) {
  const ptr = zx._malloc(buf.byteLength); zx.HEAPU8.set(buf, ptr);
  const v = zx.readBarcodesFromPixmap(ptr, w, h, o), out = [];
  for (let i = 0; i < v.size(); i++) { const r = v.get(i); if (r.isValid) out.push(Buffer.from(r.bytes).toString("hex")); }
  zx._free(ptr); return out;
}
function crops(o) {
  const out = [];
  for (const b of boxes) {
    const x0 = Math.floor(b.x), y0 = Math.floor(b.y), cw = Math.ceil(b.w), ch = Math.ceil(b.h), c = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) c.set(f.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + cw), y * cw);
    out.push(...read(c, cw, ch, o));
  }
  return out;
}
const B = ["LocalAverage", "GlobalHistogram", "FixedThreshold"];
console.log("mode    binarizer        tryHarder  codes  ms/frame");
for (const mode of ["full", "crops"]) for (const bin of [0, 1, 2]) for (const th of [true, false]) {
  const o = opts(th, bin, mode === "full" ? 16 : 3);
  const run = () => (mode === "full" ? read(f, W, H, o) : crops(o));
  run();
  const t = performance.now(); let got; for (let k = 0; k < 6; k++) got = run();
  const ok = got.filter((h) => sent.includes(h)).length;
  console.log(mode.padEnd(8), B[bin].padEnd(16), String(th).padEnd(10), `${ok}/6`.padEnd(6), ((performance.now() - t) / 6).toFixed(1));
}
