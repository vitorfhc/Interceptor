import XCTest
@testable import interceptor_bridge

// Regression: NotificationsDomain.handle was switching on
// `command` so `notifications tail` and `notifications log` all fell
// through to `notImplemented`. These tests pin the dispatch contract.

private final class NotificationsResultHolder: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String: Any] = [:]
    var value: [String: Any] {
        lock.lock(); defer { lock.unlock() }; return stored
    }
    func set(_ v: [String: Any]) { lock.lock(); stored = v; lock.unlock() }
}

final class NotificationsDispatchTests: XCTestCase {
    private func dispatch(sub: String, extra: [String: Any] = [:]) -> [String: Any] {
        let domain = NotificationsDomain()
        var action: [String: Any] = ["type": "macos_notifications", "sub": sub]
        for (k, v) in extra { action[k] = v }
        let holder = NotificationsResultHolder()
        let exp = expectation(description: "notifications dispatch \(sub)")
        domain.handle("notifications", action: action) { r in
            holder.set(r)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 2.0)
        return holder.value
    }

    private func isNotImplemented(_ result: [String: Any]) -> Bool {
        let err = (result["error"] as? String) ?? ""
        return err.contains("not yet implemented") || err.contains("not implemented")
    }

    func testTailIsRoutedFromSub() {
        let r = dispatch(sub: "tail")
        XCTAssertFalse(isNotImplemented(r), "tail sub must reach the tail handler")
        XCTAssertEqual(r["success"] as? Bool, true)
    }

    func testLogIsRoutedFromSub() {
        let r = dispatch(sub: "log", extra: ["limit": 5])
        XCTAssertFalse(isNotImplemented(r), "log sub must reach the log handler")
    }

    func testUnknownSubReturnsNotImplementedWithSubString() {
        let r = dispatch(sub: "unknownop")
        let err = (r["error"] as? String) ?? ""
        XCTAssertTrue(err.contains("unknownop"), "Error should reference the unknown sub")
    }
}
