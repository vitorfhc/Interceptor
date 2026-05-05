import Foundation
import ApplicationServices
import AppKit

// Picks how a synthesized input event should be delivered without
// stealing focus when a target is known. Three documented Apple
// delivery layers, ordered from most-specific to least-specific:
//
//   axPress(elem)       — AXUIElementPerformAction(kAXPressAction).
//                         Pure AX, no event posting, never moves focus.
//   postToPid(pid)      — CGEvent.postToPid(_:). Per-process delivery,
//                         does not require the target to be frontmost.
//   cghidEventTap       — system-wide HID, routed by WindowServer to
//                         the frontmost app. Legacy "drive whatever's
//                         on screen" behavior.
//
// The selector is a pure decision function over (ref, app, pid).
// It does not perform any AX or event work itself — callers do that —
// so it is trivially unit-testable.
enum InputTarget: Equatable, @unchecked Sendable {
    case axPress(AXUIElement)
    case postToPid(pid_t)
    case cghidEventTap

    static func == (lhs: InputTarget, rhs: InputTarget) -> Bool {
        switch (lhs, rhs) {
        case (.axPress, .axPress): return true
        case (.postToPid(let a), .postToPid(let b)): return a == b
        case (.cghidEventTap, .cghidEventTap): return true
        default: return false
        }
    }
}

// Compact, testable variant that doesn't carry the AXUIElement so we
// can compare decisions in unit tests without fabricating live AX state.
enum InputTargetKind: String, Equatable {
    case axPress
    case postToPid
    case cghidEventTap
}

struct InputTargetSelector {
    // Resolution functions are injected so tests can drive the
    // selector with deterministic inputs. Production callers pass the
    // real RefRegistry / NSWorkspace lookups.
    let resolveRef: (String) -> (element: AXUIElement, pid: pid_t?)?
    let resolvePidByName: (String) -> pid_t?

    init(
        resolveRef: @escaping (String) -> (element: AXUIElement, pid: pid_t?)?,
        resolvePidByName: @escaping (String) -> pid_t?
    ) {
        self.resolveRef = resolveRef
        self.resolvePidByName = resolvePidByName
    }

    // Live-AX selection. Called from InputDomain when the request
    // carries a real ref and we want the actual AXUIElement back.
    func select(ref: String?, appName: String?, pid: pid_t?) -> InputTarget {
        if let ref = ref, let entry = resolveRef(ref) {
            return .axPress(entry.element)
        }
        if let pid = pid {
            return .postToPid(pid)
        }
        if let appName = appName, let resolved = resolvePidByName(appName) {
            return .postToPid(resolved)
        }
        return .cghidEventTap
    }

    // Pure-decision variant for tests: returns the kind only.
    // Identical control flow to `select(...)`.
    func selectKind(ref: String?, appName: String?, pid: pid_t?) -> InputTargetKind {
        if let ref = ref, resolveRef(ref) != nil {
            return .axPress
        }
        if pid != nil {
            return .postToPid
        }
        if let appName = appName, resolvePidByName(appName) != nil {
            return .postToPid
        }
        return .cghidEventTap
    }

    // Ref-aware PID resolution: when a ref is provided and registered,
    // its owning PID is the right target for any keyboard fallback path
    // that needs CGEvent.postToPid (e.g. text-field type when AX value
    // set is rejected). Falls through to the explicit pid / app lookup
    // chain otherwise.
    func resolveTargetPid(ref: String?, appName: String?, pid: pid_t?) -> pid_t? {
        if let ref = ref, let entry = resolveRef(ref), let owner = entry.pid {
            return owner
        }
        if let pid = pid { return pid }
        if let appName = appName, let resolved = resolvePidByName(appName) { return resolved }
        return nil
    }
}

// Production-default lookup wiring. Keeps construction sites short.
extension InputTargetSelector {
    static func live(refRegistry: RefRegistry = .shared) -> InputTargetSelector {
        InputTargetSelector(
            resolveRef: { ref in
                guard let entry = refRegistry.resolveInfo(ref) else { return nil }
                return (entry.element, entry.pid)
            },
            resolvePidByName: { name in
                NSWorkspace.shared.runningApplications
                    .first(where: { $0.localizedName?.lowercased() == name.lowercased() })?
                    .processIdentifier
            }
        )
    }
}
