// Shared by sender and decoder pages (inlined into both).
//
// Systematic random linear fountain code over GF(2):
//   - encoding symbol ids (esi) 0..K-1 are the raw blocks themselves (sent
//     first, once);
//   - esi >= K is the XOR of a pseudo-random subset (each block w.p. 1/2)
//     derived deterministically from esi, so the decoder can rebuild the subset.
//     The sender emits esi = 0, 1, 2, ... forever, so every coded frame is new.
// The decoder does incremental Gaussian elimination, so ANY ~K+2 distinct
// frames reconstruct the payload. Missed frames never force a wait for the
// next loop; any later coded frame fills the gap.
var Fountain = (function () {
  "use strict";

  var HEADER_EVERY = 10; // one header frame per this many frames

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
  }

  // Bitset (Uint32Array of ceil(K/32) words) of the blocks mixed into symbol esi.
  function rowCoefs(esi, K) {
    var words = (K + 31) >>> 5;
    var c = new Uint32Array(words);
    if (esi < K) {
      c[esi >>> 5] = 1 << (esi & 31);
      return c;
    }
    var rand = mulberry32(Math.imul(esi, 0x9E3779B1) ^ K);
    var any = 0;
    for (var w = 0; w < words; w++) c[w] = rand();
    var tail = K & 31;
    if (tail) c[words - 1] &= (1 << tail) - 1;
    for (w = 0; w < words; w++) any |= c[w];
    if (!any) {
      var b = esi % K;
      c[b >>> 5] = 1 << (b & 31);
    }
    return c;
  }

  function xorInto(dst, src) {
    for (var i = 0; i < dst.length; i++) dst[i] ^= src[i];
  }

  function words32(bytes, blockSize) {
    var buf = new Uint8Array(((blockSize + 3) >>> 2) * 4);
    buf.set(bytes.subarray(0, blockSize));
    return new Uint32Array(buf.buffer);
  }

  // ---- Encoder ----
  function Encoder(payload, blockSize) {
    this.bs = blockSize;
    this.len = payload.length;
    this.K = Math.max(1, Math.ceil(payload.length / blockSize));
    this.blocks = [];
    for (var i = 0; i < this.K; i++) {
      this.blocks.push(words32(payload.subarray(i * blockSize, (i + 1) * blockSize), blockSize));
    }
  }

  // Returns the blockSize bytes for encoding symbol esi.
  Encoder.prototype.symbol = function (esi) {
    var K = this.K;
    var out = new Uint32Array(this.blocks[0].length);
    var c = rowCoefs(esi, K);
    for (var w = 0; w < c.length; w++) {
      var bits = c[w];
      while (bits) {
        var low = bits & -bits;
        xorInto(out, this.blocks[w * 32 + (31 - Math.clz32(low))]);
        bits ^= low;
      }
    }
    return new Uint8Array(out.buffer, 0, this.bs);
  };

  // ---- Decoder ----
  function Decoder(K, blockSize, length) {
    this.K = K;
    this.bs = blockSize;
    this.len = length;
    this.words = (K + 31) >>> 5;
    this.pivots = new Array(K);
    this.rank = 0;
    this.seen = new Set();
  }

  // Adds one received symbol. Returns true if it contributed new information.
  Decoder.prototype.add = function (esi, bytes) {
    if (this.rank === this.K || this.seen.has(esi) || bytes.length !== this.bs) return false;
    this.seen.add(esi);
    var coef = rowCoefs(esi, this.K);
    var data = words32(bytes, this.bs);
    var w = 0;
    for (;;) {
      while (w < this.words && coef[w] === 0) w++;
      if (w === this.words) return false; // linearly dependent: nothing new
      var bit = w * 32 + (31 - Math.clz32(coef[w] & -coef[w]));
      var p = this.pivots[bit];
      if (!p) {
        this.pivots[bit] = { coef: coef, data: data };
        this.rank++;
        return true;
      }
      // Pivot rows have no bits below their pivot, so start XOR at word w.
      for (var i = w; i < this.words; i++) coef[i] ^= p.coef[i];
      xorInto(data, p.data);
    }
  };

  Decoder.prototype.complete = function () {
    return this.rank === this.K;
  };

  // Back-substitution; call once complete(). Returns the payload bytes.
  Decoder.prototype.solve = function () {
    var K = this.K, pivots = this.pivots;
    for (var col = K - 1; col >= 0; col--) {
      var p = pivots[col];
      var w0 = col >>> 5;
      for (var w = w0; w < this.words; w++) {
        var bits = p.coef[w];
        if (w === w0) bits &= ~((2 << (col & 31)) - 1); // only bits above col
        while (bits) {
          var low = bits & -bits;
          xorInto(p.data, pivots[w * 32 + (31 - Math.clz32(low))].data);
          bits ^= low;
        }
      }
    }
    var out = new Uint8Array(this.len);
    for (var i = 0; i < K; i++) {
      var blk = new Uint8Array(pivots[i].data.buffer, 0, this.bs);
      var start = i * this.bs;
      out.set(blk.subarray(0, Math.min(this.bs, this.len - start)), start);
    }
    return out;
  };

  return {
    HEADER_EVERY: HEADER_EVERY,
    Encoder: Encoder,
    Decoder: Decoder,
  };
})();
if (typeof module !== "undefined") module.exports = Fountain;
