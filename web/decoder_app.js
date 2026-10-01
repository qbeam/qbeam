// qbeam receiver (protocol v3). Camera -> decode workers -> fountain decoder -> verified file.
// QBeam3 (js/qbeam3.js) is inlined before this script; the worker source and WASM are inlined as data blocks.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var video = $("video"), statusEl = $("status"), errorEl = $("error"), bar = $("progressBar");
  var STALE_MS = 3000;

  function setStatus(t) { statusEl.textContent = t; }
  function setError(t) { errorEl.textContent = t || ""; errorEl.style.display = t ? "block" : "none"; }
  function kb(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB"; }
  function b64ToBytes(b64) {
    var s = atob(b64.trim()), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
    return s;
  }

  // ---- Decode workers ----
  var NW = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  var workers = [], busy = [], path = window.VideoFrame ? "yplane" : "canvas";
  var workerUrl = URL.createObjectURL(new Blob(
    [$("zxing-src").textContent, "\n", $("worker-src").textContent], { type: "text/javascript" }));
  var wasm = b64ToBytes($("zxing-wasm").textContent).buffer;
  for (var i = 0; i < NW; i++) {
    var w = new Worker(workerUrl);
    w.onmessage = onWorkerMessage.bind(null, i);
    w.postMessage({ type: "init", wasm: wasm.slice(0) });
    workers.push(w); busy.push(false);
  }

  // ---- Session state ----
  var S = null;         // current session
  var notice = "";      // latched message about codes we can't use
  var stats = { frames: 0, decoded: 0, decodeMs: 0, width: 0, height: 0 };

  function newSession(p) {
    return { key: sessionKey(p), L: p.L, T: p.T, flags: p.flags, dec: new QBeam3.Decoder(p.L, p.T),
             started: performance.now(), lastNew: performance.now(), codes: 0, done: false, finishing: false };
  }
  function sessionKey(p) { return p.session + "|" + p.L + "|" + p.T + "|" + (p.flags & 0x0f); }

  function onCode(bytes) {
    var b = new Uint8Array(bytes);
    if (b.length >= 3 && b[0] === 0x51 && (b[1] === 0x31 || b[1] === 0x32)) { // "Q1" / "Q2" text frames
      notice = "This sender page was made by an older qbeam. Regenerate it with the latest version.";
      return;
    }
    var p = QBeam3.parseCode(b);
    if (!p) return;
    if (p.error === "version") { notice = "The sender uses qbeam protocol v" + p.version + "; this receiver understands v3. Update the older side."; return; }
    if (p.error === "flags") { notice = "The sender uses a feature this receiver doesn't support. Update the receiver."; return; }
    if (p.error) return; // crc / length: misread, just drop it

    var now = performance.now();
    if (!S || S.key !== sessionKey(p)) {
      var idle = !S || S.done || S.dec.rank === 0 || now - S.lastNew > STALE_MS;
      if (!idle) return;
      S = newSession(p);
      notice = "";
      setError("");
    }
    if (S.done) return;
    S.codes++;
    if (S.dec.add(p.esi, p.symbol)) {
      S.lastNew = now;
      if (S.dec.complete() && !S.finishing) { S.finishing = true; finish(S); }
    }
  }

  // ---- Finishing: decrypt, parse, decompress, verify, save ----
  function finish(s) {
    var payload = s.dec.payload();
    s.receivedMs = performance.now() - s.started;
    if (s.flags & QBeam3.FLAG_ENCRYPTED) {
      setStatus("Received an encrypted file. Enter the passphrase shown on the sending computer's terminal.");
      $("passWrap").style.display = "block";
      $("passInput").focus();
      $("passBtn").onclick = function () {
        var pass = $("passInput").value;
        setStatus("Decrypting…");
        QBeam3.openEnvelope(payload, pass).then(function (container) {
          $("passWrap").style.display = "none";
          return save(s, container);
        }, function () {
          setStatus("Wrong passphrase (or the transfer was damaged). Try again.");
        });
      };
      return;
    }
    save(s, payload).catch(function (e) { setError("Could not save: " + e.message); });
  }

  function safeName(nameBytes) {
    var name = new TextDecoder().decode(nameBytes);
    name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return !name || name === "." || name === ".." ? "qbeam-file" : name;
  }

  function save(s, container) {
    var c;
    try { c = QBeam3.parseContainer(container); } catch (e) { setError("Unreadable transfer: " + e.message); return Promise.resolve(); }
    var name = safeName(c.filenameUtf8);
    setStatus("Verifying " + name + "…");
    var bytes = c.encoding === "gzip"
      ? new Response(new Blob([c.data]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
      : Promise.resolve(c.data);
    return bytes.then(function (data) {
      return crypto.subtle.digest("SHA-256", data).then(function (digest) {
        if (hex(digest) !== hex(c.sha256)) {
          setError("Checksum mismatch: a code was misread. Starting over; keep the camera on the sender.");
          if (S === s) S = null;
          return;
        }
        s.done = true;
        window.qbeamReceiver.last = { name: name, bytes: new Uint8Array(data), ms: s.receivedMs };
        var url = URL.createObjectURL(new Blob([data]));
        var a = document.createElement("a");
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        bar.style.width = "100%"; bar.textContent = "100%";
        var took = s.receivedMs >= 500 ? " in " + (s.receivedMs / 1000).toFixed(1) + " s, " + kb(s.L / (s.receivedMs / 1000)) + "/s" : "";
        setStatus("Saved " + name + " (" + kb(data.byteLength) + ")" + took + ". Point at another sender to receive the next file.");
      });
    });
  }

  // ---- Camera and frame loop ----
  var track = null, gen = 0;

  function onWorkerMessage(wi, e) {
    var m = e.data;
    if (m.type === "fatal") { setError("Decoder failed to start: " + m.error); return; }
    if (m.type !== "result") return;
    busy[wi] = false;
    if (m.error) {
      if (m.copyFailed && path !== "canvas") path = path === "yplane" ? "videoframe" : "canvas";
      return;
    }
    stats.decoded++; stats.decodeMs += m.copyMs + m.decodeMs; stats.width = m.width; stats.height = m.height;
    m.codes.forEach(onCode);
  }

  function onFrame(myGen) {
    if (myGen !== gen) return; // a newer camera stream replaced this loop
    stats.frames++;
    var wi = busy.indexOf(false);
    if (wi >= 0 && video.videoWidth) {
      busy[wi] = true;
      var tryHarder = true;
      if (path !== "canvas") {
        try {
          var vf = new VideoFrame(video);
          workers[wi].postMessage({ frame: vf, path: path, tryHarder: tryHarder }, [vf]);
        } catch (err) { busy[wi] = false; path = "canvas"; }
      } else {
        createImageBitmap(video).then(function (bm) {
          workers[wi].postMessage({ bitmap: bm, tryHarder: tryHarder }, [bm]);
        }, function () { busy[wi] = false; });
      }
    }
    schedule(myGen);
  }

  var lastTime = -1;
  function schedule(myGen) {
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(function () { onFrame(myGen); });
    else requestAnimationFrame(function () {
      if (video.currentTime !== lastTime) { lastTime = video.currentTime; onFrame(myGen); } else schedule(myGen);
    });
  }

  function startCamera(deviceId) {
    setError("");
    if (!window.isSecureContext) { setError("Camera access needs a secure page: open this file directly (file://) or over https://."); return; }
    if (track) track.stop();
    var base = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } };
    // Ask firmly first: some browsers treat "ideal" as a hint and hand out 640x480 at 30 fps.
    var attempts = [
      { width: { min: 1920 }, height: { min: 1080 }, frameRate: { min: 60 } },
      { width: { min: 1920 }, height: { min: 1080 }, frameRate: { ideal: 60 } },
      { width: { min: 1280 }, height: { min: 720 }, frameRate: { ideal: 60 } },
      { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
    ];
    var tryNext = function (k) {
      if (k >= attempts.length) return Promise.reject(new Error("no camera matched"));
      return navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({}, base, attempts[k]) })
        .catch(function () { return tryNext(k + 1); });
    };
    tryNext(0).then(attach).then(function () {
      $("startBtn").textContent = "Restart camera";
      listCameras();
      if (!S) setStatus("Point the camera at the sender. Fill the view with the codes and hold steady.");
    }).catch(function (e) {
      setError("Camera failed: " + e.message);
    });
  }

  function attach(stream) {
    track = stream.getVideoTracks()[0];
    try { track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function () {}); } catch (e) { /* unsupported */ }
    video.srcObject = stream;
    return video.play().then(function () { gen++; schedule(gen); });
  }

  // Test hook (web/test/e2e.html): decode any MediaStream, such as a sender canvas's captureStream(), and expose
  // the last saved file. Not used in normal operation.
  window.qbeamReceiver = { useStream: attach, last: null };

  function listCameras() {
    navigator.mediaDevices.enumerateDevices().then(function (devs) {
      var sel = $("cameraSel"), current = track && track.getSettings().deviceId;
      var cams = devs.filter(function (d) { return d.kind === "videoinput"; });
      sel.innerHTML = "";
      cams.forEach(function (d, i) {
        var o = document.createElement("option");
        o.value = d.deviceId; o.textContent = d.label || "Camera " + (i + 1);
        if (d.deviceId === current) o.selected = true;
        sel.appendChild(o);
      });
      $("cameraWrap").style.display = cams.length > 1 ? "inline-flex" : "none";
    });
  }

  $("startBtn").addEventListener("click", function () { startCamera(); });
  $("cameraSel").addEventListener("change", function (e) { startCamera(e.target.value); });
  $("resetBtn").addEventListener("click", function () { S = null; notice = ""; setError(""); bar.style.width = "0"; bar.textContent = ""; setStatus("Ready for a new transfer."); });
  $("passInput").addEventListener("keydown", function (e) { if (e.key === "Enter") $("passBtn").click(); });

  // ---- Progress display ----
  var t0 = performance.now();
  setInterval(function () {
    var secs = (performance.now() - t0) / 1000;
    var set = track ? track.getSettings() : {};
    var coarse = stats.width && Math.max(stats.width, stats.height) < 1280;
    $("stats").textContent = track
      ? (stats.width ? stats.width + "×" + stats.height : "camera") + " @ " + Math.round(set.frameRate || 0) + " fps · " +
        (stats.frames / secs).toFixed(0) + " frames/s seen · " + (stats.decoded / secs).toFixed(0) + " decoded · " +
        (stats.decoded ? (stats.decodeMs / stats.decoded).toFixed(0) : "–") + " ms each · " + NW + " workers · " + path
      : "";
    stats.frames = stats.decoded = stats.decodeMs = 0; t0 = performance.now();

    if (notice && (!S || S.dec.rank === 0)) setError(notice);
    else if (coarse) setError("The camera is only " + stats.width + "×" + stats.height + ". Use Chrome or Safari; Firefox on Android is limited to 640×480.");
    if (!S || S.done || S.finishing) return;
    var rank = S.dec.rank, K = S.dec.lay.K, pct = Math.floor(100 * rank / K);
    var el = (performance.now() - S.started) / 1000, rate = S.L * rank / K / Math.max(el, 0.1);
    bar.style.width = pct + "%"; bar.textContent = pct + "%";
    setStatus("Receiving " + kb(S.L) + (S.flags & QBeam3.FLAG_ENCRYPTED ? " (encrypted)" : "") + ": " + pct + "% · " +
      kb(rate) + "/s" + (rate > 0 && rank < K ? " · about " + Math.ceil((S.L - S.L * rank / K) / rate) + " s left" : ""));
  }, 500);

  setStatus("Press Start camera, then point it at the sender.");
})();
