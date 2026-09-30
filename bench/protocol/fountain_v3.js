// P0.5a: segmented dense fountain code, segment size (KMAX) trade-off.
// Simulates the sender's ESI order with random code loss and measures: symbols needed / K (overhead),
// receiver decode time, and sender cost per repair symbol.    node bench/protocol/fountain_v3.js
"use strict";
var fs = require("fs"), path = require("path"), crypto = require("crypto");
var src = fs.readFileSync(path.join(__dirname, "..", "..", "js", "qbeam3.js"), "utf8");

function codecWith(kmax) {
  var m = { exports: {} };
  new Function("module", src.replace("var KMAX = 2048;", "var KMAX = " + kmax + ";"))(m);
  return m.exports;
}

var T = 1710; // v30-L capacity (1732) minus 22 bytes of framing
var LOSS = 0.2;
console.log("KMAX   file    K      S    overhead   decode s   decode MB/s   encode ms/repair   ok");
(process.env.KMAXES || "256,512,1024").split(",").map(Number).forEach(function (kmax) {
  var Q = codecWith(kmax);
  (process.env.SIZES || "0.1,1,10").split(",").map(Number).forEach(function (mb) {
    var payload = crypto.randomBytes(Math.round(mb * 1024 * 1024));
    var enc = new Q.Encoder(new Uint8Array(payload), T), dec = new Q.Decoder(payload.length, T);
    var K = enc.lay.K, esi = 0, received = 0, decMs = 0, encMs = 0, repairs = 0;
    while (!dec.complete()) {
      var t0 = process.hrtime.bigint();
      var sym = enc.symbol(esi);
      var t1 = process.hrtime.bigint();
      if (esi >= K) { encMs += Number(t1 - t0) / 1e6; repairs++; }
      if (Math.random() >= LOSS) {
        received++;
        var t2 = process.hrtime.bigint();
        dec.add(esi, sym);
        decMs += Number(process.hrtime.bigint() - t2) / 1e6;
      }
      esi++;
    }
    var ok = Buffer.compare(Buffer.from(dec.payload()), payload) === 0;
    console.log([String(kmax).padEnd(6), (mb + "MB").padEnd(7), String(K).padEnd(6), String(enc.lay.S).padEnd(4),
      ((received / K - 1) * 100).toFixed(1).padStart(7) + "%", (decMs / 1000).toFixed(2).padStart(10),
      (payload.length / 1048576 / (decMs / 1000)).toFixed(1).padStart(13), (repairs ? encMs / repairs : 0).toFixed(3).padStart(18),
      "   " + ok].join(" "));
  });
});
