# android

Native Android receiver: CameraX + zxing-cpp, files saved to Downloads/qbeam, no internet permission.

- [`core/`](core/): protocol v3 in Kotlin (pure JVM, also used by the app): code parsing with the session limits,
  the segmented fountain decoder and encoder, containers, the encryption envelope (`javax.crypto`), the `Receiver`
  and the `Trial`. Checked against `protocol/test-vectors/v3.json` plus round trips under loss:

  ```bash
  cd android && ./gradlew :core:test
  ```

- [`app/`](app/): the receiver. CameraX (1080p, up to 60 fps where the camera offers it) → a pool of zxing-cpp
  readers on the luma plane → `Receiver` on its own thread → Compose UI.

  Two flavours:
  - **foss** (default): no Google libraries; the APK on GitHub releases, IzzyOnDroid and F-Droid.
  - **play**: adds Play Billing for the one-time unlock, behind a switch (`-Pqbeam.trial=true`).

  ```bash
  cd android && ./gradlew :app:assembleFossRelease   # signed with the debug key unless QBEAM_KEYSTORE is set
  adb install -r app/build/outputs/apk/foss/release/app-foss-release.apk
  ```

  Release signing and the published APK: [docs/RELEASING.md](../docs/RELEASING.md).

Versions: AGP 8.13.2, Kotlin 2.3.20, compileSdk 36, CameraX 1.5.2 (what zxing-cpp 3.1.1 is built against), Compose
BOM 2025.10.01 (the last one for compileSdk 36 / AGP 8). Newer AndroidX needs AGP 9 and compileSdk 37.
