# qbeam protocol

This document is normative for every qbeam sender and receiver (Python, JS, Kotlin, Swift, Go).
Test vectors in [`test-vectors/`](test-vectors/) are part of the spec: an implementation is conforming only
if it reproduces them exactly.

- **v3** (below) replaces v2: binary codes, one fountain symbol per QR code, a segmented fountain code for large
  files, and the file metadata inside the payload. Draft: not yet implemented by any sender.
- **v2** is what qbeam 0.0.x sends today. Frame prefix `Q2`.
- **v1** (prefix `Q1`) predates the fountain code. Receivers must recognise it only to tell the user to regenerate
  the sender page.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

---

## v3 (draft)

### 1. Overview

Every QR code is self-contained: it carries a small header, one fountain symbol and a checksum. How many codes a
sender shows at once, and how fast, is the sender's business; receivers treat codes independently and never need
to know the grid.

```
file ──(optional gzip)──▶ container ──split──▶ K blocks in S segments ──fountain──▶ symbols 0,1,2,…
                           filename, SHA-256                                          │
                                                                                      ▼
                                             QR code = header (18 B) + symbol (T B) + CRC-32 (4 B)
```

All integers are big-endian and unsigned.

### 2. Code format

| Offset | Size | Field | Value |
| --- | --- | --- | --- |
| 0 | 2 | magic | `0xB3 0x71` (not ASCII, so never confused with v1/v2 text frames) |
| 2 | 1 | version | `3` |
| 3 | 1 | flags | bits 0–3: must-understand; bits 4–7: may be ignored. None defined yet: senders MUST send 0 |
| 4 | 4 | session | random per transfer |
| 8 | 4 | L | payload (container) length in bytes |
| 12 | 2 | T | symbol size in bytes, ≥ 1 |
| 14 | 4 | ESI | encoding symbol id |
| 18 | T | symbol | the fountain symbol |
| 18 + T | 4 | CRC | CRC-32 (IEEE 802.3, as zlib's `crc32`) of bytes `0 … 18+T−1` |

A code is therefore exactly `T + 22` bytes. It is carried in a single byte-mode QR segment. Senders SHOULD use
error-correction level L and a fixed mask pattern (mask evaluation is optional in ISO 18004 and costs ~17× the
encoding time); receivers MUST accept any level and mask.

**Receiver checks, in order.** A code whose first two bytes aren't the magic is not qbeam v3 and MUST be ignored
(it may be v1/v2, see those sections). Then:

1. `version ≠ 3`: ignore, and SHOULD tell the user the sender is newer or older than this receiver.
2. Length `≠ T + 22`: ignore.
3. CRC mismatch: ignore.
4. Any must-understand flag bit set that this receiver doesn't implement: ignore, and SHOULD tell the user.

**Session identity** is the tuple (`session`, `L`, `T`, must-understand flag bits). Session adoption follows the v2
rule (§v2.6): a code from a different session replaces the current one only if the current one is idle (none,
finished, or no symbols accepted yet).

### 3. Segments

`K = max(1, ceil(L / T))` source blocks. Block *i* is payload bytes `[i·T, (i+1)·T)`, zero-padded to T bytes.

The blocks are split into `S = ceil(K / KMAX)` segments, **KMAX = 2048**, as evenly as possible: with
`base = floor(K / S)` and `extra = K mod S`, segment *s* (0-based) has `base + 1` blocks if `s < extra`, else
`base`, and segments are contiguous in block order. Each segment is an independent code: symbols of one segment
never involve blocks of another.

### 4. Symbols

Each ESI belongs to exactly one segment:

- **ESI < K (source symbol):** the segment containing block ESI; the symbol is that block.
- **ESI ≥ K (repair symbol):** with `r = ESI − K`, segment `s = r mod S` and repair index `j = floor(r / S)`.
  Repair symbols therefore rotate through the segments.

A repair symbol is the XOR of the blocks of segment *s* selected by its coefficient vector, an `n`-bit vector where
`n` is the segment's block count:

1. `W = ceil(n / 32)`.
2. Seed mulberry32 (§v2.4, same generator) with
   `seed = imul(j + 1, 0x9E3779B1) XOR imul(s + 1, 0x85EBCA6B) XOR n`, as a 32-bit unsigned value.
3. Draw `W` 32-bit words; bit *b* of word *w* (least significant first) selects the segment's block `32·w + b`.
4. If `n mod 32 ≠ 0`, clear the bits of the last word at positions ≥ `n mod 32`.
5. If every word is zero, select only block `j mod n`.

Senders MUST emit ESIs 0, 1, 2, … in increasing order without repeating, so every source block goes out once,
then repair symbols forever. Receivers MUST accept symbols in any order and ignore duplicate ESIs. A segment
decodes once its accepted symbols have rank n over GF(2); in practice about n + 2 symbols. With 20% random loss,
the whole payload needed 0.5% more symbols than K for a 10 MB file and 2.2% for 40 MB
(`bench/protocol/fountain_v3.js`).

### 5. Container (the payload)

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 1 | container version, `1` |
| 1 | 1 | encoding: `0` = save the data as-is; `1` = gzip, the receiver MUST gunzip before saving |
| 2 | 2 | filename length *n* in bytes |
| 4 | n | filename, UTF-8 |
| 4 + n | 32 | SHA-256 of the bytes the receiver saves (after gunzip for encoding 1) |
| 36 + n | rest | data |

The receiver MUST verify the SHA-256 before saving. On mismatch it MUST NOT save and SHOULD restart the session.
Filenames are untrusted: receivers MUST strip path components and reject `.` and `..`.

Senders choose compression; the container says only how to undo it. xz archives are sent with encoding 0 and a
`.xz` filename, as in v2.

### 6. Choosing T

T should fill the QR code: `T = (byte capacity of the chosen version at level L) − 22`. The speed spike's best
configuration (3×2 grid of version 30, level L) gives `T = 1732 − 22 = 1710`. zxing-cpp's encoder adds an ECI
marker for binary data that costs a few bytes; senders using it must leave room for that.

### 7. Not yet decided

- **Encryption** (PLAN P0.6): will use a must-understand flag bit, so older receivers refuse encrypted codes
  instead of saving ciphertext.

---

## v2

### 1. Overview

The channel is one-way: a sender shows a looping sequence of QR codes; a receiver films it. The receiver never
talks back, so the sender repeats forever and the receiver decides when it has enough.

```
file ──compress──▶ payload ──split──▶ K source blocks ──fountain──▶ symbols 0,1,2,…  ─┐
                     │                                                                 ├─▶ QR frames
                     └── SHA-256, filename, encoding ───────────────▶ header ─────────┘
```

### 2. Payload

The payload is the compressed file. The sender chooses one encoding:

| `encoding` | Payload | Filename the receiver saves | Receiver action |
| --- | --- | --- | --- |
| `gz` | gzip stream (RFC 1952) of the file | the original name | MUST gunzip, then save |
| `raw` | bytes saved as-is (used for xz) | the name in the header, e.g. `notes.txt.xz` or `proj.tar.xz` | MUST save unchanged |

Current senders produce:

- single file, gzip (default): `encoding=gz`, filename = original name. Python uses level 9, `mtime=0`.
- single file, `--compress xz`: `encoding=raw`, filename = original name + `.xz`.
- folder, `--archive`: a POSIX tar (PAX format, uid/gid 0, empty user/group names) of the folder, compressed with xz
  (default) or gzip. xz gives `encoding=raw` and filename `<folder>.tar.xz`; gzip gives `encoding=gz` and
  filename `<folder>.tar`.

Compression settings are not part of the protocol; receivers MUST NOT depend on them.

`sha` is the lowercase hex SHA-256 of the **payload** (the compressed bytes), not of the original file.

### 3. Session

A session is one payload. Its identity is the tuple (`id`, `K`, `len`):

| Field | Meaning |
| --- | --- |
| `id` | 6 characters from `[A-Za-z0-9]`, chosen at random per sender page |
| `len` | payload length in bytes (decimal) |
| `blockSize` | bytes per source block; senders default to 300. Not sent explicitly: receivers infer it from the first data frame's decoded block length |
| `K` | number of source blocks, `max(1, ceil(len / blockSize))` (decimal) |

### 4. Fountain code

Source block *i* (0 ≤ *i* < K) is payload bytes `[i·blockSize, (i+1)·blockSize)`, zero-padded to `blockSize`.
An empty payload has K = 1 and one all-zero block.

Each data frame carries one encoding symbol, identified by its ESI (encoding symbol id, 0, 1, 2, …). A symbol is the
XOR of the source blocks selected by its coefficient vector c(ESI, K), a K-bit vector:

- **ESI < K (systematic):** c has only bit ESI set. The symbol is source block ESI.
- **ESI ≥ K (repair):**
  1. `W = ceil(K / 32)`.
  2. Seed a mulberry32 generator (below) with `seed = (imul(ESI, 0x9E3779B1) XOR K)` as a 32-bit integer.
  3. Draw W 32-bit words `w[0] … w[W−1]` from it, in order.
  4. Bit *j* of word *w* (least significant bit first) selects source block `32·w + j`.
  5. If `K mod 32 ≠ 0`, clear the bits of `w[W−1]` at positions ≥ `K mod 32`.
  6. If every word is now zero, select only block `ESI mod K`.

`imul` is 32-bit wrapping multiplication (JavaScript `Math.imul`); all arithmetic is modulo 2³², and the seed is
used as an unsigned 32-bit value. mulberry32, with state `a` initialised to the seed, returns each word as:

```
a = (a + 0x6D2B79F5) mod 2^32
t = imul(a XOR (a >>> 15), 1 OR a)
t = (t + imul(t XOR (t >>> 7), 61 OR t)) XOR t
return (t XOR (t >>> 14)) >>> 0
```

(`>>>` is an unsigned right shift.)

Senders MUST emit ESIs 0, 1, 2, … in increasing order without repeating, so the source blocks go out first,
then repair symbols forever. Receivers MUST NOT assume any order: any set of symbols whose coefficient vectors
have rank K over GF(2) reconstructs the payload. In practice about K + 2 distinct symbols suffice.

### 5. Frames

Each QR code carries one frame: a 3-character prefix followed by `|`-separated fields. Every field is ASCII and
none can contain `|`.

**Header frame** (6 fields):

```
Q2H<id>|<K>|<len>|<sha>|<filenameB64>|<encoding>
```

`filenameB64` is standard base64 (RFC 4648, with `=` padding) of the UTF-8 filename.

**Data frame** (5 fields):

```
Q2D<id>|<K>|<len>|<esi>|<symbolB64>
```

`esi` is decimal; `symbolB64` is standard base64 of the `blockSize` symbol bytes.

**Schedule.** Senders show frames in slots 0, 1, 2, …. A slot divisible by 10 shows the header; every other slot
shows the next data frame. Slot 0 is therefore a header. Senders SHOULD show a new slot every 350 ms by default
and MAY let the user choose 100–1000 ms.

**QR encoding.** Current senders encode each frame as a single byte-mode segment, ISO-8859-1 (every character
is ASCII), error-correction level M, at the smallest QR version that fits. Receivers MUST accept any version,
error-correction level and mode that decodes to the same text.

### 6. Receiver behaviour

- A frame whose text doesn't start with `Q2H` or `Q2D`, or whose field count is wrong, or whose `K` isn't a
  positive integer or `len` isn't a non-negative integer, MUST be ignored.
- A `Q1H`/`Q1D` frame SHOULD produce a message telling the user to regenerate the sender page.
- **Session adoption:** a frame from a different (`id`, `K`, `len`) replaces the current session only if the
  current one is idle: no session, already finished, or no symbols accepted yet. Otherwise it is ignored, so a
  second sender in view can't disrupt a transfer in progress.
- Data frames MUST be accepted before the header arrives. The first data frame fixes `blockSize`; a data frame
  whose symbol length differs MUST be ignored. Duplicate ESIs MUST be ignored.
- The header is needed only to finish: it supplies `sha`, the filename and `encoding`. The first header of a
  session wins.
- When the decoder has rank K and a header has arrived, the receiver reconstructs the payload (length `len`,
  padding dropped) and checks its SHA-256 against `sha`.
  - **Match:** decode per `encoding` (§2) and save under the header filename.
  - **Mismatch:** MUST NOT save; SHOULD discard the session and start again from the next frames.
- Receivers MUST NOT let the header filename choose a directory. Browser downloads already strip paths; native
  receivers MUST strip any path components and reject `.`/`..`.

### 7. Known limits of v2 (motivating v3)

- Base64 inside byte-mode QR wastes 25% of every frame.
- The dense GF(2) code needs O(K²) work to decode, too slow for multi-MB payloads at high frame rates.
- One small code per slot at ~3 slots/s gives about 0.8 KB/s at defaults; see PLAN P2 for the speed targets.
- No per-frame checksum beyond QR's own error correction; a misread symbol only shows up as a SHA-256 mismatch
  at the end, which costs the whole transfer.
- The header takes 10% of slots and carries no protocol version beyond the prefix.
