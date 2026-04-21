import Foundation
import Sparkle

@MainActor
final class SparkleController: ObservableObject {
    @Published private(set) var isAvailable = false

    private var updaterController: SPUStandardUpdaterController?

    func startIfConfigured(installState: AppInstallState) {
        guard case .installed = installState else { return }
        guard updaterController == nil else { return }

        let info = Bundle.main.infoDictionary ?? [:]
        let feedURL = (info["SUFeedURL"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let publicKey = (info["SUPublicEDKey"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !feedURL.isEmpty, !publicKey.isEmpty else { return }

        let controller = SPUStandardUpdaterController(
            startingUpdater: false,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
        updaterController = controller
        controller.startUpdater()
        isAvailable = true
    }

    func checkForUpdates() {
        updaterController?.checkForUpdates(nil)
    }
}
