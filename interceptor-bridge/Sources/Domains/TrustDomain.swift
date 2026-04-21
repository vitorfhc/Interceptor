import Foundation
import ApplicationServices
import AppKit
import CoreGraphics
import AVFoundation

final class TrustDomain: DomainHandler, @unchecked Sendable {
    func handle(_ command: String, action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        switch command {
        case "trust", "preflight":
            preflight(action: action, completion: completion)
        default:
            notImplemented(command, completion: completion)
        }
    }

    private func preflight(completion: @escaping @Sendable ([String: Any]) -> Void) {
        preflight(action: [:], completion: completion)
    }

    private func preflight(action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        let prompt = action["prompt"] as? Bool ?? false
        let walkthrough = action["walkthrough"] as? Bool ?? false
        let accessibilityPrompt = action["accessibilityPrompt"] as? Bool ?? false
        let screenPrompt = action["screenPrompt"] as? Bool ?? false
        let microphonePrompt = action["microphonePrompt"] as? Bool ?? false

        let shouldPromptAccessibility = prompt || walkthrough || accessibilityPrompt
        let shouldPromptScreen = prompt || walkthrough || screenPrompt
        let shouldPromptMicrophone = prompt || walkthrough || microphonePrompt

        let accessibilityGranted = promptAccessibilityIfNeeded(prompt: shouldPromptAccessibility)
        let screenGranted = requestScreenRecordingIfNeeded(prompt: shouldPromptScreen)
        let micGrantedNow = requestMicrophoneIfNeeded(prompt: shouldPromptMicrophone)

        var openedPanes: [String] = []
        if walkthrough {
            if !accessibilityGranted {
                openPrivacyPane("Privacy_Accessibility")
                openedPanes.append("Accessibility")
            } else if !screenGranted {
                openPrivacyPane("Privacy_ScreenCapture")
                openedPanes.append("Screen Recording")
            } else if micGrantedNow != "true" {
                openPrivacyPane("Privacy_Microphone")
                openedPanes.append("Microphone")
            }
        }

        let displayName =
            (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? "Interceptor"

        let permissions: [[String: Any]] = [
            [
                "name": "Accessibility",
                "granted": accessibilityGranted,
                "required": true,
                "path": "System Settings → Privacy & Security → Accessibility → Enable \(displayName)",
                "reason": "Required for UI element inspection, clicking, typing, and window management"
            ],
            [
                "name": "Microphone",
                "granted": micGrantedNow,
                "required": false,
                "path": "System Settings → Privacy & Security → Microphone → Enable \(displayName)",
                "reason": "Required for speech recognition and voice activity detection"
            ],
            [
                "name": "Screen Recording",
                "granted": screenGranted,
                "required": false,
                "path": "System Settings → Privacy & Security → Screen Recording → Enable \(displayName)",
                "reason": "Required for screenshots, screen capture, and vision analysis"
            ]
        ]

        var instructions: [String] = []
        for perm in permissions {
            let grantedValue = perm["granted"]
            let denied =
                (grantedValue as? Bool) == false ||
                (grantedValue as? String) == "false"
            if denied {
                instructions.append(perm["path"] as? String ?? "")
            }
        }

        var result: [String: Any] = [
            "accessibility": accessibilityGranted,
            "screenRecording": screenGranted,
            "microphone": micGrantedNow,
            "permissions": permissions,
            "bundlePath": Bundle.main.bundlePath,
            "displayName": displayName
        ]

        if !instructions.isEmpty {
            result["action_required"] = instructions
        }
        var prompted: [String] = []
        if shouldPromptAccessibility { prompted.append("Accessibility") }
        if shouldPromptScreen { prompted.append("Screen Recording") }
        if shouldPromptMicrophone { prompted.append("Microphone") }
        if !prompted.isEmpty {
            result["prompted"] = prompted
        }
        if !openedPanes.isEmpty {
            result["opened"] = openedPanes
        }

        completion(WireFormat.success(result))
    }

    private func promptAccessibilityIfNeeded(prompt: Bool) -> Bool {
        guard prompt else { return AXIsProcessTrusted() }
        let key = "AXTrustedCheckOptionPrompt" as CFString
        let options = [key: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    private func requestScreenRecordingIfNeeded(prompt: Bool) -> Bool {
        guard prompt else { return CGPreflightScreenCaptureAccess() }
        if CGPreflightScreenCaptureAccess() {
            return true
        }
        return CGRequestScreenCaptureAccess()
    }

    private func requestMicrophoneIfNeeded(prompt: Bool) -> String {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        switch status {
        case .authorized:
            return "true"
        case .denied, .restricted:
            return "false"
        case .notDetermined:
            guard prompt else { return "not_requested" }
            let semaphore = DispatchSemaphore(value: 0)
            var granted = false
            AVCaptureDevice.requestAccess(for: .audio) { allowed in
                granted = allowed
                semaphore.signal()
            }
            _ = semaphore.wait(timeout: .now() + 30)
            return granted ? "true" : "false"
        @unknown default:
            return "unknown"
        }
    }

    private func openPrivacyPane(_ anchor: String) {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)") else {
            return
        }
        Task { @MainActor in
            NSWorkspace.shared.open(url)
        }
    }
}
