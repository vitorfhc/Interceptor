import SwiftUI
import AppKit
import Foundation
import ApplicationServices
import AVFAudio
import AVFoundation
import CoreGraphics
import ServiceManagement
import Darwin

enum Brand {
    static let primary = Color(red: 0.0, green: 0.3137, blue: 0.9098) // #0050e8
    static let primaryHover = Color(red: 0.0, green: 0.2510, blue: 0.7529) // #0040c0
    static let blue = Color(red: 0.0, green: 0.2902, blue: 0.8353) // #004ad5
    static let red = Color(red: 0.8902, green: 0.0, blue: 0.0) // #e30000
    static let darkRed = Color(red: 0.5569, green: 0.0, blue: 0.0) // #8e0000
    static let gold = Color(red: 0.9569, green: 0.7294, blue: 0.2588) // #f4ba42
    static let dark = Color(red: 0.2863, green: 0.2902, blue: 0.3216) // #494A52
    static let light = Color(red: 0.9725, green: 0.9804, blue: 0.9882) // #F8FAFC
    static let canvas = Color.black
    static let surface = Color(red: 0.10, green: 0.12, blue: 0.16)
    static let surfaceRaised = Color(red: 0.18, green: 0.21, blue: 0.28)
    static let surfaceEdge = Color.white.opacity(0.08)
    static let copy = Color(red: 0.86, green: 0.89, blue: 0.94)
    static let muted = Color(red: 0.64, green: 0.69, blue: 0.77)

    static func heading(_ size: CGFloat) -> Font {
        .custom("Balboa-ExtraCondensed", size: size)
    }

    static func body(_ size: CGFloat) -> Font {
        .custom("Raleway-Regular", size: size)
    }

    static func action(_ size: CGFloat) -> Font {
        .custom("Montserrat-SemiBold", size: size)
    }
}

enum InterceptorLog {
    static let path = "/tmp/interceptor-app.log"

    static func write(_ message: String) {
        let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n"
        guard let data = line.data(using: .utf8) else { return }
        if FileManager.default.fileExists(atPath: path),
           let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        } else {
            FileManager.default.createFile(atPath: path, contents: data)
        }
    }
}

struct BrowserOption: Identifiable, Hashable {
    let id: String
    let label: String
    let bundleIdentifier: String
    let appPath: String

    static let brave = BrowserOption(
        id: "brave",
        label: "Brave Browser",
        bundleIdentifier: "com.brave.Browser",
        appPath: "/Applications/Brave Browser.app"
    )

    static let chrome = BrowserOption(
        id: "chrome",
        label: "Google Chrome",
        bundleIdentifier: "com.google.Chrome",
        appPath: "/Applications/Google Chrome.app"
    )
}

struct ProfileOption: Identifiable, Hashable {
    let id: String
    let directory: String
    let displayName: String
}

enum PermissionState: Equatable {
    case granted
    case denied
    case notRequested
    case unknown

    var label: String {
        switch self {
        case .granted: return "Granted"
        case .denied: return "Needs Setup"
        case .notRequested: return "Not Requested"
        case .unknown: return "Unknown"
        }
    }

    var tint: Color {
        switch self {
        case .granted: return Color(red: 0.24, green: 0.92, blue: 0.55)
        case .denied: return Color(red: 1.0, green: 0.71, blue: 0.29)
        case .notRequested, .unknown: return Color(red: 0.56, green: 0.64, blue: 0.75)
        }
    }
}

enum HelperServiceState: Equatable {
    case enabled
    case requiresApproval
    case notRegistered
    case notFound
    case error(String)

    var label: String {
        switch self {
        case .enabled: return "Enabled"
        case .requiresApproval: return "Needs Approval"
        case .notRegistered: return "Not Registered"
        case .notFound: return "Missing"
        case .error: return "Error"
        }
    }

    var tint: Color {
        switch self {
        case .enabled: return Color(red: 0.24, green: 0.92, blue: 0.55)
        case .requiresApproval: return Color(red: 1.0, green: 0.74, blue: 0.33)
        case .notRegistered, .notFound, .error: return Color(red: 0.95, green: 0.44, blue: 0.44)
        }
    }

    var actionTitle: String? {
        switch self {
        case .enabled: return nil
        case .requiresApproval: return "Open Login Items"
        case .notRegistered: return "Enable Helper"
        case .notFound, .error: return "Refresh"
        }
    }

    static func from(statusString: String) -> HelperServiceState {
        switch statusString {
        case "enabled": return .enabled
        case "requiresApproval": return .requiresApproval
        case "notRegistered": return .notRegistered
        case "notFound": return .notFound
        default: return .error(statusString)
        }
    }
}

enum AppStep: Int, CaseIterable {
    case choose
    case setup
    case permissions
    case done

    var title: String {
        switch self {
        case .choose: return "Browser"
        case .setup: return "Setup"
        case .permissions: return "Permissions"
        case .done: return "Ready"
        }
    }
}

struct TrustSnapshot {
    var accessibility: PermissionState = .unknown
    var screenRecording: PermissionState = .unknown
    var microphone: PermissionState = .unknown
}

struct HelperSnapshot {
    var state: HelperServiceState = .notRegistered
    var legacyPlistExists = false
    var legacyStatus = "notRegistered"
}

struct SetupHealthSnapshot {
    var repairReason: String?
}

struct ProcessResult {
    let status: Int32
    let stdout: String
    let stderr: String
}

struct AppError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

enum BridgeServiceController {
    static let plistName = "com.interceptor.bridge.plist"
    static let label = "com.interceptor.bridge"

    static func service() -> SMAppService {
        SMAppService.agent(plistName: plistName)
    }

    static func legacyLaunchAgentURL() -> URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }

    static func statusString(for status: SMAppService.Status) -> String {
        switch status {
        case .enabled: return "enabled"
        case .requiresApproval: return "requiresApproval"
        case .notRegistered: return "notRegistered"
        case .notFound: return "notFound"
        @unknown default: return "unknown"
        }
    }

    static func payload(bundleURL: URL) -> [String: Any] {
        let serviceStatus = statusString(for: service().status)
        let legacyURL = legacyLaunchAgentURL()
        let legacyExists = FileManager.default.fileExists(atPath: legacyURL.path)
        let legacyStatus = legacyExists
            ? statusString(for: SMAppService.statusForLegacyPlist(at: legacyURL))
            : "notRegistered"

        return [
            "label": label,
            "plistName": plistName,
            "status": serviceStatus,
            "legacyPlistExists": legacyExists,
            "legacyStatus": legacyStatus,
            "bundlePath": bundleURL.path,
        ]
    }

    static func register(bundleURL: URL) -> [String: Any] {
        var errorMessage: String?
        do {
            try service().register()
        } catch {
            errorMessage = error.localizedDescription
        }
        var payload = payload(bundleURL: bundleURL)
        if let errorMessage {
            payload["error"] = errorMessage
        }
        return payload
    }

    static func unregister(bundleURL: URL) -> [String: Any] {
        var errorMessage: String?
        do {
            try service().unregister()
        } catch {
            errorMessage = error.localizedDescription
        }
        var payload = payload(bundleURL: bundleURL)
        if let errorMessage {
            payload["error"] = errorMessage
        }
        return payload
    }
}

