# Build plan: development, testing and marketing

Strategy (why and for whom): https://claude.ai/code/artifact/83b0e616-c086-499b-8b24-ff42837f18c3

This is the working plan. Tick boxes as work lands and add a line to the progress log at the bottom.
`CLAUDE.md` holds the one-paragraph "where are we" summary; this file holds the detail.

Product and command name: **qbeam** (chosen 2026-09-30; free on PyPI, npm, `.dev`, GitHub, Homebrew at the time).

## Status at a glance

| Phase | Target window | Status | Exit gate |
| --- | --- | --- | --- |
| P0 Foundations | Oct 1–7, 2026 | In progress | Repo, spec draft, CI green on 3 OSes |
| P1 Python CLI + terminal mode | Oct 8–31 | Not started | **Gate 1:** installs and sends on macOS/Linux/Windows with no admin rights |
| P2 Speed parity, web decoder v2, npm, public launch | Nov 1–30 | Not started | **Gate 2:** ≥ 100 KB/s goodput on reference rig (web sender + best decoder); 1k installs |
| P3 Android app (trial + unlock) | Dec 1 – Jan 15, 2027 | Not started | **Gate 3:** app ≥ fastest competitor on the same rig (target ≥ 130 KB/s); 100 paid unlocks |
| P4 iOS app, $19 bundle, Pro web receiver | Q1 2027 | Not started | iOS live; bundle key works on all platforms |
| P5 Standalone binaries + more channels | Q1–Q2 2027 | Not started | Signed binaries in Scoop/brew/winget |

Rules: don't start paid work (P3 billing) until Gate 2 passes. Each phase ends with its testing checklist green.

---

## Guiding constraints (apply to every phase)

- **Speed parity with the fastest competitor, no compromise.** Reported numbers: cimbar up to ~100 KB/s
  (850 kbit/s), Decimen ~129 KB/s. We re-measure them on our own rig (P0.12) and must match or beat
  the best on that rig. "Full speed" means the pixel sender (browser page or native window); terminal
  character cells physically cap lower (~10–20 KB/s) and are the headless fallback, not the benchmark.
- **No admin rights, ever.** Every install path works as a normal user on macOS, Linux and Windows.
- **Core Python package stays stdlib-only.** Vendored pure-Python code is fine; runtime dependencies are not (optional extras allowed).
- **The CLI makes zero network calls.** No telemetry, no update checks. Users are on monitored machines.
- **One protocol, many codecs.** Python, JS, Kotlin, Swift (and later Go) all pass the same test vectors.
- **One-way channel.** The sender never hears from the receiver; anything "adaptive" must be a preset or a receiver-side hint.
- **Wording.** "Offline file transfer". Never "bypass", "evade", "undetectable".

---

## P0 — Foundations (week 1)

Development
- [x] P0.1 Pick the name → **qbeam**. Criteria: 3–6 letters, free on PyPI, npm, Play, App Store, GitHub org and a `.dev` domain
- [ ] P0.2 `git init`, public GitHub repo, Apache-2.0 (or MIT) license, CODE_OF_CONDUCT, SECURITY.md, acceptable-use line in README — done: git init, Apache-2.0, SECURITY.md, README + acceptable use, THIRD_PARTY_NOTICES.md; public repo github.com/qbeam/qbeam; remaining: CODE_OF_CONDUCT
- [x] P0.3 Monorepo layout (move existing code in, keep it working):
  ```
  protocol/   SPEC.md + test-vectors/ (inputs, params, expected frames)
  py/         Python package (src layout, pyproject.toml), CLI, .pyz build
  js/         shared JS codec (fountain.js, frames), npm CLI
  web/        sender + decoder pages and their build script (replaces qrtool/build_decoder.py)
  android/    Kotlin app (P3)
  ios/        Swift app (P4)
  go/         standalone binary (P5)
  bench/      benchmark harness + results
  docs/       user docs / site
  ```
