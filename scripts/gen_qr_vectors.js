#!/usr/bin/env node
// Generates py/tests/data/qr_vectors.json: module grids from web/vendor/qrcodegen.js (the encoder the sender page
// uses) for the Python encoder (py/src/qbeam/qr.py) to reproduce exactly.   node scripts/gen_qr_vectors.js
"use strict";
var fs = require("fs");
var path = require("path");
var qrcode = require("../web/vendor/qrcodegen.js");

var CAP = { L: { 1: 17, 25: 1273, 30: 1732, 40: 2953 }, M: { 40: 2331 } };
function bytes(n, seed) {
  var b = new Uint8Array(n);
  for (var i = 0; i < n; i++) b[i] = (i * 131 + seed * 17 + 7) & 0xff;
  return b;
}

var cases = [];
for (var m = 0; m < 8; m++) cases.push([5, "L", m, bytes(60, m)]);   // every mask
cases.push([1, "L", 2, new Uint8Array(Buffer.from("hello"))]);
cases.push([1, "L", 2, bytes(CAP.L[1], 1)]);                        // full v1
cases.push([2, "M", 3, bytes(20, 2)]);                              // level M, short
cases.push([7, "L", 2, bytes(100, 3)]);                             // first version with version info
cases.push([9, "M", 6, bytes(150, 4)]);                             // last 8-bit length
cases.push([10, "L", 5, bytes(200, 5)]);                            // first 16-bit length
cases.push([25, "L", 2, bytes(CAP.L[25], 6)]);                      // presets safe / fast
cases.push([30, "L", 2, bytes(CAP.L[30], 7)]);                      // preset max
cases.push([40, "L", 2, bytes(CAP.L[40], 8)]);
cases.push([40, "M", 7, bytes(CAP.M[40], 9)]);
cases.push([3, "L", 2, new Uint8Array(0)]);                         // empty

var out = cases.map(function (c) {
  var q = qrcode(c[0], c[1]);
  q.setMask(c[2]);
  var s = "";
  for (var i = 0; i < c[3].length; i++) s += String.fromCharCode(c[3][i]);
  q.addData(s, "Byte");
  q.make();
  var n = q.getModuleCount(), rows = [];
  for (var r = 0; r < n; r++) {
    var row = "";
    for (var k = 0; k < n; k++) row += q.isDark(r, k) ? "1" : "0";
    rows.push(row);
  }
  return { version: c[0], ecc: c[1], mask: c[2], dataHex: Buffer.from(c[3]).toString("hex"), rows: rows };
});

var file = path.join(__dirname, "..", "py", "tests", "data", "qr_vectors.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out) + "\n");
console.log("wrote " + path.relative(process.cwd(), file) + " (" + out.length + " codes)");