enum InterceptorHostCommand {
    static func runIfNeeded(bundleURL: URL) {
        let args = Array(CommandLine.arguments.dropFirst())
        guard let command = args.first else { return }

        func argValue(_ name: String, in args: [String]) -> String? {
            guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
            return args[index + 1]
        }

        func emit(_ payload: [String: Any], exitCode: Int32 = 0) -> Never {
            let data = try! JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted])
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([0x0A]))
            Darwin.exit(exitCode)
        }

        switch command {
        case "helper-status":
            emit(BridgeServiceController.payload(bundleURL: bundleURL))
        case "register-helper":
            emit(BridgeServiceController.register(bundleURL: bundleURL))
        case "unregister-helper":
            emit(BridgeServiceController.unregister(bundleURL: bundleURL))
        case "trust-status":
            emit(Self.trustPayload(bundleURL: bundleURL))
        case "request-trust":
            emit(Self.requestTrust(bundleURL: bundleURL, args: args))
        case "setup-headless":
            guard let browser = argValue("--browser", in: args),
                  let profile = argValue("--profile", in: args) else {
                emit(["error": "Usage: Interceptor setup-headless --browser <chrome|brave> --profile <profile>"], exitCode: 1)
            }
            let skipRegister = args.contains("--skip-register")

            let browserOption: BrowserOption
            switch browser {
            case "brave": browserOption = .brave
            case "chrome": browserOption = .chrome
            default:
                emit(["error": "Unsupported browser '\(browser)'"], exitCode: 1)
            }

            let installDir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".interceptor", isDirectory: true)
            let stateFileURL = installDir.appendingPathComponent("state/setup.json")
            let legacyAppInstallURL = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Applications/Interceptor.app", isDirectory: true)
            let legacyLaunchAgentURL = BridgeServiceController.legacyLaunchAgentURL()

            do {
                try InterceptorViewModel.performSetup(
                    browser: browserOption,
                    profile: ProfileOption(id: profile, directory: profile, displayName: profile),
                    installDir: installDir,
                    stateFileURL: stateFileURL,
                    bundledCLIURL: bundleURL.appendingPathComponent("Contents/Resources/bin/interceptor"),
                    bundledDaemonURL: bundleURL.appendingPathComponent("Contents/Resources/bin/interceptor-daemon"),
                    bundledBridgeURL: bundleURL.appendingPathComponent("Contents/MacOS/InterceptorBridge"),
                    bundledSetupHelperURL: bundleURL.appendingPathComponent("Contents/Resources/bin/interceptor-setup"),
                    extensionURL: bundleURL.appendingPathComponent("Contents/Resources/extension/dist", isDirectory: true),
                    daemonManifestTemplateURL: bundleURL.appendingPathComponent("Contents/Resources/templates/com.interceptor.host.json"),
                    legacyLaunchAgentURL: legacyLaunchAgentURL,
                    legacyAppInstallURL: legacyAppInstallURL,
                    currentAppBundleURL: bundleURL
                )
                var payload = skipRegister
                    ? BridgeServiceController.payload(bundleURL: bundleURL)
                    : BridgeServiceController.register(bundleURL: bundleURL)
                payload["browser"] = browser
                payload["profile"] = profile
                payload["skipRegister"] = skipRegister
                payload["setupStatePath"] = stateFileURL.path
                emit(payload)
            } catch {
                emit(["error": error.localizedDescription], exitCode: 1)
            }
        default:
            return
        }
    }

    private static func trustPayload(bundleURL: URL) -> [String: Any] {
        let microphoneStatus = InterceptorViewModel.microphonePermissionString()
        let helperPayload = BridgeServiceController.payload(bundleURL: bundleURL)
        return [
            "accessibility": AXIsProcessTrusted(),
            "screenRecording": CGPreflightScreenCaptureAccess(),
            "microphone": microphoneStatus,
            "helper": helperPayload["status"] as? String ?? "unknown",
            "bundlePath": bundleURL.path,
        ]
    }

    private static func requestTrust(bundleURL: URL, args: [String]) -> [String: Any] {
        let prompt = args.contains("--prompt") || args.contains("--walkthrough")
        let walkthrough = args.contains("--walkthrough")
        let accessibilityPrompt = args.contains("--accessibility-prompt")
        let screenPrompt = args.contains("--screen-prompt")
        let microphonePrompt = args.contains("--microphone-prompt")

        let shouldPromptAccessibility = prompt || walkthrough || accessibilityPrompt
        let shouldPromptScreen = prompt || walkthrough || screenPrompt
        let shouldPromptMicrophone = prompt || walkthrough || microphonePrompt

        if shouldPromptAccessibility {
            let key = "AXTrustedCheckOptionPrompt" as CFString
            let options = [key: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        }

        if shouldPromptScreen && !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
        }

        var microphoneStatus = InterceptorViewModel.microphonePermissionString()
        if shouldPromptMicrophone {
            microphoneStatus = InterceptorViewModel.requestMicrophonePermissionString()
        }

        var payload = trustPayload(bundleURL: bundleURL)
        payload["microphone"] = microphoneStatus
        payload["prompted"] = [
            shouldPromptAccessibility ? "Accessibility" : nil,
            shouldPromptScreen ? "Screen Recording" : nil,
            shouldPromptMicrophone ? "Microphone" : nil,
        ].compactMap { $0 }

        if walkthrough {
            if (payload["accessibility"] as? Bool) != true {
                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
            } else if (payload["screenRecording"] as? Bool) != true {
                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
            } else if microphoneStatus != "true" {
                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
            }
        }

        return payload
    }
}

@MainActor
final class InterceptorViewModel: ObservableObject {
    @Published var step: AppStep = .choose
    @Published var browsers: [BrowserOption] = []
    @Published var selectedBrowser: BrowserOption?
    @Published var profiles: [ProfileOption] = []
    @Published var selectedProfile: ProfileOption?
    @Published var setupMessage = "Choose a browser profile to finish setup."
    @Published var setupError: String?
    @Published var isWorking = false
    @Published var trust = TrustSnapshot()
    @Published var helper = HelperSnapshot()
    @Published var installState: AppInstallState
    @Published var setupHealth = SetupHealthSnapshot()
    @Published var needsBrowserRestart = false
    @Published var legacyInstallDetected = false
    @Published var microphoneRuntimeReady = false
    @Published var microphoneRuntimeMessage: String?
    @Published var isCheckingMicrophone = false

    private var permissionTimer: Timer?
    private var appActivationObserver: NSObjectProtocol?
    private var savedBrowserId: String?
    private var savedProfileId: String?
    private let sparkleController = SparkleController()

