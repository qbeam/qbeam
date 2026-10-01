# android

Native Android receiver (PLAN P3): CameraX + zxing-cpp, Play Billing one-time unlock after 10 free transfers.

- [`core/`](core/) — protocol v3 in Kotlin (pure JVM, also used by the app): code parsing with the session limits,
  the segmented fountain decoder and encoder, containers, and the encryption envelope (`javax.crypto`). Checked
  against `protocol/test-vectors/v3.json` plus decode round trips under loss:

  ```bash
  cd android && ./gradlew :core:test
  ```

- The app module comes next, once Android Studio (which provides the JDK and SDK) is installed.
