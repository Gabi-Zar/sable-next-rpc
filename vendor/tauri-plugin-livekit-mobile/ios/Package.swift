// swift-tools-version:5.9

import PackageDescription

// Must stay a Swift package, not an `.xcodeproj`. Tauri's Xcode fallback
// merges the Tauri Swift API into this archive while the `tauri` crate links
// its own copy; the duplicated `JSObject`/`JsonValue` metadata corrupts the
// bridged dictionary and crashes on `invoke.resolve`/`invoke.reject`
// (tauri-apps/tauri#14510, SkipperNDT/tauri-plugin-machine-uid#4).
let package = Package(
  name: "tauri-plugin-livekit-mobile",
  platforms: [
    .iOS("15.4"),
    // LiveKit declares macOS support, so this package must declare it too.
    .macOS(.v12),
  ],
  products: [
    .library(
      name: "tauri-plugin-livekit-mobile",
      type: .static,
      targets: ["tauri-plugin-livekit-mobile"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api"),
    .package(
      name: "LiveKit",
      url: "https://github.com/SableClient/client-sdk-swift.git",
      .revision("3f586ba2122339fa277a61f076905bd9b21da913")),
  ],
  targets: [
    .target(
      name: "tauri-plugin-livekit-mobile",
      dependencies: [
        .byName(name: "Tauri"),
        .product(name: "LiveKit", package: "LiveKit"),
      ],
      path: "Sources"),
    .testTarget(
      name: "LivekitMobilePluginTests",
      dependencies: [
        .byName(name: "tauri-plugin-livekit-mobile")
      ],
      path: "Tests"),
  ]
)
