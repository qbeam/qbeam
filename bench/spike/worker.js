// Decode worker for the speed spike: camera frame (ImageBitmap) in, QR payloads out. zxing-cpp via WASM.
import { readBarcodes, prepareZXingModule } from "./node_modules/zxing-wasm/dist/es/reader/index.js";

prepareZXingModule({
  overrides: { locateFile: (path) => new URL("./node_modules/zxing-wasm/dist/reader/" + path, self.location).href },
});

let canvas = null, ctx = null;

self.onmessage = async (e) => {
  const { bitmap, id, tryHarder } = e.data;
  const t0 = performance.now();
  if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const t1 = performance.now();
  let results = [];
  try {
    results = await readBarcodes(img, {
      formats: ["QRCode"], tryHarder, tryRotate: false, tryInvert: false, tryDownscale: false, maxNumberOfSymbols: 16,
      returnErrors: true, // also report codes that were located but failed to decode
    });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
    return;
  }
  const t2 = performance.now();
  const payloads = results.filter((r) => r.isValid).map((r) => r.bytes.slice().buffer);
  self.postMessage({ id, payloads, readMs: t1 - t0, decodeMs: t2 - t1, found: results.length }, payloads);
};
