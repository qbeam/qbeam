// qbeam protocol v3 reference codec: binary codes, segmented fountain code, file container.
// Normative description: protocol/SPEC.md (v3). Test vectors: protocol/test-vectors/v3.json.
//
// Each QR code is self-contained: an 18-byte header, one fountain symbol of T bytes, and a CRC-32.
// The payload (a container with filename, SHA-256 and the file bytes) is split into K source blocks,
// grouped into S segments of at most KMAX blocks. Every segment is its own systematic dense random
// linear code over GF(2), so a segment decodes from about Ks + 2 of its symbols and decoding cost
// stays linear in file size.
var QBeam3 = (function () {
  "use strict";

  var MAGIC0 = 0xb3, MAGIC1 = 0x71, VERSION = 3;
  var HEADER = 18, TRAILER = 4, OVERHEAD = HEADER + TRAILER;
  var KMAX = 2048;
  var MUST_UNDERSTAND = 0x0f; // flag bits a receiver must reject if it doesn't know them (none defined yet)

  // ---- CRC-32 (IEEE 802.3, as zlib) ----
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, start, end) {
    var c = 0xffffffff;
    for (var i = start || 0, e = end === undefined ? bytes.length : end; i < e; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ---- Deterministic PRNG (same mulberry32 as v2) ----
  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
  }

  // ---- Segment layout ----
  // K blocks split into S = ceil(K / KMAX) segments; the first (K mod S) segments get one extra block.
  function layout(L, T) {
    var K = Math.max(1, Math.ceil(L / T));
    var S = Math.ceil(K / KMAX), base = Math.floor(K / S), extra = K % S;
    var segs = [];
    for (var s = 0, start = 0; s < S; s++) {
      var size = base + (s < extra ? 1 : 0);
      segs.push({ index: s, start: start, size: size });
      start += size;
    }
    return { L: L, T: T, K: K, S: S, segments: segs };
  }

  // Which segment an ESI belongs to, and the coefficient bitset over that segment's blocks.
  function locate(lay, esi) {
    if (esi < lay.K) {
      var base = Math.floor(lay.K / lay.S), extra = lay.K % lay.S, big = extra * (base + 1);
      var s = esi < big ? Math.floor(esi / (base + 1)) : extra + Math.floor((esi - big) / base);
      return { seg: lay.segments[s], local: esi - lay.segments[s].start, repair: -1 };
    }
    var r = esi - lay.K;
    return { seg: lay.segments[r % lay.S], local: -1, repair: Math.floor(r / lay.S) };
  }

  function coefficients(lay, esi) {
    var loc = locate(lay, esi), n = loc.seg.size, words = (n + 31) >>> 5, c = new Uint32Array(words);
    if (loc.repair < 0) {
      c[loc.local >>> 5] = (1 << (loc.local & 31)) >>> 0;
      return { seg: loc.seg, coef: c };
    }
    var rand = mulberry32((Math.imul(loc.repair + 1, 0x9e3779b1) ^ Math.imul(loc.seg.index + 1, 0x85ebca6b) ^ n) >>> 0);
    var any = 0;
    for (var w = 0; w < words; w++) c[w] = rand();
    if (n & 31) c[words - 1] &= ((1 << (n & 31)) >>> 0) - 1;
    for (w = 0; w < words; w++) any |= c[w];
    if (!any) { var b = loc.repair % n; c[b >>> 5] = (1 << (b & 31)) >>> 0; }
    return { seg: loc.seg, coef: c };
  }

  function words32(bytes, T) {
    var buf = new Uint8Array(((T + 3) >>> 2) * 4);
    buf.set(bytes.subarray(0, T));
    return new Uint32Array(buf.buffer);
  }

  function xorInto(dst, src) {
    for (var i = 0; i < dst.length; i++) dst[i] ^= src[i];
  }

  // ---- Encoder ----
  function Encoder(payload, T) {
    this.lay = layout(payload.length, T);
    this.T = T;
    this.blocks = [];
    for (var i = 0; i < this.lay.K; i++) this.blocks.push(words32(payload.subarray(i * T, (i + 1) * T), T));
  }

  // The T-byte fountain symbol for ESI `esi`.
  Encoder.prototype.symbol = function (esi) {
    var cf = coefficients(this.lay, esi), c = cf.coef, out = new Uint32Array(this.blocks[0].length);
    for (var w = 0; w < c.length; w++) {
      var bits = c[w];
      while (bits) {
        var low = bits & -bits;
        xorInto(out, this.blocks[cf.seg.start + w * 32 + (31 - Math.clz32(low))]);
        bits ^= low;
      }
    }
    return new Uint8Array(out.buffer, 0, this.T);
  };

  // ---- Code framing ----
  function encodeCode(session, L, T, esi, symbol, flags) {
    var b = new Uint8Array(OVERHEAD + T), v = new DataView(b.buffer);
    b[0] = MAGIC0; b[1] = MAGIC1; b[2] = VERSION; b[3] = flags || 0;
    v.setUint32(4, session >>> 0); v.setUint32(8, L >>> 0); v.setUint16(12, T); v.setUint32(14, esi >>> 0);
    b.set(symbol.subarray(0, T), HEADER);
    v.setUint32(HEADER + T, crc32(b, 0, HEADER + T));
    return b;
  }

  // Returns {session, L, T, esi, flags, symbol}, or {error} for codes that are ours but unusable, or null if not ours.
  function parseCode(b) {
    if (b.length < 3 || b[0] !== MAGIC0 || b[1] !== MAGIC1) return null;
    if (b[2] !== VERSION) return { error: "version", version: b[2] };
    if (b.length < OVERHEAD + 1) return { error: "short" };
    var v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    var T = v.getUint16(12);
    if (T < 1 || b.length !== OVERHEAD + T) return { error: "length" };
    if (v.getUint32(HEADER + T) !== crc32(b, 0, HEADER + T)) return { error: "crc" };
    if (b[3] & MUST_UNDERSTAND) return { error: "flags", flags: b[3] };
    return { session: v.getUint32(4), L: v.getUint32(8), T: T, esi: v.getUint32(14), flags: b[3],
             symbol: b.subarray(HEADER, HEADER + T) };
  }

  // ---- Decoder ----
  function SegmentDecoder(size, T) {
    this.n = size;
    this.words = (size + 31) >>> 5;
    this.T = T;
    this.pivots = new Array(size);
    this.rank = 0;
    this.data = null; // Uint8Array(size * T) once solved
  }

  SegmentDecoder.prototype.add = function (coef, bytes) {
    if (this.data || this.rank === this.n) return false;
    var data = words32(bytes, this.T), w = 0;
    for (;;) {
      while (w < this.words && coef[w] === 0) w++;
      if (w === this.words) return false;
      var bit = w * 32 + (31 - Math.clz32(coef[w] & -coef[w]));
      var p = this.pivots[bit];
      if (!p) {
        this.pivots[bit] = { coef: coef, data: data };
        if (++this.rank === this.n) this.solve();
        return true;
      }
      for (var i = w; i < this.words; i++) coef[i] ^= p.coef[i];
      xorInto(data, p.data);
    }
  };

  SegmentDecoder.prototype.solve = function () {
    var n = this.n, pivots = this.pivots;
    for (var col = n - 1; col >= 0; col--) {
      var p = pivots[col], w0 = col >>> 5;
      for (var w = w0; w < this.words; w++) {
        var bits = p.coef[w];
        if (w === w0) bits &= ~((2 << (col & 31)) - 1);
        while (bits) {
          var low = bits & -bits;
          xorInto(p.data, pivots[w * 32 + (31 - Math.clz32(low))].data);
          bits ^= low;
        }
      }
    }
    var out = new Uint8Array(n * this.T);
    for (var i = 0; i < n; i++) out.set(new Uint8Array(pivots[i].data.buffer, 0, this.T), i * this.T);
    this.data = out;
    this.pivots = null; // free the working rows
  };

  function Decoder(L, T) {
    this.lay = layout(L, T);
    this.T = T;
    this.seen = new Set();
    this.segs = this.lay.segments.map(function (s) { return new SegmentDecoder(s.size, T); });
    this.rank = 0;
  }

  // Adds one symbol; returns true if it carried new information.
  Decoder.prototype.add = function (esi, bytes) {
    if (bytes.length !== this.T || this.seen.has(esi)) return false;
    this.seen.add(esi);
    var cf = coefficients(this.lay, esi);
    var ok = this.segs[cf.seg.index].add(cf.coef, bytes);
    if (ok) this.rank++;
    return ok;
  };

  Decoder.prototype.complete = function () { return this.rank === this.lay.K; };

  Decoder.prototype.payload = function () {
    var out = new Uint8Array(this.lay.L), T = this.T, lay = this.lay;
    this.segs.forEach(function (sd, s) {
      var start = lay.segments[s].start * T;
      out.set(sd.data.subarray(0, Math.max(0, Math.min(sd.data.length, lay.L - start))), start);
    });
    return out;
  };

  // ---- Container (the fountain payload) ----
  // u8 container version (1) | u8 encoding (0 = save as-is, 1 = gzip: receiver gunzips) |
  // u16 filename length | filename (UTF-8) | 32-byte SHA-256 of the bytes the receiver saves | data
  var ENCODINGS = { raw: 0, gzip: 1 };

  function encodeContainer(filenameUtf8, encoding, sha256, data) {
    if (filenameUtf8.length > 0xffff) throw new Error("filename too long");
    var out = new Uint8Array(4 + filenameUtf8.length + 32 + data.length);
    out[0] = 1; out[1] = ENCODINGS[encoding];
    out[2] = filenameUtf8.length >>> 8; out[3] = filenameUtf8.length & 0xff;
    out.set(filenameUtf8, 4);
    out.set(sha256, 4 + filenameUtf8.length);
    out.set(data, 36 + filenameUtf8.length);
    return out;
  }

  function parseContainer(b) {
    if (b.length < 36 || b[0] !== 1) throw new Error("unknown container version " + b[0]);
    var n = (b[2] << 8) | b[3];
    if (b.length < 36 + n) throw new Error("container too short");
    var enc = b[1] === 1 ? "gzip" : b[1] === 0 ? "raw" : null;
    if (!enc) throw new Error("unknown encoding " + b[1]);
    return { encoding: enc, filenameUtf8: b.subarray(4, 4 + n), sha256: b.subarray(4 + n, 36 + n), data: b.subarray(36 + n) };
  }

  return {
    VERSION: VERSION, HEADER: HEADER, OVERHEAD: OVERHEAD, KMAX: KMAX,
    crc32: crc32, layout: layout, coefficients: coefficients,
    Encoder: Encoder, Decoder: Decoder,
    encodeCode: encodeCode, parseCode: parseCode,
    encodeContainer: encodeContainer, parseContainer: parseContainer,
  };
})();
if (typeof module !== "undefined") module.exports = QBeam3;
