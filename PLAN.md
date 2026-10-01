# Build plan: development, testing and marketing

Strategy (why and for whom): https://claude.ai/code/artifact/83b0e616-c086-499b-8b24-ff42837f18c3

This is the working plan. Tick boxes as work lands and add a line to the progress log at the bottom.
`CLAUDE.md` holds the one-paragraph "where are we" summary; this file holds the detail.

Product and command name: **qbeam** (chosen 2026-09-30; free on PyPI, npm, `.dev`, GitHub, Homebrew at the time).

## Status at a glance

| Phase | Target window | Status | Exit gate |
| --- | --- | --- | --- |
| P0 Foundations | Oct 1–7, 2026 | Done except user items (P0.2 CoC, P0.10 handles/stores, P0.12 deferred) | Repo, spec draft, CI green on 3 OSes |
| P1 Python CLI + terminal mode | Oct 8–31 | Mostly done: v3, terminal mode, .pyz; left: P1.4a, P1.13 cap, P1.16–19 install/manual checks, P1.20–22 marketing | **Gate 1:** installs and sends on macOS/Linux/Windows with no admin rights |
| P2 Speed parity, web decoder v2, npm, public launch | Nov 1–30 | In progress: web decoder v2, npm, hardening and qbeam.dev done; launch not started | **Gate 2:** ≥ 100 KB/s goodput on reference rig (web sender + best decoder); 1k installs |
| P3 Android app (trial + unlock) | Dec 1 – Jan 15, 2027 | Started: receiver app builds and runs on the emulator; no billing yet | **Gate 3:** app ≥ fastest competitor on the same rig (target ≥ 130 KB/s); 100 paid unlocks |
| P4 iOS app, $19 bundle, Pro web receiver | Q1 2027 | Started: receiver app builds and runs in the Simulator; no StoreKit yet | iOS live; bundle key works on all platforms |
| P5 Standalone binaries + more channels | Q1–Q2 2027 | Not started | Signed binaries in Scoop/brew/winget |

Rules: billing may be **built** now but not **shipped** (switched on in a store build) until Gate 2 passes. Free channels (GitHub APK, IzzyOnDroid, F-Droid, web receiver) come before the paid stores (decided 2026-10-02). The speed half of Gate 2 gates the public launch (P2.17); the installs half gates shipping billing. Each phase ends with its testing checklist green.

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
- [x] P0.4 Write `protocol/SPEC.md` v2 describing today's `Q2H`/`Q2D` text frames exactly (the baseline)
- [x] P0.5 (done 2026-10-01: protocol/SPEC.md v3 draft, js/qbeam3.js reference, py/src/qbeam/protocol_v3.py encoder, v3 vectors) Draft protocol v3 (binary frames): magic + version byte, session id, K, length, block size, ESI, flags; header frame with SHA-256, filename, encoding (gz / raw / tar.gz / tar.xz), optional encryption params. Frame-level CRC32. Designed for speed from day one: binary payloads up to QR v40-L (2,953 B), multiple codes per displayed frame, and a sparse fountain code (below).
- [x] P0.5a (done 2026-10-01: segmented dense GF(2) code, KMAX 2048 blocks per segment; 0.5% overhead at 10 MB and 2.2% at 40 MB under 20% loss, 40 MB decodes in 1.7 s on a Mac; simpler to port than RaptorQ/Wirehair, see bench/protocol/fountain_v3.js) Choose the sparse fountain code: RaptorQ (RFC 6330) vs. Wirehair vs. a tuned LT code. The current dense GF(2) code decodes in O(K²) and is too slow for multi-MB files at high block rates. Check licences of existing implementations (Wirehair BSD; libcimbar — confirm) and whether a WASM build is practical.
- [x] P0.6 (decided 2026-10-01: optional extra `qbeam[crypto]`; PBKDF2-HMAC-SHA256 (600k iterations) + AES-256-GCM envelope, flag bit 0; SPEC v3 §7, js/qbeam3.js, py/src/qbeam/crypto_v3.py, vectors) Decide encryption approach (Python stdlib has no AES): (a) optional extra `pip install qbeam[crypto]` using `cryptography`, or (b) vendored pure-Python AES-GCM (slow but fine for small files). Record decision in SPEC.md.
- [ ] P0.12 **Build the benchmark rig first and measure competitors on it:** fixed monitor, 3 Android phones (low/mid/high) + 1 iPhone on a stand; measure cimbar (CameraFileCopy) and Decimen goodput for 1 MB and 10 MB files. Their numbers on our rig become the parity target.
- [x] P0.13 (done 2026-10-01: 128 KB/s avg / 149 best in Chrome on Android, 3x2 v30-L @15 fps, Y-plane copy + fixed mask; plain QR is enough, see bench/RESULTS.md) **Speed spike (1–2 days):** prototype in the browser: 2×2 grid of v30–v40 codes at 15–30 fps, decoded by zxing-cpp WASM and Android's native scanner; record the best goodput. Confirms parity is reachable with plain QR before P1 commits, or triggers the colour-mode fallback (P2.4a) early.
- [x] P0.7 CI skeleton (GitHub Actions): ubuntu, macos, windows; Python 3.8 → 3.13; Node 18/20/22 — `.github/workflows/ci.yml` (Python 3.8/3.12/3.13, Node 22) + `release.yml` (publish on merge when the version is new, trusted publishing)

