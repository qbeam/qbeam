(function () {
  "use strict";
  // PAYLOAD and META are injected as globals by encode.py; Fountain by fountain.js.

  var qrContainer = document.getElementById("qrContainer");
  var indexLabel = document.getElementById("indexLabel");
  var filenameLabel = document.getElementById("filenameLabel");
  var playPauseBtn = document.getElementById("playPauseBtn");
  var fullscreenBtn = document.getElementById("fullscreenBtn");
  var intervalSlider = document.getElementById("intervalSlider");
  var intervalLabel = document.getElementById("intervalLabel");
  var stageEl = document.getElementById("stage");

  function base64ToBytes(b64) {
    var binStr = atob(b64);
    var bytes = new Uint8Array(binStr.length);
    for (var i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return bytes;
  }

  function bytesToBase64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  var enc = new Fountain.Encoder(base64ToBytes(PAYLOAD.data), PAYLOAD.blockSize);
  var K = enc.K;
  var common = PAYLOAD.id + "|" + K + "|" + enc.len + "|";
  var headerFrame = "Q2H" + common + PAYLOAD.sha + "|" + PAYLOAD.filenameB64 + "|" + PAYLOAD.encoding;

  filenameLabel.textContent = META.filename + "  (" + META.originalSize + " bytes → " + META.compressedSize + " bytes " + META.method + ", " + K + " blocks)";

  var slot = 0;   // every frame shown, header or data
  var dataN = 0;  // data frames shown
  var playing = true;
  var intervalMs = 350;
  var timer = null;
  var current = headerFrame;
  var currentLabel = "header";

  function advance() {
    if (slot % Fountain.HEADER_EVERY === 0) {
      current = headerFrame;
      currentLabel = "header";
    } else {
      var esi = dataN++;
      current = "Q2D" + common + esi + "|" + bytesToBase64(enc.symbol(esi));
      currentLabel = esi < K ? "block " + (esi + 1) + " / " + K : "recovery frame #" + (esi - K + 1);
    }
    slot++;
  }

  function render() {
    var qr = qrcode(0, "M");
    qr.addData(current);
    qr.make();
    qrContainer.innerHTML = qr.createSvgTag(6, 4);
    indexLabel.textContent = currentLabel;
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, intervalMs);
  }

  function tick() {
    if (playing) advance();
    render();
    scheduleNext();
  }

  playPauseBtn.addEventListener("click", function () {
    playing = !playing;
    playPauseBtn.textContent = playing ? "Pause" : "Play";
  });

  intervalSlider.addEventListener("input", function () {
    intervalMs = parseInt(intervalSlider.value, 10);
    intervalLabel.textContent = intervalMs + " ms/frame";
  });

  fullscreenBtn.addEventListener("click", function () {
    if (stageEl.requestFullscreen) stageEl.requestFullscreen();
  });

  intervalLabel.textContent = intervalMs + " ms/frame";
  intervalSlider.value = intervalMs;
  tick();
})();
