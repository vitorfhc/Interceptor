import Foundation
import AppKit

enum AppInstallState: Equatable {
    case installed
    case needsMove(reason: String)
}

enum InstallationEvaluator {
    private static let expectedAppPath = "/Applications/Interceptor.app"

    static func evaluate(bundleURL: URL) -> AppInstallState {
        if isDeveloperOverrideEnabled() {
            return .installed
        }

        let standardizedPath = bundleURL.resolvingSymlinksInPath().path
        if standardizedPath == expectedAppPath {
            return .installed
        }

        if standardizedPath.contains("/AppTranslocation/") {
            return .needsMove(reason: "Interceptor is running from a translocated location. Copy it into Applications before continuing.")
        }

        if let values = try? bundleURL.resourceValues(forKeys: [.volumeIsReadOnlyKey]),
           values.volumeIsReadOnly == true {
            return .needsMove(reason: "Interceptor is running from a read-only volume. Drag it into Applications before continuing.")
        }

        if standardizedPath.hasPrefix("/Volumes/") {
            return .needsMove(reason: "Interceptor is still running from the mounted DMG. Drag it into Applications before continuing.")
        }

        return .needsMove(reason: "Copy Interceptor.app into /Applications before running setup or updates.")
    }

    static func isDeveloperOverrideEnabled() -> Bool {
        let env = ProcessInfo.processInfo.environment
        return env["INTERCEPTOR_ALLOW_LOCAL_RUN"] == "1"
            || env["INTERCEPTOR_DEV_ALLOW_NON_APPLICATIONS"] == "1"
    }

    @MainActor
    static func openApplicationsFolder() {
        NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications", isDirectory: true))
    }
}
