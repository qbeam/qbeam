"""Minimal QR Code encoder (ISO/IEC 18004): one byte-mode segment, error-correction level L or M, a given version
and mask. Stdlib only, used by terminal mode.

It produces module grids identical to web/vendor/qrcodegen.js for the same inputs (checked by
py/tests/test_qr.py against vectors from that library), so the terminal and the browser draw the same codes.
"""
from typing import List

# Reed-Solomon block structure per version 1..40: (blocks, total codewords, data codewords) repeated per group.
RS_BLOCKS = {
    "L": (
    (1, 26, 19), (1, 44, 34), (1, 70, 55), (1, 100, 80),
    (1, 134, 108), (2, 86, 68), (2, 98, 78), (2, 121, 97),
    (2, 146, 116), (2, 86, 68, 2, 87, 69), (4, 101, 81), (2, 116, 92, 2, 117, 93),
    (4, 133, 107), (3, 145, 115, 1, 146, 116), (5, 109, 87, 1, 110, 88), (5, 122, 98, 1, 123, 99),
    (1, 135, 107, 5, 136, 108), (5, 150, 120, 1, 151, 121), (3, 141, 113, 4, 142, 114), (3, 135, 107, 5, 136, 108),
    (4, 144, 116, 4, 145, 117), (2, 139, 111, 7, 140, 112), (4, 151, 121, 5, 152, 122), (6, 147, 117, 4, 148, 118),
    (8, 132, 106, 4, 133, 107), (10, 142, 114, 2, 143, 115), (8, 152, 122, 4, 153, 123), (3, 147, 117, 10, 148, 118),
    (7, 146, 116, 7, 147, 117), (5, 145, 115, 10, 146, 116), (13, 145, 115, 3, 146, 116), (17, 145, 115),
    (17, 145, 115, 1, 146, 116), (13, 145, 115, 6, 146, 116), (12, 151, 121, 7, 152, 122), (6, 151, 121, 14, 152, 122),
    (17, 152, 122, 4, 153, 123), (4, 152, 122, 18, 153, 123), (20, 147, 117, 4, 148, 118), (19, 148, 118, 6, 149, 119),
    ),
    "M": (
    (1, 26, 16), (1, 44, 28), (1, 70, 44), (2, 50, 32),
    (2, 67, 43), (4, 43, 27), (4, 49, 31), (2, 60, 38, 2, 61, 39),
    (3, 58, 36, 2, 59, 37), (4, 69, 43, 1, 70, 44), (1, 80, 50, 4, 81, 51), (6, 58, 36, 2, 59, 37),
    (8, 59, 37, 1, 60, 38), (4, 64, 40, 5, 65, 41), (5, 65, 41, 5, 66, 42), (7, 73, 45, 3, 74, 46),
    (10, 74, 46, 1, 75, 47), (9, 69, 43, 4, 70, 44), (3, 70, 44, 11, 71, 45), (3, 67, 41, 13, 68, 42),
    (17, 68, 42), (17, 74, 46), (4, 75, 47, 14, 76, 48), (6, 73, 45, 14, 74, 46),
    (8, 75, 47, 13, 76, 48), (19, 74, 46, 4, 75, 47), (22, 73, 45, 3, 74, 46), (3, 73, 45, 23, 74, 46),
    (21, 73, 45, 7, 74, 46), (19, 75, 47, 10, 76, 48), (2, 74, 46, 29, 75, 47), (10, 74, 46, 23, 75, 47),
    (14, 74, 46, 21, 75, 47), (14, 74, 46, 23, 75, 47), (12, 75, 47, 26, 76, 48), (6, 75, 47, 34, 76, 48),
    (29, 74, 46, 14, 75, 47), (13, 74, 46, 32, 75, 47), (40, 75, 47, 7, 76, 48), (18, 75, 47, 31, 76, 48),
    ),
}
FORMAT_ECC_BITS = {"L": 1, "M": 0}

