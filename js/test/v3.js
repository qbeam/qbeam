// Protocol v3 tests: reference codec against its vectors, decode round-trips under loss, receiver checks,
// and codes made by the Python encoder decoded here.   Run from the repo root: node js/test/v3.js
"use strict";
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var execFileSync = require("child_process").execFileSync;
var Q = require("../qbeam3.js");

var repo = path.resolve(__dirname, "..", "..");
var V = JSON.parse(fs.readFileSync(path.join(repo, "protocol", "test-vectors", "v3.json"), "utf8"));
var python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
var failures = 0;

function test(name, fn) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failures++; console.log("FAIL " + name + ": " + e.message); }
}
function eq(a, b, what) { if (a !== b) throw new Error((what || "value") + ": expected " + b + ", got " + a); }
var hex = function (b) { return Buffer.from(b).toString("hex"); };

// Feeds codes in sender order through random loss into a Decoder until it completes.
function transfer(container, T, loss, session) {
  var enc = new Q.Encoder(container, T), dec = null, esi = 0, sent = 0, received = 0;
  while (!dec || !dec.complete()) {
    var code = Q.encodeCode(session, container.length, T, esi, enc.symbol(esi), 0);
    esi++; sent++;
    if (Math.random() < loss) continue;
    received++;
    var c = Q.parseCode(code);
    if (!c || c.error) throw new Error("own code rejected: " + (c && c.error));
    if (!dec) dec = new Q.Decoder(c.L, c.T);
    dec.add(c.esi, c.symbol);
    if (sent > enc.lay.K * 3 + 100) throw new Error("did not converge");
  }
  return { payload: dec.payload(), sent: sent, received: received, K: enc.lay.K, S: enc.lay.S };
}

test("session vector: codes parse back to the container", function () {
  var s = V.session, container = Buffer.from(s.containerHex, "hex");
  s.codes.forEach(function (c) {
    var p = Q.parseCode(new Uint8Array(Buffer.from(c.codeHex, "hex")));
    eq(p.session, s.sessionId, "session"); eq(p.L, container.length, "L"); eq(p.T, s.T, "T"); eq(p.esi, c.esi, "esi");
  });
  var ct = Q.parseContainer(new Uint8Array(container));
  eq(Buffer.from(ct.filenameUtf8).toString("utf8"), s.filename, "filename");
  eq(ct.encoding, s.encoding, "encoding");
  eq(hex(ct.sha256), s.sha256Hex, "sha256");
  eq(hex(crypto.createHash("sha256").update(ct.data).digest()), s.sha256Hex, "data hash");
});

test("reject vectors are rejected for the stated reason", function () {
  V.reject.forEach(function (r) {
    var p = Q.parseCode(new Uint8Array(Buffer.from(r.codeHex, "hex")));
    eq(p && p.error, r.reason, "reason");
  });
});

test("non-qbeam and v2 text codes are not ours", function () {
  eq(Q.parseCode(new Uint8Array(Buffer.from("Q2HTEST01|4|1000|", "ascii"))), null);
  eq(Q.parseCode(new Uint8Array([1, 2, 3, 4])), null);
});

[[0, 300, 0], [1, 300, 0.3], [5000, 1710, 0.3], [700000, 1710, 0.2], [2049 * 100, 100, 0.25], [10000 * 64, 64, 0.2]]
  .forEach(function (c) {
    test("round trip L=" + c[0] + " T=" + c[1] + " loss=" + c[2], function () {
      var data = new Uint8Array(crypto.randomBytes(c[0]));
      var r = transfer(data, c[1], c[2], 0x12345678);
      eq(Buffer.compare(Buffer.from(r.payload), Buffer.from(data)), 0, "payload equal");
      var overhead = r.received / r.K - 1; // symbols actually received beyond K
      if (r.K >= 50 && overhead > 0.1) throw new Error("overhead " + (overhead * 100).toFixed(1) + "% (K=" + r.K + ", S=" + r.S + ")");
    });
  });

test("Python-encoded codes decode here (cross-language)", function () {
  var script = [
    "import hashlib, json, os, sys",
    "sys.path.insert(0, " + JSON.stringify(path.join(repo, "py", "src")) + ")",
    "from qbeam import protocol_v3 as p3",
    "data = os.urandom(300000)",
    "c = p3.encode_container('däta 名.bin', 'raw', hashlib.sha256(data).digest(), data)",
    "enc = p3.Encoder(c, 1710)",
    "codes = [p3.encode_code(0xCAFE, len(c), 1710, e, enc.symbol(e)).hex() for e in range(int(enc.lay.K * 1.6))]",
    "print(json.dumps({'data': data.hex(), 'codes': codes}))",
  ].join("\n");
  var out = JSON.parse(execFileSync(python, ["-c", script], { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }));
  var dec = null, order = out.codes.map(function (h, i) { return i; }).sort(function () { return Math.random() - 0.5; });
  for (var i = 0; i < order.length && !(dec && dec.complete()); i++) {
    if (Math.random() < 0.25) continue;
    var p = Q.parseCode(new Uint8Array(Buffer.from(out.codes[order[i]], "hex")));
    if (!dec) dec = new Q.Decoder(p.L, p.T);
    dec.add(p.esi, p.symbol);
  }
  if (!dec.complete()) throw new Error("not enough codes survived the simulated loss; rerun");
  var ct = Q.parseContainer(dec.payload());
  eq(Buffer.from(ct.filenameUtf8).toString("utf8"), "däta 名.bin", "filename");
  eq(hex(ct.data), out.data, "data");
  eq(hex(crypto.createHash("sha256").update(ct.data).digest()), hex(ct.sha256), "sha256");
});

if (failures) { console.log(failures + " failure(s)"); process.exit(1); }
console.log("all v3 tests passed");
