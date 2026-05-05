import XCTest
@testable import interceptor_bridge

final class AppsDomainTests: XCTestCase {
    func testActivationReachedTargetRequiresMatchingFrontmostPID() {
        XCTAssertTrue(AppsDomain.activationReachedTarget(targetPID: 123, appIsActive: true, frontmostPID: 123))
        XCTAssertFalse(AppsDomain.activationReachedTarget(targetPID: 123, appIsActive: true, frontmostPID: 456))
        XCTAssertFalse(AppsDomain.activationReachedTarget(targetPID: 123, appIsActive: false, frontmostPID: 123))
        XCTAssertFalse(AppsDomain.activationReachedTarget(targetPID: 123, appIsActive: false, frontmostPID: nil))
    }

    func testPreferredCompoundAppIdentityPrefersExplicitTargetOverFrontmost() {
        let requested: CompoundDomain.AppIdentity = ("TextEdit", 30873, "com.apple.TextEdit")
        let frontmost: CompoundDomain.AppIdentity = ("Codex", 793, "com.openai.codex")
        let chosen = CompoundDomain.preferredAppIdentity(requested: requested, frontmost: frontmost)
        XCTAssertEqual(chosen.name, "TextEdit")
        XCTAssertEqual(chosen.pid, 30873)
        XCTAssertEqual(chosen.bundleId, "com.apple.TextEdit")
    }

    func testPreferredCompoundAppIdentityFallsBackToFrontmostWhenNoExplicitTargetExists() {
        let frontmost: CompoundDomain.AppIdentity = ("Codex", 793, "com.openai.codex")
        let chosen = CompoundDomain.preferredAppIdentity(requested: nil, frontmost: frontmost)
        XCTAssertEqual(chosen.name, "Codex")
        XCTAssertEqual(chosen.pid, 793)
        XCTAssertEqual(chosen.bundleId, "com.openai.codex")
    }
}