# Alignment pattern centre coordinates per version 1..40.
ALIGNMENT = (
    (), (6, 18), (6, 22), (6, 26), (6, 30),
    (6, 34), (6, 22, 38), (6, 24, 42), (6, 26, 46), (6, 28, 50),
    (6, 30, 54), (6, 32, 58), (6, 34, 62), (6, 26, 46, 66), (6, 26, 48, 70),
    (6, 26, 50, 74), (6, 30, 54, 78), (6, 30, 56, 82), (6, 30, 58, 86), (6, 34, 62, 90),
    (6, 28, 50, 72, 94), (6, 26, 50, 74, 98), (6, 30, 54, 78, 102), (6, 28, 54, 80, 106), (6, 32, 58, 84, 110),
    (6, 30, 58, 86, 114), (6, 34, 62, 90, 118), (6, 26, 50, 74, 98, 122), (6, 30, 54, 78, 102, 126), (6, 26, 52, 78, 104, 130),
    (6, 30, 56, 82, 108, 134), (6, 34, 60, 86, 112, 138), (6, 30, 58, 86, 114, 142), (6, 34, 62, 90, 118, 146), (6, 30, 54, 78, 102, 126, 150),
    (6, 24, 50, 76, 102, 128, 154), (6, 28, 54, 80, 106, 132, 158), (6, 32, 58, 84, 110, 136, 162), (6, 26, 54, 82, 110, 138, 166), (6, 30, 58, 86, 114, 142, 170),
)

_EXP = [0] * 512
_LOG = [0] * 256
_x = 1
for _i in range(255):
    _EXP[_i] = _x
    _LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    _EXP[_i] = _EXP[_i - 255]


def _generator(degree: int) -> List[int]:
    g = [1]
    for i in range(degree):
        nxt = [0] * (len(g) + 1)
        for j, c in enumerate(g):
            nxt[j] ^= c
            if c:
                nxt[j + 1] ^= _EXP[_LOG[c] + i]
        g = nxt
    return g


def _rs_remainder(data: List[int], degree: int) -> List[int]:
    gen = _generator(degree)
    rem = list(data) + [0] * degree
    for i in range(len(data)):
        c = rem[i]
        if c:
            lc = _LOG[c]
            for j in range(1, degree + 1):
                if gen[j]:
                    rem[i + j] ^= _EXP[lc + _LOG[gen[j]]]
    return rem[len(data):]


def capacity(version: int, ecc: str = "L") -> int:
    """Byte-mode payload capacity in bytes."""
    t = RS_BLOCKS[ecc][version - 1]
    data_cw = sum(t[i] * t[i + 2] for i in range(0, len(t), 3))
    return (data_cw * 8 - 4 - (8 if version < 10 else 16)) // 8


