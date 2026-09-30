// Round-trip test: make sender pages with the Node CLI and the Python CLI, then decode them the way
// the phone does (fountain frames with random loss -> decoder -> gunzip) and compare with the input.
// Run from the repo root: node js/test/roundtrip.js   (PYTHON=python to override the interpreter)
"use strict";
var fs = require("fs");
var os = require("os");
var path = require("path");
var zlib = require("zlib");
var crypto = require("crypto");
var execFileSync = require("child_process").execFileSync;
var Fountain = require("../fountain.js");

var repo = path.resolve(__dirname, "..", "..");
var python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qbeam-test-"));
var failures = 0;

function decodePage(page, dropRate) {
  var html = fs.readFileSync(page, "utf8");
  if (/__(TITLE|QRCODEGEN|FOUNTAIN|PAYLOAD|META|APP)__/.test(html)) throw new Error("unfilled placeholder");
  var P = JSON.parse(html.match(/var PAYLOAD = (\{.*?\});/)[1]);
  var data = Buffer.from(P.data, "base64");
  if (crypto.createHash("sha256").update(data).digest("hex") !== P.sha) throw new Error("checksum mismatch");
  var enc = new Fountain.Encoder(new Uint8Array(data), P.blockSize);
  var dec = new Fountain.Decoder(enc.K, P.blockSize, enc.len);
  var esi = 0;
  while (!dec.complete()) {
    var sym = enc.symbol(esi);
    if (Math.random() >= dropRate) dec.add(esi, sym);
    esi++;
    if (esi > enc.K * 10 + 100) throw new Error("decoder did not converge");
  }
  return zlib.gunzipSync(Buffer.from(dec.solve()));
}

function check(label, makePage, input, dropRate) {
  var page = path.join(tmp, label + ".html");
  try {
    makePage(input, page);
    var out = decodePage(page, dropRate);
    if (Buffer.compare(out, fs.readFileSync(input)) !== 0) throw new Error("output differs from input");
    console.log("ok   " + label + " (drop " + dropRate + ")");
  } catch (e) {
    failures++;
    console.log("FAIL " + label + ": " + e.message);
  }
}

var nodeCli = function (input, page) {
  execFileSync(process.execPath, [path.join(repo, "js", "bin", "qbeam.js"), "send", input, "--out", page], { stdio: "ignore" });
};
var pyCli = function (input, page) {
  execFileSync(python, [path.join(repo, "py", "encode.py"), input, "--out", page], { stdio: "ignore" });
};

var inputs = {
  random: path.join(tmp, "random.bin"),
  text: path.join(tmp, "ünïcode 名.txt"),
  empty: path.join(tmp, "empty.txt"),
};
fs.writeFileSync(inputs.random, crypto.randomBytes(120000));
fs.writeFileSync(inputs.text, "héllo naïve 文件\n".repeat(400));
fs.writeFileSync(inputs.empty, "");

[["node", nodeCli], ["python", pyCli]].forEach(function (cli) {
  check(cli[0] + "-random", cli[1], inputs.random, 0.3);
  check(cli[0] + "-unicode", cli[1], inputs.text, 0.5);
  check(cli[0] + "-empty", cli[1], inputs.empty, 0);
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failures) { console.log(failures + " failure(s)"); process.exit(1); }
console.log("all round-trips passed");
