#!/usr/bin/env node
// Copies the sender/decoder assets and license files into this package before `npm pack` / `npm publish`.
"use strict";
var fs = require("fs");
var path = require("path");

var js = path.resolve(__dirname, "..");
var root = path.resolve(js, "..");
var assets = path.join(js, "assets");
fs.mkdirSync(assets, { recursive: true });

var copies = [
  [path.join(root, "web", "sender_shell.html"), path.join(assets, "sender_shell.html")],
  [path.join(root, "web", "sender_app.js"), path.join(assets, "sender_app.js")],
  [path.join(root, "web", "vendor", "qrcodegen.js"), path.join(assets, "qrcodegen.js")],
  [path.join(root, "web", "dist", "decoder.html"), path.join(assets, "decoder.html")],
  [path.join(root, "LICENSE"), path.join(js, "LICENSE")],
  [path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(js, "THIRD_PARTY_NOTICES.md")],
];
copies.forEach(function (c) {
  fs.copyFileSync(c[0], c[1]);
  console.log("copied " + path.relative(root, c[0]) + " -> " + path.relative(root, c[1]));
});
