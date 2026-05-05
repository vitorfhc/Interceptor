import XCTest
import ApplicationServices
@testable import interceptor_bridge

final class InputTargetSelectionTests: XCTestCase {
    // System-wide AX root makes a stable AXUIElement that can be
    // returned from the resolveRef hook without any UI side effects.
    // We never call into AX from the selector itself; this is just a
    // valid CFTypeRef that the helper carries through.
    private var anyElement: AXUIElement {
        AXUIElementCreateSystemWide()
    }

    func testRefWithRegisteredEntryPrefersAxPress() {
        let selector = InputTargetSelector(
            resolveRef: { ref in
                ref == "e1" ? (self.anyElement, pid_t(1234)) : nil
            },
            resolvePidByName: { _ in nil }
        )

        let kind = selector.selectKind(ref: "e1", appName: nil, pid: nil)
        XCTAssertEqual(kind, .axPress)
    }

    func testRefThatDoesNotResolveFallsThroughToPostToPidWhenPidProvided() {
        let selector = InputTargetSelector(
            resolveRef: { _ in nil },
            resolvePidByName: { _ in nil }
        )

        let kind = selector.selectKind(ref: "e99", appName: nil, pid: pid_t(7777))
        XCTAssertEqual(kind, .postToPid)
    }

    func testExplicitPidRoutesToPostToPid() {
        let selector = InputTargetSelector(
            resolveRef: { _ in nil },
            resolvePidByName: { _ in nil }
        )

        let kind = selector.selectKind(ref: nil, appName: nil, pid: pid_t(4321))
        XCTAssertEqual(kind, .postToPid)
    }

    func testAppNameRoutesToPostToPidWhenNameResolves() {
        let selector = InputTargetSelector(
            resolveRef: { _ in nil },
            resolvePidByName: { name in
                name == "TextEdit" ? pid_t(8888) : nil
            }
        )

        let kind = selector.selectKind(ref: nil, appName: "TextEdit", pid: nil)
        XCTAssertEqual(kind, .postToPid)
    }

    func testAppNameThatDoesNotResolveFallsToCghidEventTap() {
        let selector = InputTargetSelector(
            resolveRef: { _ in nil },
            resolvePidByName: { _ in nil }
        )

        let kind = selector.selectKind(ref: nil, appName: "NoSuchApp", pid: nil)
        XCTAssertEqual(kind, .cghidEventTap)
    }

    func testNoTargetingFallsToCghidEventTap() {
        let selector = InputTargetSelector(
            resolveRef: { _ in nil },
            resolvePidByName: { _ in nil }
        )

        let kind = selector.selectKind(ref: nil, appName: nil, pid: nil)
        XCTAssertEqual(kind, .cghidEventTap)
    }

    func testRefBeatsExplicitPid() {
        let selector = InputTargetSelector(
            resolveRef: { ref in
                ref == "e2" ? (self.anyElement, pid_t(1111)) : nil
            },
            resolvePidByName: { _ in nil }
        )

        let kind = selector.selectKind(ref: "e2", appName: nil, pid: pid_t(2222))
        XCTAssertEqual(kind, .axPress)
    }

    func testResolveTargetPidPrefersRefOwnerOverExplicitPid() {
        let selector = InputTargetSelector(
            resolveRef: { ref in
                ref == "e3" ? (self.anyElement, pid_t(5555)) : nil
            },
            resolvePidByName: { _ in nil }
        )

        let pid = selector.resolveTargetPid(ref: "e3", appName: nil, pid: pid_t(6666))
        XCTAssertEqual(pid, pid_t(5555))
    }

    func testResolveTargetPidFallsThroughToExplicitPidThenAppLookup() {
        let selector = InputTargetSelector(
            resolveRef: { _ in nil },
            resolvePidByName: { name in
                name == "Finder" ? pid_t(9999) : nil
            }
        )

        XCTAssertEqual(selector.resolveTargetPid(ref: nil, appName: nil, pid: pid_t(7777)), pid_t(7777))
        XCTAssertEqual(selector.resolveTargetPid(ref: nil, appName: "Finder", pid: nil), pid_t(9999))
        XCTAssertNil(selector.resolveTargetPid(ref: nil, appName: "Other", pid: nil))
    }
}
