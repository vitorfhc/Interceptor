// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "interceptor-app",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "InterceptorHost", targets: ["InterceptorHost"])
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle.git", exact: "2.9.1")
    ],
    targets: [
        .executableTarget(
            name: "InterceptorHost",
            dependencies: [
                .product(name: "Sparkle", package: "Sparkle")
            ],
            path: "Sources",
            linkerSettings: [
                .linkedFramework("SwiftUI"),
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("ServiceManagement"),
            ]
        )
    ]
)
