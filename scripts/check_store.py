"""Check store listing text (store/, fastlane layout) against Google Play and App Store limits. Run in CI."""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "store"
LIMITS = {
    "android/en-US/title.txt": 30,
    "android/en-US/short_description.txt": 80,
    "android/en-US/full_description.txt": 4000,
    "android/en-US/changelogs/*.txt": 500,
    "ios/en-US/name.txt": 30,
    "ios/en-US/subtitle.txt": 30,
    "ios/en-US/promotional_text.txt": 170,
    "ios/en-US/keywords.txt": 100,
    "ios/en-US/description.txt": 4000,
    "ios/en-US/release_notes.txt": 4000,
}


def main() -> int:
    bad = 0
    for pattern, limit in LIMITS.items():
        files = sorted(ROOT.glob(pattern))
        if not files:
            print(f"missing: store/{pattern}")
            bad += 1
        for f in files:
            n = len(f.read_text(encoding="utf-8").strip())
            ok = 0 < n <= limit
            bad += not ok
            print(f"{'ok ' if ok else 'BAD'} {n:5}/{limit:<5} {f.relative_to(ROOT)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
