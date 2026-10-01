// qbeam decode worker: camera frame in, raw QR code bytes out (zxing-cpp compiled to WASM).
// Runs as a classic worker built from a Blob: the page prepends web/vendor/zxing-reader.js (global ZXingWASM)
// and sends the WASM bytes in an "init" message, so the receiver works from a single offline file.
//
// Frame paths, fastest first (see bench/RESULTS.md):
//   "yplane"     VideoFrame copied in the camera's native format; the luma plane goes straight to zxing's
//                greyscale entry point. ~1 ms per 1080p frame on phones.
//   "videoframe" VideoFrame converted to RGBA by the browser.
//   "canvas"     ImageBitmap drawn to an OffscreenCanvas (works everywhere; ~90 ms per frame on phones).
/* global ZXingWASM */
"use strict";

var zx = null, zxReady = null;
var canvas = null, ctx = null, rgba = null, raw = null, luma = null;

function zxOptions(tryHarder) {
  // Encoded options for readBarcodesFromPixmap (what readBarcodes builds internally).
  return { formats: "QRCode", tryHarder: tryHarder, tryRotate: false, tryInvert: false, tryDownscale: false,
    tryDenoise: false, binarizer: 0, isPure: false, downscaleFactor: 3, downscaleThreshold: 500, minLineCount: 2,
    maxNumberOfSymbols: 16, validateOptionalChecksum: false, returnErrors: false, eanAddOnSymbol: 0, textMode: 2,
    characterSet: 0, tryCode39ExtendedMode: true };
}

function lumaFromVideoFrame(frame) {
  var fmt = frame.format || "";
  var planar = /^(NV12|NV12A|I420|I420A|I422|I444)$/.test(fmt), packed = /^(RGBA|RGBX|BGRA|BGRX)$/.test(fmt);
  if (!planar && !packed) { frame.close(); return Promise.reject(new Error("frame format " + fmt)); }
  var size = frame.allocationSize();
  if (!raw || raw.byteLength < size) raw = new Uint8Array(size);
  return frame.copyTo(raw).then(function (layout) {
    var w = frame.visibleRect.width, h = frame.visibleRect.height, y = layout[0];
    frame.close();
    if (!luma || luma.byteLength !== w * h) luma = new Uint8Array(w * h);
    if (packed) {
      var rgb = fmt[0] === "R", R = rgb ? 0 : 2, B = rgb ? 2 : 0;
      for (var r = 0; r < h; r++) for (var c = 0, o = y.offset + r * y.stride; c < w; c++, o += 4)
        luma[r * w + c] = (306 * raw[o + R] + 601 * raw[o + 1] + 117 * raw[o + B] + 512) >> 10;
    } else if (y.stride === w) {
      luma.set(raw.subarray(y.offset, y.offset + w * h));
    } else {
      for (r = 0; r < h; r++) luma.set(raw.subarray(y.offset + r * y.stride, y.offset + r * y.stride + w), r * w);
    }
    return { luma: luma, width: w, height: h };
  }, function (e) { frame.close(); throw e; });
}

function rgbaFromVideoFrame(frame) {
  var size = frame.allocationSize({ format: "RGBA" });
  if (!rgba || rgba.byteLength !== size) rgba = new Uint8ClampedArray(size);
  return frame.copyTo(rgba, { format: "RGBA" }).then(function () {
    var img = { data: rgba, width: frame.visibleRect.width, height: frame.visibleRect.height };
    frame.close();
    return img;
  }, function (e) { frame.close(); throw e; });
}

function rgbaFromBitmap(bitmap) {
  if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return Promise.resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

function toLuma(img) {
  if (img.luma) return img;
  var n = img.width * img.height;
  if (!luma || luma.byteLength !== n) luma = new Uint8Array(n);
  for (var i = 0, o = 0; i < n; i++, o += 4) luma[i] = (306 * img.data[o] + 601 * img.data[o + 1] + 117 * img.data[o + 2] + 512) >> 10;
  return { luma: luma, width: img.width, height: img.height };
}

// Returns copies: result bytes point into WASM memory that the next decode reuses.
function decode(img, tryHarder) {
  var ptr = zx._malloc(img.luma.byteLength);
  try {
    zx.HEAPU8.set(img.luma, ptr);
    var v = zx.readBarcodesFromPixmap(ptr, img.width, img.height, zxOptions(tryHarder)), out = [];
    for (var i = 0; i < v.size(); i++) {
      var r = v.get(i);
      if (r.isValid) out.push(new Uint8Array(r.bytes).buffer);
    }
    return out;
  } finally {
    zx._free(ptr);
  }
}

self.onmessage = function (e) {
  var m = e.data;
  if (m.type === "init") {
    zxReady = ZXingWASM.prepareZXingModule({ overrides: { wasmBinary: m.wasm }, fireImmediately: true })
      .then(function (mod) { zx = mod; self.postMessage({ type: "ready" }); },
            function (err) { self.postMessage({ type: "fatal", error: String(err) }); });
    return;
  }
  var t0 = performance.now();
  (zx ? Promise.resolve() : zxReady).then(function () {
    if (m.frame) return m.path === "yplane" ? lumaFromVideoFrame(m.frame) : rgbaFromVideoFrame(m.frame);
    return rgbaFromBitmap(m.bitmap);
  }).then(function (img) {
    var t1 = performance.now();
    var codes = decode(toLuma(img), m.tryHarder);
    self.postMessage({ type: "result", id: m.id, codes: codes, copyMs: t1 - t0, decodeMs: performance.now() - t1,
                       width: img.width, height: img.height }, codes);
  }).catch(function (err) {
    self.postMessage({ type: "result", id: m.id, codes: [], error: String(err && err.message || err),
                       copyFailed: true });
  });
};
