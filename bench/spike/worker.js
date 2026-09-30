// Decode worker for the speed spike: camera frame in, QR payloads out. zxing-cpp via WASM.
//
// Two ways to get pixels out of a camera frame:
//   "canvas":     ImageBitmap -> OffscreenCanvas.drawImage -> getImageData (works everywhere; slow on phones)
//   "videoframe": WebCodecs VideoFrame -> copyTo(RGBA) straight into memory (Chrome; skips the canvas)
import { readBarcodes, prepareZXingModule } from "./node_modules/zxing-wasm/dist/es/reader/index.js";

prepareZXingModule({
  overrides: { locateFile: (path) => new URL("./node_modules/zxing-wasm/dist/reader/" + path, self.location).href },
});

let canvas = null, ctx = null, rgba = null;

async function pixelsFromBitmap(bitmap) {
  if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function pixelsFromVideoFrame(frame) {
  try {
    const size = frame.allocationSize({ format: "RGBA" });
    if (!rgba || rgba.byteLength !== size) rgba = new Uint8ClampedArray(size);
    await frame.copyTo(rgba, { format: "RGBA" });
    return { data: rgba, width: frame.visibleRect.width, height: frame.visibleRect.height };
  } finally {
    frame.close();
  }
}

self.onmessage = async (e) => {
  const { bitmap, frame, id, tryHarder } = e.data;
  const t0 = performance.now();
  let img;
  try {
    img = frame ? await pixelsFromVideoFrame(frame) : await pixelsFromBitmap(bitmap);
  } catch (err) {
    self.postMessage({ id, error: "copy failed: " + err, copyFailed: true });
    return;
  }
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
