// Terminal sender (protocol v3) for the npm CLI: animated QR codes drawn with Unicode half blocks, in true black
// on white. Mirrors py/src/qbeam/terminal.py (same presets, layout rule and rendering), so both CLIs behave alike.
"use strict";
var QBeam3 = require("./qbeam3.js");

var QUIET = 4;                                   // quiet-zone modules around each code (ISO 18004 minimum)
var VERSIONS = [25, 20, 15, 10, 7, 5, 3, 2];     // largest first
var CAPACITY_L = { 25: 1273, 20: 858, 15: 520, 10: 271, 7: 154, 5: 106, 3: 53, 2: 32 }; // byte mode, level L
var PRESETS = { safe: [10, 5], fast: [20, 8], max: [25, 12] }; // speed -> [largest version, frames per second]
var MAX_CODES = 6;

var INK = "\x1b[38;5;16m", PAPER = "\x1b[48;5;231m";
var RESET = "\x1b[0m", HOME = "\x1b[H", CLEAR = "\x1b[2J", HIDE = "\x1b[?25l", SHOW = "\x1b[?25h";

// The (version, across, down) carrying the most payload per frame in this window, larger codes winning ties;
// null if nothing fits. One row is kept for the status line.
function layout(cols, rows, maxVersion, minT) {
  var best = null;
  VERSIONS.forEach(function (v) {
    if (v > maxVersion || CAPACITY_L[v] - QBeam3.OVERHEAD < (minT || QBeam3.T_MIN)) return; // too big, or too small for K limit
    var size = 17 + 4 * v + 2 * QUIET, across = Math.floor(cols / size), down = Math.floor((rows - 1) / Math.ceil(size / 2));
    if (across < 1 || down < 1) return;
    while (across * down > MAX_CODES) { if (across >= down) across--; else down--; }
    var perFrame = across * down * (CAPACITY_L[v] - QBeam3.OVERHEAD);
    if (!best || perFrame > best.perFrame) best = { version: v, across: across, down: down, perFrame: perFrame };
  });
  return best;
}

// Codes laid out `across` per band (each a function (row, col) -> dark), with white quiet zones, as terminal text.
function render(codes, n, across) {
  var size = n + 2 * QUIET, out = [];
  function dark(code, r, c) { r -= QUIET; c -= QUIET; return r >= 0 && r < n && c >= 0 && c < n && code(r, c); }
  for (var b = 0; b < codes.length; b += across) {
    var band = codes.slice(b, b + across);
    for (var r = 0; r < size; r += 2) {
      var line = PAPER + INK;
      band.forEach(function (code) {
        for (var c = 0; c < size; c++) {
          var top = dark(code, r, c), bottom = r + 1 < size && dark(code, r + 1, c);
          line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
        }
      });
      out.push(line + RESET);
    }
  }
  return out.join("\n");
}

function latin1(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i += 4096) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  return s;
}

// Draws codes until stopped (Ctrl-C, or io.shouldStop() in tests). Resizing re-fits the codes; a different QR version
// starts a new session, which the receiver follows within 3 seconds (SPEC v3 §2).
// io: { out, size() -> [cols, rows], sleep(ms) -> Promise, shouldStop() -> bool, qrcode }
async function run(payload, flags, session, speed, label, io) {
  var preset = PRESETS[speed], maxVersion = preset[0], fps = preset[1];
  var minT = Math.max(QBeam3.T_MIN, Math.ceil(payload.length / QBeam3.MAX_K)); // keep K within the receiver limit
  var current = null, esi = 0, shown = 0, t0 = Date.now(), stopped = false;
  var onSig = function () { stopped = true; };
  process.once("SIGINT", onSig);
  io.out.write(HIDE + CLEAR);
  try {
    while (!stopped && !(io.shouldStop && io.shouldStop())) {
      var start = Date.now(), sz = io.size(), fit = layout(sz[0], sz[1], maxVersion, minT);
      if (!fit) {
        io.out.write(HOME + CLEAR + "Terminal too small for a QR code: make it at least 45x24, or use the browser sender.");
        await io.sleep(500);
        continue;
      }
      if (!current || current.version !== fit.version) {
        var T = CAPACITY_L[fit.version] - QBeam3.OVERHEAD;
        if (current) session = require("crypto").randomBytes(4).readUInt32BE(0);
        current = { version: fit.version, T: T, enc: new QBeam3.Encoder(payload, T) };
        esi = 0;
        io.out.write(CLEAR);
      }
      var codes = [], n = 17 + 4 * fit.version;
      for (var i = 0; i < fit.across * fit.down; i++) {
        var bytes = QBeam3.encodeCode(session, payload.length, current.T, esi, current.enc.symbol(esi), flags);
        esi++;
        var qr = io.qrcode(fit.version, "L");
        qr.setMask(2);
        qr.addData(latin1(bytes), "Byte");
        qr.make();
        codes.push(qr.isDark.bind(qr));
      }
      shown++;
      var rate = shown / Math.max((Date.now() - t0) / 1000, 1e-3);
      var status = " qbeam · " + label + " · " + codes.length + "× v" + fit.version + " · " + rate.toFixed(0) + " fps · ~" +
        Math.round(codes.length * current.T * rate / 1024) + " KB/s offered · Ctrl-C to stop ";
      io.out.write(HOME + render(codes, n, fit.across) + "\n" + status.slice(0, sz[0]) + "\x1b[K");
      await io.sleep(Math.max(0, 1000 / fps - (Date.now() - start)));
    }
  } finally {
    process.removeListener("SIGINT", onSig);
    io.out.write(RESET + SHOW + CLEAR + HOME);
  }
}

module.exports = { layout: layout, render: render, run: run, PRESETS: PRESETS, QUIET: QUIET, CAPACITY_L: CAPACITY_L,
                   HOME: HOME, PAPER: PAPER };
