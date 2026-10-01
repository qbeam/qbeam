# CLAUDE.md

**qbeam** — offline file transfer over animated QR codes: a file is shown as a looping QR stream on one screen and
rebuilt from a camera on another device. For developers in restricted, monitored environments
(VDI, cloud shells, locked-down laptops, sandboxes).

- Strategy doc: https://claude.ai/code/artifact/83b0e616-c086-499b-8b24-ff42837f18c3
- Build plan with checkboxes: [PLAN.md](PLAN.md)
- Repo: https://github.com/qbeam/qbeam (public; commit as the GitHub no-reply address, set in this repo's git config)

## Current status

<!-- Update this block at the end of every work session. -->
- **Phase:** P1 (in progress); P0 done except user items
- **Last done:** protocol v3 live in both CLIs, the sender page and a new single-file receiver; browser e2e test passes (2026-10-01)
- **Next up:** terminal mode (P1.3–P1.5: own pure-Python QR encoder checked against qrcodegen.js, half-block renderer, Windows VT), .pyz (P1.9), then ask the user about releasing 0.1.0. P0.2 code of conduct and P0.12 benchmark still open (user)
- **Blockers / open decisions:** paid strategy for the web decoder (deferred by user)

## Tracking rules

- When a PLAN.md task is finished, tick its box (`- [x]`) and keep its ID (e.g. `P1.4`).
- At the end of a session: update "Current status" above, the phase's Status column in PLAN.md,
  and add one line to PLAN.md's progress log (date · what changed · next step).
- Don't start a phase's paid work before its gate in PLAN.md passes.

## Code today

| File | Role |
| --- | --- |
| `py/src/qbeam/cli.py` | Python CLI: `qbeam send` (file, folder as one archive, or `-` stdin; `--speed`, `--encrypt`, `--name`, `--no-open`) writes a self-contained `*.sender.html`; `qbeam receive` opens the receiver. Stdlib only. Repo files win over packaged `assets/` |
| `py/src/qbeam/protocol_v3.py`, `crypto_v3.py` | v3 encoder (framing, segmented fountain, container) and encryption envelope (`cryptography` optional) |
| `py/encode.py` | Shim: `python3 py/encode.py <path> [opts]` = `qbeam send` from a checkout |
| `py/pyproject.toml`, `py/sync_assets.py` | PyPI packaging (extra `crypto`); `sync_assets.py` copies web/js assets into the package at release time |
| `js/qbeam3.js` | Protocol v3 reference codec (also the npm package's `main`) |
| `js/bin/qbeam.js` | npm CLI on v3: single files and stdin, same options as Python except folders |
| `js/fountain.js` | Old v2 codec, kept only as the reference for `protocol/test-vectors/v2.json` |
| `web/sender_shell.html`, `web/sender_app.js` | v3 sender page: grid of codes, presets safe/fast/max, fixed mask |
| `web/decoder_*.{html,js}`, `web/decode_worker.js` | v3 receiver: camera → zxing WASM workers (Y-plane copy) → decode → decrypt → SHA-256 → save |
| `web/vendor/` | `qrcodegen.js` (MIT, patched `setMask`), zxing-wasm reader + WASM (MIT; zxing-cpp Apache-2.0) |
| `web/build.py` → `web/dist/decoder.html` | Builds the single-file receiver (~1.3 MB); generated, CI checks it's current |
| `web/test/e2e.html` | Browser end-to-end test: real sender page → real receiver (see web/README.md) |
| `protocol/SPEC.md`, `protocol/test-vectors/` | Normative spec (v3 current, v2 legacy) and vectors |
| `bench/` | Speed spike (`bench/spike`), fountain benchmark (`bench/protocol`), results (`bench/RESULTS.md`) |

Protocol: senders and the receiver speak **v3** only (binary codes: 18-byte header + symbol + CRC-32; segmented fountain
code, KMAX 2048; container with filename/encoding/SHA-256; optional AES-GCM envelope). Presets: safe 2x2 v25 @10 fps,
fast 3x2 v25 @15, max 3x2 v30 @30 (T = capacity − 22).

## Tests and releases

- `python3 -m unittest discover -s py/tests -v`, `node js/test/roundtrip.js`, `node js/test/v3.js` (repo root); CI runs them on every PR, plus the encryption tests with `cryptography` installed. Browser e2e: `web/test/e2e.html` (manual, needs a visible window).
- Release = bump with `python3 scripts/version.py X.Y.Z` and merge to main. See docs/RELEASING.md. Never publish by hand after the first npm version.
- After editing receiver files, `web/vendor/zxing-*` or `js/qbeam3.js`, run `python3 web/build.py` and commit `web/dist/decoder.html` (CI checks it).
- Python file I/O always passes `encoding="utf-8"` (Windows defaults to cp1252).

## Conventions and constraints

- **Transfer speed must match or beat the fastest competitor** (cimbar, Decimen) measured on our own rig.
  No change may lower benchmark goodput. Full speed = pixel sender; terminal mode is the headless fallback.

- Python package must stay **stdlib-only** at runtime (vendored pure-Python code OK; optional extras OK).
- Installs must work **without admin rights** on macOS, Linux and Windows.
- The CLI makes **no network calls** (no telemetry, no update checks).
- The channel is **one-way**; nothing can depend on receiver feedback.
- Browser JS: ES5-style IIFEs, no build tooling, everything inlined into single offline HTML files.
- All codecs (Python, JS, Kotlin, Swift, Go) must pass the shared test vectors in `protocol/test-vectors/` once they exist.
- Never write copy that frames the tool as bypassing security or monitoring.
