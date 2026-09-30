# protocol

Wire format shared by every sender and receiver.

- [`SPEC.md`](SPEC.md) — the protocol. **v3** (draft): binary codes, one fountain symbol per QR code, segmented
  fountain code, metadata in a container. **v2**: what qbeam 0.0.x sends today.
- [`test-vectors/`](test-vectors/) — every codec must reproduce these exactly.
  - `v2.json` from `js/fountain.js` (`generate.js`); checked by `py/tests/test_protocol_v2.py`.
  - `v3.json` from `js/qbeam3.js` (`generate_v3.js`); checked by `py/tests/test_protocol_v3.py` (the Python encoder,
    written from the spec) and `js/test/v3.js`.
  CI fails if a reference codec stops matching its vectors.
