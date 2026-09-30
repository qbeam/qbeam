# protocol

Wire format shared by every sender and receiver.

- [`SPEC.md`](SPEC.md) — the protocol. v2 is what qbeam 0.0.x sends; v3 (binary frames, sparse fountain code) is next.
- [`test-vectors/v2.json`](test-vectors/v2.json) — fountain symbols and exact frame text. Every codec must reproduce them.
  Generated from `js/fountain.js` by `test-vectors/generate.js`; `py/tests/test_protocol_v2.py` checks them against
  an implementation written only from the spec. CI fails if the reference codec stops matching.
