// Round trip through both CLIs (protocol v3): each CLI writes a sender page; the test takes the page's payload,
// turns it into framed codes the way the page does, drops a share of them, decodes the rest with the reference
// decoder, and checks the saved bytes against the input.
// Run from the repo root: node js/test/roundtrip.js   (PYTHON=python to override the interpreter)
"use strict";
var fs = require("fs");
var os = require("os");
var path = require("path");
var zlib = require("zlib");
var crypto = require("crypto");
var execFileSync = require("child_process").execFileSync;
var Q = require("../qbeam3.js");

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

var repo = path.resolve(__dirname, "..", "..");
var python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qbeam-test-"));
var failures = 0;
var PASS = "correct horse battery staple";
var T_FOR_SPEED = { safe: 1251, fast: 1251, max: 1710 }; // must match web/sender_app.js presets

function pageGlobal(html, name) { return JSON.parse(html.match(new RegExp("var " + name + " = (.*?);\\n"))[1]); }

async function decodePage(page, loss) {
  var html = fs.readFileSync(page, "utf8");
  if (/__(TITLE|QRCODEGEN|QBEAM3|PAYLOAD|META|SPEED|APP)__/.test(html)) throw new Error("unfilled placeholder");
  var P = pageGlobal(html, "PAYLOAD"), speed = pageGlobal(html, "SPEED"), T = T_FOR_SPEED[speed];
  var payload = new Uint8Array(Buffer.from(P.dataB64, "base64"));
  var enc = new Q.Encoder(payload, T), dec = null, esi = 0;
  while (!dec || !dec.complete()) {
    var code = Q.encodeCode(P.session, payload.length, T, esi, enc.symbol(esi), P.flags);
    esi++;
    if (Math.random() < loss) continue;
    var c = Q.parseCode(code);
    if (!dec) dec = new Q.Decoder(c.L, c.T);
    dec.add(c.esi, c.symbol);
    if (esi > enc.lay.K * 4 + 100) throw new Error("decoder did not converge");
  }
  var container = dec.payload();
  if (P.flags & Q.FLAG_ENCRYPTED) container = await Q.openEnvelope(container, PASS);
  var ct = Q.parseContainer(container);
  var saved = ct.encoding === "gzip" ? zlib.gunzipSync(Buffer.from(ct.data)) : Buffer.from(ct.data);
  if (Buffer.compare(crypto.createHash("sha256").update(saved).digest(), Buffer.from(ct.sha256)) !== 0) throw new Error("sha256 mismatch");
  return { saved: saved, name: Buffer.from(ct.filenameUtf8).toString("utf8"), encrypted: !!(P.flags & 1) };
}

async function check(label, makePage, input, opts) {
  var page = path.join(tmp, label + ".html");
  try {
    makePage(input, page, opts);
    var r = await decodePage(page, opts.loss);
    if (Buffer.compare(r.saved, fs.readFileSync(input)) !== 0) throw new Error("output differs from input");
    if (r.name !== path.basename(input)) throw new Error("filename " + r.name);
    if (r.encrypted !== !!opts.encrypt) throw new Error("encryption flag");
    console.log("ok   " + label);
  } catch (e) {
    failures++;
    console.log("FAIL " + label + ": " + e.message);
  }
}

function cliArgs(input, page, opts) {
  return ["send", input, "--out", page, "--no-open", "--speed", opts.speed].concat(opts.encrypt ? ["--encrypt"] : []);
}
var env = Object.assign({}, process.env, { QBEAM_PASSPHRASE: PASS });
var nodeCli = function (input, page, opts) {
  execFileSync(process.execPath, [path.join(repo, "js", "bin", "qbeam.js")].concat(cliArgs(input, page, opts)), { stdio: "ignore", env: env });
};
var pyCli = function (input, page, opts) {
  execFileSync(python, [path.join(repo, "py", "encode.py")].concat(cliArgs(input, page, opts).slice(1)), { stdio: "ignore", env: env });
};
var pyHasCrypto = (function () {
  try { execFileSync(python, ["-c", "import cryptography"], { stdio: "ignore" }); return true; } catch (e) { return false; }
})();

var inputs = {
  random: path.join(tmp, "random.bin"),
  text: path.join(tmp, "ünïcode 名.txt"),
  empty: path.join(tmp, "empty.txt"),
};
fs.writeFileSync(inputs.random, crypto.randomBytes(120000));
fs.writeFileSync(inputs.text, "héllo naïve 文件\n".repeat(400));
fs.writeFileSync(inputs.empty, "");

(async function () {
  var clis = [["node", nodeCli], ["python", pyCli]];
  for (var i = 0; i < clis.length; i++) {
    var name = clis[i][0], cli = clis[i][1];
    await check(name + "-random-max", cli, inputs.random, { speed: "max", loss: 0.3 });
    await check(name + "-unicode-fast", cli, inputs.text, { speed: "fast", loss: 0.5 });
    await check(name + "-empty-safe", cli, inputs.empty, { speed: "safe", loss: 0 });
    if (name === "node" || pyHasCrypto) await check(name + "-encrypted", cli, inputs.text, { speed: "fast", loss: 0.25, encrypt: true });
    else console.log("skip " + name + "-encrypted (cryptography not installed for " + python + ")");
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failures) { console.log(failures + " failure(s)"); process.exit(1); }
  console.log("all round-trips passed");
})();
