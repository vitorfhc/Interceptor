import Foundation

final class FilesDomain: DomainHandler, @unchecked Sendable {
    private var watchers: [String: DispatchSourceFileSystemObject] = [:]
    private let lock = NSLock()
    private var recentChanges: [[String: Any]] = []

    func handle(_ command: String, action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        // Router sends command = "files" because the action type is
        // two-segment (`macos_files`). The CLI parser puts the real
        // sub-verb on action["sub"].
        let sub = action["sub"] as? String ?? command
        switch sub {
        case "watch":
            watchDirectory(action, completion: completion)
        case "recent":
            getRecentFiles(action, completion: completion)
        case "open":
            getOpenFiles(completion: completion)
        default:
            notImplemented(sub, completion: completion)
        }
    }

    private func watchDirectory(_ action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        guard let path = action["path"] as? String else {
            completion(WireFormat.error("watch requires a path"))
            return
        }
        let expandedPath = NSString(string: path).expandingTildeInPath
        let fd = open(expandedPath, O_EVTONLY)
        guard fd >= 0 else {
            completion(WireFormat.error("cannot open path: \(expandedPath)"))
            return
        }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .rename, .delete, .extend],
            queue: DispatchQueue.global()
        )
        source.setEventHandler { [weak self] in
            let event: [String: Any] = [
                "path": expandedPath,
                "timestamp": ISO8601DateFormatter().string(from: Date()),
                "event": "change"
            ]
            self?.lock.lock()
            self?.recentChanges.append(event)
            if (self?.recentChanges.count ?? 0) > 1000 {
                self?.recentChanges.removeFirst(500)
            }
            self?.lock.unlock()
            Platform.emitEvent("file_change", data: event)
        }
        source.setCancelHandler { close(fd) }
        source.resume()
        lock.lock()
        watchers[expandedPath] = source
        lock.unlock()
        completion(WireFormat.success(["watching": expandedPath]))
    }

    private func getRecentFiles(_ action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        let limit = action["limit"] as? Int ?? 20
        lock.lock()
        let recent = Array(recentChanges.suffix(limit))
        lock.unlock()
        completion(WireFormat.success(recent))
    }

    private func getOpenFiles(completion: @escaping @Sendable ([String: Any]) -> Void) {
        // Use lsof's fast path: -nlP avoids DNS / login-name / port-name
        // resolution; -c "^com.apple" excludes Apple-bundled processes;
        // -Fn emits only file-name records. We post-filter to user files
        // (those rooted at the user's home or /Volumes) and cap to 100.
        // The previous implementation used `+D <homedir>` which is a
        // recursive directory scan and routinely exceeded the daemon's
        // 15s request timeout on large home directories.
        let homeDir = FileManager.default.homeDirectoryForCurrentUser.path
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        task.arguments = ["-nlP", "-c", "^com.apple", "-Fn"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice

        do {
            try task.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            task.waitUntilExit()
            let output = String(data: data, encoding: .utf8) ?? ""
            let files: [String] = output.split(separator: "\n")
                .compactMap { line -> String? in
                    guard line.hasPrefix("n/") else { return nil }
                    return String(line.dropFirst(1))
                }
                .filter { path in
                    // User-relevant files only. Exclude framework dylibs,
                    // /System, /private noise, and pipes/sockets.
                    if path.hasPrefix("/System/") { return false }
                    if path.hasPrefix("/Library/") { return false }
                    if path.hasPrefix("/usr/") { return false }
                    if path.hasPrefix("/private/var/") { return false }
                    if path.contains(".framework/") { return false }
                    if path.contains(".dylib") { return false }
                    return path.hasPrefix(homeDir) || path.hasPrefix("/Volumes/") || path.hasPrefix("/Applications/")
                }
                .prefix(100)
                .map { $0 }
            completion(WireFormat.success(Array(files)))
        } catch {
            completion(WireFormat.error("lsof failed: \(error.localizedDescription)"))
        }
    }
}