    let installDir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".interceptor", isDirectory: true)
    let legacyAppInstallURL = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Applications/Interceptor.app", isDirectory: true)
    let legacyLaunchAgentURL = BridgeServiceController.legacyLaunchAgentURL()

    init() {
        installState = InstallationEvaluator.evaluate(bundleURL: Bundle.main.bundleURL)
        InterceptorLog.write("app init")

        guard case .installed = installState else {
            return
        }

        loadSavedSelection()
        appActivationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refreshStatuses()
            }
        }

        refreshLegacyInstallFlag()
        loadBrowsers()
        refreshHelperStatus()
        refreshStatuses()
        evaluateSetupHealth()
        sparkleController.startIfConfigured(installState: installState)

        if savedBrowserId != nil, savedProfileId != nil, selectedProfile != nil, setupHealth.repairReason == nil {
            step = .permissions
            startStatusPolling()
        } else {
            step = .choose
        }
    }

    var currentAppBundleURL: URL {
        Bundle.main.bundleURL
    }

    var appExecutableURL: URL {
        currentAppBundleURL.appendingPathComponent("Contents/MacOS/Interceptor")
    }

    var bundledCLIURL: URL {
        currentAppBundleURL.appendingPathComponent("Contents/Resources/bin/interceptor")
    }

    var bundledDaemonURL: URL {
        currentAppBundleURL.appendingPathComponent("Contents/Resources/bin/interceptor-daemon")
    }

    var bundledSetupHelperURL: URL {
        currentAppBundleURL.appendingPathComponent("Contents/Resources/bin/interceptor-setup")
    }

    var bundledManifestTemplateURL: URL {
        currentAppBundleURL.appendingPathComponent("Contents/Resources/templates/com.interceptor.host.json")
    }

    var bundledBridgeURL: URL {
        currentAppBundleURL.appendingPathComponent("Contents/MacOS/InterceptorBridge")
    }

    var extensionURL: URL {
        currentAppBundleURL.appendingPathComponent("Contents/Resources/extension/dist", isDirectory: true)
    }

    var stateFileURL: URL {
        installDir.appendingPathComponent("state/setup.json")
    }

    func loadBrowsers() {
        browsers = [BrowserOption.brave, BrowserOption.chrome].filter {
            FileManager.default.fileExists(atPath: $0.appPath)
        }

        if let savedBrowserId,
           let savedBrowser = browsers.first(where: { $0.id == savedBrowserId }) {
            selectedBrowser = savedBrowser
        } else if selectedBrowser == nil || !browsers.contains(selectedBrowser!) {
            selectedBrowser = browsers.first
        }

        refreshProfiles()
    }

    func refreshProfiles() {
        guard let browser = selectedBrowser else {
            profiles = []
            selectedProfile = nil
            return
        }

        do {
            let output = try Self.runProcess(
                executable: bundledSetupHelperURL.path,
                arguments: ["profiles", "--browser", browser.id]
            ).stdout

            let data = output.data(using: .utf8) ?? Data()
            let decoded = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let rawProfiles = decoded?["profiles"] as? [[String: Any]] ?? []
            profiles = rawProfiles.compactMap { profile in
                guard let directory = profile["dir"] as? String,
                      let name = profile["name"] as? String else { return nil }
                return ProfileOption(id: directory, directory: directory, displayName: name)
            }

            if let savedProfileId,
               let savedProfile = profiles.first(where: { $0.id == savedProfileId }) {
                selectedProfile = savedProfile
            } else if let current = selectedProfile, profiles.contains(current) {
                selectedProfile = current
            } else {
                selectedProfile = profiles.first
            }
            evaluateSetupHealth()
        } catch {
            profiles = []
            selectedProfile = nil
            setupError = "Failed to enumerate browser profiles: \(error.localizedDescription)"
        }
    }

    func beginSetup() {
        guard case .installed = installState else { return }
        guard let browser = selectedBrowser, let profile = selectedProfile else { return }
        setupError = nil
        setupMessage = setupHealth.repairReason == nil
            ? "Configuring your browser profile, helper service, and CLI wrappers…"
            : "Repairing your browser profile, helper service, and CLI wrappers…"
        step = .setup
        isWorking = true

        let installDir = self.installDir
        let stateFileURL = self.stateFileURL
        let bundledCLIURL = self.bundledCLIURL
        let bundledDaemonURL = self.bundledDaemonURL
        let bundledBridgeURL = self.bundledBridgeURL
        let bundledSetupHelperURL = self.bundledSetupHelperURL
        let extensionURL = self.extensionURL
        let bundledManifestTemplateURL = self.bundledManifestTemplateURL
        let legacyLaunchAgentURL = self.legacyLaunchAgentURL
        let legacyAppInstallURL = self.legacyAppInstallURL
        let currentAppBundleURL = self.currentAppBundleURL

        Task {
            do {
                try await Task.detached(priority: .userInitiated) {
                    try Self.performSetup(
                        browser: browser,
                        profile: profile,
                        installDir: installDir,
                        stateFileURL: stateFileURL,
                        bundledCLIURL: bundledCLIURL,
                        bundledDaemonURL: bundledDaemonURL,
                        bundledBridgeURL: bundledBridgeURL,
                        bundledSetupHelperURL: bundledSetupHelperURL,
                        extensionURL: extensionURL,
                        daemonManifestTemplateURL: bundledManifestTemplateURL,
                        legacyLaunchAgentURL: legacyLaunchAgentURL,
                        legacyAppInstallURL: legacyAppInstallURL,
                        currentAppBundleURL: currentAppBundleURL
                    )
                }.value

                self.savedBrowserId = browser.id
                self.savedProfileId = profile.id
                self.setupHealth.repairReason = nil
                self.isWorking = false
                self.setupMessage = "Interceptor is configured. Finish the helper approval and privacy permissions to unlock native control."
                self.registerHelper(userInitiated: false)
                self.step = .permissions
                self.startStatusPolling()
                self.refreshStatuses()
                if self.trust.microphone == .granted {
                    self.verifyMicrophoneRuntime(force: true)
                }
            } catch {
                self.isWorking = false
                self.setupError = error.localizedDescription
                self.setupMessage = "Setup failed."
                self.step = .choose
            }
        }
    }

    func registerHelper(userInitiated: Bool) {
        let payload = BridgeServiceController.register(bundleURL: currentAppBundleURL)
        if let error = payload["error"] as? String, !error.isEmpty {
            InterceptorLog.write("registerHelper error=\(error)")
        }
        refreshHelperStatus()
        InterceptorLog.write("registerHelper status=\(helper.state.label.lowercased()) userInitiated=\(userInitiated)")
        if userInitiated && helper.state == .requiresApproval {
            openLoginItems()
        }
        if helper.state == .enabled && trust.microphone == .granted {
            verifyMicrophoneRuntime(force: true)
        }
    }

    func openLoginItems() {
        SMAppService.openSystemSettingsLoginItems()
    }

    func helperAction() {
        switch helper.state {
        case .enabled:
            return
        case .requiresApproval:
            openLoginItems()
        case .notRegistered:
            registerHelper(userInitiated: true)
        case .notFound, .error:
            refreshHelperStatus()
        }
    }

    func grantAccessibility() {
        let key = "AXTrustedCheckOptionPrompt" as CFString
        let options = [key: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        openPrivacyPane(anchor: "Privacy_Accessibility")
        refreshLocalTrust()
    }

    func grantScreenRecording() {
        needsBrowserRestart = true
        _ = CGRequestScreenCaptureAccess()
        openPrivacyPane(anchor: "Privacy_ScreenCapture")
        refreshLocalTrust()
    }

    func grantMicrophone() {
        refreshLocalTrust()
        let currentStatus = AVAudioApplication.shared.recordPermission
        InterceptorLog.write("grantMicrophone currentStatus=\(String(describing: currentStatus.rawValue)) helper=\(helper.state.label.lowercased())")

        if trust.microphone == .granted {
            verifyMicrophoneRuntime(force: true)
            return
        }

        microphoneRuntimeReady = false
        microphoneRuntimeMessage = "Requesting microphone access from macOS…"

        Task {
            let allowed = await Self.requestMicrophonePermission()
            self.refreshLocalTrust()
            InterceptorLog.write("grantMicrophone explicitRequest allowed=\(allowed) mic=\(self.trust.microphone.label.lowercased())")
            if allowed || self.trust.microphone == .granted {
                self.microphoneRuntimeMessage = "Microphone access granted. Verifying the packaged bridge audio path…"
                self.verifyMicrophoneRuntime(force: true)
            } else {
                self.microphoneRuntimeMessage = "Microphone permission was not granted by macOS. Enable Interceptor in System Settings and then retry the audio check."
                self.openPrivacyPane(anchor: "Privacy_Microphone")
            }
        }
    }

    func refreshStatuses(restartBridge: Bool = false) {
        refreshHelperStatus()
        refreshLocalTrust()
        let clearedStaleDenial = clearStaleMicrophoneDenialMessageIfNeeded()
        InterceptorLog.write("refreshStatuses helper=\(helper.state.label.lowercased()) mic=\(trust.microphone.label.lowercased()) runtimeReady=\(microphoneRuntimeReady) clearedStaleDenial=\(clearedStaleDenial)")
        if trust.microphone == .granted && helper.state == .enabled && (clearedStaleDenial || (!microphoneRuntimeReady && microphoneRuntimeMessage == nil)) {
            verifyMicrophoneRuntime(force: true)
        }
        if trust.microphone != .granted {
            microphoneRuntimeReady = false
        }
    }

    func finish() {
        let browserToOpen =
            selectedBrowser
            ?? browsers.first(where: { $0.id == savedBrowserId })

        if let browserToOpen {
            openBrowser(browserToOpen) { [weak self] in
                Task { @MainActor in
                    self?.step = .done
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                        NSApplication.shared.terminate(nil)
                    }
                }
            }
        } else {
            step = .done
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                NSApplication.shared.terminate(nil)
            }
        }
    }

    func finishLater() {
        NSApplication.shared.terminate(nil)
    }

    private func loadSavedSelection() {
        guard FileManager.default.fileExists(atPath: stateFileURL.path) else { return }
        do {
            let data = try Data(contentsOf: stateFileURL)
            let decoded = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            savedBrowserId = decoded?["browser"] as? String
            savedProfileId = decoded?["profile"] as? String
        } catch {
            InterceptorLog.write("loadSavedSelection error=\(error.localizedDescription)")
        }
    }

    private func refreshLegacyInstallFlag() {
        legacyInstallDetected =
            FileManager.default.fileExists(atPath: legacyLaunchAgentURL.path) ||
            FileManager.default.fileExists(atPath: legacyAppInstallURL.path)
    }

    private func refreshHelperStatus() {
        let payload = BridgeServiceController.payload(bundleURL: currentAppBundleURL)
        helper.state = HelperServiceState.from(statusString: payload["status"] as? String ?? "notFound")
        helper.legacyPlistExists = payload["legacyPlistExists"] as? Bool ?? false
        helper.legacyStatus = payload["legacyStatus"] as? String ?? "notRegistered"
        InterceptorLog.write("refreshHelperStatus status=\(helper.state.label.lowercased()) legacyExists=\(helper.legacyPlistExists) legacyStatus=\(helper.legacyStatus)")
        refreshLegacyInstallFlag()
    }

    private func refreshLocalTrust() {
        let previousMicrophoneState = trust.microphone
        trust.accessibility = AXIsProcessTrusted() ? .granted : .denied
        trust.screenRecording = CGPreflightScreenCaptureAccess() ? .granted : .denied

        let microphoneStatus = AVAudioApplication.shared.recordPermission
        switch microphoneStatus {
        case .granted:
            trust.microphone = .granted
        case .denied:
            trust.microphone = .denied
            microphoneRuntimeReady = false
        case .undetermined:
            trust.microphone = .notRequested
            microphoneRuntimeReady = false
        @unknown default:
            trust.microphone = .unknown
            microphoneRuntimeReady = false
        }

        if previousMicrophoneState == .denied && trust.microphone == .granted {
            microphoneRuntimeMessage = nil
        }
        InterceptorLog.write("refreshLocalTrust accessibility=\(trust.accessibility.label.lowercased()) screen=\(trust.screenRecording.label.lowercased()) mic=\(trust.microphone.label.lowercased()) previousMic=\(previousMicrophoneState.label.lowercased())")
    }

    private func startStatusPolling() {
        permissionTimer?.invalidate()
        permissionTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshStatuses()
            }
        }
    }

    private func openBrowser(_ browser: BrowserOption, completion: (@Sendable () -> Void)? = nil) {
        let url = URL(fileURLWithPath: browser.appPath)
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { _, _ in
            completion?()
        }
    }

    private func openPrivacyPane(anchor: String) {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)") else {
            return
        }
        NSWorkspace.shared.open(url)
    }

    private static func boolState(_ value: Any?) -> PermissionState {
        switch value as? Bool {
        case true: return .granted
        case false: return .denied
        case nil: return .unknown
        }
    }

    private static func stringState(_ value: Any?) -> PermissionState {
        switch value as? String {
        case "true": return .granted
        case "false": return .denied
        case "not_requested": return .notRequested
        default: return .unknown
        }
    }

    func openApplicationsFolder() {
        InstallationEvaluator.openApplicationsFolder()
    }

    var shouldShowInstallGate: Bool {
        if case .installed = installState {
            return false
        }
        return true
    }

    var installGateReason: String {
        switch installState {
        case .installed:
            return ""
        case .needsMove(let reason):
            return reason
        }
    }

    var setupActionTitle: String {
        setupHealth.repairReason == nil ? "Finish Setup" : "Repair Setup"
    }

    var microphoneButtonTitle: String {
        if trust.microphone == .granted {
            return microphoneRuntimeReady ? "Verified" : (isCheckingMicrophone ? "Checking..." : "Retry Audio Check")
        }
        return "Grant Microphone"
    }

    var microphoneActionEnabled: Bool {
        !isCheckingMicrophone && helper.state == .enabled && (trust.microphone != .granted || !microphoneRuntimeReady)
    }

    private func evaluateSetupHealth() {
        guard case .installed = installState else {
            setupHealth.repairReason = nil
            return
        }
        guard let browser = selectedBrowser, let profile = selectedProfile else {
            setupHealth.repairReason = nil
            return
        }
        guard let setupState = loadSetupState() else {
            setupHealth.repairReason = nil
            return
        }

        let currentVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let storedVersion = setupState["appVersion"] as? String
        if storedVersion != currentVersion {
            setupHealth.repairReason = "Interceptor was updated from \(storedVersion ?? "an older build") to \(currentVersion). Repair the browser hooks so the app bundle paths stay current."
            return
        }

        let wrapperTarget = bundledDaemonURL.path
        let wrapperURL = installDir.appendingPathComponent("bin/interceptor-daemon")
        if let wrapperContents = try? String(contentsOf: wrapperURL, encoding: .utf8),
           !wrapperContents.contains(wrapperTarget) {
            setupHealth.repairReason = "The CLI wrappers point at an older app bundle. Repair setup to refresh them."
            return
        }

        let nativeManifestURL = Self.nativeHostManifestURL(browser: browser)
        guard let manifestData = try? Data(contentsOf: nativeManifestURL),
              let manifest = try? JSONSerialization.jsonObject(with: manifestData) as? [String: Any],
              let manifestPath = manifest["path"] as? String,
              manifestPath == bundledDaemonURL.path else {
            setupHealth.repairReason = "The native messaging host still points at an old daemon path. Repair setup to refresh it."
            return
        }

        let expectedExtensionVersion = Self.extensionVersion(at: extensionURL)
        if let expectedExtensionVersion {
            let extensionPath = Self.installedExtensionVersionDirectory(browser: browser, profile: profile, version: expectedExtensionVersion)
            if !FileManager.default.fileExists(atPath: extensionPath.path) {
                setupHealth.repairReason = "The selected browser profile is missing the packaged extension payload. Repair setup to restore it."
                return
            }
        }

        setupHealth.repairReason = nil
    }

    private func loadSetupState() -> [String: Any]? {
        guard FileManager.default.fileExists(atPath: stateFileURL.path),
              let data = try? Data(contentsOf: stateFileURL),
              let decoded = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return decoded
    }

    func verifyMicrophoneRuntime(force: Bool = false) {
        guard trust.microphone == .granted else {
            microphoneRuntimeReady = false
            microphoneRuntimeMessage = nil
            InterceptorLog.write("verifyMicrophoneRuntime skipped reason=permission-not-granted")
            return
        }

        guard helper.state == .enabled else {
            microphoneRuntimeReady = false
            microphoneRuntimeMessage = "Approve the bundled helper in Login Items before Interceptor can verify live audio capture."
            InterceptorLog.write("verifyMicrophoneRuntime skipped reason=helper-\(helper.state.label.lowercased())")
            return
        }

        if isCheckingMicrophone {
            InterceptorLog.write("verifyMicrophoneRuntime skipped reason=already-checking")
            return
        }
        if microphoneRuntimeReady && !force {
            InterceptorLog.write("verifyMicrophoneRuntime skipped reason=already-verified")
            return
        }

        isCheckingMicrophone = true
        microphoneRuntimeReady = false
        microphoneRuntimeMessage = "Running a quick live audio capture check through the packaged helper…"
        InterceptorLog.write("verifyMicrophoneRuntime start force=\(force) cliPath=\(bundledCLIURL.path)")

        let cliPath = bundledCLIURL.path
        Task {
            do {
                let message = try await Task.detached(priority: .userInitiated) {
                    try Self.runPackagedMicrophoneSmoke(cliPath: cliPath)
                }.value
                self.isCheckingMicrophone = false
                self.microphoneRuntimeReady = true
                self.microphoneRuntimeMessage = message
                InterceptorLog.write("verifyMicrophoneRuntime success message=\(message)")
            } catch {
                self.isCheckingMicrophone = false
                self.microphoneRuntimeReady = false
                self.microphoneRuntimeMessage = "Microphone permission is granted, but the packaged bridge could not start audio capture: \(error.localizedDescription)"
                InterceptorLog.write("verifyMicrophoneRuntime failure error=\(error.localizedDescription)")
            }
        }
    }

    private func clearStaleMicrophoneDenialMessageIfNeeded() -> Bool {
        guard trust.microphone == .granted, let message = microphoneRuntimeMessage else {
            return false
        }

        let lowercased = message.lowercased()
        let staleDenial =
            lowercased.contains("denied")
            || lowercased.contains("not granted")
            || lowercased.contains("re-enable it in system settings")

        if staleDenial {
            microphoneRuntimeMessage = nil
            return true
        }

        return false
    }

    nonisolated private static func nativeHostManifestURL(browser: BrowserOption) -> URL {
        switch browser.id {
        case "brave":
            return URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.interceptor.host.json")
        case "chrome":
            return URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support/Google/Chrome/NativeMessagingHosts/com.interceptor.host.json")
        default:
            return URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support/Google/Chrome/NativeMessagingHosts/com.interceptor.host.json")
        }
    }

    nonisolated private static func installedExtensionVersionDirectory(browser: BrowserOption, profile: ProfileOption, version: String) -> URL {
        let basePath: String
        switch browser.id {
        case "brave":
            basePath = "Library/Application Support/BraveSoftware/Brave-Browser"
        case "chrome":
            basePath = "Library/Application Support/Google/Chrome"
        default:
            basePath = "Library/Application Support/Google/Chrome"
        }

        return URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(basePath, isDirectory: true)
            .appendingPathComponent(profile.directory, isDirectory: true)
            .appendingPathComponent("Extensions/hkjbaciefhhgekldhncknbjkofbpenng/\(version)_0", isDirectory: true)
    }

    nonisolated private static func extensionVersion(at url: URL) -> String? {
        let manifestURL = url.appendingPathComponent("manifest.json")
        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return manifest["version"] as? String
    }

    nonisolated static func microphonePermissionString() -> String {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            return "true"
        case .denied:
            return "false"
        case .undetermined:
            return "not_requested"
        @unknown default:
            return "unknown"
        }
    }

    nonisolated static func requestMicrophonePermissionString() -> String {
        let currentStatus = AVAudioApplication.shared.recordPermission
        if currentStatus != .undetermined {
            return microphonePermissionString()
        }

        let semaphore = DispatchSemaphore(value: 0)
        final class PermissionBox: @unchecked Sendable {
            var granted = false
        }
        let permissionBox = PermissionBox()
        AVAudioApplication.requestRecordPermission { allowed in
            permissionBox.granted = allowed
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 30)
        return permissionBox.granted ? "true" : "false"
    }

    nonisolated static func requestMicrophonePermission() async -> Bool {
        let currentStatus = AVAudioApplication.shared.recordPermission
        if currentStatus == .granted {
            return true
        }
        if currentStatus == .denied {
            return false
        }

        return await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { allowed in
                continuation.resume(returning: allowed)
            }
        }
    }

    nonisolated private static func runPackagedMicrophoneSmoke(cliPath: String) throws -> String {
        InterceptorLog.write("runPackagedMicrophoneSmoke start cliPath=\(cliPath)")
        let startResult = try runProcess(
            executable: cliPath,
            arguments: ["--json", "macos", "audio", "input", "start"]
        )
        InterceptorLog.write("runPackagedMicrophoneSmoke startResult status=\(startResult.status) stdout=\(startResult.stdout.trimmingCharacters(in: .whitespacesAndNewlines)) stderr=\(startResult.stderr.trimmingCharacters(in: .whitespacesAndNewlines))")
        try validateCLIProcessResult(startResult)

        let stopResult = try runProcess(
            executable: cliPath,
            arguments: ["--json", "macos", "audio", "input", "stop"]
        )
        InterceptorLog.write("runPackagedMicrophoneSmoke stopResult status=\(stopResult.status) stdout=\(stopResult.stdout.trimmingCharacters(in: .whitespacesAndNewlines)) stderr=\(stopResult.stderr.trimmingCharacters(in: .whitespacesAndNewlines))")
        try validateCLIProcessResult(stopResult)
        return "Microphone verified through the packaged bridge audio stack."
    }

    nonisolated private static func validateCLIProcessResult(_ result: ProcessResult) throws {
        guard let data = result.stdout.data(using: .utf8),
              let decoded = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let success = decoded["success"] as? Bool else {
            if result.status == 0 {
                return
            }
            throw AppError(result.stderr.isEmpty ? result.stdout : result.stderr)
        }

        guard success else {
            let errorMessage = decoded["error"] as? String ?? result.stderr
            throw AppError(errorMessage.isEmpty ? "packaged CLI command failed" : errorMessage)
        }
    }

    nonisolated static func performSetup(
        browser: BrowserOption,
        profile: ProfileOption,
        installDir: URL,
        stateFileURL: URL,
        bundledCLIURL: URL,
        bundledDaemonURL: URL,
        bundledBridgeURL: URL,
        bundledSetupHelperURL: URL,
        extensionURL: URL,
        daemonManifestTemplateURL: URL,
        legacyLaunchAgentURL: URL,
        legacyAppInstallURL: URL,
        currentAppBundleURL: URL
    ) throws {
        try ensureDirectory(at: installDir)
        try ensureDirectory(at: installDir.appendingPathComponent("bin", isDirectory: true))
        try ensureDirectory(at: installDir.appendingPathComponent("state", isDirectory: true))

        try cleanupLegacyLaunchAgent(at: legacyLaunchAgentURL)
        try terminateBrowser(browser)
        if FileManager.default.fileExists(atPath: legacyAppInstallURL.path),
           legacyAppInstallURL.path != currentAppBundleURL.path {
            try? FileManager.default.removeItem(at: legacyAppInstallURL)
        }

        try writeWrapper(name: "interceptor", target: bundledCLIURL.path, installDir: installDir)
        try writeWrapper(name: "interceptor-daemon", target: bundledDaemonURL.path, installDir: installDir)
        try writeWrapper(name: "interceptor-bridge", target: bundledBridgeURL.path, installDir: installDir)

        _ = try runProcess(
            executable: bundledSetupHelperURL.path,
            arguments: [
                "install",
                "--browser", browser.id,
                "--profile", profile.directory,
                "--extension-src", extensionURL.path,
                "--daemon-path", bundledDaemonURL.path,
                "--manifest-template", daemonManifestTemplateURL.path,
            ]
        )

        let state: [String: Any] = [
            "browser": browser.id,
            "profile": profile.directory,
            "configuredAt": ISO8601DateFormatter().string(from: Date()),
            "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            "bundlePath": currentAppBundleURL.path,
            "daemonPath": bundledDaemonURL.path,
        ]
        let data = try JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted])
        try data.write(to: stateFileURL, options: [.atomic])
    }

    nonisolated private static func cleanupLegacyLaunchAgent(at url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) {
            let domain = "gui/\(getuid())/\(BridgeServiceController.label)"
            _ = try? runProcess(executable: "/bin/launchctl", arguments: ["bootout", domain], allowFailure: true)
            try? FileManager.default.removeItem(at: url)
        }
    }

    nonisolated private static func terminateBrowser(_ browser: BrowserOption) throws {
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: browser.bundleIdentifier)
        for app in running {
            app.terminate()
        }

        for _ in 0..<15 {
            if NSRunningApplication.runningApplications(withBundleIdentifier: browser.bundleIdentifier).isEmpty {
                return
            }
            Thread.sleep(forTimeInterval: 1)
        }

        for app in NSRunningApplication.runningApplications(withBundleIdentifier: browser.bundleIdentifier) {
            _ = app.forceTerminate()
        }

        let executablePath: String
        switch browser.id {
        case "brave":
            executablePath = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
        case "chrome":
            executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        default:
            executablePath = browser.appPath
        }

        _ = try? runProcess(executable: "/usr/bin/pkill", arguments: ["-f", executablePath], allowFailure: true)
        Thread.sleep(forTimeInterval: 1.0)
    }

    nonisolated private static func ensureDirectory(at url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    nonisolated private static func writeWrapper(name: String, target: String, installDir: URL) throws {
        let wrapperURL = installDir.appendingPathComponent("bin/\(name)")
        let script = "#!/bin/bash\nexec \"\(target)\" \"$@\"\n"
        try script.write(to: wrapperURL, atomically: true, encoding: .utf8)
        _ = try runProcess(executable: "/bin/chmod", arguments: ["+x", wrapperURL.path])
    }

    nonisolated private static func runProcess(executable: String, arguments: [String], allowFailure: Bool = false) throws -> ProcessResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        try process.run()
        process.waitUntilExit()

        let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()

        let result = ProcessResult(
            status: process.terminationStatus,
            stdout: String(decoding: stdoutData, as: UTF8.self),
            stderr: String(decoding: stderrData, as: UTF8.self)
        )

        if process.terminationStatus != 0 && !allowFailure {
            throw AppError(result.stderr.isEmpty ? result.stdout : result.stderr)
        }

        return result
    }

}

