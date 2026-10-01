#!/usr/bin/env node
// Generates protocol/test-vectors/v3.json from the reference codec (js/qbeam3.js).
// Regenerate only on a deliberate protocol change:  node protocol/test-vectors/generate_v3.js
"use strict";
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var Q = require("../../js/qbeam3.js");

function payload(len) {
  var b = new Uint8Array(len);
  for (var i = 0; i < len; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}
var hex = function (b) { return Buffer.from(b).toString("hex"); };

// Coefficients as bytes: bit j of the segment's blocks = byte j>>3, bit j&7 (least significant first).
function coefHex(words, n) {
  var out = new Uint8Array((n + 7) >> 3);
  for (var j = 0; j < n; j++) if (words[j >>> 5] & (1 << (j & 31))) out[j >> 3] |= 1 << (j & 7);
  return hex(out);
}

var crc = ["", "123456789", "qbeam"].map(function (s) {
  return { asciiInput: s, crc32: Q.crc32(new Uint8Array(Buffer.from(s, "ascii"))) };
});

var layouts = [[0, 300], [1, 300], [300, 300], [301, 300], [2048 * 100, 100], [2049 * 100, 100], [10000 * 8, 8], [6133 * 1710, 1710]]
  .map(function (lt) {
    var l = Q.layout(lt[0], lt[1]);
    return { L: lt[0], T: lt[1], K: l.K, S: l.S, segments: l.segments.map(function (s) { return [s.start, s.size]; }) };
  });

// Fountain symbols: one single-segment case and one three-segment case (small T keeps the file small).
var fountain = [[5000, 64], [5000 * 8, 8]].map(function (lt) {
  var L = lt[0], T = lt[1], data = payload(L), enc = new Q.Encoder(data, T), lay = enc.lay;
  var esis = [0, 1, lay.K - 1, lay.K, lay.K + 1, lay.K + 2, lay.K + 3, lay.K + 50, lay.K + 1000];
  return {
    L: L, T: T, K: lay.K, S: lay.S,
    symbols: esis.map(function (esi) {
      var cf = Q.coefficients(lay, esi);
      return { esi: esi, segment: cf.seg.index, coefHex: coefHex(cf.coef, cf.seg.size), symbolHex: hex(enc.symbol(esi)) };
    }),
  };
});

// A complete small session: container -> fountain -> framed codes.
var fileBytes = payload(700);
var name = new Uint8Array(Buffer.from("héllo 名.txt", "utf8"));
var sha = new Uint8Array(crypto.createHash("sha256").update(fileBytes).digest());
var container = Q.encodeContainer(name, "raw", sha, fileBytes);
var T = 200, session = 0x0a0b0c0d, senc = new Q.Encoder(container, T);
var codes = [0, 1, senc.lay.K - 1, senc.lay.K, senc.lay.K + 7].map(function (esi) {
  return { esi: esi, codeHex: hex(Q.encodeCode(session, container.length, T, esi, senc.symbol(esi), 0)) };
});

// Codes a receiver must reject.
var good = Q.encodeCode(session, container.length, T, 0, senc.symbol(0), 0);
function mutate(f) { var b = new Uint8Array(good); f(b); return hex(b); }
var reject = [
  { reason: "crc", codeHex: mutate(function (b) { b[30] ^= 1; }) },
  { reason: "version", codeHex: mutate(function (b) { b[2] = 4; }) },
  { reason: "flags", note: "unknown must-understand bit 1 set, CRC recomputed", codeHex: (function () {
      var b = Q.encodeCode(session, container.length, T, 0, senc.symbol(0), 0x02); return hex(b); })() },
  { reason: "length", codeHex: hex(good.subarray(0, good.length - 1)) },
  { reason: "limits", note: "valid CRC but T = 1 and L = 2^32 - 1: must be rejected before allocating", codeHex: (function () {
      var b = new Uint8Array(23), v = new DataView(b.buffer);
      b.set([0xb3, 0x71, 3, 0]); v.setUint32(4, session); v.setUint32(8, 0xffffffff); v.setUint16(12, 1); v.setUint32(14, 0);
      v.setUint32(19, Q.crc32(b, 0, 19)); return hex(b); })() },
];

// Encryption envelope of the session container (1,000 iterations for speed; senders use >= 600,000).
var envelopeOpts = { iterations: 1000, salt: Uint8Array.from({ length: 16 }, function (_, i) { return i; }),
                     nonce: Uint8Array.from({ length: 12 }, function (_, i) { return 0xa0 + i; }) };
var passphrase = "correct horse battery staple";

Q.sealEnvelope(container, passphrase, envelopeOpts).then(function (envelope) {
var out = {
  description: "qbeam protocol v3 test vectors. payload byte i = (i*31 + 7) & 0xff. See protocol/SPEC.md.",
  constants: { magic: [0xb3, 0x71], version: 3, headerBytes: Q.HEADER, overheadBytes: Q.OVERHEAD, kmax: Q.KMAX,
               tMin: Q.T_MIN, tMax: Q.T_MAX, maxL: Q.MAX_L, maxK: Q.MAX_K },
  crc32: crc,
  layouts: layouts,
  fountain: fountain,
  session: {
    sessionId: session, T: T, fileLen: fileBytes.length, filename: "héllo 名.txt", encoding: "raw",
    sha256Hex: hex(sha), containerHex: hex(container), codes: codes,
  },
  reject: reject,
  encryption: {
    passphrase: passphrase, iterations: envelopeOpts.iterations, saltHex: hex(envelopeOpts.salt),
    nonceHex: hex(envelopeOpts.nonce), plaintext: "session.containerHex", envelopeHex: hex(envelope),
    codeHex: hex(Q.encodeCode(session, envelope.length, T, 0, new Q.Encoder(envelope, T).symbol(0), Q.FLAG_ENCRYPTED)),
  },
};
var file = path.join(__dirname, "v3.json");
fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log("wrote " + path.relative(process.cwd(), file));
});
