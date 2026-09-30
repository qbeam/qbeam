// Fixed-mask vs searched-mask encoding time, and whether fixed-mask codes still decode (clean and blurred).
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { readBarcodes, prepareZXingModule } from "zxing-wasm/reader";
const require = createRequire(import.meta.url);
const qrcode = require("./qrcode-fastmask.cjs");
await prepareZXingModule({ fireImmediately: true });

function render(qr, px, blur) {
  const n = qr.getModuleCount(), W = Math.ceil((n + 8) * px);
  const g = new Uint8ClampedArray(W * W).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) {
    for (let y = Math.round((r + 4) * px); y < Math.round((r + 5) * px); y++)
      g.fill(0, y * W + Math.round((c + 4) * px), y * W + Math.round((c + 5) * px));
  }
  let o = g;
  if (blur) { o = new Uint8ClampedArray(W * W).fill(255);
    for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) { let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * W + x + dx]; o[y * W + x] = s / 9; } }
  const rgba = new Uint8ClampedArray(W * W * 4);
  for (let i = 0; i < W * W; i++) { rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = o[i]; rgba[4 * i + 3] = 255; }
  return { data: rgba, width: W, height: W };
}

const per = 1732, N = 24;
const payloads = Array.from({ length: N }, () => new Uint8Array(per).map(() => (Math.random() * 256) | 0));
const str = (d) => { let s = ""; for (const b of d) s += String.fromCharCode(b); return s; };
for (const mask of [-1, 0, 2, 4, 6]) {
  let ms = 0, ok = 0, okBlur = 0;
  for (const d of payloads) {
    const t = performance.now();
    const q = qrcode(30, "L"); if (mask >= 0) q.setMask(mask); q.addData(str(d), "Byte"); q.make();
    ms += performance.now() - t;
    const same = (res) => res.some((r) => r.isValid && Buffer.compare(Buffer.from(r.bytes), Buffer.from(d)) === 0);
    if (same(await readBarcodes(render(q, 3.35, false), { formats: ["QRCode"] }))) ok++;
    if (same(await readBarcodes(render(q, 3.35, true), { formats: ["QRCode"] }))) okBlur++;
  }
  console.log(`mask ${mask < 0 ? "searched" : mask}`.padEnd(14), `encode ${(ms / N).toFixed(2)} ms/code`.padEnd(22), `decoded ${ok}/${N}, blurred ${okBlur}/${N} (3.35 px/module)`);
}
