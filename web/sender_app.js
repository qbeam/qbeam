// qbeam sender (protocol v3): shows the payload as a grid of QR codes, a new set every frame, forever.
// Globals injected by the page: QBeam3 (js/qbeam3.js), qrcode (web/vendor/qrcodegen.js with setMask),
// PAYLOAD {session, flags, dataB64}, META {filename, size, encrypted}, SPEED (preset name).
(function () {
  "use strict";

  // Byte capacity at ECC level L (ISO 18004) for the versions the presets use.
  var CAP_L = { 20: 858, 25: 1273, 30: 1732, 35: 2303, 40: 2953 };
  var PRESETS = {
    safe: { cols: 2, rows: 2, ver: 25, fps: 10, label: "safe: 2×2 codes, 10 fps" },
    fast: { cols: 3, rows: 2, ver: 25, fps: 15, label: "fast: 3×2 codes, 15 fps" },
    max: { cols: 3, rows: 2, ver: 30, fps: 30, label: "max: 3×2 large codes, 30 fps (needs a 60 fps camera)" },
  };
  var MASK = 2;

  var $ = function (id) { return document.getElementById(id); };
  var stage = $("stage"), screen = $("screen"), ctx = screen.getContext("2d"), hud = $("hud");
  var back = document.createElement("canvas"), bctx = back.getContext("2d");
  var tiles = [];

  function b64ToBytes(b64) {
    var s = atob(b64), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  var payload = b64ToBytes(PAYLOAD.dataB64);

  // A session is (session id, T): changing the QR version changes T, so it starts a new session.
  var cfg, enc, T, session, esi, running = false, lastSwitch = 0, shown = 0, t0 = 0, buildMs = 0;

  function configure(name) {
    var p = PRESETS[name] || PRESETS.fast;
    var newT = CAP_L[p.ver] - QBeam3.OVERHEAD;
    if (!enc || newT !== T) {
      T = newT;
      enc = new QBeam3.Encoder(payload, T);
      session = cfg ? (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) : PAYLOAD.session;
      esi = 0;
    }
    cfg = { name: name, cols: p.cols, rows: p.rows, ver: p.ver, fps: p.fps, count: p.cols * p.rows };
    $("fps").value = cfg.fps;
    shown = 0; buildMs = 0; t0 = performance.now();
    layout();
  }

  function layout() {
    var dpr = window.devicePixelRatio || 1, r = stage.getBoundingClientRect();
    screen.width = back.width = Math.max(1, Math.floor(r.width * dpr));
    screen.height = back.height = Math.max(1, Math.floor(r.height * dpr));
    if (running) buildNext();
  }

  function latin1(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 4096) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    return s;
  }

  function buildNext() {
    var t = performance.now(), W = back.width, H = back.height;
    bctx.fillStyle = "#fff";
    bctx.fillRect(0, 0, W, H);
    bctx.imageSmoothingEnabled = false;
    var n = 17 + 4 * cfg.ver, cell = n + 8;
    var px = Math.floor(Math.min(W / (cfg.cols * cell), H / (cfg.rows * cell)));
    cfg.px = px;
    if (px < 1) return;
    var x0 = Math.floor((W - cfg.cols * cell * px) / 2), y0 = Math.floor((H - cfg.rows * cell * px) / 2);
    for (var i = 0; i < cfg.count; i++) {
      var code = QBeam3.encodeCode(session, payload.length, T, esi, enc.symbol(esi), PAYLOAD.flags);
      esi++;
      var qr = qrcode(cfg.ver, "L");
      qr.setMask(MASK);
      qr.addData(latin1(code), "Byte");
      qr.make();
      var tile = tiles[i];
      if (!tile || tile.width !== n) {
        tile = tiles[i] = document.createElement("canvas");
        tile.width = tile.height = n;
        tile.img = tile.getContext("2d").createImageData(n, n);
      }
      var d = tile.img.data;
      for (var rr = 0; rr < n; rr++) for (var c = 0; c < n; c++) {
        var v = qr.isDark(rr, c) ? 0 : 255, o = 4 * (rr * n + c);
        d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
      }
      tile.getContext("2d").putImageData(tile.img, 0, 0);
      bctx.drawImage(tile, x0 + (i % cfg.cols) * cell * px + 4 * px, y0 + Math.floor(i / cfg.cols) * cell * px + 4 * px, n * px, n * px);
    }
    buildMs += performance.now() - t;
  }

  function tick(now) {
    if (!running) return;
    if (now - lastSwitch >= 1000 / cfg.fps - 4) { // switch on the vsync nearest the target time
      ctx.drawImage(back, 0, 0);
      lastSwitch = now; shown++;
      buildNext();
      if (shown % Math.max(1, cfg.fps) === 0) {
        var secs = (now - t0) / 1000, perFrame = cfg.count * T;
        hud.textContent = cfg.label + " · " + (shown / secs).toFixed(0) + " fps · up to " + Math.round(perFrame * shown / secs / 1024) +
          " KB/s · " + (cfg.px < 2 ? "window too small: codes are " + cfg.px + " px/module" : cfg.px + " px/module") +
          " · " + (buildMs / shown).toFixed(0) + " ms/frame";
      }
    }
    requestAnimationFrame(tick);
  }

  function start() {
    running = true;
    lastSwitch = performance.now() - 1000;
    buildNext();
    requestAnimationFrame(tick);
  }

  // ---- Controls ----
  var sel = $("speed");
  Object.keys(PRESETS).forEach(function (k) {
    var o = document.createElement("option");
    o.value = k; o.textContent = PRESETS[k].label;
    sel.appendChild(o);
  });
  sel.value = PRESETS[SPEED] ? SPEED : "fast";
  sel.addEventListener("change", function () { configure(sel.value); cfg.label = PRESETS[sel.value].label; });
  $("fps").addEventListener("input", function () {
    var f = Math.max(1, Math.min(60, +$("fps").value || cfg.fps));
    cfg.fps = f; shown = 0; buildMs = 0; t0 = performance.now();
  });
  $("fullBtn").addEventListener("click", function () {
    if (stage.requestFullscreen) stage.requestFullscreen().then(function () { setTimeout(layout, 200); });
  });
  document.addEventListener("fullscreenchange", function () { setTimeout(layout, 200); });
  window.addEventListener("resize", function () { layout(); });

  $("title").textContent = META.filename + " · " + (META.size >= 1048576 ? (META.size / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(META.size / 1024)) + " KB") +
    (META.encrypted ? " · encrypted" : "");
  configure(sel.value);
  cfg.label = PRESETS[sel.value].label;
  start();
})();
