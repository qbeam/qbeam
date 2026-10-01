// Simulated camera: real sender frames for each speed preset are photographed by a fake camera
// (tilted screen in perspective, scaled into 1920x1080, blur, reduced contrast, sensor noise) and decoded with the
// receiver's own zxing build. Fails if any preset's code recovery drops below its floor, so a change that makes
// codes harder to read is caught in CI before it reaches a phone.
// Run from the repo root: node js/test/optics.js   (deterministic)
"use strict";
var fs = require("fs");
var path = require("path");
var Q = require("../qbeam3.js");
var qrcode = require("../../web/vendor/qrcodegen.js");

var repo = path.resolve(__dirname, "..", "..");
var ZXingWASM = new Function(fs.readFileSync(path.join(repo, "web", "vendor", "zxing-reader.js"), "utf8") + "; return ZXingWASM;")();
var wasm = fs.readFileSync(path.join(repo, "web", "vendor", "zxing_reader.wasm"));

// Must match web/sender_app.js.
var PRESETS = {
  safe: { cols: 2, rows: 2, ver: 25, fps: 10 },
  fast: { cols: 3, rows: 2, ver: 25, fps: 15 },
  max: { cols: 3, rows: 2, ver: 30, fps: 30 },
};
// Camera profiles and the minimum share of codes each preset must read. "typical" is a sharp, focused phone (one
// blur pass); "hard" is softer (two passes) and puts max at the edge. Its floors sit just under the values measured
// on 2026-10-01 (safe/fast 100%, max 42%), so changes that make codes harder to read fail here. A real iPhone read
// ~69% of max codes per capture (bench/RESULTS.md), between the two profiles.
var PROFILES = [
  { name: "typical", blurs: 1, floor: { safe: 0.95, fast: 0.95, max: 0.95 } },
  { name: "hard", blurs: 2, floor: { safe: 0.95, fast: 0.9, max: 0.25 } },
];
var CAP_L = { 25: 1273, 30: 1732 };
var SCREEN_W = 2560, SCREEN_H = 1600;   // a 13" laptop panel at 2x
var CAM_W = 1920, CAM_H = 1080, FRAMES = 6;

var seed = 12345;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }

// The sender page's layout: integer pixels per module, grid centred on the screen, 4-module quiet zone per code.
function screenFrame(p, codes) {
  var n = 17 + 4 * p.ver, cell = n + 8;
  var px = Math.floor(Math.min(SCREEN_W / (p.cols * cell), SCREEN_H / (p.rows * cell)));
  var img = new Uint8Array(SCREEN_W * SCREEN_H).fill(255);
  var x0 = Math.floor((SCREEN_W - p.cols * cell * px) / 2), y0 = Math.floor((SCREEN_H - p.rows * cell * px) / 2);
  codes.forEach(function (bytes, i) {
    var qr = qrcode(p.ver, "L"), s = "";
    qr.setMask(2);
    for (var k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]);
    qr.addData(s, "Byte");
    qr.make();
    var ox = x0 + (i % p.cols) * cell * px + 4 * px, oy = y0 + Math.floor(i / p.cols) * cell * px + 4 * px;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      for (var y = 0; y < px; y++) img.fill(0, (oy + r * px + y) * SCREEN_W + ox + c * px, (oy + r * px + y) * SCREEN_W + ox + (c + 1) * px);
    }
  });
  return { img: img, px: px, gridW: p.cols * cell * px, gridH: p.rows * cell * px };
}

// Homography mapping camera pixels back to screen pixels. The user fills the view with the codes, as the receiver
// asks: the code grid covers 90% of the frame in its limiting dimension, and the screen is slightly tilted.
var FILL = 0.9;
function cameraScale(sf) { return Math.min(CAM_W * FILL / sf.gridW, CAM_H * FILL / sf.gridH); }
function cameraFrame(sf, blurs) {
  var screen = sf.img, s = cameraScale(sf), w = SCREEN_W * s, h = SCREEN_H * s, cx = CAM_W / 2, cy = CAM_H / 2;
  // Screen corners as seen by the camera: a little keystone (left edge 4% taller) and a 2° roll.
  var a = 2 * Math.PI / 180, k = 0.04;
  function rot(x, y) { return [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]; }
  var dst = [rot(cx - w / 2, cy - h / 2 * (1 + k)), rot(cx + w / 2, cy - h / 2 * (1 - k)), rot(cx + w / 2, cy + h / 2 * (1 - k)), rot(cx - w / 2, cy + h / 2 * (1 + k))];
  var src = [[0, 0], [SCREEN_W, 0], [SCREEN_W, SCREEN_H], [0, SCREEN_H]];
  var H = homography(dst, src);
  var raw = new Float32Array(CAM_W * CAM_H);
  for (var y = 0; y < CAM_H; y++) for (var x = 0; x < CAM_W; x++) {
    var d = H[6] * x + H[7] * y + 1, sx = (H[0] * x + H[1] * y + H[2]) / d, sy = (H[3] * x + H[4] * y + H[5]) / d;
    var v = 90; // dark room around the screen
    if (sx >= 0 && sy >= 0 && sx < SCREEN_W - 1 && sy < SCREEN_H - 1) {
      // Box-average the screen pixels under this camera pixel (the screen is denser than the sensor).
      var ix = Math.floor(sx), iy = Math.floor(sy), acc = 0;
      for (var dy = 0; dy < 2; dy++) for (var dx = 0; dx < 2; dx++) acc += screen[(iy + dy) * SCREEN_W + ix + dx];
      v = acc / 4;
    }
    raw[y * CAM_W + x] = v;
  }
  // Lens blur (3x3 box passes), contrast squeeze (black 35, white 215), noise σ = 6.
  var a1 = raw;
  for (var b = 0; b < blurs; b++) a1 = boxBlur(a1);
  var out = new Uint8Array(CAM_W * CAM_H);
  for (var i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, 35 + a1[i] * (180 / 255) + 6 * gauss()));
  return out;
}

