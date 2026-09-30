#!/usr/bin/env python3
"""Copy the web and JS assets into src/qbeam/assets/ (and the license files into py/)
so they ship inside the wheel and sdist.
Run before building a release: python3 py/sync_assets.py
"""
import pathlib
import shutil
import sys

here = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(here / "src"))

from qbeam.cli import REPO_ASSETS  # noqa: E402

dest = here / "src" / "qbeam" / "assets"
dest.mkdir(exist_ok=True)
for name, src in REPO_ASSETS.items():
    shutil.copyfile(src, dest / name)
    print(f"copied {src.relative_to(here.parent)} -> {(dest / name).relative_to(here.parent)}")

for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
    shutil.copyfile(here.parent / name, here / name)
    print(f"copied {name} -> py/{name}")