@main
struct InterceptorHostApp: App {
    @StateObject private var viewModel = InterceptorViewModel()

    init() {
        InterceptorHostCommand.runIfNeeded(bundleURL: Bundle.main.bundleURL)
    }

    var body: some Scene {
        WindowGroup {
            InterceptorRootView(viewModel: viewModel)
                .frame(minWidth: 780, minHeight: 560)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 820, height: 620)
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
    }
}

struct InterceptorRootView: View {
    @ObservedObject var viewModel: InterceptorViewModel

    var body: some View {
        ZStack {
            Brand.canvas
                .ignoresSafeArea()

            VStack(spacing: 22) {
                header
                if !viewModel.shouldShowInstallGate {
                    stepDots
                }
                content
                if let setupError = viewModel.setupError, !setupError.isEmpty {
                    Text(setupError)
                        .font(Brand.action(13))
                        .foregroundStyle(Brand.gold)
                        .padding(.horizontal, 24)
                }
            }
            .padding(28)
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            InterceptorLogoMark()
                .frame(width: 84, height: 84)
                .padding(.bottom, 6)

            Text("Finish Setting Up Interceptor")
                .font(Brand.heading(40))
                .tracking(1.3)
                .foregroundStyle(Brand.light)

            Text("Interceptor is installed. This first-launch flow configures your browser profile, background helper, and macOS permissions.")
                .font(Brand.body(15))
                .foregroundStyle(Brand.copy)
                .multilineTextAlignment(.center)
        }
    }

