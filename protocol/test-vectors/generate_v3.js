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
  { reason: "flags", note: "must-understand bit 0 set, CRC recomputed", codeHex: (function () {
      var b = Q.encodeCode(session, container.length, T, 0, senc.symbol(0), 0x01); return hex(b); })() },
  { reason: "length", codeHex: hex(good.subarray(0, good.length - 1)) },
];

var out = {
  description: "qbeam protocol v3 test vectors. payload byte i = (i*31 + 7) & 0xff. See protocol/SPEC.md.",
  constants: { magic: [0xb3, 0x71], version: 3, headerBytes: Q.HEADER, overheadBytes: Q.OVERHEAD, kmax: Q.KMAX },
  crc32: crc,
  layouts: layouts,
  fountain: fountain,
  session: {
    sessionId: session, T: T, fileLen: fileBytes.length, filename: "héllo 名.txt", encoding: "raw",
    sha256Hex: hex(sha), containerHex: hex(container), codes: codes,
  },
  reject: reject,
};
var file = path.join(__dirname, "v3.json");
fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log("wrote " + path.relative(process.cwd(), file));
