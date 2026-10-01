#!/usr/bin/env node
// qbeam CLI (Node), protocol v3. Mirrors the Python CLI for single files and stdin.
// Folders are Python-only for now: uvx qbeam send <folder>
"use strict";
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");
var crypto = require("crypto");
var childProcess = require("child_process");

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto; // Node 18: WebCrypto isn't global yet

var pkgDir = path.resolve(__dirname, "..");
var repoRoot = path.resolve(pkgDir, "..");
var version = require(path.join(pkgDir, "package.json")).version;
var QBeam3 = require(path.join(pkgDir, "qbeam3.js"));

// Raw bytes the sender offers per second for each preset; must match web/sender_app.js and the Python CLI.
var SPEEDS = { safe: 4 * 1251 * 10, fast: 6 * 1251 * 15, max: 6 * 1710 * 30 };
var TYPICAL_EFFICIENCY = 0.75;
var RECEIVER_URL = "https://qbeam.dev/r";

// In a checkout the repo's own files win, so a stale assets/ copy from an earlier `npm pack` is never used.
function asset(name) {
  var repo = {
    "sender_shell.html": path.join(repoRoot, "web", "sender_shell.html"),
    "sender_app.js": path.join(repoRoot, "web", "sender_app.js"),
    "qrcodegen.js": path.join(repoRoot, "web", "vendor", "qrcodegen.js"),
    "decoder.html": path.join(repoRoot, "web", "dist", "decoder.html"),
  }[name];
  return fs.existsSync(repo) ? repo : path.join(pkgDir, "assets", name);
}

var USAGE = [
  "usage: qbeam send <file|-> [--speed safe|fast|max] [--encrypt] [--name NAME] [--out page.html] [--no-open]",
  "       qbeam receive [--no-open]",
  "       qbeam --version",
  "Folders: use the Python version (uvx qbeam send <folder>).",
].join("\n");

function fail(msg) {
  console.error("qbeam: error: " + msg);
  console.error(USAGE);
  process.exit(2);
}

// JSON that is safe inside <script>: no "</script>" or HTML comment sequences can appear.
function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function htmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function newPassphrase() {
  var alphabet = "23456789abcdefghjkmnpqrstuvwxyz", groups = [];
  for (var g = 0; g < 5; g++) {
    var s = "";
    for (var i = 0; i < 4; i++) s += alphabet[crypto.randomInt(alphabet.length)];
    groups.push(s);
  }
  return groups.join("-");
}

function sha256(b) { return new Uint8Array(crypto.createHash("sha256").update(b).digest()); }

// SPEC v3 §5. gzip only when it helps; the SHA-256 covers what the receiver saves.
function makeContainer(raw, filename) {
  var name = new Uint8Array(Buffer.from(filename, "utf8")), gz = zlib.gzipSync(raw, { level: 9 });
  if (gz.length < 0.98 * raw.length) return { container: QBeam3.encodeContainer(name, "gzip", sha256(raw), gz), how: "gzip" };
  return { container: QBeam3.encodeContainer(name, "raw", sha256(raw), raw), how: "uncompressed" };
}

function openPath(p) {
  var cmd = process.platform === "darwin" ? ["open", [p]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", p]]
    : ["xdg-open", [p]];
  try {
    childProcess.spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).on("error", function () {}).unref();
    return true;
  } catch (e) {
    return false;
  }
}