    private var stepDots: some View {
        HStack(spacing: 12) {
            ForEach(AppStep.allCases, id: \.rawValue) { step in
                HStack(spacing: 8) {
                    Circle()
                        .fill(step.rawValue <= viewModel.step.rawValue ? Brand.primary : Color.white.opacity(0.18))
                        .frame(width: 10, height: 10)
                    Text(step.title)
                        .font(Brand.action(12))
                        .foregroundStyle(step.rawValue <= viewModel.step.rawValue ? Brand.light : Brand.muted)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 999)
                        .fill(Color.white.opacity(step == viewModel.step ? 0.10 : 0.04))
                )
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.shouldShowInstallGate {
            InstallGateView(viewModel: viewModel)
        } else {
            switch viewModel.step {
            case .choose:
                ChooseStep(viewModel: viewModel)
            case .setup:
                SetupStepView(viewModel: viewModel)
            case .permissions:
                PermissionsStep(viewModel: viewModel)
            case .done:
                ReadyStep()
            }
        }
    }
}

struct CardShell<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            content
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(Brand.surface.opacity(0.96))
                .overlay(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .stroke(Brand.blue.opacity(0.22), lineWidth: 1)
                )
        )
    }
}

struct InterceptorLogoMark: View {
    var body: some View {
        Group {
            if let url = Bundle.main.url(forResource: "InterceptorLogo", withExtension: "png"),
               let image = NSImage(contentsOf: url) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
                    .shadow(color: Brand.blue.opacity(0.35), radius: 14, x: 0, y: 8)
            } else {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Brand.red, Brand.blue],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            }
        }
    }
}

