# py

Python sender. Today: `encode.py` (stdlib only), which builds a self-contained sender page from `../web` and `../js`.

```bash
python3 py/encode.py path/to/file
```

Next (PLAN P1): package as `<name>` with `send` / `receive` commands, terminal mode, and a single-file `.pyz`. Must stay stdlib-only at runtime.
