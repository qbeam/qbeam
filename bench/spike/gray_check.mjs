// Verifies zxing's greyscale entry point (readBarcodesFromPixmap) gives the same results as readBarcodes(RGBA),
// and times both. The receiver's "Y plane" copy path depends on this.
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { readBarcodes, prepareZXingModule } from "zxing-wasm/reader";
const require = createRequire(import.meta.url);
const qrcode = require("./qrcode-fastmask.cjs");
const zx = await prepareZXingModule({ fireImmediately: true });

// Six v25-L codes in a 1920x1080 greyscale frame.
const W = 1920, H = 1080, n = 117, cell = n + 8, px = 3.9, gray = new Uint8Array(W * H).fill(255), sent = [];
for (let i = 0; i < 6; i++) {
  const bytes = new Uint8Array(1273).map(() => (Math.random() * 256) | 0); sent.push(Buffer.from(bytes));
  const q = qrcode(25, "L"); q.setMask(2); q.addData(String.fromCharCode(...bytes), "Byte"); q.make();
  const x0 = 60 + (i % 3) * cell * px + 4 * px, y0 = 60 + Math.floor(i / 3) * cell * px + 4 * px;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c))
    for (let y = Math.round(y0 + r * px); y < Math.round(y0 + (r + 1) * px); y++)
      gray.fill(0, y * W + Math.round(x0 + c * px), y * W + Math.round(x0 + (c + 1) * px));
}
const rgba = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = gray[i]; rgba[4 * i + 3] = 255; }

const zxOpts = { formats: "QRCode", tryHarder: true, tryRotate: false, tryInvert: false, tryDownscale: false, tryDenoise: false,
  binarizer: 0, isPure: false, downscaleFactor: 3, downscaleThreshold: 500, minLineCount: 2, maxNumberOfSymbols: 16,
  validateOptionalChecksum: false, returnErrors: true, eanAddOnSymbol: 0, textMode: 2, characterSet: 0, tryCode39ExtendedMode: true };

function readGray(buf, w, h) {
  const ptr = zx._malloc(buf.byteLength);
  try {
    zx.HEAPU8.set(buf, ptr);
    const v = zx.readBarcodesFromPixmap(ptr, w, h, zxOpts), out = [];
    for (let i = 0; i < v.size(); i++) out.push(v.get(i));
    return out;
  } finally { zx._free(ptr); }
}

const count = (res) => res.filter((r) => r.isValid && sent.some((s) => Buffer.compare(Buffer.from(r.bytes), s) === 0)).length;
let t = performance.now(), a;
for (let k = 0; k < 10; k++) a = await readBarcodes({ data: rgba, width: W, height: H }, { formats: ["QRCode"], tryHarder: true, tryRotate: false, tryInvert: false, tryDownscale: false, maxNumberOfSymbols: 16 });
const tA = (performance.now() - t) / 10;
t = performance.now(); let b;
for (let k = 0; k < 10; k++) b = readGray(gray, W, H);
const tB = (performance.now() - t) / 10;
console.log(`readBarcodes(RGBA):        ${count(a)}/6 codes, ${tA.toFixed(1)} ms`);
console.log(`readBarcodesFromPixmap(Y): ${count(b)}/6 codes, ${tB.toFixed(1)} ms`);
