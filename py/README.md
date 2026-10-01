# qbeam

Move a file from a locked-down machine to your phone over animated QR codes. No network, no USB,
no admin rights, and nothing to install on the receiving side. Transfers are verified with SHA-256.

```bash
uvx qbeam send app.log        # or: pipx install qbeam
uvx qbeam send ./project      # a folder goes as one .tar.xz; .gitignore respected
```

1. `qbeam send <file>` writes a self-contained `<file>.sender.html` and opens it in your browser (works offline).
   Press Fullscreen for the best speed.
2. On the phone, open the qbeam receiver page (`qbeam receive` prints its path; copy it to the phone once, it works
   offline) in Chrome or Safari and point the camera at the codes. The file saves once it's complete and its
   SHA-256 matches.

Options: `--speed safe|fast|max` (default fast; max needs a 60 fps phone camera), `--encrypt` (prints a passphrase
to type on the phone; never shown on the QR screen), `--name` and `-` for stdin, `--no-open`, `--tty` (draw the codes
in the terminal; automatic over SSH and on Linux without a display; slower than the browser page).

Nothing installed at all? Each GitHub release has a single-file `qbeam-<version>.pyz`: `python3 qbeam-<version>.pyz send app.log`.

Encryption needs the optional package: `pip install "qbeam[crypto]"` (or `uvx --from "qbeam[crypto]" qbeam send ... --encrypt`).

Status: early alpha (0.0.x). Terminal mode, higher speed and native apps are on the way:
https://github.com/qbeam/qbeam

Use it only to move data you're authorised to move. Apache-2.0 licensed.