async function send(opts) {
  var raw, name, label, outPath;
  if (opts.file === "-") {
    raw = fs.readFileSync(0);
    name = opts.name || "stdin.txt";
    label = "stdin";
    outPath = opts.out || path.join(process.cwd(), name + ".sender.html");
  } else {
    var stat;
    try { stat = fs.statSync(opts.file); } catch (e) { fail(opts.file + " is not a file"); }
    if (stat.isDirectory()) fail("folders need the Python version: uvx qbeam send " + opts.file);
    raw = fs.readFileSync(opts.file);
    name = opts.name || path.basename(opts.file);
    label = opts.file;
    outPath = opts.out || opts.file + ".sender.html";
  }

  var passphrase = null;
  if (opts.encrypt) passphrase = process.env.QBEAM_PASSPHRASE || newPassphrase();
  var c = makeContainer(new Uint8Array(raw), name);
  var payload = c.container, flags = 0;
  if (passphrase !== null) { payload = await QBeam3.sealEnvelope(c.container, passphrase); flags = QBeam3.FLAG_ENCRYPTED; }
  var session = crypto.randomBytes(4).readUInt32BE(0);

  var read = function (n) { return fs.readFileSync(asset(n), "utf8"); };
  var qbeam3Src = fs.readFileSync(path.join(pkgDir, "qbeam3.js"), "utf8");
  // replaceAll like Python's str.replace; function replacers because the inlined sources contain "$" sequences.
  var page = read("sender_shell.html")
    .replaceAll("__TITLE__", function () { return htmlEscape(name); })
    .replaceAll("/*__QRCODEGEN__*/", function () { return read("qrcodegen.js"); })
    .replaceAll("/*__QBEAM3__*/", function () { return qbeam3Src; })
    .replaceAll("/*__PAYLOAD__*/", function () {
      return jsonForScript({ session: session, flags: flags, dataB64: Buffer.from(payload).toString("base64") });
    })
    .replaceAll("/*__META__*/", function () { return jsonForScript({ filename: name, size: raw.length, encrypted: passphrase !== null }); })
    .replaceAll("/*__SPEED__*/", function () { return jsonForScript(opts.speed); })
    .replaceAll("/*__APP__*/", function () { return read("sender_app.js"); });
  fs.writeFileSync(outPath, page);

  var seconds = payload.length / (SPEEDS[opts.speed] * TYPICAL_EFFICIENCY);
  console.log("Input:       " + label + " (" + raw.length.toLocaleString("en-US") + " bytes)");
  console.log("Sending:     " + name + " as " + payload.length.toLocaleString("en-US") + " bytes (" + c.how +
              (passphrase !== null ? ", encrypted" : "") + ")");
  console.log("Speed:       " + opts.speed + ", about " + Math.max(1, Math.round(seconds)) + " s with a good camera");
  console.log("Sender page: " + outPath);
  if (passphrase !== null) {
    console.log("");
    console.log("Passphrase:  " + passphrase);
    console.log("             Type it on the phone when asked. Don't show it on the screen the camera sees.");
  }
  console.log("");
  if (opts.noOpen || !openPath(path.resolve(outPath))) {
    console.log("Open " + outPath + " in a browser, then point the phone's qbeam receiver (" + RECEIVER_URL + ") at it.");
  } else {
    console.log("Opened the sender page. On the phone, open " + RECEIVER_URL + " and point it at the codes; press Fullscreen for best results.");
  }
}

function receive(noOpen) {
  var p = asset("decoder.html");
  console.log("Receiver page: " + p);
  console.log("On your phone: open " + RECEIVER_URL + " (keeps working offline after the first visit),");
  console.log("or copy this file to the phone and open it there. It also works with this computer's webcam.");
  if (!noOpen) openPath(p);
}

function main(argv) {
  if (argv[0] === "--version" || argv[0] === "-V") { console.log("qbeam " + version); return; }
  if (argv[0] === "-h" || argv[0] === "--help" || argv.length === 0) { console.log(USAGE); return; }
  var command = argv[0], rest = argv.slice(1);
  if (command === "receive") return receive(rest.indexOf("--no-open") !== -1);
  if (command !== "send") fail("unknown command " + command);

  var opts = { file: null, speed: "fast", encrypt: false, name: null, out: null, noOpen: false };
  for (var i = 0; i < rest.length; i++) {
    var a = rest[i];
    if (a === "--speed") opts.speed = rest[++i];
    else if (a === "--encrypt") opts.encrypt = true;
    else if (a === "--name") opts.name = rest[++i];
    else if (a === "--out") opts.out = rest[++i];
    else if (a === "--no-open") opts.noOpen = true;
    else if (a.slice(0, 2) === "--") fail("unknown option " + a);
    else if (opts.file === null) opts.file = a;
    else fail("unexpected argument " + a);
  }
  if (!opts.file) fail("missing file (or - for stdin)");
  if (!SPEEDS[opts.speed]) fail("--speed must be safe, fast or max");
  send(opts).catch(function (e) { console.error("qbeam: error: " + e.message); process.exit(1); });
}

main(process.argv.slice(2));
