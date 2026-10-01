"""Terminal sender (protocol v3): animated QR codes drawn in the terminal, for SSH sessions and headless shells with
no browser. Each character cell shows two modules with Unicode half blocks, in explicit black on white so codes
scan on dark themes too. Slower than the browser sender (character cells are coarse), but needs nothing else.
"""
import os
import secrets
import shutil
import sys
import time

from . import protocol_v3, qr

QUIET = 4                                     # quiet-zone modules around each code (ISO 18004 minimum)
VERSIONS = (25, 20, 15, 10, 7, 5, 3, 2)       # largest first
# speed preset -> (largest QR version, frames per second); terminals redraw far slower than a browser canvas
PRESETS = {"safe": (10, 5), "fast": (20, 8), "max": (25, 12)}
MAX_CODES = 6

INK, PAPER = "\x1b[38;5;16m", "\x1b[48;5;231m"  # true black on true white (256-colour palette)
RESET, HOME, CLEAR, HIDE, SHOW = "\x1b[0m", "\x1b[H", "\x1b[2J", "\x1b[?25l", "\x1b[?25h"


def enable_windows_vt() -> None:
    """Windows 10+ consoles understand ANSI sequences once virtual-terminal processing is switched on."""
    if os.name != "nt":
        return
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        handle = k32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint32()
        if k32.GetConsoleMode(handle, ctypes.byref(mode)):
            k32.SetConsoleMode(handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
    except Exception:
        pass


def can_draw_blocks(stream=None) -> bool:
    stream = stream or sys.stdout
    try:
        "▀▄█".encode(stream.encoding or "ascii")
        return True
    except (LookupError, UnicodeEncodeError):
        return False


def layout(cols: int, rows: int, max_version: int, half_blocks: bool = True):
    """The (version, across, down) that carries the most payload per frame in this window, larger codes winning ties;
    None if nothing fits. One row is kept for the status line."""
    best = None
    for v in VERSIONS:  # largest first, so ties keep the larger code
        if v > max_version:
            continue
        size = 17 + 4 * v + 2 * QUIET
        w = size if half_blocks else 2 * size
        h = (size + 1) // 2 if half_blocks else size
        across, down = cols // w, (rows - 1) // h
        if across < 1 or down < 1:
            continue
        while across * down > MAX_CODES:
            if across >= down:
                across -= 1
            else:
                down -= 1
        per_frame = across * down * (qr.capacity(v) - protocol_v3.OVERHEAD)  # payload, not raw capacity
        if best is None or per_frame > best[0]:
            best = (per_frame, v, across, down)
    return best and best[1:]


def render(grids, across: int, half_blocks: bool = True) -> str:
    """Codes laid out `across` per band, each with a white quiet zone, as terminal text."""
    out = []
    n = len(grids[0])
    size = n + 2 * QUIET

    def module(g, r, c):
        r, c = r - QUIET, c - QUIET
        return 0 <= r < n and 0 <= c < n and g[r][c]

    for b in range(0, len(grids), across):
        band = grids[b:b + across]
        if half_blocks:
            for r in range(0, size, 2):
                line = [PAPER, INK]
                for g in band:
                    for c in range(size):
                        top, bottom = module(g, r, c), r + 1 < size and module(g, r + 1, c)
                        line.append("█" if top and bottom else "▀" if top else "▄" if bottom else " ")
                out.append("".join(line) + RESET)
        else:  # no Unicode: two spaces per module, coloured by background
            dark, light = "\x1b[48;5;16m  ", "\x1b[48;5;231m  "
            for r in range(size):
                out.append("".join(dark if module(g, r, c) else light for g in band for c in range(size)) + RESET)
    return "\n".join(out)


def run(payload: bytes, flags: int, session: int, speed: str, label: str, out=None) -> None:
    """Draw codes until Ctrl-C. Resizing the window re-fits the codes; a different QR version starts a new session,
    which the receiver follows within 3 seconds (SPEC v3 §2)."""
    out = out or sys.stdout
    enable_windows_vt()
    half = can_draw_blocks(out)
    max_version, fps = PRESETS[speed]
    current = None  # (version, across, down, T, encoder)
    esi, shown, t0 = 0, 0, time.monotonic()
    out.write(HIDE + CLEAR)
    try:
        while True:
            start = time.monotonic()
            cols, rows = shutil.get_terminal_size((80, 24))
            fit = layout(cols, rows, max_version, half)
            if fit is None:
                out.write(HOME + CLEAR + "Terminal too small for a QR code: make it at least 45x24, or use the browser sender.")
                out.flush()
                time.sleep(0.5)
                continue
            v, across, down = fit
            if current is None or current[0] != v:
                T = qr.capacity(v) - protocol_v3.OVERHEAD
                if current is not None:
                    session = secrets.randbits(32)
                current, esi = (v, across, down, T, protocol_v3.Encoder(payload, T)), 0
                out.write(CLEAR)
            elif current[1:3] != (across, down):
                current = (v, across, down) + current[3:]
                out.write(CLEAR)
            _, across, down, T, enc = current
            grids = []
            for _ in range(across * down):
                code = protocol_v3.encode_code(session, len(payload), T, esi, enc.symbol(esi), flags)
                grids.append(qr.encode(code, v, "L", 2))
                esi += 1
            shown += 1
            rate = shown / max(time.monotonic() - t0, 1e-3)
            status = (f" qbeam · {label} · {across * down}× v{v} · {rate:.0f} fps · "
                      f"~{across * down * T * rate / 1024:.0f} KB/s offered · Ctrl-C to stop ")
            out.write(HOME + render(grids, across, half) + "\n" + status[:cols] + "\x1b[K")
            out.flush()
            time.sleep(max(0.0, 1 / fps - (time.monotonic() - start)))
    except KeyboardInterrupt:
        pass
    finally:
        out.write(RESET + SHOW + CLEAR + HOME)
        out.flush()