- [ ] P0.4 Write `protocol/SPEC.md` v2 describing today's `Q2H`/`Q2D` text frames exactly (the baseline)
- [ ] P0.5 Draft protocol v3 (binary frames): magic + version byte, session id, K, length, block size, ESI, flags; header frame with SHA-256, filename, encoding (gz / raw / tar.gz / tar.xz), optional encryption params. Frame-level CRC32. Designed for speed from day one: binary payloads up to QR v40-L (2,953 B), multiple codes per displayed frame, and a sparse fountain code (below).
- [ ] P0.5a Choose the sparse fountain code: RaptorQ (RFC 6330) vs. Wirehair vs. a tuned LT code. The current dense GF(2) code decodes in O(K²) and is too slow for multi-MB files at high block rates. Check licences of existing implementations (Wirehair BSD; libcimbar — confirm) and whether a WASM build is practical.
- [ ] P0.6 Decide encryption approach (Python stdlib has no AES): (a) optional extra `pip install qbeam[crypto]` using `cryptography`, or (b) vendored pure-Python AES-GCM (slow but fine for small files). Record decision in SPEC.md.
- [ ] P0.12 **Build the benchmark rig first and measure competitors on it:** fixed monitor, 3 Android phones (low/mid/high) + 1 iPhone on a stand; measure cimbar (CameraFileCopy) and Decimen goodput for 1 MB and 10 MB files. Their numbers on our rig become the parity target.
- [ ] P0.13 **Speed spike (1–2 days):** prototype in the browser: 2×2 grid of v30–v40 codes at 15–30 fps, decoded by zxing-cpp WASM and Android's native scanner; record the best goodput. Confirms parity is reachable with plain QR before P1 commits, or triggers the colour-mode fallback (P2.4a) early.
- [x] P0.7 CI skeleton (GitHub Actions): ubuntu, macos, windows; Python 3.8 → 3.13; Node 18/20/22 — `.github/workflows/ci.yml` (Python 3.8/3.12/3.13, Node 22) + `release.yml` (publish on merge when the version is new, trusted publishing)

Testing
- [x] P0.8 Port existing behaviour into tests first (py/tests/test_cli.py, js/test/roundtrip.js): fountain round-trip (JS via node), encode.py → decoder round-trip on text frames
- [ ] P0.9 Generate the first test vectors from today's encoder; both codecs must reproduce them byte for byte

Marketing
- [ ] P0.10 (done: qbeam.dev domain, GitHub org, npm and PyPI qbeam 0.0.1; remaining: social handles, store/trademark checks) Register qbeam.dev, `qbeam` on PyPI and npm (publish a real 0.0.1 of the current encoder rather than an empty placeholder, which PyPI discourages), GitHub org `qbeam`, X / Bluesky / YouTube handles. Not yet checked: Play Store, App Store, trademarks (USPTO/EUIPO), qbeam.com
- [ ] P0.11 One-page landing site: tagline, 10-second GIF placeholder, "star on GitHub"

---

## P1 — Python CLI + terminal mode (Oct 8–31)