def _codewords(data: bytes, version: int, ecc: str) -> List[int]:
    t = RS_BLOCKS[ecc][version - 1]
    blocks = [(t[i + 1], t[i + 2]) for i in range(0, len(t), 3) for _ in range(t[i])]
    data_cw = sum(d for _, d in blocks)
    if len(data) > capacity(version, ecc):
        raise ValueError(f"{len(data)} bytes don't fit version {version}-{ecc}")
    bits = []
    def put(v, n):
        bits.extend((v >> (n - 1 - k)) & 1 for k in range(n))
    put(0b0100, 4)
    put(len(data), 8 if version < 10 else 16)
    for b in data:
        put(b, 8)
    put(0, min(4, data_cw * 8 - len(bits)))
    if len(bits) % 8:
        put(0, 8 - len(bits) % 8)
    stream = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    pad = (0xEC, 0x11)
    while len(stream) < data_cw:
        stream.append(pad[(len(stream) - len(bits) // 8) % 2])
    dblocks, eblocks, pos = [], [], 0
    for total, dcount in blocks:
        dblocks.append(stream[pos:pos + dcount])
        eblocks.append(_rs_remainder(stream[pos:pos + dcount], total - dcount))
        pos += dcount
    out = []
    for i in range(max(len(b) for b in dblocks)):
        out.extend(b[i] for b in dblocks if i < len(b))
    for i in range(max(len(b) for b in eblocks)):
        out.extend(b[i] for b in eblocks if i < len(b))
    return out


def _bch(value: int, poly: int, poly_bits: int) -> int:
    v = value << (poly_bits - 1)
    while v.bit_length() >= poly_bits:
        v ^= poly << (v.bit_length() - poly_bits)
    return (value << (poly_bits - 1)) | v


_MASKS = (
    lambda i, j: (i + j) % 2 == 0,
    lambda i, j: i % 2 == 0,
    lambda i, j: j % 3 == 0,
    lambda i, j: (i + j) % 3 == 0,
    lambda i, j: (i // 2 + j // 3) % 2 == 0,
    lambda i, j: (i * j) % 2 + (i * j) % 3 == 0,
    lambda i, j: ((i * j) % 2 + (i * j) % 3) % 2 == 0,
    lambda i, j: ((i * j) % 3 + (i + j) % 2) % 2 == 0,
)


def encode(data: bytes, version: int, ecc: str = "L", mask: int = 2) -> List[List[bool]]:
    """Module grid (rows of booleans, True = dark) for `data` in one byte-mode segment."""
    n = 17 + 4 * version
    m = [[None] * n for _ in range(n)]  # None = not yet placed (data area)

    def finder(r0, c0):
        for r in range(-1, 8):
            for c in range(-1, 8):
                rr, cc = r0 + r, c0 + c
                if 0 <= rr < n and 0 <= cc < n:
                    m[rr][cc] = (0 <= r <= 6 and c in (0, 6)) or (0 <= c <= 6 and r in (0, 6)) or (2 <= r <= 4 and 2 <= c <= 4)
    finder(0, 0)
    finder(0, n - 7)
    finder(n - 7, 0)
    # Alignment patterns before the timing pattern: centres on row/column 6 (version 7+) are drawn, only those
    # overlapping a finder pattern are skipped.
    pos = ALIGNMENT[version - 1]
    for r in pos:
        for c in pos:
            if m[r][c] is not None:
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    m[r + dr][c + dc] = max(abs(dr), abs(dc)) != 1
    for i in range(8, n - 8):
        if m[6][i] is None:
            m[6][i] = i % 2 == 0
        if m[i][6] is None:
            m[i][6] = i % 2 == 0
    # Format information: ECC level bits and mask, BCH(15,5), XOR mask.
    fmt = _bch((FORMAT_ECC_BITS[ecc] << 3) | mask, 0b10100110111, 11) ^ 0b101010000010010
    for i in range(15):
        bit = (fmt >> i) & 1 == 1
        if i < 6:
            m[i][8] = bit
        elif i < 8:
            m[i + 1][8] = bit
        else:
            m[n - 15 + i][8] = bit
        if i < 8:
            m[8][n - i - 1] = bit
        elif i < 9:
            m[8][15 - i - 1 + 1] = bit
        else:
            m[8][15 - i - 1] = bit
    m[n - 8][8] = True  # dark module
    if version >= 7:
        ver = _bch(version, 0b1111100100101, 13)
        for i in range(18):
            bit = (ver >> i) & 1 == 1
            m[i // 3][i % 3 + n - 8 - 3] = bit
            m[i % 3 + n - 8 - 3][i // 3] = bit
    # Data: zigzag from the bottom-right, two columns at a time, skipping the vertical timing column.
    bits = []
    for cw in _codewords(bytes(data), version, ecc):
        bits.extend((cw >> (7 - k)) & 1 == 1 for k in range(8))
    masked = _MASKS[mask]
    idx, row, inc, col = 0, n - 1, -1, n - 1
    while col > 0:
        if col == 6:
            col -= 1
        while True:
            for c in (col, col - 1):
                if m[row][c] is None:
                    dark = bits[idx] if idx < len(bits) else False
                    idx += 1
                    m[row][c] = dark != masked(row, c)
            row += inc
            if row < 0 or row >= n:
                row -= inc
                inc = -inc
                break
        col -= 2
    return m
