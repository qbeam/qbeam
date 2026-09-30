// Compare QR encoders for one v30-L binary code (1732 bytes): current JS lib vs zxing-cpp writer (WASM).
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { writeBarcode, prepareZXingModule } from "zxing-wasm/writer";
import { readBarcodes } from "zxing-wasm/reader";
const require = createRequire(import.meta.url);
const qrcode = require("../../web/vendor/qrcodegen.js");
await prepareZXingModule({ fireImmediately: true });

const N = 30, per = 1728;
const data = Array.from({ length: N }, () => new Uint8Array(per).map(() => (Math.random() * 256) | 0));

let t = performance.now();
for (const d of data) { const q = qrcode(30, "L"); let s = ""; for (const b of d) s += String.fromCharCode(b); q.addData(s, "Byte"); q.make(); }
console.log("qrcode-generator (current)  ms/code:", ((performance.now() - t) / N).toFixed(2));

let r0;
t = performance.now();
for (const d of data) r0 = await writeBarcode(d, { format: "QRCode", ecLevel: "L", options: "version=30", withQuietZones: false, scale: 1 });
console.log("zxing-cpp writer (WASM)     ms/code:", ((performance.now() - t) / N).toFixed(2), "| error:", JSON.stringify(r0.error), "| symbol:", r0.symbol && `${r0.symbol.width}x${r0.symbol.height}`);

// Round-trip one zxing-written code through the reader to prove the bytes survive.
const s = r0.symbol, px = 4, W = (s.width + 8) * px;
const rgba = new Uint8ClampedArray(W * W * 4).fill(255);
for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
  if (!s.data[y * s.width + x]) continue;
  for (let dy = 0; dy < px; dy++) for (let dx = 0; dx < px; dx++) {
    const i = 4 * ((y + 4) * px + dy) * W + 4 * ((x + 4) * px + dx); rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
  }
}
const res = await readBarcodes({ data: rgba, width: W, height: W }, { formats: ["QRCode"] });
const same = res.length === 1 && Buffer.compare(Buffer.from(res[0].bytes), Buffer.from(data.at(-1))) === 0;
console.log("zxing-written code decodes to identical bytes:", same);