struct ChooseStep: View {
    @ObservedObject var viewModel: InterceptorViewModel

    var body: some View {
        CardShell {
            Text("Choose Your Browser")
                .font(Brand.heading(30))
                .tracking(0.8)
                .foregroundStyle(Brand.light)

            Text("Interceptor configures your real browser profile, preserves your sessions, and installs the native helper from the signed app bundle in /Applications.")
                .font(Brand.body(15))
                .foregroundStyle(Brand.copy)
                .fixedSize(horizontal: false, vertical: true)

            if let repairReason = viewModel.setupHealth.repairReason {
                Text(repairReason)
                    .font(Brand.action(13))
                    .foregroundStyle(Brand.gold)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if viewModel.legacyInstallDetected {
                Text("A legacy home-directory install was detected. This setup run will migrate wrappers and retire the old launch-agent path.")
                    .font(Brand.action(13))
                    .foregroundStyle(Brand.gold)
            }

            HStack(spacing: 16) {
                ForEach(viewModel.browsers) { browser in
                    Button {
                        viewModel.selectedBrowser = browser
                        viewModel.refreshProfiles()
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(browser.label)
                                .font(Brand.action(17))
                                .foregroundStyle(Brand.light)
                            Text(browser.id == "brave" ? "Best for privacy-focused sessions." : "Best for Chrome-based workflows.")
                                .font(Brand.body(13))
                                .foregroundStyle(Brand.muted)
                        }
                        .padding(20)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .fill(viewModel.selectedBrowser == browser ? Brand.surfaceRaised : Brand.surface.opacity(0.65))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                                        .stroke(viewModel.selectedBrowser == browser ? Brand.primary : Brand.surfaceEdge.opacity(0.5), lineWidth: 1)
                                )
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Profile")
                    .font(Brand.action(14))
                    .foregroundStyle(Brand.copy)

                Picker("Profile", selection: Binding(
                    get: { viewModel.selectedProfile?.id ?? "" },
                    set: { newValue in
                        viewModel.selectedProfile = viewModel.profiles.first { $0.id == newValue }
                    })
                ) {
                    ForEach(viewModel.profiles) { profile in
                        Text(profile.displayName).tag(profile.id)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
            }

            Spacer()

            HStack {
                Spacer()
                Button(action: viewModel.beginSetup) {
                    Text(viewModel.setupActionTitle)
                        .font(Brand.action(15))
                        .foregroundStyle(Brand.light)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 14)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Brand.primary)
                        )
                }
                .buttonStyle(.plain)
                .disabled(viewModel.selectedBrowser == nil || viewModel.selectedProfile == nil || viewModel.isWorking)
                .opacity((viewModel.selectedBrowser == nil || viewModel.selectedProfile == nil || viewModel.isWorking) ? 0.5 : 1)
            }
        }
    }
}

