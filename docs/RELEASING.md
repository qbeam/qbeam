# Releasing qbeam

Releases are automatic. Every push to `main` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. It reads the version (`python3 scripts/version.py`) and checks whether that version is already on PyPI and npm.
2. If both already have it, nothing is published; CI still runs on its own.
3. Otherwise it runs the full CI suite, publishes the exact artifacts CI built and tested, and creates a `vX.Y.Z` tag
   and GitHub release with the files attached.

No tokens are stored anywhere: both registries trust this repo's `release.yml` through OIDC ("trusted publishing").

## Cutting a release

In the pull request that should ship:

```bash
python3 scripts/version.py 0.0.2
```

This updates `py/src/qbeam/__init__.py` and `js/package.json` together. Merge the PR; the release runs on `main`.
CI fails if the two versions ever disagree.

Versions are `MAJOR.MINOR.PATCH`. A version can be published only once; to fix a bad release, bump again.

## One-time setup

### PyPI

If `qbeam` isn't on PyPI yet, add a *pending* publisher (the first release creates the project):
pypi.org → Account settings → Publishing → "Add a new pending publisher":

| Field | Value |
| --- | --- |
| PyPI project name | `qbeam` |
| Owner | `qbeam` |
| Repository name | `qbeam` |
| Workflow name | `release.yml` |
| Environment name | `pypi` |

If the project already exists, add the same values under the project's Settings → Publishing instead.

### npm

npm attaches trusted publishers to an existing package, so the first version is published by hand once:

```bash
npm login
npm publish ./js/qbeam-0.0.1.tgz   # the ./ matters: without it npm treats the path as a GitHub repo
```

Then npmjs.com → package `qbeam` → Settings → Trusted Publisher → GitHub Actions:

| Field | Value |
| --- | --- |
| Organization or user | `qbeam` |
| Repository | `qbeam` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |

Afterwards, in the same settings page, you can require two-factor authentication and disallow tokens for publishing,
so only the workflow can publish.

### GitHub environments (optional)

The `pypi` and `npm` environments are created automatically on first use. To require a manual approval before
anything is published, add yourself as a required reviewer under repo Settings → Environments → `pypi` / `npm`.
