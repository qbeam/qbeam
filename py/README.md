# qbeam

Move a file from a locked-down machine to your phone over animated QR codes. No network, no USB,
no admin rights, and nothing to install on the receiving side. Transfers are verified with SHA-256.

```bash
uvx qbeam send app.log        # or: pipx install qbeam
```

1. `qbeam send <file>` writes a self-contained `<file>.sender.html`. Open it in a browser (works offline).
2. On the receiving device, open the decoder page (`qbeam receive` prints its path; copy it to your phone)
   and point the camera at the screen. The file saves once every block arrives and the checksum matches.

Send a folder as one archive: `qbeam send myfolder --archive`.

Status: early alpha (0.0.x). Terminal mode, higher speed and native apps are on the way:
https://github.com/qbeam/qbeam

Use it only to move data you're authorised to move. Apache-2.0 licensed.
