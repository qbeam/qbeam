// swift-tools-version:5.9
// QBeamKit: qbeam protocol v3 (protocol/SPEC.md) for the iOS app. Tested against protocol/test-vectors/v3.json.
import PackageDescription

let package = Package(
    name: "QBeamKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "QBeamKit", targets: ["QBeamKit"])],
    targets: [
        .target(name: "QBeamKit"),
        .testTarget(name: "QBeamKitTests", dependencies: ["QBeamKit"]),
    ]
)
