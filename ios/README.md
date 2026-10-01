# ios

Native iOS receiver (PLAN P4, started early): AVFoundation camera + Vision barcode detection, StoreKit 2 unlock.

- [`QBeamKit/`](QBeamKit/) — protocol v3 in Swift: code parsing with the session limits, the segmented fountain
  decoder (and encoder, for sending from the phone), containers, and the encryption envelope (CryptoKit AES-GCM,
  CommonCrypto PBKDF2). Checked against `protocol/test-vectors/v3.json` with decode round trips under loss:

  ```bash
  cd ios/QBeamKit && swift test --disable-sandbox   # --disable-sandbox only needed when the repo is under ~/Desktop
  ```

- The app itself needs Xcode (not yet installed on the dev Mac).