function boxBlur(src) {
  var out = new Float32Array(src.length);
  for (var y = 1; y < CAM_H - 1; y++) for (var x = 1; x < CAM_W - 1; x++) {
    var s = 0;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) s += src[(y + dy) * CAM_W + x + dx];
    out[y * CAM_W + x] = s / 9;
  }
  return out;
}

// Solves the 8-parameter homography taking points `from` to points `to`.
function homography(from, to) {
  var A = [], b = [];
  for (var i = 0; i < 4; i++) {
    var x = from[i][0], y = from[i][1], u = to[i][0], v = to[i][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (var c = 0; c < 8; c++) { // Gaussian elimination with partial pivoting
    var p = c;
    for (var r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    var t = A[c]; A[c] = A[p]; A[p] = t; var tb = b[c]; b[c] = b[p]; b[p] = tb;
    for (r = 0; r < 8; r++) if (r !== c) {
      var f = A[r][c] / A[c][c];
      for (var k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map(function (bv, i) { return bv / A[i][i]; });
}

(async function () {
  var zx = await ZXingWASM.prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }, fireImmediately: true });
  var opts = { formats: "QRCode", tryHarder: true, tryRotate: false, tryInvert: false, tryDownscale: false, tryDenoise: false,
    binarizer: 0, isPure: false, downscaleFactor: 3, downscaleThreshold: 500, minLineCount: 2, maxNumberOfSymbols: 16,
    validateOptionalChecksum: false, returnErrors: false, eanAddOnSymbol: 0, textMode: 2, characterSet: 0, tryCode39ExtendedMode: true };
  var payload = new Uint8Array(400000);
  for (var i = 0; i < payload.length; i++) payload[i] = (i * 2654435761) >>> 24;
  var failed = false;
  console.log("profile  preset  grid  QR    px/module (screen → camera)  codes read  offered KB/s  simulated KB/s  floor");
  PROFILES.forEach(function (prof) { Object.keys(PRESETS).forEach(function (name) {
    var p = PRESETS[name], T = CAP_L[p.ver] - Q.OVERHEAD, enc = new Q.Encoder(payload, T), esi = 0, read = 0, shown = 0, camPx = 0;
    for (var f = 0; f < FRAMES; f++) {
      var codes = [];
      for (var c = 0; c < p.cols * p.rows; c++, esi++) codes.push(Q.encodeCode(0xABCD, payload.length, T, esi, enc.symbol(esi), 0));
      var sf = screenFrame(p, codes), cam = cameraFrame(sf, prof.blurs);
      camPx = sf.px * cameraScale(sf);
      var ptr = zx._malloc(cam.length);
      zx.HEAPU8.set(cam, ptr);
      var v = zx.readBarcodesFromPixmap(ptr, CAM_W, CAM_H, opts), seen = {};
      for (var k = 0; k < v.size(); k++) {
        var r = v.get(k);
        if (!r.isValid) continue;
        var pc = Q.parseCode(new Uint8Array(r.bytes));
        if (pc && !pc.error && !seen[pc.esi]) { seen[pc.esi] = 1; read++; }
      }
      zx._free(ptr);
      shown += codes.length;
    }
    var rate = read / shown, offered = p.cols * p.rows * T * p.fps / 1024;
    var floor = prof.floor[name], ok = rate >= floor;
    failed = failed || !ok;
    console.log((prof.name + "         ").slice(0, 9) + (name + "      ").slice(0, 8) + p.cols + "x" + p.rows + "   v" + p.ver + "-L " +
      ("  " + Math.floor(sf.px) + " → " + camPx.toFixed(1)).padEnd(28) + (read + "/" + shown + " (" + Math.round(rate * 100) + "%)").padEnd(12) +
      offered.toFixed(0).padStart(12) + (offered * rate).toFixed(0).padStart(16) + "   " + Math.round(floor * 100) + "% " + (ok ? "ok" : "BELOW FLOOR"));
  }); });
  if (failed) { console.log("FAIL optics: a preset's simulated code recovery fell below its floor"); process.exit(1); }
  console.log("ok   simulated camera reads every preset above its floor");
})().catch(function (e) { console.log("FAIL optics: " + (e.stack || e.message)); process.exit(1); });
