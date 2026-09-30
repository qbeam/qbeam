// Decode worker for the speed spike: camera frame in, QR payloads out. zxing-cpp via WASM.
//
// Two ways to get pixels out of a camera frame:
//   "canvas":     ImageBitmap -> OffscreenCanvas.drawImage -> getImageData (works everywhere; slow on phones)
//   "videoframe": WebCodecs VideoFrame -> copyTo(RGBA) straight into memory (Chrome; skips the canvas)
//   "yplane":     VideoFrame -> copyTo in the camera's native format (NV12/I420), keep only the luma plane and hand
//                 it to zxing's greyscale entry point. No colour conversion at all; this is what a native app does.
import { readBarcodes, prepareZXingModule } from "./node_modules/zxing-wasm/dist/es/reader/index.js";

// Not awaited at top level: the message handler must be registered before any frame arrives.
const zxReady = prepareZXingModule({
  overrides: { locateFile: (path) => new URL("./node_modules/zxing-wasm/dist/reader/" + path, self.location).href },
  fireImmediately: true,
});
let zx = null;

let canvas = null, ctx = null, rgba = null, raw = null, luma = null;

// Encoded zxing options for readBarcodesFromPixmap (what readBarcodes builds internally; checked by gray_check.mjs).
const zxOptions = (tryHarder) => ({
  formats: "QRCode", tryHarder, tryRotate: false, tryInvert: false, tryDownscale: false, tryDenoise: false,
  binarizer: 0, isPure: false, downscaleFactor: 3, downscaleThreshold: 500, minLineCount: 2, maxNumberOfSymbols: 16,
  validateOptionalChecksum: false, returnErrors: true, eanAddOnSymbol: 0, textMode: 2, characterSet: 0,
  tryCode39ExtendedMode: true,
});

async function lumaFromVideoFrame(frame) {
  try {
    const fmt = frame.format || "";
    const planar = /^(NV12|NV12A|I420|I420A|I422|I444)$/.test(fmt), packed = /^(RGBA|RGBX|BGRA|BGRX)$/.test(fmt);
    if (!planar && !packed) throw new Error("frame format " + fmt);
    const size = frame.allocationSize();
    if (!raw || raw.byteLength < size) raw = new Uint8Array(size);
    const layout = await frame.copyTo(raw);
    const w = frame.visibleRect.width, h = frame.visibleRect.height, y = layout[0];
    if (!luma || luma.byteLength !== w * h) luma = new Uint8Array(w * h);
    if (packed) { // canvas-sourced frames (loopback): compute luma ourselves, same weights as zxing-wasm
      const rgb = fmt[0] === "R", R = rgb ? 0 : 2, B = rgb ? 2 : 0;
      for (let r = 0; r < h; r++) for (let c = 0, o = y.offset + r * y.stride; c < w; c++, o += 4)
        luma[r * w + c] = (306 * raw[o + R] + 601 * raw[o + 1] + 117 * raw[o + B] + 512) >> 10;
    } else if (y.stride === w) luma.set(raw.subarray(y.offset, y.offset + w * h));
    else for (let r = 0; r < h; r++) luma.set(raw.subarray(y.offset + r * y.stride, y.offset + r * y.stride + w), r * w);
    return { luma, width: w, height: h };
  } finally {
    frame.close();
  }
}

function readLuma(img, tryHarder) {
  const ptr = zx._malloc(img.luma.byteLength);
  try {
    zx.HEAPU8.set(img.luma, ptr);
    const v = zx.readBarcodesFromPixmap(ptr, img.width, img.height, zxOptions(tryHarder)), out = [];
    for (let i = 0; i < v.size(); i++) out.push(v.get(i));
    return out;
  } finally {
    zx._free(ptr);
  }
}

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
  const { bitmap, frame, id, tryHarder, path } = e.data;
  if (!zx) zx = await zxReady;
  const t0 = performance.now();
  let img;
  try {
    img = !frame ? await pixelsFromBitmap(bitmap)
      : path === "yplane" ? await lumaFromVideoFrame(frame) : await pixelsFromVideoFrame(frame);
  } catch (err) {
    self.postMessage({ id, error: "copy failed: " + err, copyFailed: true });
    return;
  }
  const t1 = performance.now();
  let results = [];
  try {
    results = img.luma ? readLuma(img, tryHarder) : await readBarcodes(img, {
      formats: ["QRCode"], tryHarder, tryRotate: false, tryInvert: false, tryDownscale: false, maxNumberOfSymbols: 16,
      returnErrors: true, // also report codes that were located but failed to decode
    });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
    return;
  }
  const t2 = performance.now();
  const payloads = results.filter((r) => r.isValid).map((r) => r.bytes.slice().buffer);
  self.postMessage({ id, payloads, readMs: t1 - t0, decodeMs: t2 - t1, found: results.length, w: img.width, h: img.height }, payloads);
};