struct SetupStepView: View {
    @ObservedObject var viewModel: InterceptorViewModel

    var body: some View {
        CardShell {
            Text("Configuring")
                .font(Brand.heading(30))
                .tracking(0.8)
                .foregroundStyle(Brand.light)

            Text(viewModel.setupMessage)
                .font(Brand.body(15))
                .foregroundStyle(Brand.copy)

            ProgressView()
                .progressViewStyle(.linear)
                .tint(Brand.primary)

            VStack(alignment: .leading, spacing: 12) {
                SetupBullet(title: "CLI Wrappers", detail: "Writing wrappers into ~/.interceptor/bin")
                SetupBullet(title: "Browser Injection", detail: "Updating the selected browser profile and native messaging host")
                SetupBullet(title: "Background Helper", detail: "Preparing the bundled bridge service for SMAppService registration")
            }

            Spacer()
        }
    }
}

struct SetupBullet: View {
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(Color(red: 0.24, green: 0.84, blue: 1.0))
                .frame(width: 8, height: 8)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(Brand.action(15))
                    .foregroundStyle(Brand.light)
                Text(detail)
                    .font(Brand.body(13))
                    .foregroundStyle(Brand.muted)
            }
        }
    }
}

struct PermissionsStep: View {
    @ObservedObject var viewModel: InterceptorViewModel

    private var finishTitle: String {
        (viewModel.trust.accessibility == .granted && viewModel.helper.state == .enabled) ? "Open Browser & Finish" : "Finish Anyway"
    }

    private var accessibilityAction: (() -> Void)? {
        guard viewModel.helper.state == .enabled, viewModel.trust.accessibility != .granted else { return nil }
        return { viewModel.grantAccessibility() }
    }

    private var screenAction: (() -> Void)? {
        guard viewModel.helper.state == .enabled, viewModel.trust.screenRecording != .granted else { return nil }
        return { viewModel.grantScreenRecording() }
    }

    private var microphoneAction: (() -> Void)? {
        guard viewModel.microphoneActionEnabled else { return nil }
        return { viewModel.grantMicrophone() }
    }

