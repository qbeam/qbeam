(function () {
  "use strict";

  var videoEl = document.getElementById("video");
  var canvasEl = document.getElementById("canvas");
  var ctx = canvasEl.getContext("2d", { willReadFrequently: true });
  var statusEl = document.getElementById("status");
  var progressBarEl = document.getElementById("progressBar");
  var progressWrapEl = document.getElementById("progressWrap");
  var resetBtn = document.getElementById("resetBtn");
  var errorEl = document.getElementById("error");

  // { id, K, len, sha, filename, encoding, dec, done, finishing }
  // Data frames are accepted before the header arrives; the header (sent every
  // few frames) only supplies filename + checksum, needed at the end.
  var session = null;
  var warnedOld = false;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function setError(text) {
    if (text) {
      errorEl.textContent = text;
      errorEl.style.display = "block";
    } else {
      errorEl.style.display = "none";
      errorEl.textContent = "";
    }
  }

  function resetSession() {
    session = null;
    progressWrapEl.style.display = "none";
    setError("");
    setStatus("Waiting for sender… point the camera at the animated QR code.");
  }

  resetBtn.addEventListener("click", resetSession);

  function base64ToBytes(b64) {
    var binStr = atob(b64);
    var bytes = new Uint8Array(binStr.length);
    for (var i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return bytes;
  }

  function bufToHex(buf) {
    var bytes = new Uint8Array(buf);
    var hex = "";
    for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  }

  function updateProgress() {
    if (!session) return;
    var received = session.dec ? session.dec.rank : 0;
    var total = session.K;
    var pct = Math.floor((received / total) * 100);
    progressWrapEl.style.display = "block";
    progressBarEl.style.width = pct + "%";
    progressBarEl.textContent = pct + "%";
    var name = session.filename ? "“" + session.filename + "”" : "file";
    var extra = received === total && !session.sha ? " — waiting for header frame…" : "";
    setStatus("Receiving " + name + ": " + received + " / " + total + " blocks" + extra);
  }

  // Adopt a new session unless we're mid-way through a different one.
  function ensureSession(id, K, len) {
    if (session && session.id === id) return true;
    var idle = !session || session.done || !session.dec || session.dec.rank === 0;
    if (!idle) return false;
    session = { id: id, K: K, len: len, sha: null, filename: null, encoding: "gz", dec: null, done: false, finishing: false };
    setError("");
    return true;
  }

  function maybeFinish() {
    var s = session;
    if (s && !s.done && !s.finishing && s.sha && s.dec && s.dec.complete()) {
      s.finishing = true;
      finish(s);
    }
  }

  function handleFrame(text) {
    if (text.length < 3) return;
    var kind = text.slice(0, 3);
    var parts = text.slice(3).split("|");

    if (kind === "Q1H" || kind === "Q1D") {
      if (!warnedOld) {
        warnedOld = true;
        setError("This sender page was made by an older encode.py. Re-run encode.py to regenerate it.");
      }
      return;
    }
    // Header: id|K|len|sha|filename|encoding  Data: id|K|len|esi|block
    if (kind !== "Q2H" && kind !== "Q2D") return;
    if (parts.length !== (kind === "Q2H" ? 6 : 5)) return;

    var id = parts[0];
    var K = parseInt(parts[1], 10);
    var len = parseInt(parts[2], 10);
    if (!(K > 0) || !(len >= 0)) return;
    if (!ensureSession(id, K, len)) return;
    if (session.done) return;

    if (kind === "Q2H") {
      if (!session.sha) {
        try {
          session.filename = new TextDecoder().decode(base64ToBytes(parts[4]));
        } catch (e) {
          return;
        }
        session.sha = parts[3];
        session.encoding = parts[5]; // "gz": gunzip here; "raw": save as-is (e.g. .tar.xz)
        updateProgress();
        maybeFinish();
      }
      return;
    }

    var esi = parseInt(parts[3], 10);
    if (!(esi >= 0)) return;
    var bytes;
    try {
      bytes = base64ToBytes(parts[4]);
    } catch (e) {
      return;
    }
    if (!session.dec) session.dec = new Fountain.Decoder(K, bytes.length, len);
    if (session.dec.add(esi, bytes)) {
      updateProgress();
      maybeFinish();
    }
  }

  async function finish(s) {
    setStatus("Verifying “" + s.filename + "”…");
    var merged = s.dec.solve();

    var digest = await crypto.subtle.digest("SHA-256", merged);
    var hex = bufToHex(digest);

    if (hex !== s.sha) {
      setError(
        "Checksum mismatch after decoding all " + s.K + " blocks — a frame was likely misread. " +
        "Starting over automatically; keep the camera on the sender."
      );
      // Drop the session so the next frames re-arm a clean attempt.
      if (session === s) session = null;
      return;
    }
    s.done = true;

    try {
      var outBlob;
      if (s.encoding === "raw") {
        outBlob = new Blob([merged]);
      } else {
        var stream = new Blob([merged]).stream().pipeThrough(new DecompressionStream("gzip"));
        outBlob = await new Response(stream).blob();
      }

      var url = URL.createObjectURL(outBlob);
      var a = document.createElement("a");
      a.href = url;
      a.download = s.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);

      setStatus("Done — saved “" + s.filename + "” (" + outBlob.size + " bytes). Tap Reset to receive another file.");
      progressBarEl.style.width = "100%";
      progressBarEl.textContent = "100%";
    } catch (e) {
      setError("Decompression failed: " + e.message);
    }
  }

  var lastW = 0, lastH = 0;

  function tick() {
    if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA && videoEl.videoWidth > 0) {
      if (videoEl.videoWidth !== lastW || videoEl.videoHeight !== lastH) {
        lastW = canvasEl.width = videoEl.videoWidth;
        lastH = canvasEl.height = videoEl.videoHeight;
      }
      ctx.drawImage(videoEl, 0, 0, lastW, lastH);
      var imageData = ctx.getImageData(0, 0, lastW, lastH);
      var code = jsQR(imageData.data, lastW, lastH, { inversionAttempts: "dontInvert" });
      if (code && code.data) {
        handleFrame(code.data);
      }
    }
    requestAnimationFrame(tick);
  }

  async function start() {
    if (!window.isSecureContext) {
      setError(
        "This page is not running in a secure context, so the browser will refuse camera access. " +
        "Open it via file:// (local copy) or https:// — not a plain http:// address."
      );
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Camera API not available in this browser.");
      return;
    }
    var stream;
    try {
      // Ask for 720p: the browser default is often 640x480, which is too
      // coarse for dense QR codes and causes lots of missed frames.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (e2) {
        setError("Camera access failed: " + e2.message);
        return;
      }
    }
    videoEl.srcObject = stream;
    await videoEl.play();
    resetSession();
    requestAnimationFrame(tick);
  }

  start();
})();
