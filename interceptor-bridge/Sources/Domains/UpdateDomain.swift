import Foundation
import AppKit
import Sparkle

// `interceptor macos update *` — thin wrapper around SPUUpdater so the
// CLI can drive Sparkle directly (manual user-initiated update check,
// state inspection). Without this, agents and operators have to rely on
// Sparkle's automatic scheduled-check cadence, which for an LSUIElement
// app means the update prompt frequently never surfaces visibly.
//
// The `check` verb calls SPUUpdater.checkForUpdates() — the user-initiated
// API — which always shows the alert immediately, regardless of the
// scheduled-check throttle or the automatic-driver's silent-download
// behavior. Combined with `SparkleUserDriverDelegate`, that alert will
// surface as a real modal window rather than a transient banner.
final class UpdateDomain: DomainHandler, @unchecked Sendable {
    private let updaterController: SPUStandardUpdaterController

    init(updaterController: SPUStandardUpdaterController) {
        self.updaterController = updaterController
    }

    func handle(_ command: String, action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        let sub = action["sub"] as? String ?? command
        switch sub {
        case "check":
            handleCheck(completion: completion)
        case "status":
            handleStatus(completion: completion)
        default:
            notImplemented("update \(sub)", completion: completion)
        }
    }

    // User-initiated check. Sparkle's contract: always shows the user
    // driver alert. `checkForUpdates(_:)` requires main-thread invocation.
    private func handleCheck(completion: @escaping @Sendable ([String: Any]) -> Void) {
        DispatchQueue.main.async { [updaterController] in
            updaterController.checkForUpdates(nil)
            completion(WireFormat.success([
                "message": "user-initiated update check fired — Sparkle will now show the alert",
                "feed": updaterController.updater.feedURL?.absoluteString ?? "unset"
            ]))
        }
    }

    // Snapshot of Sparkle's current scheduling/state. Useful for agents
    // diagnosing why an update prompt did or didn't surface.
    private func handleStatus(completion: @escaping @Sendable ([String: Any]) -> Void) {
        DispatchQueue.main.async { [updaterController] in
            let updater = updaterController.updater
            var payload: [String: Any] = [
                "feed": updater.feedURL?.absoluteString ?? "unset",
                "automaticChecks": updater.automaticallyChecksForUpdates,
                "checkInterval": updater.updateCheckInterval,
                "canCheckForUpdates": updater.canCheckForUpdates,
                "sessionInProgress": updater.sessionInProgress
            ]
            if let last = updater.lastUpdateCheckDate {
                payload["lastCheck"] = ISO8601DateFormatter().string(from: last)
            }
            completion(WireFormat.success(payload))
        }
    }
}
