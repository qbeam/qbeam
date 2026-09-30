#!/usr/bin/env python3
"""Run qbeam from a repo checkout without installing it: python3 py/encode.py <path> [options]"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "src"))

from qbeam.cli import main  # noqa: E402

main(["send", *sys.argv[1:]])
