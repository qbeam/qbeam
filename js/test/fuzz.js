// Fuzz tests for everything a hostile or garbled QR code can reach in a receiver (js/qbeam3.js).
// Deterministic (seeded), so a failure reproduces: node js/test/fuzz.js [seed] [iterations]
"use strict";
var crypto = require("crypto");
var Q = require("../qbeam3.js");

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

var seed = +process.argv[2] || 20261001, N = +process.argv[3] || 3000;
var failures = 0;
function rng(s) { return function () { s = (s + 0x6d2b79f5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
var rand = rng(seed);
function int(n) { return Math.floor(rand() * n); }
function bytes(n) { var b = new Uint8Array(n); for (var i = 0; i < n; i++) b[i] = int(256); return b; }
function fail(name, detail) { failures++; console.log("FAIL " + name + " (seed " + seed + "): " + detail); }
function test(name, fn) {
  var t = Date.now();
  try { fn(); console.log("ok   " + name + " (" + (Date.now() - t) + " ms)"); } catch (e) { fail(name, e.stack || e.message); }
}

// A well-formed code with a correct CRC around arbitrary header values.
function forged(session, L, T, esi, flags) {
  var b = new Uint8Array(22 + T), v = new DataView(b.buffer);
  b.set([0xb3, 0x71, 3, flags]); v.setUint32(4, session); v.setUint32(8, L); v.setUint16(12, T); v.setUint32(14, esi);
  b.set(bytes(T), 18);
  v.setUint32(18 + T, Q.crc32(b, 0, 18 + T));
  return b;
}

var KNOWN_ERRORS = { version: 1, short: 1, length: 1, crc: 1, flags: 1, limits: 1 };
function checkParse(b, where) {
  var p = Q.parseCode(b);
  if (p === null) return null;
  if (p.error) { if (!KNOWN_ERRORS[p.error]) throw new Error(where + ": unknown error " + p.error); return null; }
  if (Q.limitsError(p.L, p.T)) throw new Error(where + ": accepted a code outside the limits");
  if (p.symbol.length !== p.T) throw new Error(where + ": symbol length " + p.symbol.length + " != T " + p.T);
  return p;
}

test("random bytes never throw in parseCode", function () {
  for (var i = 0; i < N; i++) {
    var b = bytes(int(3000));
    if (rand() < 0.5 && b.length >= 3) { b[0] = 0xb3; b[1] = 0x71; b[2] = rand() < 0.8 ? 3 : int(256); }
    checkParse(b, "random #" + i);
  }
});

test("mutated real codes are rejected or parse consistently", function () {
  var payload = bytes(5000), enc = new Q.Encoder(payload, 300);
  for (var i = 0; i < N; i++) {
    var code = Q.encodeCode(0x1234, payload.length, 300, i, enc.symbol(i), 0);
    var m = new Uint8Array(code), k = 1 + int(4);
    for (var j = 0; j < k; j++) m[int(m.length)] ^= 1 + int(255);
    if (rand() < 0.2) m = m.subarray(0, int(m.length));
    var p = checkParse(m, "mutation #" + i);
    if (p && Buffer.compare(Buffer.from(m), Buffer.from(code)) !== 0) throw new Error("a corrupted code passed the CRC (#" + i + ")");
  }
});

test("forged headers: limits enforced, decoders bounded, add() never throws", function () {
  var t0 = Date.now(), built = 0;
  for (var i = 0; i < N; i++) {
    var T = rand() < 0.5 ? int(3200) : Q.T_MIN + int(Q.T_MAX - Q.T_MIN + 1);
    var L = rand() < 0.3 ? 0xffffffff - int(1000) : rand() < 0.5 ? int(Q.MAX_L + 1) : int(5000);
    if (T < 1) T = 1;
    var p = checkParse(forged(int(4294967296), L, T, rand() < 0.5 ? int(1000) : 4294967295 - int(1000), int(2)), "forged #" + i);
    if (!p) continue;
    var t = Date.now(), d = new Q.Decoder(p.L, p.T);
    if (Date.now() - t > 50) throw new Error("Decoder(" + p.L + ", " + p.T + ") took " + (Date.now() - t) + " ms");
    d.add(p.esi, p.symbol);
    d.add(p.esi, p.symbol); // duplicate
    d.add(p.esi + 1, bytes(p.T + 1)); // wrong length
    built++;
  }
  if (process.memoryUsage().heapUsed > 1.5e9) throw new Error("heap grew to " + process.memoryUsage().heapUsed);
  if (Date.now() - t0 > 20000) throw new Error("too slow: " + (Date.now() - t0) + " ms for " + built + " decoders");
});

test("random containers throw plain Errors or parse in bounds", function () {
  for (var i = 0; i < N; i++) {
    var b = bytes(int(200));
    if (rand() < 0.5 && b.length) b[0] = 1;
    if (rand() < 0.5 && b.length > 1) b[1] = int(2);
    try {
      var c = Q.parseContainer(b);
      if (c.filenameUtf8.length + c.sha256.length + c.data.length + 4 !== b.length) throw new Error("container sizes don't add up");
      if (c.sha256.length !== 32) throw new Error("sha256 length " + c.sha256.length);
    } catch (e) {
      if (!(e instanceof Error) || /sizes|sha256 length/.test(e.message)) throw e;
    }
  }
});

test("a symbol corrupted past the CRC is caught by the SHA-256", function () {
  var data = bytes(20000), sha = new Uint8Array(crypto.createHash("sha256").update(data).digest());
  var c = Q.encodeContainer(new Uint8Array(Buffer.from("f.bin")), "raw", sha, data);
  var enc = new Q.Encoder(c, 500), dec = new Q.Decoder(c.length, 500);
  for (var esi = 0; !dec.complete(); esi++) {
    var s = new Uint8Array(enc.symbol(esi));
    if (esi === 7) s[3] ^= 0x40; // as if the QR decoded wrongly but its CRC still matched
    dec.add(esi, s);
  }
  var out = Q.parseContainer(dec.payload());
  var got = crypto.createHash("sha256").update(out.data).digest("hex");
  if (got === Buffer.from(out.sha256).toString("hex")) throw new Error("corruption went unnoticed");
});

(async function () {
  var t = Date.now();
  try {
    var allowed = { scheme: 1, iterations: 1, short: 1, auth: 1 };
    for (var i = 0; i < 300; i++) {
      var env = bytes(int(120));
      if (rand() < 0.5 && env.length) env[0] = 1;
      if (rand() < 0.5 && env.length > 5) new DataView(env.buffer).setUint32(1, 1 + int(2000)); // keep PBKDF2 cheap
      try { await Q.openEnvelope(env, "pass"); throw new Error("random envelope #" + i + " decrypted"); }
      catch (e) { if (!allowed[e.message]) throw new Error("envelope #" + i + ": unexpected " + e.message); }
    }
    console.log("ok   random envelopes are rejected with known reasons (" + (Date.now() - t) + " ms)");
  } catch (e) { fail("random envelopes", e.message); }
  if (failures) { console.log(failures + " failure(s)"); process.exit(1); }
  console.log("all fuzz tests passed (seed " + seed + ", " + N + " iterations)");
})();
