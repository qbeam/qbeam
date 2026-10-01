#!/usr/bin/env bash
# Build, sign and verify the Android APK (foss flavour) for a GitHub release:
#   scripts/build_apk.sh <version> <out-dir>   ->  <out-dir>/qbeam-<version>.apk and .apk.sha256
# Needs KEYSTORE_B64 (the release key, base64) and QBEAM_KEYSTORE_PASSWORD; exits 0 without building if KEYSTORE_B64
# is empty. Used by .github/workflows/release.yml and android-apk.yml; key setup in docs/RELEASING.md.
set -euo pipefail
version=$1 out=$2
if [ -z "${KEYSTORE_B64:-}" ]; then
  echo "::warning::No ANDROID_KEYSTORE_BASE64 secret, so no APK (docs/RELEASING.md)"; exit 0
fi
ks=$(mktemp "${RUNNER_TEMP:-/tmp}/release.XXXXXX.jks")
trap 'rm -f "$ks"' EXIT
echo "$KEYSTORE_B64" | base64 -d > "$ks"
export QBEAM_KEYSTORE=$ks QBEAM_KEY_ALIAS=${QBEAM_KEY_ALIAS:-qbeam} QBEAM_KEY_PASSWORD=${QBEAM_KEY_PASSWORD:-$QBEAM_KEYSTORE_PASSWORD}
(cd android && ./gradlew :app:assembleFossRelease --console=plain)
apk=android/app/build/outputs/apk/foss/release/app-foss-release.apk
name=$(grep -oE "versionName='[^']+'" <("$ANDROID_HOME"/build-tools/36.0.0/aapt2 dump badging "$apk") | cut -d"'" -f2)
[ "$name" = "$version" ] || { echo "::error::APK versionName $name != release $version"; exit 1; }
certs=$("$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs "$apk")
echo "$certs"
if echo "$certs" | grep -q "CN=Android Debug"; then echo "::error::APK is signed with the debug key"; exit 1; fi
mkdir -p "$out"
cp "$apk" "$out/qbeam-$version.apk"
(cd "$out" && sha256sum "qbeam-$version.apk" > "qbeam-$version.apk.sha256" && cat "qbeam-$version.apk.sha256")
