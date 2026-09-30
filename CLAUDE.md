# CLAUDE.md

**qbeam** — offline file transfer over animated QR codes: a file is shown as a looping QR stream on one screen and
rebuilt from a camera on another device. For developers in restricted, monitored environments
(VDI, cloud shells, locked-down laptops, sandboxes).

- Strategy doc: https://claude.ai/code/artifact/83b0e616-c086-499b-8b24-ff42837f18c3
- Build plan with checkboxes: [PLAN.md](PLAN.md)
- Repo: https://github.com/qbeam/qbeam (public; commit as the GitHub no-reply address, set in this repo's git config)

## Current status

<!-- Update this block at the end of every work session. -->
- **Phase:** P0 Foundations (in progress)
- **Last done:** qbeam 0.0.1 live on PyPI and npm; releases now automatic on merge to main (2026-10-01)
- **Next up:** P0.4 spec v2, P0.12 benchmark rig, P0.13 speed spike, P0.5/P0.5a protocol v3 + sparse fountain code. P0.2 still needs a code of conduct
- **Blockers / open decisions:** encryption approach (P0.6); sparse fountain code choice (P0.5a)

## Tracking rules

- When a PLAN.md task is finished, tick its box (`- [x]`) and keep its ID (e.g. `P1.4`).
- At the end of a session: update "Current status" above, the phase's Status column in PLAN.md,
  and add one line to PLAN.md's progress log (date · what changed · next step).
- Don't start a phase's paid work before its gate in PLAN.md passes.

## Code today

| File | Role |
| --- | --- |
| `py/src/qbeam/cli.py` | Python CLI (`qbeam send` / `qbeam receive`): file/folder → self-contained `*.sender.html` (stdlib only; gzip or xz; `--archive`, `--exclude`). Assets load from `qbeam/assets/` when packaged, else from `web/` and `js/` |
| `py/encode.py` | Shim: run the CLI from a checkout (`python3 py/encode.py <path>` = `qbeam send <path>`) |
| `py/pyproject.toml`, `py/sync_assets.py` | PyPI packaging; run `sync_assets.py` before `python -m build py` (copies assets + license files, all gitignored) |
| `js/bin/qbeam.js`, `js/package.json` | npm CLI (Node ≥ 18): `send` for single files (gzip) and `receive`; `prepack` runs `js/scripts/sync-assets.js` |
| `web/sender_shell.html`, `web/sender_app.js` | Sender page template; placeholders are replaced by `encode.py` |
| `js/fountain.js` | Systematic random linear fountain code over GF(2); shared by sender and decoder |
| `web/decoder_shell.html`, `web/decoder_app.js` | Camera decoder; SHA-256 check; gunzip in browser |
| `web/vendor/` | Third-party `qrcodegen.js` (MIT) and `jsQR.js` (Apache-2.0); see THIRD_PARTY_NOTICES.md |
| `web/build.py` | Rebuilds `web/dist/decoder.html`; rerun after changing decoder files or `js/fountain.js` |
| `web/dist/decoder.html` | Generated; don't edit by hand |

Empty folders with a README stub for later phases: `protocol/`, `android/`, `ios/`, `go/`, `bench/`, `docs/`.

Frame format (v2): `Q2H` header `id|K|len|sha|filenameB64|encoding`, `Q2D` data `id|K|len|esi|base64block`,
header every 10th frame. Defaults: 300-byte blocks, ECC M, 350 ms/frame.

## Tests and releases

- `python3 -m unittest discover -s py/tests -v` and `node js/test/roundtrip.js` (both from the repo root); CI runs them on every PR.
- Release = bump with `python3 scripts/version.py X.Y.Z` and merge to main. See docs/RELEASING.md. Never publish by hand after the first npm version.
- After editing decoder files or `js/fountain.js`, run `python3 web/build.py` and commit `web/dist/decoder.html` (CI checks it).
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
