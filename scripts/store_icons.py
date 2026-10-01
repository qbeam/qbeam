"""App icons and Play graphics, from the same drawing as qbeam.dev's icon (scripts/build_site.py).

    uv run --with pillow python scripts/store_icons.py

Writes:
    ios/App/Sources/Assets.xcassets/AppIcon.appiconset/icon-1024.png  1024x1024, opaque (iOS masks the corners)
    fastlane/metadata/android/en-US/images/icon.png                           512x512 Play listing icon
    fastlane/metadata/android/en-US/images/featureGraphic.png                 1024x500 Play feature graphic
"""
import io
import json
import pathlib
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from build_site import png  # noqa: E402
from store_screenshots import SUB, TITLE, font, gradient  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent


def icon(size: int) -> Image.Image:
    return Image.open(io.BytesIO(png(size, rounded=False))).convert("RGB")  # opaque: App Store rejects alpha


def main() -> None:
    appicon = ROOT / "ios/App/Sources/Assets.xcassets/AppIcon.appiconset"
    appicon.mkdir(parents=True, exist_ok=True)
    icon(1024).save(appicon / "icon-1024.png", optimize=True)
    (appicon / "Contents.json").write_text(json.dumps({
        "images": [{"filename": "icon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
        "info": {"author": "xcode", "version": 1},
    }, indent=2) + "\n", encoding="utf-8")
    (appicon.parent / "Contents.json").write_text(json.dumps({"info": {"author": "xcode", "version": 1}}, indent=2) + "\n",
                                                 encoding="utf-8")

    images = ROOT / "fastlane/metadata/android/en-US/images"
    images.mkdir(parents=True, exist_ok=True)
    icon(512).save(images / "icon.png", optimize=True)

    # Feature graphic: the mark, the name and one line, on the screenshots' background.
    w, h = 1024, 500
    g = gradient((w, h)).convert("RGB")
    mark = Image.open(io.BytesIO(png(220))).convert("RGBA")
    g.paste(mark, (110, (h - 220) // 2), mark)
    d = ImageDraw.Draw(g)
    d.text((380, 150), "qbeam", font=font(104, True), fill=TITLE)
    d.text((384, 285), "Files from a screen to your phone.", font=font(36, False), fill=SUB)
    d.text((384, 333), "No network, no cable.", font=font(36, False), fill=SUB)
    g.save(images / "featureGraphic.png", optimize=True)
    for p in (appicon / "icon-1024.png", images / "icon.png", images / "featureGraphic.png"):
        print(p.relative_to(ROOT), Image.open(p).size)


if __name__ == "__main__":
    main()
