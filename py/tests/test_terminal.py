"""Terminal mode: rendered text must map back to exactly the QR modules, layouts must fit, and the animation loop
must draw frames and restore the terminal when stopped."""
import io
import os
import pathlib
import re
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))

from qbeam import protocol_v3, qr, terminal  # noqa: E402

ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def parse_half_blocks(text: str, codes: int, n: int):
    """Inverse of terminal.render for half blocks: text -> list of module grids (bands of `codes` across)."""
    size = n + 2 * terminal.QUIET
    lines = [ANSI.sub("", line) for line in text.split("\n")]
    grids = [[[False] * n for _ in range(n)] for _ in range(codes)]
    for li, line in enumerate(lines):
        for x, ch in enumerate(line):
            g, c = divmod(x, size)
            top, bottom = ch in "█▀", ch in "█▄"
            for r, dark in ((2 * li, top), (2 * li + 1, bottom)):
                rr, cc = r - terminal.QUIET, c - terminal.QUIET
                if 0 <= rr < n and 0 <= cc < n:
                    grids[g][rr][cc] = dark
    return grids


class RenderTest(unittest.TestCase):
    def test_half_block_render_round_trips(self):
        grids = [qr.encode(os.urandom(qr.capacity(v) - 5), v) for v in (5, 5)]
        text = terminal.render(grids, across=2, half_blocks=True)
        self.assertEqual(parse_half_blocks(text, 2, len(grids[0])), grids)
        size = len(grids[0]) + 2 * terminal.QUIET
        self.assertEqual(max(len(ANSI.sub("", line)) for line in text.split("\n")), 2 * size)
        self.assertEqual(len(text.split("\n")), (size + 1) // 2)

    def test_two_space_fallback_round_trips(self):
        grid = qr.encode(b"no unicode here", 2)
        text = terminal.render([grid], across=1, half_blocks=False)
        n, q = len(grid), terminal.QUIET
        dark = re.compile(r"\x1b\[48;5;(16|231)m  ")
        for r, line in enumerate(text.split("\n")):
            cells = [m.group(1) == "16" for m in dark.finditer(line)]
            self.assertEqual(len(cells), n + 2 * q)
            for c, d in enumerate(cells):
                rr, cc = r - q, c - q
                self.assertEqual(d, 0 <= rr < n and 0 <= cc < n and grid[rr][cc])

    def test_layout_fits_and_prefers_payload(self):
        for cols, rows in [(80, 24), (120, 40), (200, 60), (300, 80)]:
            v, across, down = terminal.layout(cols, rows, 25)
            size = 17 + 4 * v + 2 * terminal.QUIET
            self.assertLessEqual(across * size, cols)
            self.assertLessEqual(down * ((size + 1) // 2) + 1, rows)
            self.assertLessEqual(across * down, terminal.MAX_CODES)
        self.assertEqual(terminal.layout(80, 24, 25), (5, 1, 1))
        self.assertIsNone(terminal.layout(30, 10, 25))

    def test_run_draws_frames_and_restores_terminal(self):
        payload = os.urandom(3000)
        out = io.StringIO()
        frames = {"n": 0}

        def sleep(_):
            frames["n"] += 1
            if frames["n"] >= 3:
                raise KeyboardInterrupt

        with mock.patch.object(terminal.shutil, "get_terminal_size", return_value=os.terminal_size((120, 40))), \
                mock.patch.object(terminal.time, "sleep", side_effect=sleep), \
                mock.patch.object(terminal, "can_draw_blocks", return_value=True):
            terminal.run(payload, 0, 0x1234, "fast", "test.bin", out=out)
        text = out.getvalue()
        self.assertEqual(text.count(terminal.HOME + terminal.PAPER), 3)  # three frames drawn
        self.assertIn("qbeam · test.bin", text)
        self.assertTrue(text.endswith(terminal.RESET + terminal.SHOW + terminal.CLEAR + terminal.HOME))
        # The first frame's codes are ESIs 0..k-1 of this payload: check the first one decodes to the right bytes.
        v, across, down = terminal.layout(120, 40, terminal.PRESETS["fast"][0])
        n = 17 + 4 * v
        first = text.split(terminal.HOME, 2)[1].split("\n qbeam")[0]
        grids = parse_half_blocks(first, across, n)
        T = qr.capacity(v) - protocol_v3.OVERHEAD
        expect = protocol_v3.encode_code(0x1234, len(payload), T, 0, protocol_v3.Encoder(payload, T).symbol(0))
        self.assertEqual(grids[0], qr.encode(expect, v))


if __name__ == "__main__":
    unittest.main()
