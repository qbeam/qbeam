# android

Native Android receiver (PLAN P3): CameraX + zxing-cpp, Play Billing one-time unlock after 10 free transfers.

- [`core/`](core/) — protocol v3 in Kotlin (pure JVM, also used by the app): code parsing with the session limits,
  the segmented fountain decoder and encoder, containers, and the encryption envelope (`javax.crypto`). Checked
  against `protocol/test-vectors/v3.json` plus decode round trips under loss:

  ```bash
  cd android && ./gradlew :core:test
  ```

- [`app/`](app/) — the receiver: CameraX (1080p, up to 60 fps) → zxing-cpp reading the luma plane natively →
  `Receiver` on its own thread → Compose UI; files save to Downloads/qbeam. Not yet: billing and the free-transfer
  limit, phone-to-laptop sending.

  ```bash
  cd android && ./gradlew :app:assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
  adb install -r app/build/outputs/apk/debug/app-debug.apk
  ```

Versions: AGP 8.13.2, Kotlin 2.3.20, compileSdk 36, CameraX 1.5.2 (what zxing-cpp 3.1.1 is built against), Compose
BOM 2025.10.01 (the last one for compileSdk 36 / AGP 8). Newer AndroidX needs AGP 9 and compileSdk 37.
