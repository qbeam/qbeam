"""Build captioned store screenshots from real device captures.

    uv run --with pillow python scripts/store_screenshots.py

Inputs: store/screenshots/raw/{ios,android}-<n>-<slug>.jpg (unedited screen captures from real transfers) and the
captions below. Outputs, in fastlane's layout:
    store/ios/screenshots/en-US/<n>_<slug>.jpg                 1290x2796 (App Store 6.9" slot; scaled down for others)
    store/android/en-US/images/phoneScreenshots/<n>_<slug>.jpg 1080x1920 (Play: 9:16, within its 2:1 limit)
The capture is never altered, only scaled and placed under a caption. JPEG (both stores accept it) keeps the repo
small: camera noise makes these PNGs ~3 MB each.
"""
import pathlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent / "store"
RAW = ROOT / "screenshots" / "raw"
OUT = {
    "ios": (ROOT / "ios" / "screenshots" / "en-US", (1290, 2796)),
    "android": (ROOT / "android" / "en-US" / "images" / "phoneScreenshots", (1080, 1920)),
}
CAPTIONS = {
    "receiving": ("Point your phone at the screen", "A grid of QR codes, read at ~280 KB/s"),
    "saved": ("Checked, then saved", "SHA-256 verified before it's written"),
    "passphrase": ("Encrypt what matters", "AES-256-GCM with a passphrase you type"),
    "terminal": ("Works from a terminal", "Over SSH or with no browser: --tty"),
}
BG_TOP, BG_BOTTOM = (24, 26, 31), (8, 9, 11)
TITLE, SUB = (244, 244, 244), (160, 166, 176)


def font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    for path in ("/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            f = ImageFont.truetype(path, size)
            if bold and path.endswith("SFNS.ttf"):
                try:
                    f.set_variation_by_name("Semibold")
                except (OSError, ValueError):
                    pass
            return f
        except OSError:
            continue
    return ImageFont.load_default(size)


def gradient(size):
    w, h = size
    g = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        g.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)))
    return g.resize(size)


def rounded(im: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def compose(shot: Image.Image, size, title: str, sub: str) -> Image.Image:
    w, h = size
    canvas = gradient(size).convert("RGBA")
    d = ImageDraw.Draw(canvas)
    top = round(h * 0.055)
    tf, sf = font(round(w * 0.068), True), font(round(w * 0.04), False)
    for text, f, color, bold in ((title, tf, TITLE, True), (sub, sf, SUB, False)):
        while d.textlength(text, font=f) > w * 0.86:  # keep a margin on narrow canvases
            f = font(f.size - 2, bold)
        tw = d.textlength(text, font=f)
        d.text(((w - tw) / 2, top), text, font=f, fill=color)
        top += round(f.size * 1.35)
    # The capture, scaled to fit below the caption, with rounded corners and a soft shadow.
    room_h, room_w = h - top - round(h * 0.04), round(w * 0.84)
    scale = min(room_w / shot.width, room_h / shot.height)
    shot = shot.convert("RGB").resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    x, y = (w - shot.width) // 2, top + round(h * 0.02)
    radius = round(shot.width * 0.07)
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x, y + 12, x + shot.width, y + shot.height + 12), radius, fill=(0, 0, 0, 170))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(28)))
    framed = rounded(shot, radius)
    canvas.paste(framed, (x, y), framed)
    ImageDraw.Draw(canvas).rounded_rectangle((x, y, x + shot.width - 1, y + shot.height - 1), radius,
                                             outline=(70, 74, 82), width=3)
    return canvas.convert("RGB")


def main() -> None:
    for platform, (out_dir, size) in OUT.items():
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in [*out_dir.glob("*.png"), *out_dir.glob("*.jpg")]:
            old.unlink()
        for raw in sorted(RAW.glob(f"{platform}-*.jpg")):
            _, n, slug = raw.stem.split("-", 2)
            title, sub = CAPTIONS[slug]
            dest = out_dir / f"{n}_{slug}.jpg"
            compose(Image.open(raw), size, title, sub).save(dest, quality=92, optimize=True)
            print(dest.relative_to(ROOT.parent))


if __name__ == "__main__":
    main()