    var body: some View {
        CardShell {
            Text("Finish Setup")
                .font(Brand.heading(30))
                .tracking(0.8)
                .foregroundStyle(Brand.light)

            Text("Enable the bundled bridge helper in Login Items, then grant the Privacy permissions that make native control work.")
                .font(Brand.body(15))
                .foregroundStyle(Brand.copy)
                .fixedSize(horizontal: false, vertical: true)

            Text("Accessibility and Screen Recording unlock the core native workflows. Microphone is optional — Interceptor does not require it, but it does make Interceptor more capable.")
                .font(Brand.action(13))
                .foregroundStyle(Brand.gold)
                .fixedSize(horizontal: false, vertical: true)

            ServiceRow(
                icon: "switch.2",
                tint: viewModel.helper.state.tint,
                title: "Background Helper",
                subtitle: "Registered with SMAppService from the installed app bundle instead of a legacy plist in ~/Library/LaunchAgents.",
                stateLabel: viewModel.helper.state.label,
                buttonTitle: viewModel.helper.state.actionTitle,
                action: viewModel.helper.state.actionTitle == nil ? nil : { viewModel.helperAction() }
            )

            PermissionRow(
                icon: "hand.raised.fill",
                tint: Color(red: 0.24, green: 0.84, blue: 1.0),
                title: "Accessibility",
                subtitle: "Required for AX tree inspection, trusted clicks, typing, and window control.",
                state: viewModel.trust.accessibility,
                buttonTitle: viewModel.trust.accessibility == .granted ? "Granted" : "Grant Accessibility",
                action: accessibilityAction
            )

            PermissionRow(
                icon: "rectangle.dashed.badge.record",
                tint: Color(red: 1.0, green: 0.74, blue: 0.33),
                title: "Screen Recording",
                subtitle: "Recommended for screenshots, OCR, and Vision APIs.",
                state: viewModel.trust.screenRecording,
                buttonTitle: viewModel.trust.screenRecording == .granted ? "Granted" : "Grant Screen Recording",
                action: screenAction
            )

            PermissionRow(
                icon: "mic.fill",
                tint: Color(red: 0.31, green: 0.93, blue: 0.58),
                title: "Microphone",
                subtitle: "Optional. Enables speech recognition and voice-driven features if you want them. Interceptor verifies the live bridge audio path after permission is granted.",
                state: viewModel.trust.microphone,
                buttonTitle: viewModel.microphoneButtonTitle,
                action: microphoneAction
            )

            if let microphoneRuntimeMessage = viewModel.microphoneRuntimeMessage, !microphoneRuntimeMessage.isEmpty {
                Text(microphoneRuntimeMessage)
                    .font(Brand.action(13))
                    .foregroundStyle(viewModel.microphoneRuntimeReady ? Color(red: 0.24, green: 0.92, blue: 0.55) : Brand.gold)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if viewModel.helper.legacyPlistExists {
                Text("A legacy launch-agent plist is still present. Interceptor will stop using it after migration.")
                    .font(Brand.action(13))
                    .foregroundStyle(Brand.gold)
            }

            if viewModel.needsBrowserRestart {
                Text("Screen Recording changes may require reopening apps that Interceptor captures.")
                    .font(Brand.action(13))
                    .foregroundStyle(Brand.gold)
            }

            Spacer()

            HStack {
                Button("Finish Later") {
                    viewModel.finishLater()
                }
                .buttonStyle(.plain)
                .foregroundStyle(Brand.copy)

                Button("Refresh Status") {
                    viewModel.refreshStatuses()
                }
                .buttonStyle(.plain)
                .foregroundStyle(Brand.primary)

                Spacer()

                Button(action: viewModel.finish) {
                    Text(finishTitle)
                        .font(Brand.action(15))
                        .foregroundStyle(Brand.light)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 14)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Brand.primary)
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct ServiceRow: View {
    let icon: String
    let tint: Color
    let title: String
    let subtitle: String
    let stateLabel: String
    let buttonTitle: String?
    let action: (() -> Void)?

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Text(title)
                        .font(Brand.action(15))
                        .foregroundStyle(Brand.light)
                    Text(stateLabel)
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(tint)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(tint.opacity(0.14)))
                }
                Text(subtitle)
                    .font(Brand.body(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            if let buttonTitle, let action {
                Button(action: action) {
                    Text(buttonTitle)
                        .font(Brand.action(13))
                        .foregroundStyle(Brand.light)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(Brand.surfaceRaised)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(Brand.primary.opacity(0.35), lineWidth: 1)
                                )
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Brand.surfaceRaised.opacity(0.9))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Brand.blue.opacity(0.18), lineWidth: 1)
                )
        )
    }
}

struct PermissionRow: View {
    let icon: String
    let tint: Color
    let title: String
    let subtitle: String
    let state: PermissionState
    let buttonTitle: String
    let action: (() -> Void)?

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Text(title)
                        .font(Brand.action(15))
                        .foregroundStyle(Brand.light)
                    Text(state.label)
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(state.tint)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(state.tint.opacity(0.14)))
                }
                Text(subtitle)
                    .font(Brand.body(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            if let action {
                Button(action: action) {
                    Text(buttonTitle)
                        .font(Brand.action(13))
                        .foregroundStyle(Brand.light)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(Brand.surfaceRaised)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(Brand.primary.opacity(0.35), lineWidth: 1)
                                )
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Brand.surfaceRaised.opacity(0.9))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Brand.blue.opacity(0.18), lineWidth: 1)
                )
        )
    }
}

struct InstallGateView: View {
    @ObservedObject var viewModel: InterceptorViewModel

    var body: some View {
        CardShell {
            Text("Move Interceptor First")
                .font(Brand.heading(30))
                .tracking(0.8)
                .foregroundStyle(Brand.light)

            Text("Setup and updates only work when Interceptor.app is running from /Applications.")
                .font(Brand.body(15))
                .foregroundStyle(Brand.copy)

            Text(viewModel.installGateReason)
                .font(Brand.action(13))
                .foregroundStyle(Brand.gold)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 10) {
                SetupBullet(title: "1. Drag Interceptor.app", detail: "Drop the app into the Applications folder from the mounted DMG.")
                SetupBullet(title: "2. Launch From Applications", detail: "Open /Applications/Interceptor.app after the copy completes.")
                SetupBullet(title: "3. Finish Setup In-App", detail: "Interceptor will then repair the browser profile, helper, and privacy permissions from the installed app bundle.")
            }

            Spacer()

            HStack {
                Button("Quit") {
                    NSApplication.shared.terminate(nil)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Brand.copy)

                Spacer()

                Button(action: viewModel.openApplicationsFolder) {
                    Text("Open Applications Folder")
                        .font(Brand.action(15))
                        .foregroundStyle(Brand.light)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 14)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Brand.primary)
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct ReadyStep: View {
    var body: some View {
        CardShell {
            Text("Interceptor Is Ready")
                .font(Brand.heading(30))
                .tracking(0.8)
                .foregroundStyle(Brand.light)

            Text("The installed app, bundled helper, and browser profile setup are complete.")
                .font(Brand.body(15))
                .foregroundStyle(Brand.copy)

            Spacer()
        }
    }
}
