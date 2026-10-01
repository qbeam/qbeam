#!/usr/bin/env python3
"""Build qbeam.pyz: the whole CLI in one file, runnable with any Python 3.8+ and nothing installed.

    python3 py/build_pyz.py              # writes py/dist/qbeam-<version>.pyz
    python3 qbeam-<version>.pyz send app.log
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile
import zipapp

here = pathlib.Path(__file__).resolve().parent
subprocess.run([sys.executable, str(here / "sync_assets.py")], check=True, stdout=subprocess.DEVNULL)
sys.path.insert(0, str(here / "src"))
from qbeam import __version__  # noqa: E402

out = here / "dist" / f"qbeam-{__version__}.pyz"
out.parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    stage = pathlib.Path(tmp)
    shutil.copytree(here / "src" / "qbeam", stage / "qbeam", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copyfile(here.parent / name, stage / name)
    zipapp.create_archive(stage, out, interpreter="/usr/bin/env python3", main="qbeam.cli:main", compressed=True)
print(f"wrote {out} ({out.stat().st_size:,} bytes)")
