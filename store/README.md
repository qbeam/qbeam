# Store listings

Text and screenshots for Google Play and the App Store, in fastlane's folder layout (`supply` for Play, `deliver` for
the App Store) so uploads can be automated later.

| Path | What |
| --- | --- |
| `android/en-US/*.txt`, `changelogs/<versionCode>.txt` | Play title, short and full description, release notes |
| `ios/en-US/*.txt` | App Store name, subtitle, promotional text, description, keywords, URLs, release notes |
| `screenshots/raw/<platform>-<n>-<slug>.jpg` | Unedited captures from real transfers on real phones |
| `android/en-US/images/icon.png`, `featureGraphic.png` | Play icon (512) and feature graphic (1024×500); `uv run --with pillow python scripts/store_icons.py` also writes the iOS AppIcon |
| `ios/screenshots/en-US/`, `android/en-US/images/phoneScreenshots/` | Generated: captioned, sized for each store |

- `python3 scripts/check_store.py` checks every field against the store limits (CI runs it).
- `uv run --with pillow python scripts/store_screenshots.py` rebuilds the screenshots from `raw/`; captions live in
  that script.

Copy rules: describe moving files between your own devices, offline. Never frame qbeam as a way around security or
monitoring (CLAUDE.md). Speeds quoted are measured ones (iPhone 15 and OnePlus 12, `--speed max`, a file that doesn't
compress); don't claim "fastest" until the competitor baseline (PLAN.md P0.12 / P3.16) is measured. When billing ships
(trial switch on), both descriptions must mention the 10 free transfers and the one-time unlock, and Play's data-safety
form should be answered for Play Billing (purchase history is handled by Google, not by us).

Capturing new raw screenshots: phones on USB, then `adb exec-out screencap -p > x.png` (Android) and
`xcrun devicectl device capture screenshot --device <udid> --destination x.png` (iPhone). Use demo files, never real
ones, since file names show on screen.
