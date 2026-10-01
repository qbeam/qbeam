"""Build docs/media/senders.gif for the README: the browser sender and the terminal sender side by side, sending the
same file. Both halves are real output:

- browser: frames recorded from the live sender page's canvas (qbeam send <file> --speed max, saved as
  <frames>/browser-NNN.png, 960 px wide, consecutive distinct frames);
- terminal: the exact text terminal.py prints for a 250x66 window (full screen, small font) at --speed max, drawn
  cell by cell (half blocks as pixels, the status line in a monospace font).

    uv run --with pillow python scripts/readme_media.py <payload-file> <frames-dir>
"""
import pathlib
import secrets
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "py" / "src"))
from qbeam import cli, protocol_v3, qr, terminal  # noqa: E402

COLS, ROWS, CELL_W, CELL_H = 250, 66, 4, 8           # terminal grid and pixel size of one character cell
PANEL_W, BAR_H, CAPTION_H, GAP = 600, 30, 34, 20
FRAMES = 12  # QR noise barely compresses: keep the GIF to a couple of MB
BG, CHROME, CHROME_TEXT, CAPTION = (17, 18, 20), (44, 46, 51), (190, 194, 200), (160, 166, 176)
FONT = "/System/Library/Fonts/Menlo.ttc"


def terminal_frames(payload: bytes, label: str, n: int):
    v, across, down = terminal.layout(COLS, ROWS, terminal.PRESETS["max"][0])
    fps = terminal.PRESETS["max"][1]
    T = qr.capacity(v) - protocol_v3.OVERHEAD
    enc, session, esi = protocol_v3.Encoder(payload, T), secrets.randbits(32), 0
    status = f" qbeam · {label} · {across * down}× v{v} · {fps} fps · ~{across * down * T * fps / 1024:.0f} KB/s offered"
    for _ in range(n):
        grids = []
        for _ in range(across * down):
            grids.append(qr.encode(protocol_v3.encode_code(session, len(payload), T, esi, enc.symbol(esi)), v, "L", 2))
            esi += 1
        text = terminal.render(grids, across, half_blocks=True)
        lines = [ln.replace(terminal.PAPER, "").replace(terminal.INK, "").replace(terminal.RESET, "") for ln in text.split("\n")]
        img = Image.new("RGB", (COLS * CELL_W, len(lines) * CELL_H), BG)
        d = ImageDraw.Draw(img)
        x0 = (COLS - len(lines[0])) // 2 * CELL_W
        for r, line in enumerate(lines):
            for c, ch in enumerate(line):
                x, y = x0 + c * CELL_W, r * CELL_H
                top = (0, 0, 0) if ch in "█▀" else (255, 255, 255)
                bottom = (0, 0, 0) if ch in "█▄" else (255, 255, 255)
                d.rectangle((x, y, x + CELL_W - 1, y + CELL_H // 2 - 1), fill=top)
                d.rectangle((x, y + CELL_H // 2, x + CELL_W - 1, y + CELL_H - 1), fill=bottom)
        yield img, f"Terminal (--tty) · {across * down} codes, {fps} fps", status


def window(content: Image.Image, title: str, caption: str, status: str = "") -> Image.Image:
    # Nearest neighbour keeps modules pure black and white (smoothing adds greys that bloat the GIF).
    content = content.resize((PANEL_W, round(content.height * PANEL_W / content.width)), Image.NEAREST)
    if status:  # the terminal's status line, drawn at display size so it stays readable
        strip = Image.new("RGB", (PANEL_W, content.height + 22), BG)
        strip.paste(content, (0, 0))
        ImageDraw.Draw(strip).text((4, content.height + 4), status, font=ImageFont.truetype(FONT, 11), fill=(220, 220, 220))
        content = strip
    out = Image.new("RGB", (PANEL_W, BAR_H + content.height + CAPTION_H), BG)
    d = ImageDraw.Draw(out)
    d.rounded_rectangle((0, 0, PANEL_W - 1, BAR_H + 8), 10, fill=CHROME)
    for i, col in enumerate(((255, 95, 87), (254, 188, 46), (40, 200, 64))):
        d.ellipse((14 + i * 20, 10, 26 + i * 20, 22), fill=col)
    small = ImageFont.truetype(FONT, 13)
    d.text((84, 8), title, font=small, fill=CHROME_TEXT)
    out.paste(content, (0, BAR_H))
    d.text((6, BAR_H + content.height + 10), caption, font=ImageFont.truetype(FONT, 14), fill=CAPTION)
    return out


def main() -> None:
    payload_file, frames_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    raw = payload_file.read_bytes()
    payload = cli.prepare(raw, payload_file.name, "gzip")["payload"]
    browser = sorted(frames_dir.glob("browser-*.png"))[:FRAMES]
    frames = []
    for b, (term, term_caption, status) in zip(browser, terminal_frames(payload, payload_file.name, len(browser))):
        left = window(Image.open(b).convert("RGB"), f"{payload_file.name}.sender.html", "Browser page · 3×2 codes, 30 fps")
        right = window(term, "Terminal · qbeam send --tty", term_caption, status)
        h = max(left.height, right.height)
        frame = Image.new("RGB", (2 * PANEL_W + GAP, h), BG)
        frame.paste(left, (0, 0))
        frame.paste(right, (PANEL_W + GAP, 0))
        frames.append(frame.quantize(colors=8, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    out = ROOT / "docs" / "media" / "senders.gif"
    out.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=150, loop=0, optimize=True)
    print(out.relative_to(ROOT), frames[0].size, f"{out.stat().st_size // 1024} KB", len(frames), "frames")


if __name__ == "__main__":
    main()
