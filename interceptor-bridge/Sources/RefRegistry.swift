import Foundation
import ApplicationServices

final class RefRegistry: @unchecked Sendable {
    static let shared = RefRegistry()

    struct Entry {
        let element: AXUIElement
        let pid: pid_t?
    }

    private let lock = NSLock()
    private var refs: [String: Entry] = [:]
    private var counter: Int = 0

    func clear() {
        lock.lock()
        refs.removeAll()
        counter = 0
        lock.unlock()
    }

    func register(_ element: AXUIElement, pid: pid_t? = nil) -> String {
        lock.lock()
        counter += 1
        let ref = "e\(counter)"
        refs[ref] = Entry(element: element, pid: pid)
        lock.unlock()
        return ref
    }

    func resolve(_ ref: String) -> AXUIElement? {
        lock.lock()
        let element = refs[ref]?.element
        lock.unlock()
        return element
    }

    func resolveInfo(_ ref: String) -> Entry? {
        lock.lock()
        let entry = refs[ref]
        lock.unlock()
        return entry
    }

    func resolvePID(_ ref: String) -> pid_t? {
        lock.lock()
        let pid = refs[ref]?.pid
        lock.unlock()
        return pid
    }

    func currentCount() -> Int {
        lock.lock()
        let c = counter
        lock.unlock()
        return c
    }

    var count: Int {
        lock.lock()
        let c = refs.count
        lock.unlock()
        return c
    }
}
