import XCTest
@testable import interceptor_bridge

// Regression: CaptureDomain.handleCapture("frame", ...) used to
// check `latestFrame` synchronously and return "no active capture stream
// — use screenshot instead" any time the first sample buffer hadn't yet
// arrived. Apple's SCStream.startCapture(completionHandler:) doc says
// the success callback fires when the stream "successfully starts" but
// the first frame arrives async via SCStreamOutput. These tests pin the
// new behavior: distinguish "no stream" vs "stream active no frame yet"
// and respect a configurable timeout.

// Lock-protected holder so completion-handler mutations are Sendable.
private final class ResultHolder: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String: Any] = [:]
    var value: [String: Any] {
        lock.lock(); defer { lock.unlock() }
        return stored
    }
    func set(_ v: [String: Any]) {
        lock.lock(); stored = v; lock.unlock()
    }
}

final class CaptureFrameTimingTests: XCTestCase {
    private func dispatchFrame(_ domain: CaptureDomain, timeoutMs: Int? = nil) -> [String: Any] {
        var action: [String: Any] = ["type": "macos_capture", "sub": "frame"]
        if let timeoutMs = timeoutMs { action["timeoutMs"] = timeoutMs }
        let holder = ResultHolder()
        let exp = expectation(description: "frame dispatch")
        domain.handle("capture", action: action) { r in
            holder.set(r)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5.0)
        return holder.value
    }

    func testNoStreamReturnsCaptureNotStarted() {
        let domain = CaptureDomain()
        let r = dispatchFrame(domain)
        let err = (r["error"] as? String) ?? ""
        XCTAssertTrue(
            err.contains("capture not started"),
            "Expected 'capture not started' error, got: \(err)"
        )
        // Specifically: must NOT incorrectly suggest using screenshot
        // when the stream simply wasn't started — that's a different
        // failure mode for an active-but-empty stream.
        XCTAssertFalse(err.contains("use screenshot instead") && err.contains("active but no frame"))
    }

    func testBufferedFrameReturnsImmediately() {
        let domain = CaptureDomain()
        let payload = "test-immediate-frame".data(using: .utf8)!
        domain._testInjectFrame(payload)

        let r = dispatchFrame(domain, timeoutMs: 100)
        XCTAssertEqual(r["success"] as? Bool, true)
        let data = r["data"] as? [String: Any]
        let dataUrl = (data?["dataUrl"] as? String) ?? ""
        XCTAssertTrue(dataUrl.hasPrefix("data:image/jpeg;base64,"))
        XCTAssertTrue(dataUrl.contains(payload.base64EncodedString()))
        domain._testReset()
    }

    func testStreamActiveButNoFrameTimesOut() {
        let domain = CaptureDomain()
        domain.testForcedActive = true
        defer { domain._testReset() }

        let start = Date()
        let r = dispatchFrame(domain, timeoutMs: 200)
        let elapsed = Date().timeIntervalSince(start)
        let err = (r["error"] as? String) ?? ""
        XCTAssertTrue(
            err.contains("capture stream active but no frame in 200ms"),
            "Expected timeout-error wording with 200ms, got: \(err)"
        )
        XCTAssertGreaterThanOrEqual(elapsed, 0.18, "Should actually wait close to 200ms; waited \(elapsed)s")
        XCTAssertLessThan(elapsed, 1.5, "Should not wait far beyond timeout; waited \(elapsed)s")
    }

    func testStreamActiveAndFrameArrivesMidWaitReturnsSuccess() {
        let domain = CaptureDomain()
        domain.testForcedActive = true
        defer { domain._testReset() }

        let payload = "test-midwait-frame".data(using: .utf8)!
        // Dispatch the frame request first — it will block waiting on the
        // semaphore for up to 1500ms — then inject a frame ~150ms later
        // to simulate ScreenCaptureKit delivering the first sample buffer
        // after startCapture's success callback returned.
        let holder = ResultHolder()
        let exp = expectation(description: "midwait frame")
        let action: [String: Any] = ["type": "macos_capture", "sub": "frame", "timeoutMs": 1500]
        domain.handle("capture", action: action) { r in
            holder.set(r)
            exp.fulfill()
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(150)) {
            domain._testInjectFrame(payload)
        }
        wait(for: [exp], timeout: 3.0)

        let result = holder.value
        XCTAssertEqual(result["success"] as? Bool, true, "Expected success after frame injection. Got: \(result)")
        let data = result["data"] as? [String: Any]
        let dataUrl = (data?["dataUrl"] as? String) ?? ""
        XCTAssertTrue(dataUrl.contains(payload.base64EncodedString()), "dataUrl should contain the injected payload")
    }

    func testTimeoutMsHonored() {
        // 50ms timeout — verifies the timeoutMs override flows through.
        let domain = CaptureDomain()
        domain.testForcedActive = true
        defer { domain._testReset() }

        let r = dispatchFrame(domain, timeoutMs: 50)
        let err = (r["error"] as? String) ?? ""
        XCTAssertTrue(err.contains("50ms"), "Expected timeout error to mention 50ms, got: \(err)")
    }
}
