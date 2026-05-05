import Foundation
import AVFoundation

// Wraps Apple's AVCaptureDevice authorization-status surface so TrustDomain
// can be unit-tested without driving the live AVCaptureDevice singleton.
//
// Apple-doc anchors:
//   AVAuthorizationStatus            — 4-state enum: notDetermined / restricted / denied / authorized
//   authorizationStatus(for:)        — returns the current AVAuthorizationStatus
//   requestAccess(for:completionHandler:) — non-blocking; "doesn't block the
//                                            thread while the system is
//                                            prompting the user for access"
//
// The provider is a thin protocol over those two calls. Production callers
// use `.live`. Tests inject deterministic closures.
protocol MicrophoneAuthorizationProvider: Sendable {
    func currentStatus() -> AVAuthorizationStatus
    func requestAccess(_ completion: @escaping @Sendable (Bool) -> Void)
}

// Production-default wiring. Calls Apple's APIs directly.
struct LiveMicrophoneAuthorizationProvider: MicrophoneAuthorizationProvider {
    func currentStatus() -> AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: .audio)
    }

    func requestAccess(_ completion: @escaping @Sendable (Bool) -> Void) {
        // Apple's documented contract: "Calling this method doesn't block the
        // thread while the system is prompting the user for access."
        // We deliberately do not await the completion in TrustDomain; the
        // caller re-polls `authorizationStatus(for:)` to observe the result.
        AVCaptureDevice.requestAccess(for: .audio, completionHandler: completion)
    }
}

// Maps Apple's AVAuthorizationStatus into the unified PermissionStatus
// vocabulary used in the trust response. Mic is the only TCC surface
// where Apple exposes all four cases, so this is the only mapping site.
extension AVAuthorizationStatus {
    var permissionStatus: PermissionStatus {
        switch self {
        case .authorized: return .granted
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }
}

// Unified status vocabulary across all three TCC surfaces in the trust
// response. Lifted from Apple's AVAuthorizationStatus enum so the JSON
// schema is self-documenting against Apple's public API.
//
// AX and Screen Recording can only ever produce .granted or .denied —
// Apple's AXIsProcessTrusted / CGPreflightScreenCaptureAccess return Bool
// only, so notDetermined and restricted are unobservable for those
// surfaces via public API. Trust response carries a `limitation` field on
// AX/Screen entries to make that asymmetry self-documenting.
enum PermissionStatus: String, Sendable {
    case granted
    case denied
    case notDetermined = "not_determined"
    case restricted

    static func fromBool(_ granted: Bool) -> PermissionStatus {
        granted ? .granted : .denied
    }
}