Testing
- [x] P0.8 Port existing behaviour into tests first (py/tests/test_cli.py, js/test/roundtrip.js): fountain round-trip (JS via node), encode.py → decoder round-trip on text frames
- [x] P0.9 Generate the first test vectors (protocol/test-vectors/v2.json; JS reference + spec-only Python implementation agree; CI guards drift) from today's encoder; both codecs must reproduce them byte for byte

Marketing
- [ ] P0.10 (done: qbeam.dev domain, GitHub org, npm and PyPI qbeam 0.0.1; remaining: social handles, store/trademark checks) Register qbeam.dev, `qbeam` on PyPI and npm (publish a real 0.0.1 of the current encoder rather than an empty placeholder, which PyPI discourages), GitHub org `qbeam`, X / Bluesky / YouTube handles. Not yet checked: Play Store, App Store, trademarks (USPTO/EUIPO), qbeam.com
- [ ] P0.11 One-page landing site: tagline, 10-second GIF placeholder, "star on GitHub"

---

## P1 — Python CLI + terminal mode (Oct 8–31)

Development
- [x] P1.1 (done 2026-10-01: send / receive / --version on protocol v3) Package `encode.py` as `qbeam` with entry point; commands: `send`, `receive`, `version` — started early for the 0.0.1 name claim: `qbeam send` / `receive` / `--version` exist in py/ and js/; still needs the P1 features below
- [x] P1.2 (done 2026-10-01: stdin with --name; folders always one archive; .gitignore + junk + --exclude skipped) `send <file>` / `send -` (stdin) / `send <dir> --archive` (respect `.gitignore` + existing junk patterns) / `--exclude`
- [x] P1.3 (done 2026-10-01: own encoder py/src/qbeam/qr.py instead of vendoring; module-for-module identical to qrcodegen.js on 19 vectors) Vendor a pure-Python QR encoder (e.g. Nayuki `qrcodegen`, MIT) for terminal mode
- [x] P1.4 (done 2026-10-01: half blocks in true black on white, auto-fit by payload per frame, cursor/screen restored on Ctrl-C; two-space fallback without Unicode) Terminal renderer: Unicode half-blocks (2 modules per char), ANSI cursor-home redraw, auto-fit QR version to terminal size, `--invert` for light themes, clean exit on Ctrl-C (restore cursor/screen)
- [x] P1.5 (done 2026-10-01: VT processing enabled via ctypes; Python writes Unicode to the Windows console natively; not yet tried in a real conhost) Windows console: enable VT processing via ctypes; UTF-8 output; fall back gracefully on legacy conhost
- [ ] P1.4a (not done: half blocks only so far) Terminal graphics protocols for pixel output where supported (kitty, iTerm2 inline images, sixel incl. Windows Terminal); detect and prefer them over half-blocks
- [x] P1.6 (done 2026-10-01: browser page by default; --tty, and automatic terminal mode over SSH / Linux without a display; --browser forces the page) Pixel sender: `send` opens the full-speed sender page (self-contained HTML → temp file → `webbrowser`) by default when a display is available; `--tty` forces terminal mode; headless sessions fall back to terminal automatically. All heavy encoding (fountain + QR) runs in JS/WASM in the page, not in Python.
- [x] P1.7 (done 2026-10-01: prints and opens the v3 receiver page) `receive`: opens the offline decoder page (webcam) for laptop-to-laptop / phone-to-laptop
- [x] P1.8 (done 2026-10-01: size, compression, encryption, speed preset and estimated time) Print SHA-256 and a short summary (size, compressed size, frames, estimated time) before sending
- [x] P1.9 (done 2026-10-01: py/build_pyz.py, 591 KB, assets read via pkgutil; built and run on 3 OSes in CI, attached to GitHub releases) Build a single-file `qbeam.pyz` (stdlib `zipapp`) in CI; attach to GitHub releases with checksums
- [ ] P1.10 Publish to TestPyPI, then PyPI; verify `uvx qbeam`, `pipx install qbeam`, `pip install --user qbeam`
- [x] P1.11 (done 2026-10-01: folders arrive as .tar.xz; single files are gunzipped in the browser; already-compressed files sent as-is) Decoder: in-browser `.tar.gz` handling decision (save as-is vs. prefer gzip'd tar for single-file receivers)

Testing
- [x] P1.12 (done 2026-10-01: py/tests/test_cli.py rewritten for v3, incl. stdin, .gitignore, HTML escaping, encryption) Unit: CLI arg parsing, archive excludes, stdin, compression choices, filename encoding (unicode, long names)
- [x] P1.13 (done 2026-10-01: receiver strips paths, rejects ./.., refuses gzip that expands past 1 GiB) Security: sanitize received filenames (no path separators, no `..`, no absolute paths); cap decompressed size (zip-bomb guard)
- [x] P1.14 (done 2026-10-01: py/tests/test_terminal.py parses rendered frames back to modules) Terminal snapshot tests: rendered frame text for fixed inputs across widths
- [x] P1.15 (done 2026-10-01: js/test/terminal_decode.js paints terminal frames as 8x16 px glyphs, zxing decodes, file rebuilt) Decode-what-we-render test: render terminal frames to images (dev-only deps: Pillow, `zxing-cpp`) and decode them back
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
- [x] P2.1 (done 2026-10-01: js/qbeam3.js + py protocol_v3; sender page emits v3 binary codes) Implement protocol v3 binary frames in Python + JS encoders (QR byte mode, no base64)
- [x] P2.1a (done 2026-10-01: segmented dense code in the sender page and receiver) Implement the sparse fountain code chosen in P0.5a in JS/WASM (sender) and for all decoders; keep the dense code only for tiny files if it helps
- [x] P2.2 (done 2026-10-01: T = version capacity − 22 per preset) Large blocks up to QR v40-L (2,953 B), ECC level L; block size matched to the QR version per preset. Spike: density is capped by camera pixels (≥ ~3.3 px/module), so at 1080p prefer more mid-size codes (v25–v30) over fewer v40s
- [x] P2.2a (done 2026-10-01: web/vendor/qrcodegen.js patched with setMask; sender uses mask 2) Fixed QR mask in every sender (spike: 18 ms → 1.1 ms per code, no decode loss)
- [x] P2.3 (done 2026-10-01: presets safe/fast/max plus the receiver hint (P2.6)) (presets done 2026-10-01 (safe 2x2 v25 @10, fast 3x2 v25 @15, max 3x2 v30 @30); receiver 'too fast' hint still to do) Speed presets `--speed safe|fast|max` (frame rate 10–30 fps, code size, grid) — no feedback channel, so presets + receiver hint; `max` is the default on a pixel display
- [ ] P2.3a Sender render loop: pre-generate frames ahead in a Worker, draw to canvas with `requestAnimationFrame`, frame changes locked to display refresh (no tearing/half-drawn frames)
- [x] P2.4 (done 2026-10-01: sender grids 2x2 / 3x2) Multi-code frames: 2×2 (and 3×2 on large screens) grid of codes per frame; terminal stays single-code
- [ ] P2.4b Try a 1–2 module quiet zone between codes (optics sim read more max-preset codes with it because modules get larger); needs a real-phone A/B before shipping
- [ ] P2.4a Fallback if plain QR can't reach parity on the rig: high-density colour mode (cimbar-style or libcimbar-compatible, licence permitting)
- [x] P2.5 (done 2026-10-01: web/dist/decoder.html, single offline file, zxing WASM worker pool, Y-plane copy with fallbacks, min resolution/fps constraints, camera picker) Web decoder v2: zxing-cpp WASM in a Web Worker (multi-code, binary), native `BarcodeDetector` where faster; request the camera's highest resolution/frame rate; replace jsQR. Spike-proven recipe: WebCodecs VideoFrame → native-format luma plane → zxing `readBarcodesFromPixmap` in a worker pool, tryHarder on, `min` resolution constraints, canvas fallback; recommend Chrome on Android
- [x] P2.6 (done 2026-10-01: amber hint when under half the codes in the last 5 s were caught, suggesting framing, glare and 'safe' speed) Receiver hint: decoder shows "missing X% of frames — try `--speed safe`" when its drop rate is high
- [x] P2.7 (decided 2026-10-01: no v2 decoding; the receiver tells users to regenerate old pages (0.0.1 had almost no users)) Keep v2 text frames decodable (backward compatibility) for one release
- [x] P2.8 (done 2026-10-01: npx qbeam send on v3 incl. --encrypt; terminal mode js/terminal.js mirrors Python, decoded by zxing in CI) (send on v3 done 2026-10-01 (single files, stdin, --encrypt); Node terminal renderer still to do) npm package: `npx qbeam send|receive` using the shared JS codec + a terminal renderer in Node
- [ ] P2.9 Hosted web decoder as an installable offline PWA; also downloadable single HTML
- [x] P2.10 (done 2026-10-01: --encrypt with generated or QBEAM_PASSPHRASE passphrase printed only in the terminal; receiver prompts and decrypts) Optional encryption per P0.6 decision (`--passphrase`), decoder prompts for it. Codec done (P0.6); remaining: CLI flag (generate a passphrase and print it in the terminal, never on the QR screen), receiver prompt, friendly error when `cryptography` is missing

Testing
- [x] P2.11 (done 2026-10-01: js/test/v3.js and roundtrip.js decode Python- and Node-made codes and pages) Cross-codec tests: Python-encode → JS-decode and JS-encode → Python-decode on all test vectors
- [x] P2.12 (done 2026-10-01: round trips with 20-50% loss incl. multi-segment; e2e harness capfps simulates a slow camera) Loss tests: randomly drop 0–50% of frames and reorder; must decode with ≈ K+ε frames
- [x] P2.13 (done 2026-10-01: js/test/optics.js photographs real sender frames with a simulated camera (perspective, blur, contrast, noise) and decodes them with the receiver's zxing) Optical simulation: rendered frames + blur, perspective, noise, moiré, gamma, motion; decode rate per preset
- [x] P2.14 (done 2026-10-01: js/test/fuzz.js (seeded) over parseCode, decoders, containers, envelopes; found and fixed the session-size DoS (SPEC v3 §2 limits)) Fuzz the frame parser and header parser (Python: atheris or hypothesis; JS: fast-check)
- [ ] P2.15 **Benchmark on the P0.12 rig:** `bench/run` sends 100 KB, 1 MB and 10 MB per preset; ours and competitors' goodput side by side in `bench/RESULTS.md`
- [x] P2.15a (done 2026-10-01: optics 'hard' profile floors sit under measured values; verified it fails when codes get softer) Speed regression check in CI: simulated-optics goodput per preset must not drop between commits (fails the build)
- [x] P2.16 (done 2026-10-01: CI installs via npx on 3 OSes (Node 22)) npm install matrix (`npx`, `npm i -g` with user prefix) on 3 OSes, Node 18/20/22

Marketing
- [ ] P2.17 Show HN + r/commandline, r/programming, r/selfhosted, r/homelab, Lobsters (same day)
- [ ] P2.18 Deep-dive post: fountain codes, binary frames, terminal rendering, with benchmark numbers
- [ ] P2.19 Submit to awesome-cli-apps, awesome-python, terminal-trove, console.dev, Python Weekly, JavaScript Weekly, Changelog
- [ ] P2.20 Public benchmarks page (honest comparison with cimbar and Decimen)
- [ ] P2.21 Start weekly short clips; SEO how-to pages ("copy file from VDI without clipboard", etc.)
- [ ] P2.22 GitHub Sponsors live; CLI prints one sponsor line after success (suppressible with `--quiet`)

**Gate 2:** ≥ 100 KB/s median goodput on the mid-range phone (web sender, best available decoder) at `--speed max`, 10 MB file; 1k installs (PyPI + npm). The speed part must pass before the public launch (P2.17); the installs part (which mostly comes from that launch) must pass before billing ships.

---

## Release track (decided 2026-10-02, revised the same day)

**Order:** web receiver + Android APK first, through free channels (GitHub releases, IzzyOnDroid, F-Droid); public
launch once a mid-range phone clears Gate 2's speed bar; Google Play and the App Store (with the trial + unlock, B.11)
later, when demand shows. iPhone users use the web receiver (qbeam.dev/r) until then. Android flavours: **foss**
(default; no Google libraries, no trial) for the free channels, **play** (Play Billing, trial switch) for Google Play.
One release key signs every channel so they stay update-compatible (docs/RELEASING.md).

Free channels
- [x] F.1 (done 2026-10-02) foss / play flavours; version from scripts/version.py; release signing from env; CI checks no network permission (both) and no billing (foss)
- [x] F.2 (done 2026-10-02) Release workflow attaches the signed foss APK + SHA-256 to each GitHub release (skips without the key secret; refuses the debug key)
- [x] F.3 (done 2026-10-02: key CN=qbeam, cert SHA-256 C9:FC:71:E0…:72:14; first APK attached to v0.2.0 via android-apk.yml) **User:** generate the release key and add the two GitHub secrets (docs/RELEASING.md); first APK ships
- [x] F.4 (done 2026-10-02) qbeam.dev + README: Android download link, signing-certificate fingerprint, how to verify the SHA-256
- [ ] F.5 Store text at `fastlane/metadata/android/` (where F-Droid / IzzyOnDroid look); reproducible build check
- [ ] F.6 IzzyOnDroid inclusion request (picks up APKs from GitHub releases; usually days)
- [ ] F.7 F-Droid: build recipe + merge request to fdroiddata (user needs a GitLab account; review takes weeks). Risk: zxing-cpp's prebuilt native libs may need building from source in the recipe
- [ ] F.8 Measure a mid-range Android phone (Gate 2 speed half), then the public launch (P2.17)

Paid stores (later)
- [ ] B.1 Google Play Console account ($25; identity verification can take days). Apps with in-app purchases show the developer's physical address publicly
- [ ] B.2 Apple Developer Program ($99/yr; 1–2 days). The listing shows the legal name as seller
- [ ] B.3 Recruit ≥ 12 Android testers (Play's 14-day closed test) and TestFlight testers
- [ ] B.4 Export compliance (app decrypts AES-GCM for the user's own files) and Play data-safety / content-rating forms
- [x] B.5 (done 2026-10-02) Release CLI 0.2.0
- [x] B.6 (done 2026-10-02; support = GitHub issues for now) Privacy page at qbeam.dev/privacy
- [x] B.7 (done 2026-10-02: store/ in fastlane layout, length check in CI, 3 captioned screenshots per store from real transfers) Store copy and screenshots
- [ ] B.8 Play: upload the release key to Play App Signing, `bundlePlayRelease` AAB in CI
- [ ] B.9 iOS archive + upload (Release, automatic signing) and a CI build of the archive
- [x] B.10 (done 2026-10-02) App icons (iOS AppIcon, Play icon + feature graphic)
- [x] B.11 (done 2026-10-02: Trial in core + QBeamKit with tests; Play Billing 9.1.0 and StoreKit 2; switch off by default; real purchases untested until the store products exist) Trial + unlock behind a build switch; free-channel installs count as beta testers and keep a free unlock
- [ ] B.12 Upload: Play closed track + TestFlight external beta (needs Beta App Review)

---

## P3 — Android app with trial + one-time unlock (Dec – mid Jan)

Development
- [x] P3.1 (done 2026-10-01: CameraX 1080p 16:9, 4-worker zxing-cpp pool, 288 KB/s on OnePlus 12) Kotlin + CameraX; native decoding via zxing-cpp (multi-code) with ML Kit as an option; high-res capture, continuous autofocus
- [x] P3.2 (done 2026-10-01: android/core, JUnit on v3.json) Kotlin codec port (fountain + v3 frames); passes all shared test vectors
- [ ] P3.3 Save via Storage Access Framework to a user-chosen folder; share sheet; transfer history
- [ ] P3.4 Archive extraction in-app (tar, gz, xz) with zip-slip protection and size caps
- [ ] P3.5 Phone → laptop: app displays the QR stream from a picked file; laptop runs `qbeam receive`
- [x] P3.6 (done 2026-10-01) Passphrase decryption (per P0.6)
- [x] P3.7 (done 2026-10-02, behind the switch) **Trial:** count only completed, checksum-verified transfers; counter visible from #5; transfer in progress at the limit always finishes; unlock screen links to the free web decoder
- [ ] P3.8 (code done 2026-10-02: billing 9.1.0, product dev.qbeam.unlock, restore, cached entitlement; INTERNET stripped from the merged manifest, CI-checked; needs the Play product + license testers) Google Play Billing one-time product ($6.99) + restore purchases; offline-tolerant entitlement cache
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
- [x] P4.1 (done 2026-10-01: Vision was ~45 KB/s, replaced by vendored zxing-cpp at 60 fps, 277 KB/s on iPhone 15) Swift + AVFoundation; ~~Vision~~ zxing-cpp; Swift codec port on shared vectors
- [ ] P4.2 (trial + StoreKit 2 code done 2026-10-02; needs the App Store product + sandbox testing) Same trial model with StoreKit 2 one-time purchase; Files app save; archive extraction
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

- 2026-10-02 · First Android APK released: qbeam-0.2.0.apk (foss, signed with the release key, verified checksum + certificate) on the v0.2.0 GitHub release; download link and signing fingerprint on qbeam.dev and README · Next: F.5 fastlane metadata + reproducible build, F.6 IzzyOnDroid, F.7 F-Droid, F.8 mid-range phone then launch
- 2026-10-02 · Release order changed: web receiver + Android APK through free channels first (GitHub releases, IzzyOnDroid, F-Droid), paid stores later. Android foss/play flavours (foss: no Google libraries; CI-checked), version from scripts/version.py, release workflow attaches a signed foss APK when the key secrets exist (tested with a throwaway key; foss runs on OnePlus) · Next: user generates the release key + secrets (F.3); Claude: download link + fingerprint (F.4), fastlane metadata (F.5), IzzyOnDroid/F-Droid (F.6/F.7)
- 2026-10-02 · B.10 icons (iOS AppIcon, Play icon + feature graphic). B.11 trial: 10 free transfers then a one-time unlock, shared Trial in Kotlin + Swift (tests), Play Billing + StoreKit 2, build switch off by default, beta installs grandfathered, paywall links to the web receiver. Play Billing pulls Google's datatransport logging (INTERNET); user chose to strip the permission — billing still binds to the Play Store, no crash on OnePlus; CI fails if INTERNET returns · Next: user creates Play + Apple accounts and the dev.qbeam.unlock product; Claude: B.8/B.9 signing + CI bundles
- 2026-10-02 · Store copy + screenshots (B.7): Play and App Store text in store/ (fastlane layout, CI length check), 3 captioned screenshots per store from real iPhone 15 / OnePlus 12 transfers. Fixed two app bugs found while capturing: Saved-line speed included passphrase typing (now ends at the last needed code; tests in Kotlin + Swift), and iOS copy names split .tar.gz (now "name 2.tar.gz") · Next: B.10 icons at store sizes, B.8/B.9 signing + CI bundles, B.11 trial behind a switch; user: Play + Apple accounts
- 2026-10-02 · Released 0.2.0 (PyPI, npm, GitHub with .pyz). Terminal mode tested to phone. Chose Option A: free betas on Play closed test + TestFlight now, trial/unlock built behind a switch and shipped after Gate 2 (rule and Gate 2 wording updated; Beta release track B.1–B.12 added). Privacy page at qbeam.dev/privacy · Next: user creates Play + Apple accounts (B.1/B.2); Claude: store copy, signing, CI bundles (B.7–B.10)
- 2026-10-01 · Android on a OnePlus 12: ~140 KB/s at first (CameraX picked 1920×1440, one decode thread); with 16:9 1080p and a 4-worker zxing pool it reached 288 KB/s for 7.6 MB in 8 s, even though the camera only offers apps 30 fps. Both apps now show time and KB/s on the Saved line. iPhone 15: 277 KB/s · Next: trial counter + billing (P3.7/P3.8, P4.2), phone → laptop sending; competitor baseline (P0.12) to confirm parity
- 2026-10-01 · iOS speed: Vision decoded ~5 frames/s (~750 ms each) → ~45 KB/s; switched to zxing-cpp worker pool (60 fps in, ~12 ms/frame, ~350 codes/s) → 277 KB/s on iPhone 15 vs 246 KB/s for the web receiver. Fixed 30 fps cap (.inputPriority) and an assert() crash in zxing's QR sampler (vendored zxing-cpp 3.1.1 with NDEBUG) · Next: confirm no crashes over several transfers, then Android on a real phone
- 2026-10-01 · First real-device transfer: iOS app on iPhone 15 (free personal team, installed via devicectl) received a 399 KB file from the Python sender; SHA-256 verified · Next: record app goodput vs the web receiver on the same phone, then Android on a real phone
- 2026-10-01 · Native receivers: Kotlin and Swift v3 codecs pass the shared vectors; Android app (CameraX + zxing-cpp, saves to Downloads/qbeam) runs on the emulator; iOS app (AVFoundation 1080p/60 + Vision + QRPayload, saves to Files) builds via XcodeGen and runs in the Simulator; CI builds both. Not yet tested with a real camera · Next: real-phone tests on both apps, then trial counter + billing (P3.7/P3.8, P4.2), phone → laptop sending
- 2026-10-01 · P2 hardening: fuzzing found a receiver DoS (one crafted code could claim a 4 GiB session in 1-byte symbols); fixed with v3 session limits (T 8–2931, L ≤ 256 MiB, K ≤ 2^20), lazy segment decoders, new reject vector. Simulated-camera optics test in CI with typical/hard profiles. User chose native apps and is installing Xcode + Android Studio · Next: Kotlin and Swift v3 codecs on the shared vectors, then app shells

- 2026-10-01 · Released 0.1.0 (PyPI, npm via trusted publishing, GitHub release with .pyz). Receiver: 1 GiB gunzip cap (P1.13), catch-rate hint (P2.3/P2.6). qbeam.dev live on GitHub Pages (landing + offline receiver PWA at /r); DNS on Cloudflare set to DNS-only, waiting for GitHub's certificate. npm CLI terminal mode (P2.8) · Next: enforce HTTPS once the cert is issued; then P2 remaining (P2.9 done pending cert, P2.11–16 tests/bench) or P3 Android

- 2026-10-01 · Terminal mode: own pure-Python QR encoder (identical to qrcodegen.js on 19 vectors), half-block renderer with layout by payload per frame, auto over SSH / no display, passphrase shown before codes. zxing decodes painted terminal frames back to the file (CI). Single-file qbeam.pyz (591 KB) built and run on 3 OSes in CI, attached to releases. Windows CI fix: LF line endings pinned · Next: user decides on 0.1.0 release; then P1.16–19 checks, P1.20–22 launch prep

- 2026-10-01 · Protocol v3 end to end: new sender page (grid, presets, fixed mask), new single-file receiver (zxing WASM workers, Y-plane, passphrase prompt), Python and npm CLIs on v3 (stdin, folders with .gitignore, --speed, --encrypt, auto-open). Browser e2e test (web/test/e2e.html) passes for text, 30 KB binary at max speed and encrypted. Fixed: checkouts used stale packaged assets. jsQR removed · Next: terminal mode (P1.3–P1.5), .pyz (P1.9), then release 0.1.0

- 2026-10-01 · P0.6 done: encryption as optional extra qbeam[crypto]. SPEC v3 §7 envelope (PBKDF2-HMAC-SHA256 + AES-256-GCM, prefix authenticated), flag bit 0 must-understand. JS (WebCrypto) and Python (hashlib + cryptography) produce identical vectors; tests cover wrong passphrase, tampering, iteration cap, encrypted transfer under loss; CI installs cryptography only for the encryption tests · Next: build v3 into senders and receivers (P1/P2)

- 2026-10-01 · P0.5 + P0.5a done: protocol v3 draft (18-byte binary header + CRC-32 per code, segmented dense fountain code with KMAX 2048, container with filename/encoding/SHA-256). JS reference codec, Python encoder written from the spec (matches all vectors), JS tests incl. decoding Python-encoded codes under loss; CI runs them and guards v3 vector drift. iPhone Chrome spike run: 246 KB/s avg / 293 best. Decimen baseline skipped for now (misconfigured run gave ~1 KB/s) · Next: P0.6 encryption decision, then P1/P2 senders and receivers on v3

- 2026-10-01 · **P0.13 done: parity in a browser.** Chrome/Android 1080p@60 decoded 3x2 v30-L @15 fps at 128 KB/s avg, 149 KB/s best 5 s. Key fixes: Y-plane copy (90 ms → 1 ms), fixed QR mask (18 → 1.1 ms/code), tryHarder. Firefox on Android is capped at 640x480 · Next: P0.12 competitor baseline on the same setup, P0.5/P0.5a protocol v3 + sparse fountain code

- 2026-10-01 · P0.4 + P0.9 done (SPEC v2, vectors, spec-only Python check). P0.13 started: offline benchmarks show decode is cheap (7–12 ms/1080p frame), camera pixels cap density (~10 KB/frame at 1080p), fixed QR mask makes encoding 17x faster; 3x2 v30-L @15 fps offers 152 KB/s on paper. Camera sender/receiver prototype in bench/spike, verified by loopback · Next: user runs camera tests (bench/spike/README.md)

- 2026-10-01 · First automatic release: CI green on 18 jobs (3 OSes × Python 3.8/3.12/3.13 + install checks), PyPI qbeam 0.0.1 published via trusted publishing, GitHub release v0.0.1 · Next: P0.4 spec v2, P0.12 benchmark rig, P0.13 speed spike

- 2026-10-01 · qbeam@0.0.1 published to npm by hand (verified with npx); fixed npm publish paths (./) in release.yml and RELEASING.md · Next: user adds npm trusted publisher + PyPI pending publisher, then push to main publishes PyPI 0.0.1

- 2026-09-30 · P0.7 + P0.8 done: CI on 3 OSes, package + no-admin install jobs (uvx/npx), release-on-merge with trusted publishing (docs/RELEASING.md), scripts/version.py keeps versions in sync; tests: 6 Python CLI tests, 6 cross-CLI fountain round-trips. Fixed Windows cp1252 crashes (UTF-8 file I/O, safe console output) · Next: registry setup (user), push

- 2026-09-30 · Commits rewritten to GitHub no-reply author; public repo github.com/qbeam/qbeam created and pushed, topics set. PyPI/npm 0.0.1 artifacts built in py/dist and js/qbeam-0.0.1.tgz · Next: user runs twine upload + npm publish

- 2026-09-30 · qbeam 0.0.1 built for PyPI (py/src/qbeam, stdlib only, assets packaged) and npm (js/bin/qbeam.js, single-file send + receive, exports fountain codec). Tested: clean venv install, output matches pre-package encoder, uvx on Python 3.8 and 3.13, npm install from tarball, fountain round-trip with 30–50% frame loss for Node- and Python-made pages. Fixed: Node CLI left the second __TITLE__ unfilled · Next: user publishes to PyPI/npm, push to GitHub

- 2026-09-30 · Initial commit b71e96f. P0.1 done: name is qbeam (free on PyPI, npm, .dev, GitHub, Homebrew when checked); placeholders replaced in repo · Next: P0.10 register qbeam.dev + packages (user), P0.4 spec v2

- 2026-09-30 · P0.3 done, P0.2 mostly done: git init (main), Apache-2.0, README/SECURITY/THIRD_PARTY_NOTICES, .gitignore; code moved to py/ js/ web/ (vendor, dist), stub READMEs for protocol/ android/ ios/ go/ bench/ docs/. Verified: rebuilt decoder.html byte-identical; sender page identical except session id · Next: P0.1 name, P0.4 spec v2
- 2026-09-30 · Speed parity with fastest competitor made a hard requirement: added rig + competitor baseline (P0.12), speed spike (P0.13), sparse fountain code (P0.5a, P2.1a), pixel sender default (P1.6), parity gates 2 and 3 · Next: P0.1 pick the name
- 2026-09-30 · Plan created; strategy doc finalized (developer focus, no enterprise, trial model) · Next: P0.1 pick the name
