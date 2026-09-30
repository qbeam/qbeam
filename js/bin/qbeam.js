#!/usr/bin/env node
// qbeam CLI (Node). Mirrors `qbeam send` / `qbeam receive` from the Python package for single files.
// Folder archives (--archive) are Python-only for now: uvx qbeam send <dir> --archive
"use strict";
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");
var crypto = require("crypto");
var childProcess = require("child_process");

var pkgDir = path.resolve(__dirname, "..");
var repoRoot = path.resolve(pkgDir, "..");
var version = require(path.join(pkgDir, "package.json")).version;

// Packaged assets (npm install) first, repo checkout second.
function asset(name) {
  var packaged = path.join(pkgDir, "assets", name);
  if (fs.existsSync(packaged)) return packaged;
  var repo = {
    "sender_shell.html": path.join(repoRoot, "web", "sender_shell.html"),
    "sender_app.js": path.join(repoRoot, "web", "sender_app.js"),
    "qrcodegen.js": path.join(repoRoot, "web", "vendor", "qrcodegen.js"),
    "decoder.html": path.join(repoRoot, "web", "dist", "decoder.html"),
  };
  return repo[name];
}

var USAGE = [
  "usage: qbeam send <file> [--chunk-size N] [--out page.html]",
  "       qbeam receive [--no-open]",
  "       qbeam --version",
].join("\n");

function fail(msg) {
  console.error("qbeam: error: " + msg);
  console.error(USAGE);
  process.exit(2);
}

// Same shape as Python's json.dumps for flat objects (", " and ": " separators, ASCII-only).
function pyDumps(obj) {
  return "{" + Object.keys(obj).map(function (k) {
    var v = JSON.stringify(obj[k]).replace(/[\u007f-\uffff]/g, function (ch) {
      return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
    });
    return JSON.stringify(k) + ": " + v;
  }).join(", ") + "}";
}

function sessionId() {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var bytes = crypto.randomBytes(6), s = "";
  for (var i = 0; i < 6; i++) s += chars[bytes[i] % chars.length];
  return s;
}

function send(file, chunkSize, out) {
  var stat;
  try { stat = fs.statSync(file); } catch (e) { fail(file + " is not a file"); }
  if (stat.isDirectory()) fail("folders aren't supported by the npm version yet; use: uvx qbeam send " + file + " --archive");

  var raw = fs.readFileSync(file);
  var compressed = zlib.gzipSync(raw, { level: 9 });
  var sha = crypto.createHash("sha256").update(compressed).digest("hex");
  var filename = path.basename(file);
  var total = Math.max(1, Math.ceil(compressed.length / chunkSize));

  var payload = {
    id: sessionId(),
    blockSize: chunkSize,
    sha: sha,
    filenameB64: Buffer.from(filename, "utf8").toString("base64"),
    encoding: "gz",
    data: compressed.toString("base64"),
  };
  var meta = { filename: filename, originalSize: raw.length, compressedSize: compressed.length, method: "gzip" };

  var read = function (name) { return fs.readFileSync(asset(name), "utf8"); };
  var fountain = fs.readFileSync(path.join(pkgDir, "fountain.js"), "utf8");
  // replaceAll like Python str.replace (__TITLE__ appears twice); function replacers because the inlined
  // sources contain "$" sequences a string replacement would interpret.
  var page = read("sender_shell.html")
    .replaceAll("__TITLE__", function () { return filename; })
    .replaceAll("/*__QRCODEGEN__*/", function () { return read("qrcodegen.js"); })
    .replaceAll("/*__FOUNTAIN__*/", function () { return fountain; })
    .replaceAll("/*__PAYLOAD__*/", function () { return pyDumps(payload); })
    .replaceAll("/*__META__*/", function () { return pyDumps(meta); })
    .replaceAll("/*__APP__*/", function () { return read("sender_app.js"); });

  var outPath = out || file + ".sender.html";
  fs.writeFileSync(outPath, page);

  console.log("Input:       " + file + " (" + raw.length + " bytes)");
  console.log("Compressed:  " + compressed.length + " bytes (gzip, " + Math.round(100 * compressed.length / Math.max(1, raw.length)) + "% of original)");
  console.log("Blocks:      " + total + " x " + chunkSize + " bytes (+ recovery frames)");
  console.log("SHA-256:     " + sha);
  console.log("Wrote:       " + outPath);
  console.log("");
  console.log("Open " + outPath + " in a browser on the sending device (double-click it),");
  console.log("then open the decoder on the receiving device and point its camera at the screen");
  console.log("(`qbeam receive` opens it here and prints its path, so you can copy it to a phone).");
}

function openPath(p) {
  var cmd = process.platform === "darwin" ? ["open", [p]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", p]]
    : ["xdg-open", [p]];
  try {
    childProcess.spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref();
  } catch (e) { /* no opener available; the path is printed anyway */ }
}

function receive(noOpen) {
  var p = asset("decoder.html");
  console.log("Decoder page: " + p);
  console.log("Copy it to the receiving device and open it there, or use this machine's webcam.");
  if (!noOpen) openPath(p);
}

function main(argv) {
  if (argv[0] === "--version" || argv[0] === "-V") { console.log("qbeam " + version); return; }
  if (argv[0] === "-h" || argv[0] === "--help" || argv.length === 0) { console.log(USAGE); return; }
  var command = argv[0], rest = argv.slice(1);
  if (command === "receive") return receive(rest.indexOf("--no-open") !== -1);
  if (command !== "send") fail("unknown command " + command);

  var file = null, chunkSize = 300, out = null;
  for (var i = 0; i < rest.length; i++) {
    if (rest[i] === "--chunk-size") chunkSize = parseInt(rest[++i], 10);
    else if (rest[i] === "--out") out = rest[++i];
    else if (rest[i].slice(0, 2) === "--") fail("unknown option " + rest[i]);
    else if (file === null) file = rest[i];
    else fail("unexpected argument " + rest[i]);
  }
  if (!file) fail("missing file");
  if (!(chunkSize > 0)) fail("--chunk-size must be a positive number");
  send(file, chunkSize, out);
}

main(process.argv.slice(2));
