import XCTest
import ApplicationServices
@testable import interceptor_bridge

final class RefRegistryTests: XCTestCase {
    func testRegistryStoresPIDMetadataAlongsideElementRefs() {
        let registry = RefRegistry()
        let element = AXUIElementCreateSystemWide()
        let ref = registry.register(element, pid: 4242)

        XCTAssertNotNil(registry.resolve(ref))
        XCTAssertEqual(registry.resolvePID(ref), 4242)
        XCTAssertEqual(registry.resolveInfo(ref)?.pid, 4242)
    }

    func testClearRemovesElementsAndResetsCounter() {
        let registry = RefRegistry()
        _ = registry.register(AXUIElementCreateSystemWide(), pid: 1)
        registry.clear()

        XCTAssertEqual(registry.count, 0)
        XCTAssertEqual(registry.currentCount(), 0)

        let next = registry.register(AXUIElementCreateSystemWide(), pid: 2)
        XCTAssertEqual(next, "e1")
        XCTAssertEqual(registry.resolvePID(next), 2)
    }
}
