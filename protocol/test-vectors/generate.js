#!/usr/bin/env node
// Generates protocol/test-vectors/v2.json from the reference codec (js/fountain.js).
// Regenerate only on a deliberate protocol change:  node protocol/test-vectors/generate.js
"use strict";
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var Fountain = require("../../js/fountain.js");

function payload(len) {
  var b = Buffer.alloc(len);
  for (var i = 0; i < len; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

// Recover which source blocks a symbol mixes: give block j a payload with only bit j set.
function coefficients(K, blockSize, esi) {
  if (blockSize * 8 < K) throw new Error("blockSize too small to probe coefficients");
  var probe = Buffer.alloc(K * blockSize);
  for (var j = 0; j < K; j++) probe[j * blockSize + (j >> 3)] |= 1 << (j & 7);
  var sym = new Fountain.Encoder(new Uint8Array(probe), blockSize).symbol(esi);
  var blocks = [];
  for (var k = 0; k < K; k++) if (sym[k >> 3] & (1 << (k & 7))) blocks.push(k);
  return blocks;
}

var cases = [
  { name: "empty payload", len: 0, blockSize: 300 },
  { name: "K=4, short last block", len: 1000, blockSize: 300 },
  { name: "K=32, one full coefficient word", len: 2048, blockSize: 64 },
  { name: "K=79, three words with tail mask", len: 5000, blockSize: 64 },
].map(function (c) {
  var data = payload(c.len);
  var enc = new Fountain.Encoder(new Uint8Array(data), c.blockSize);
  var K = enc.K;
  var esis = [0, 1, 2, K - 1, K, K + 1, K + 2, K + 50, K + 1000].filter(function (e, i, a) {
    return e >= 0 && a.indexOf(e) === i;
  }).sort(function (a, b) { return a - b; });
  return {
    name: c.name,
    payloadLen: c.len,
    blockSize: c.blockSize,
    K: K,
    symbols: esis.map(function (esi) {
      return {
        esi: esi,
        blocks: K * 1 <= c.blockSize * 8 ? coefficients(K, c.blockSize, esi) : null,
        symbolHex: Buffer.from(enc.symbol(esi)).toString("hex"),
      };
    }),
  };
});

// Frame text for one session (payload = the K=4 case, blockSize 300).
var fp = payload(1000);
var fenc = new Fountain.Encoder(new Uint8Array(fp), 300);
var common = "TEST01|" + fenc.K + "|" + fp.length + "|";
var frames = {
  id: "TEST01",
  payloadLen: fp.length,
  blockSize: 300,
  sha: crypto.createHash("sha256").update(fp).digest("hex"),
  filename: "héllo 名.txt",
  encoding: "gz",
  header: null,
  data: [],
};
frames.header = "Q2H" + common + frames.sha + "|" + Buffer.from(frames.filename, "utf8").toString("base64") + "|" + frames.encoding;
[0, 3, 4, 9].forEach(function (esi) {
  frames.data.push({ esi: esi, frame: "Q2D" + common + esi + "|" + Buffer.from(fenc.symbol(esi)).toString("base64") });
});

var out = {
  description: "qbeam protocol v2 test vectors. payload byte i = (i*31 + 7) & 0xff. See protocol/SPEC.md.",
  fountain: cases,
  frames: frames,
};
var file = path.join(__dirname, "v2.json");
fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log("wrote " + path.relative(process.cwd(), file));
