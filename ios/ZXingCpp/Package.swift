// swift-tools-version:5.7.1
// zxing-cpp v3.1.1 (Apache-2.0), vendored for the iOS app: core/src (without libzint, ZXingC.cpp, ZXingCpp.cpp, as
// upstream's Package.swift excludes) and wrappers/ios/Sources/Wrapper, unmodified. The one change from upstream's
// Package.swift is NDEBUG: Xcode compiles package C++ with assert() live even in Release, and an assert in the QR
// sampler (QRDetector.cpp) aborts the app on some camera frames. Android and web builds of zxing-cpp define NDEBUG.
import PackageDescription

let package = Package(
    name: "ZXingCpp",
    platforms: [.macOS(.v13), .iOS(.v12)],
    products: [.library(name: "ZXingCpp", targets: ["ZXingCpp"])],
    targets: [
        .target(
            name: "ZXingCppCore",
            path: "core/src",
            publicHeadersPath: ".",
            cxxSettings: [
                .headerSearchPath("../../wrappers/ios/Sources/Wrapper"),
                .define("ZXING_INTERNAL"),
                .define("NDEBUG"),
            ]
        ),
        .target(
            name: "ZXingCpp",
            dependencies: ["ZXingCppCore"],
            path: "wrappers/ios/Sources/Wrapper",
            publicHeadersPath: ".",
            cxxSettings: [.define("NDEBUG")],
            linkerSettings: [.linkedFramework("CoreGraphics"), .linkedFramework("CoreImage"), .linkedFramework("CoreVideo")]
        ),
    ],
    cxxLanguageStandard: .cxx20
)
