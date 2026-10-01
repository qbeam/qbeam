# ios

Native iOS receiver: AVFoundation camera (1080p, 60 fps) + zxing-cpp, files saved to the app's folder in Files.

- [`QBeamKit/`](QBeamKit/): protocol v3 in Swift: code parsing with the session limits, the segmented fountain
  decoder and encoder, containers, the encryption envelope (CryptoKit AES-GCM, CommonCrypto PBKDF2), the `Receiver`
  and the `Trial`. Checked against `protocol/test-vectors/v3.json` with round trips under loss:

  ```bash
  cd ios/QBeamKit && swift test --disable-sandbox   # --disable-sandbox only needed when the repo is under ~/Desktop
  ```

- [`App/`](App/): the SwiftUI app. The Xcode project is generated from `project.yml` with
  [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`cd ios/App && xcodegen`). StoreKit 2 for the one-time unlock,
  behind a switch (`QBEAM_TRIAL=YES`).
- [`ZXingCpp/`](ZXingCpp/): zxing-cpp 3.1.1, vendored unmodified and built with `NDEBUG` (see its `Package.swift`).
