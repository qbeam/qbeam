#!/usr/bin/env python3
"""Assemble the qbeam.dev site into _site/ (published by .github/workflows/pages.yml).

    /            site/index.html (landing page) and icon.svg
    /r/          the receiver (web/dist/decoder.html) as an installable offline web app:
                 manifest, PNG icons drawn here, and a service worker that keeps the page cached

    python3 scripts/build_site.py [--build-id ID]
"""
import argparse
import pathlib
import shutil
import struct
import subprocess
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"

MANIFEST = """{
  "name": "qbeam receiver",
  "short_name": "qbeam",
  "description": "Receive files over animated QR codes. Works offline.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#111111",
  "theme_color": "#111111",
  "icons": [
    {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
    {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
  ]
}
"""

SERVICE_WORKER = """// qbeam receiver service worker: keeps the (self-contained) receiver page available offline.
// Serves from cache first so it opens instantly with no network; refreshes the cache in the background.
const CACHE = "qbeam-r-__BUILD__";
const FILES = ["./", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(CACHE).then((cache) =>
    cache.match(e.request, { ignoreSearch: true }).then((hit) => {
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })));
});
"""

HEAD_EXTRA = """<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="icon-192.png">
<meta name="theme-color" content="#111111">
<meta name="apple-mobile-web-app-capable" content="yes">
"""


def png(size: int, rounded: bool = True) -> bytes:
    """The qbeam icon (three finder squares and a few modules on a dark tile), drawn without any image library.
    rounded=False gives a full-bleed opaque square, as app stores want (they apply their own corner mask)."""
    cell = size / 64
    dark, white = (27, 27, 27), (255, 255, 255)

    def inside(x, y, x0, y0, w, h):
        return x0 <= x < x0 + w and y0 <= y < y0 + h

    def colour(px, py):
        x, y = px / cell, py / cell
        r = 14  # rounded corners: distance from the inner rectangle must stay within the radius
        dx, dy = max(r - x, 0, x - (64 - r)), max(r - y, 0, y - (64 - r))
        if rounded and dx * dx + dy * dy > r * r:
            return None
        for fx, fy in ((10, 10), (38, 10), (10, 38)):
            if inside(x, y, fx, fy, 16, 16) and not inside(x, y, fx + 4, fy + 4, 8, 8):
                return white
            if inside(x, y, fx + 5, fy + 5, 6, 6):
                return white
        for mx, my in ((38, 38), (48, 38), (43, 43), (38, 48), (48, 48)):
            if inside(x, y, mx, my, 6, 6):
                return white
        return dark

    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            c = colour(px + 0.5, py + 0.5)
            row += bytes(c) + b"\xff" if c else b"\x00\x00\x00\x00"
        rows.append(bytes(row))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--build-id", default=None, help="cache name suffix for the service worker (default: git commit)")
    args = ap.parse_args()
    build = args.build_id or subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                                            text=True).stdout.strip() or "dev"

    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(ROOT / "site", OUT)
    r = OUT / "r"
    r.mkdir()
    page = (ROOT / "web" / "dist" / "decoder.html").read_text(encoding="utf-8")
    assert "</head>" in page
    (r / "index.html").write_text(page.replace("</head>", HEAD_EXTRA + "</head>", 1), encoding="utf-8")
    (r / "manifest.webmanifest").write_text(MANIFEST, encoding="utf-8")
    (r / "sw.js").write_text(SERVICE_WORKER.replace("__BUILD__", build), encoding="utf-8")
    for size in (192, 512):
        (r / f"icon-{size}.png").write_bytes(png(size))
    (OUT / "CNAME").write_text("qbeam.dev\n", encoding="utf-8")
    (OUT / ".nojekyll").write_text("", encoding="utf-8")
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"wrote {OUT} ({total:,} bytes, build {build})")


if __name__ == "__main__":
    main()
