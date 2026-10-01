// Terminal mode, decoded like a camera would: the Python sender draws frames in a fake 160x50 terminal; this test
// paints each character cell as an 8x16 px glyph (half blocks fill the top or bottom half), decodes the pixels with
// the receiver's own zxing WASM build (web/vendor), and rebuilds the file with the v3 decoder.
// Run from the repo root: node js/test/terminal_decode.js   (PYTHON=python to override the interpreter)
"use strict";
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var execFileSync = require("child_process").execFileSync;
var Q = require("../qbeam3.js");

var repo = path.resolve(__dirname, "..", "..");
var python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

// The receiver's zxing build: an IIFE that defines ZXingWASM, plus the WASM bytes.
var ZXingWASM = new Function(fs.readFileSync(path.join(repo, "web", "vendor", "zxing-reader.js"), "utf8") + "; return ZXingWASM;")();
var wasm = fs.readFileSync(path.join(repo, "web", "vendor", "zxing_reader.wasm"));

var CELL_W = 8, CELL_H = 16, COLS = 160, ROWS = 50, FRAMES = 12;

var script = [
  "import io, json, os, sys",
  "sys.path.insert(0, " + JSON.stringify(path.join(repo, "py", "src")) + ")",
  "from unittest import mock",
  "from qbeam import terminal",
  "from qbeam.cli import prepare",
  "data = os.urandom(6000)",
  "out, n = io.StringIO(), {'f': 0}",
  "def sleep(_):",
  "    n['f'] += 1",
  "    if n['f'] >= " + FRAMES + ": raise KeyboardInterrupt",
  "with mock.patch.object(terminal.shutil, 'get_terminal_size', return_value=os.terminal_size((" + COLS + ", " + ROWS + "))), \\",
  "     mock.patch.object(terminal.time, 'sleep', side_effect=sleep), mock.patch.object(terminal, 'can_draw_blocks', return_value=True):",
  "    prep = prepare(data, 'blob.bin', 'gzip')",
  "    terminal.run(prep['payload'], prep['flags'], prep['session'], 'fast', 'blob.bin', out=out)",
  "print(json.dumps({'data': data.hex(), 'text': out.getvalue()}))",
].join("\n");

function paint(frameText) {
  var lines = frameText.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split("\n").slice(0, ROWS - 1);
  var W = COLS * CELL_W, H = ROWS * CELL_H, px = new Uint8Array(W * H).fill(40); // dark terminal background
  lines.forEach(function (line, row) {
    Array.from(line).forEach(function (ch, col) {
      var top = ch === "█" || ch === "▀", bottom = ch === "█" || ch === "▄", paper = ch !== undefined;
      for (var y = 0; y < CELL_H; y++) {
        var dark = y < CELL_H / 2 ? top : bottom;
        px.fill(dark ? 0 : paper ? 255 : 40, (row * CELL_H + y) * W + col * CELL_W, (row * CELL_H + y) * W + (col + 1) * CELL_W);
      }
    });
  });
  return { luma: px, width: W, height: H };
}

(async function () {
  var zx = await ZXingWASM.prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }, fireImmediately: true });
  var opts = { formats: "QRCode", tryHarder: true, tryRotate: false, tryInvert: false, tryDownscale: false, tryDenoise: false,
    binarizer: 0, isPure: false, downscaleFactor: 3, downscaleThreshold: 500, minLineCount: 2, maxNumberOfSymbols: 16,
    validateOptionalChecksum: false, returnErrors: false, eanAddOnSymbol: 0, textMode: 2, characterSet: 0, tryCode39ExtendedMode: true };
  // Decodes one sender's terminal output the way a camera would and checks it rebuilds `data`.
  function check(label, text, data) {
    var frames = text.split("\x1b[H").slice(1).filter(function (f) { return f.indexOf("█") >= 0 || f.indexOf("▀") >= 0; });
    var dec = null, codes = 0;
    frames.forEach(function (f) {
      var img = paint(f), ptr = zx._malloc(img.luma.length);
      zx.HEAPU8.set(img.luma, ptr);
      var v = zx.readBarcodesFromPixmap(ptr, img.width, img.height, opts);
      for (var i = 0; i < v.size(); i++) {
        var r = v.get(i);
        if (!r.isValid) continue;
        var p = Q.parseCode(new Uint8Array(r.bytes));
        if (!p || p.error) continue;
        codes++;
        if (!dec) dec = new Q.Decoder(p.L, p.T);
        dec.add(p.esi, p.symbol);
      }
      zx._free(ptr);
    });
    if (!dec || !dec.complete()) {
      console.log("FAIL " + label + ": " + codes + " codes from " + frames.length + " frames, " + (dec ? dec.rank + "/" + dec.lay.K : "none") + " blocks");
      return false;
    }
    var ct = Q.parseContainer(dec.payload());
    var saved = ct.encoding === "gzip" ? require("zlib").gunzipSync(Buffer.from(ct.data)) : Buffer.from(ct.data);
    if (Buffer.compare(saved, data) !== 0) { console.log("FAIL " + label + ": rebuilt file differs"); return false; }
    if (crypto.createHash("sha256").update(saved).digest("hex") !== Buffer.from(ct.sha256).toString("hex")) {
      console.log("FAIL " + label + ": sha256 mismatch"); return false;
    }
    console.log("ok   " + label + ": " + codes + " codes from " + frames.length + " frames rebuilt " +
                Buffer.from(ct.filenameUtf8).toString("utf8") + " (" + saved.length + " bytes)");
    return true;
  }

  // Python terminal sender.
  var res = JSON.parse(execFileSync(python, ["-c", script], { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" }));
  var ok = check("python terminal frames decoded by zxing", res.text, Buffer.from(res.data, "hex"));

  // Node terminal sender (js/terminal.js), same fake terminal.
  var data = crypto.randomBytes(6000), out = "", frames = 0;
  var sha = new Uint8Array(crypto.createHash("sha256").update(data).digest());
  var container = Q.encodeContainer(new Uint8Array(Buffer.from("node.bin")), "raw", sha, new Uint8Array(data));
  await require("../terminal.js").run(container, 0, 0xC0FFEE, "fast", "node.bin", {
    out: { write: function (t) { out += t; } },
    size: function () { return [COLS, ROWS]; },
    sleep: function () { frames++; return Promise.resolve(); },
    shouldStop: function () { return frames >= FRAMES; },
    qrcode: require("../../web/vendor/qrcodegen.js"),
  });
  ok = check("node terminal frames decoded by zxing", out, data) && ok;
  if (!ok) process.exit(1);
})().catch(function (e) { console.log("FAIL terminal decode: " + e.message); process.exit(1); });
