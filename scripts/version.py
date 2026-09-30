#!/usr/bin/env python3
"""Keep the Python and npm package versions in lockstep.

    python3 scripts/version.py            # print the version (fails if the two files disagree)
    python3 scripts/version.py 0.0.2      # set both to 0.0.2

Merging a new version to main triggers the release workflow (.github/workflows/release.yml).
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PY = ROOT / "py" / "src" / "qbeam" / "__init__.py"
NPM = ROOT / "js" / "package.json"
PY_RE = re.compile(r'^__version__ = "([^"]+)"$', re.M)


def current():
    py = PY_RE.search(PY.read_text()).group(1)
    npm = json.loads(NPM.read_text())["version"]
    if py != npm:
        sys.exit(f"version mismatch: {PY.relative_to(ROOT)} has {py}, {NPM.relative_to(ROOT)} has {npm}")
    return py


def set_version(new):
    if not re.fullmatch(r"\d+\.\d+\.\d+", new):
        sys.exit(f"not a MAJOR.MINOR.PATCH version: {new}")
    PY.write_text(PY_RE.sub(f'__version__ = "{new}"', PY.read_text()))
    data = json.loads(NPM.read_text())
    data["version"] = new
    NPM.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        old = current()
        set_version(sys.argv[1])
        print(f"{old} -> {current()}")
    else:
        print(current())
