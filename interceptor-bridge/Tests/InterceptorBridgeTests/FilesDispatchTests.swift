import XCTest
@testable import interceptor_bridge

// Regression: FilesDomain.handle was switching on `command` so
// `files recent`, `files watch`, `files open` all fell through to
// `notImplemented`. These tests pin the dispatch contract.

private final class FilesResultHolder: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String: Any] = [:]
    var value: [String: Any] {
        lock.lock(); defer { lock.unlock() }; return stored
    }
    func set(_ v: [String: Any]) { lock.lock(); stored = v; lock.unlock() }
}

final class FilesDispatchTests: XCTestCase {
    private func dispatch(sub: String, extra: [String: Any] = [:]) -> [String: Any] {
        let domain = FilesDomain()
        var action: [String: Any] = ["type": "macos_files", "sub": sub]
        for (k, v) in extra { action[k] = v }
        let holder = FilesResultHolder()
        let exp = expectation(description: "files dispatch \(sub)")
        domain.handle("files", action: action) { r in
            holder.set(r)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5.0)
        return holder.value
    }

    private func isNotImplemented(_ result: [String: Any]) -> Bool {
        let err = (result["error"] as? String) ?? ""
        return err.contains("not yet implemented") || err.contains("not implemented")
    }

    func testRecentIsRoutedFromSub() {
        let r = dispatch(sub: "recent")
        XCTAssertFalse(isNotImplemented(r), "recent sub must reach the recent handler")
    }

    func testWatchIsRoutedFromSubAndFailsOnMissingPath() {
        // No `path` key — handler should reject with "watch requires a
        // path", proving the router reached the watch handler.
        let r = dispatch(sub: "watch")
        XCTAssertFalse(isNotImplemented(r))
        let err = (r["error"] as? String) ?? ""
        XCTAssertTrue(err.contains("watch requires a path"), "got: \(err)")
    }

    func testOpenIsRoutedFromSub() {
        let r = dispatch(sub: "open")
        XCTAssertFalse(isNotImplemented(r), "open sub must reach the open handler")
    }

    func testUnknownSubReturnsNotImplementedWithSubString() {
        let r = dispatch(sub: "garbage")
        let err = (r["error"] as? String) ?? ""
        XCTAssertTrue(err.contains("garbage"), "Error should reference the unknown sub")
    }
}
