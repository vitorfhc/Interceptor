import XCTest
@testable import interceptor_bridge

final class AccessibilityDomainTests: XCTestCase {
    func testBuildSearchableTextIncludesRoleIdentifierAndVisibleStrings() {
        let searchable = AccessibilityDomain.buildSearchableText(
            title: "",
            description: "",
            value: "",
            identifier: "First Text View",
            roleDescription: "text entry area",
            displayRole: "textarea"
        )

        XCTAssertTrue(searchable.contains("first text view"))
        XCTAssertTrue(searchable.contains("text entry area"))
        XCTAssertTrue(searchable.contains("textarea"))
    }
}