Development
- [ ] P1.1 Package `encode.py` as `qbeam` with entry point; commands: `send`, `receive`, `version` — started early for the 0.0.1 name claim: `qbeam send` / `receive` / `--version` exist in py/ and js/; still needs the P1 features below
- [ ] P1.2 `send <file>` / `send -` (stdin) / `send <dir> --archive` (respect `.gitignore` + existing junk patterns) / `--exclude`
- [ ] P1.3 Vendor a pure-Python QR encoder (e.g. Nayuki `qrcodegen`, MIT) for terminal mode
- [ ] P1.4 Terminal renderer: Unicode half-blocks (2 modules per char), ANSI cursor-home redraw, auto-fit QR version to terminal size, `--invert` for light themes, clean exit on Ctrl-C (restore cursor/screen)
- [ ] P1.5 Windows console: enable VT processing via ctypes; UTF-8 output; fall back gracefully on legacy conhost
- [ ] P1.4a Terminal graphics protocols for pixel output where supported (kitty, iTerm2 inline images, sixel incl. Windows Terminal); detect and prefer them over half-blocks
- [ ] P1.6 Pixel sender: `send` opens the full-speed sender page (self-contained HTML → temp file → `webbrowser`) by default when a display is available; `--tty` forces terminal mode; headless sessions fall back to terminal automatically. All heavy encoding (fountain + QR) runs in JS/WASM in the page, not in Python.
- [ ] P1.7 `receive`: opens the offline decoder page (webcam) for laptop-to-laptop / phone-to-laptop
- [ ] P1.8 Print SHA-256 and a short summary (size, compressed size, frames, estimated time) before sending
- [ ] P1.9 Build a single-file `qbeam.pyz` (stdlib `zipapp`) in CI; attach to GitHub releases with checksums
- [ ] P1.10 Publish to TestPyPI, then PyPI; verify `uvx qbeam`, `pipx install qbeam`, `pip install --user qbeam`
- [ ] P1.11 Decoder: in-browser `.tar.gz` handling decision (save as-is vs. prefer gzip'd tar for single-file receivers)

Testing
- [ ] P1.12 Unit: CLI arg parsing, archive excludes, stdin, compression choices, filename encoding (unicode, long names)
- [ ] P1.13 Security: sanitize received filenames (no path separators, no `..`, no absolute paths); cap decompressed size (zip-bomb guard)
- [ ] P1.14 Terminal snapshot tests: rendered frame text for fixed inputs across widths
- [ ] P1.15 Decode-what-we-render test: render terminal frames to images (dev-only deps: Pillow, `zxing-cpp`) and decode them back
- [ ] P1.16 **Install matrix in CI, as non-admin user:** `uvx`, `pipx`, `pip --user`, `.pyz` × macOS / Ubuntu / Windows × Python 3.8–3.13
- [ ] P1.17 Manual terminal matrix: Windows Terminal, conhost, PowerShell, iTerm2, Terminal.app, GNOME Terminal, VS Code terminal, tmux over SSH. Record results in `bench/terminals.md`
- [ ] P1.18 Manual locked-down check: a Windows VM with AppLocker default rules + a standard (non-admin) user; confirm `py -m pip install --user` and `.pyz` paths work
- [ ] P1.19 Real transfer test: phone (web decoder) reads the terminal QR; 10 files of 1 KB–500 KB, all checksums match

Marketing
- [ ] P1.20 README first screen: GIF (terminal → phone), the three install commands, acceptable-use line
- [ ] P1.21 Soft launch: 20–30 developers who work in VDI / cloud shells; collect install friction per OS in GitHub Discussions
- [ ] P1.22 Record the hero clip: "stack trace out of a cloud shell in 20 seconds"

**Gate 1:** P1.16 green on all three OSes, P1.18 passes, P1.19 10/10.

---

## P2 — Speed parity, web decoder v2, npm, public launch (Nov)

Speed budget (on paper, to be proven on the rig): 4 codes × 2,953 B × 15 fps ≈ 175 KB/s raw → ≥ 130 KB/s goodput after headers and fountain overhead. Every task below serves that number.

Development
- [ ] P2.1 Implement protocol v3 binary frames in Python + JS encoders (QR byte mode, no base64)
- [ ] P2.1a Implement the sparse fountain code chosen in P0.5a in JS/WASM (sender) and for all decoders; keep the dense code only for tiny files if it helps
- [ ] P2.2 Large blocks up to QR v40-L (2,953 B), ECC level L; block size matched to the QR version per preset
- [ ] P2.3 Speed presets `--speed safe|fast|max` (frame rate 10–30 fps, code size, grid) — no feedback channel, so presets + receiver hint; `max` is the default on a pixel display
- [ ] P2.3a Sender render loop: pre-generate frames ahead in a Worker, draw to canvas with `requestAnimationFrame`, frame changes locked to display refresh (no tearing/half-drawn frames)
- [ ] P2.4 Multi-code frames: 2×2 (and 3×2 on large screens) grid of codes per frame; terminal stays single-code
- [ ] P2.4a Fallback if plain QR can't reach parity on the rig: high-density colour mode (cimbar-style or libcimbar-compatible, licence permitting)
- [ ] P2.5 Web decoder v2: zxing-cpp WASM in a Web Worker (multi-code, binary), native `BarcodeDetector` where faster; request the camera's highest resolution/frame rate; replace jsQR
- [ ] P2.6 Receiver hint: decoder shows "missing X% of frames — try `--speed safe`" when its drop rate is high
- [ ] P2.7 Keep v2 text frames decodable (backward compatibility) for one release
- [ ] P2.8 npm package: `npx qbeam send|receive` using the shared JS codec + a terminal renderer in Node
- [ ] P2.9 Hosted web decoder as an installable offline PWA; also downloadable single HTML
- [ ] P2.10 Optional encryption per P0.6 decision (`--passphrase`), decoder prompts for it

Testing
- [ ] P2.11 Cross-codec tests: Python-encode → JS-decode and JS-encode → Python-decode on all test vectors
- [ ] P2.12 Loss tests: randomly drop 0–50% of frames and reorder; must decode with ≈ K+ε frames
- [ ] P2.13 Optical simulation: rendered frames + blur, perspective, noise, moiré, gamma, motion; decode rate per preset
- [ ] P2.14 Fuzz the frame parser and header parser (Python: atheris or hypothesis; JS: fast-check)
- [ ] P2.15 **Benchmark on the P0.12 rig:** `bench/run` sends 100 KB, 1 MB and 10 MB per preset; ours and competitors' goodput side by side in `bench/RESULTS.md`
- [ ] P2.15a Speed regression check in CI: simulated-optics goodput per preset must not drop between commits (fails the build)
- [ ] P2.16 npm install matrix (`npx`, `npm i -g` with user prefix) on 3 OSes, Node 18/20/22

Marketing
- [ ] P2.17 Show HN + r/commandline, r/programming, r/selfhosted, r/homelab, Lobsters (same day)
- [ ] P2.18 Deep-dive post: fountain codes, binary frames, terminal rendering, with benchmark numbers
- [ ] P2.19 Submit to awesome-cli-apps, awesome-python, terminal-trove, console.dev, Python Weekly, JavaScript Weekly, Changelog
- [ ] P2.20 Public benchmarks page (honest comparison with cimbar and Decimen)
- [ ] P2.21 Start weekly short clips; SEO how-to pages ("copy file from VDI without clipboard", etc.)
- [ ] P2.22 GitHub Sponsors live; CLI prints one sponsor line after success (suppressible with `--quiet`)

**Gate 2:** ≥ 100 KB/s median goodput on the mid-range phone (web sender, best available decoder) at `--speed max`, 10 MB file; 1k installs (PyPI + npm). Don't do the public launch (P2.17) until this passes.

---

## P3 — Android app with trial + one-time unlock (Dec – mid Jan)

Development
- [ ] P3.1 Kotlin + CameraX; native decoding via zxing-cpp (multi-code) with ML Kit as an option; high-res capture, continuous autofocus
- [ ] P3.2 Kotlin codec port (fountain + v3 frames); passes all shared test vectors
- [ ] P3.3 Save via Storage Access Framework to a user-chosen folder; share sheet; transfer history
- [ ] P3.4 Archive extraction in-app (tar, gz, xz) with zip-slip protection and size caps
- [ ] P3.5 Phone → laptop: app displays the QR stream from a picked file; laptop runs `qbeam receive`
- [ ] P3.6 Passphrase decryption (per P0.6)
- [ ] P3.7 **Trial:** count only completed, checksum-verified transfers; counter visible from #5; transfer in progress at the limit always finishes; unlock screen links to the free web decoder
- [ ] P3.8 Google Play Billing one-time product ($6.99) + restore purchases; offline-tolerant entitlement cache
- [ ] P3.9 Accept `$19` bundle license keys (Ed25519-signed, verified offline) — can slip to P4
- [ ] P3.10 Store listing: "offline file transfer" wording, screenshots, the hero clip, privacy policy (no data collected)

Testing
- [ ] P3.11 Unit: codec vectors, trial counter state machine (limit, in-progress transfer, reinstall, purchase restore)
- [ ] P3.12 Instrumented: feed recorded screen videos through the camera pipeline; assert decode + checksum
- [ ] P3.13 Device matrix: Firebase Test Lab or 5+ physical devices across Android 9–15, low / mid / high end
- [ ] P3.14 Billing: license testers, purchase / refund / restore / offline-after-purchase cases
- [ ] P3.15 Security: malicious filenames, zip-slip archives, oversized headers, decompression bombs
- [ ] P3.16 Benchmark rig re-run: app vs. cimbar's app and Decimen on the same phones; must match or beat the fastest
- [ ] P3.17 **Play closed test:** new personal developer accounts must run a closed test with ≥ 12 opted-in testers for 14 days before production. Recruit testers from the soft-launch group in P2; start the clock early.

Marketing
- [ ] P3.18 Side-by-side speed video (app vs. web decoder); launch post + Show HN follow-up
- [ ] P3.19 In-app "Sent with `qbeam` — `uvx qbeam`" line on the success screen
- [ ] P3.20 Ask happy users for Play reviews after their 3rd successful transfer (in-app review API)

**Gate 3:** app goodput ≥ the fastest competitor on the same rig (target ≥ 130 KB/s); 100 paid unlocks; rating ≥ 4.3. The paid unlock doesn't ship until the speed part passes.

---

## P4 — iOS, $19 bundle, Pro web receiver (Q1 2027)

Development
- [ ] P4.1 Swift + AVFoundation; Vision `VNDetectBarcodesRequest` (multi-code); Swift codec port on shared vectors
- [ ] P4.2 Same trial model with StoreKit 2 one-time purchase; Files app save; archive extraction
- [ ] P4.3 $19 bundle: sell via Lemon Squeezy / Paddle; issue Ed25519-signed keys; all apps verify offline
- [ ] P4.4 Pro web receiver: fast WASM decoder PWA unlocked by bundle key (reaches iPhone users before the iOS app)

Testing
- [ ] P4.5 Codec vectors, StoreKit sandbox purchases, TestFlight beta (≥ 25 testers), device matrix iPhone SE → Pro
- [ ] P4.6 License-key tests: valid, tampered, revoked list (shipped with app updates), offline verification

Marketing
- [ ] P4.7 iOS launch post + clip; Product Hunt launch for the bundle
- [ ] P4.8 Cross-promote: CLI README + web decoder link to the apps

---

## P5 — Standalone binaries + more channels (Q1–Q2 2027)

Development
- [ ] P5.1 Go port of the sender (+ terminal renderer, `receive` opener); static binaries for macOS (arm64/x64), Linux (x64/arm64, musl), Windows (x64/arm64)
- [ ] P5.2 Sign + notarize macOS (Apple Developer ID); sign Windows (Azure Trusted Signing or cert)
- [ ] P5.3 User-space install scripts (`~/.local/bin`, `%LOCALAPPDATA%`) plus plain download + checksum
- [ ] P5.4 Scoop bucket, Homebrew tap, winget portable manifest
- [ ] P5.5 SBOM + reproducible builds; release checksums signed
- [ ] P5.6 VS Code extension ("Send file / selection as QR"); JetBrains plugin later

Testing
- [ ] P5.7 Go codec on shared vectors; binary install matrix as non-admin on 3 OSes
- [ ] P5.8 AV scan every release artifact (VirusTotal) before publishing; check SmartScreen/Gatekeeper behaviour on clean VMs

Marketing
- [ ] P5.9 "Now a single binary" post; listings in package-manager directories

---

## Cross-cutting testing strategy

| Layer | What | Where it runs |
| --- | --- | --- |
| Protocol | Shared test vectors; every codec encodes and decodes them identically | CI, every PR |
| Codec | Round-trip, frame loss/reorder, property tests, fuzzing of parsers | CI, every PR |
| Rendering | Terminal snapshots; render → image → decode | CI, every PR |
| Optical | Simulated camera distortions; decode rate per preset | CI nightly |
| Speed | Simulated goodput per preset must not regress; real-rig goodput vs. competitors | CI every PR (simulated); manually every release (rig) |
| Install | Non-admin install matrix per channel × OS × runtime version | CI, every release |
| Real world | Benchmark rig (monitor + phones), terminal matrix, locked-down Windows VM | Manually, every release |
| Security | Filename sanitization, archive extraction, size caps, fuzzing | CI + review before each release |
| Store | Play closed test / TestFlight; billing sandbox | Before each app release |

Release checklist (every release): CI green · benchmark results updated · changelog · signed artifacts + checksums · test vectors unchanged or versioned · README install commands verified on a clean machine.

---

## Marketing track summary

| Phase | Main moment | Assets |
| --- | --- | --- |
| P0 | Names and handles secured | Landing page stub |
| P1 | Soft launch to 20–30 devs | README GIF, hero clip |
| P2 | Show HN + deep-dive post | Benchmarks page, how-to pages, weekly clips |
| P3 | Android launch | Speed comparison video, store listing |
| P4 | iOS + bundle (Product Hunt) | Bundle page |
| P5 | Single-binary release | Package-manager listings |

Metrics to review monthly: PyPI/npm downloads, GitHub stars, install success reports by OS, median KB/s, trial → paid conversion, rating.

---

## Progress log

Newest first. One line per session: date · what changed · next step.

- 2026-10-01 · First automatic release: CI green on 18 jobs (3 OSes × Python 3.8/3.12/3.13 + install checks), PyPI qbeam 0.0.1 published via trusted publishing, GitHub release v0.0.1 · Next: P0.4 spec v2, P0.12 benchmark rig, P0.13 speed spike

- 2026-10-01 · qbeam@0.0.1 published to npm by hand (verified with npx); fixed npm publish paths (./) in release.yml and RELEASING.md · Next: user adds npm trusted publisher + PyPI pending publisher, then push to main publishes PyPI 0.0.1

- 2026-09-30 · P0.7 + P0.8 done: CI on 3 OSes, package + no-admin install jobs (uvx/npx), release-on-merge with trusted publishing (docs/RELEASING.md), scripts/version.py keeps versions in sync; tests: 6 Python CLI tests, 6 cross-CLI fountain round-trips. Fixed Windows cp1252 crashes (UTF-8 file I/O, safe console output) · Next: registry setup (user), push

- 2026-09-30 · Commits rewritten to GitHub no-reply author; public repo github.com/qbeam/qbeam created and pushed, topics set. PyPI/npm 0.0.1 artifacts built in py/dist and js/qbeam-0.0.1.tgz · Next: user runs twine upload + npm publish

- 2026-09-30 · qbeam 0.0.1 built for PyPI (py/src/qbeam, stdlib only, assets packaged) and npm (js/bin/qbeam.js, single-file send + receive, exports fountain codec). Tested: clean venv install, output matches pre-package encoder, uvx on Python 3.8 and 3.13, npm install from tarball, fountain round-trip with 30–50% frame loss for Node- and Python-made pages. Fixed: Node CLI left the second __TITLE__ unfilled · Next: user publishes to PyPI/npm, push to GitHub

- 2026-09-30 · Initial commit b71e96f. P0.1 done: name is qbeam (free on PyPI, npm, .dev, GitHub, Homebrew when checked); placeholders replaced in repo · Next: P0.10 register qbeam.dev + packages (user), P0.4 spec v2

- 2026-09-30 · P0.3 done, P0.2 mostly done: git init (main), Apache-2.0, README/SECURITY/THIRD_PARTY_NOTICES, .gitignore; code moved to py/ js/ web/ (vendor, dist), stub READMEs for protocol/ android/ ios/ go/ bench/ docs/. Verified: rebuilt decoder.html byte-identical; sender page identical except session id · Next: P0.1 name, P0.4 spec v2
- 2026-09-30 · Speed parity with fastest competitor made a hard requirement: added rig + competitor baseline (P0.12), speed spike (P0.13), sparse fountain code (P0.5a, P2.1a), pixel sender default (P1.6), parity gates 2 and 3 · Next: P0.1 pick the name
- 2026-09-30 · Plan created; strategy doc finalized (developer focus, no enterprise, trial model) · Next: P0.1 pick the name
