import Foundation
@preconcurrency import ScreenCaptureKit
import AVFoundation
import AppKit
import CoreMedia

final class AudioDomain: DomainHandler, @unchecked Sendable {
    private var outputStream: SCStream?
    private var inputEngine: AVAudioEngine?
    private var inputAudioFile: AVAudioFile?
    private var inputSavePath: String?
    private let sessionsQueue = DispatchQueue(label: "interceptor.audio.sessions")

    nonisolated(unsafe) private static var sharedAudioBuffer: AVAudioPCMBuffer?
    private static let bufferLock = NSLock()

    static func getLatestBuffer() -> AVAudioPCMBuffer? {
        bufferLock.lock()
        defer { bufferLock.unlock() }
        return sharedAudioBuffer
    }

    static func setLatestBuffer(_ buffer: AVAudioPCMBuffer?) {
        bufferLock.lock()
        sharedAudioBuffer = buffer
        bufferLock.unlock()
    }

    func handle(_ command: String, action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        let sub = action["sub"] as? String ?? command
        switch sub {
        case "output":
            handleOutput(action, completion: completion)
        case "input":
            handleInput(action, completion: completion)
        case "both":
            handleBoth(action, completion: completion)
        default:
            notImplemented(sub, completion: completion)
        }
    }

    private func handleOutput(_ action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        let op = action["op"] as? String ?? "start"
        switch op {
        case "start":
            startOutputCapture(action, completion: completion)
        case "stop":
            stopOutputCapture(completion: completion)
        case "level":
            completion(WireFormat.success(["level": "monitoring active"]))
        case "devices":
            listOutputDevices(completion: completion)
        default:
            notImplemented("audio output \(op)", completion: completion)
        }
    }

    private func handleInput(_ action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        let op = action["op"] as? String ?? "start"
        switch op {
        case "start":
            startInputCapture(action, completion: completion)
        case "stop":
            stopInputCapture(completion: completion)
        case "level":
            completion(WireFormat.success(["level": "monitoring active"]))
        case "devices":
            listInputDevices(completion: completion)
        default:
            notImplemented("audio input \(op)", completion: completion)
        }
    }

    private func handleBoth(_ action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        let op = action["op"] as? String ?? "start"
        let appName = action["app"] as? String
        if op == "start" {
            let outputAction: [String: Any] = appName != nil ? ["app": appName!] : [:]
            startOutputCapture(outputAction) { [weak self] result1 in
                guard let self = self else { return }
                let r1Success = result1["success"] as? Bool == true
                let inputAction: [String: Any] = [:]
                self.startInputCapture(inputAction) { result2 in
                    let out = r1Success ? "started" : "failed"
                    let inp = result2["success"] as? Bool == true ? "started" : "failed"
                    completion(WireFormat.success(["output": out, "input": inp]))
                }
            }
        } else {
            stopOutputCapture { [weak self] _ in
                guard let self = self else { return }
                self.stopInputCapture { _ in
                    completion(WireFormat.success("stopped both"))
                }
            }
        }
    }

    private func startOutputCapture(_ action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        let appName = action["app"] as? String
        if #available(macOS 13.0, *) {
            Task {
                do {
                    let content = try await SCShareableContent.current
                    let filter: SCContentFilter
                    if let appName = appName,
                       let app = content.applications.first(where: { $0.applicationName == appName }),
                       let window = content.windows.first(where: { $0.owningApplication?.processID == app.processID }) {
                        filter = SCContentFilter(desktopIndependentWindow: window)
                    } else if let display = content.displays.first {
                        filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
                    } else {
                        completion(WireFormat.error("no capturable content"))
                        return
                    }
                    let config = SCStreamConfiguration()
                    config.capturesAudio = true
                    config.excludesCurrentProcessAudio = true
                    config.sampleRate = 48_000
                    config.channelCount = 2

                    let stream = SCStream(filter: filter, configuration: config, delegate: nil)
                    let audioOutput = AudioStreamOutput()
                    try stream.addStreamOutput(audioOutput, type: .audio, sampleHandlerQueue: DispatchQueue.global())
                    try await stream.startCapture()
                    self.outputStream = stream
                    completion(WireFormat.success("audio output capture started"))
                } catch {
                    completion(WireFormat.error("output capture failed: \(error.localizedDescription)"))
                }
            }
        } else {
            completion(WireFormat.error("audio output capture requires macOS 13.0+"))
        }
    }

    private func stopOutputCapture(completion: @escaping @Sendable ([String: Any]) -> Void) {
        if let stream = outputStream {
            Task {
                try? await stream.stopCapture()
                self.outputStream = nil
                completion(WireFormat.success("audio output capture stopped"))
            }
        } else {
            completion(WireFormat.success("no active output capture"))
        }
    }

    private func startInputCapture(_ action: [String: Any], completion: @escaping @Sendable ([String: Any]) -> Void) {
        let save = action["save"] as? Bool ?? false
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        // When --save is passed, write the tapped buffers to a CAF file in
        // /tmp using AVAudioFile (Apple-native PCM container). CAF is the
        // path of least resistance — no encoder, no header surgery, just
        // raw PCM in the same format the inputNode produces.
        var fileWriter: AVAudioFile? = nil
        var savedPath: String? = nil
        if save {
            let timestamp = Int(Date().timeIntervalSince1970)
            let path = "/tmp/interceptor-audio-input-\(timestamp).caf"
            let url = URL(fileURLWithPath: path)
            do {
                fileWriter = try AVAudioFile(forWriting: url, settings: format.settings)
                savedPath = path
            } catch {
                completion(WireFormat.error("input capture file open failed: \(error.localizedDescription)"))
                return
            }
        }

        // Hold writer reference under sessionsQueue so the tap closure can
        // append without a data race against stop().
        sessionsQueue.sync {
            self.inputAudioFile = fileWriter
            self.inputSavePath = savedPath
        }

        let writerRef = fileWriter
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self else { return }
            guard let writer = writerRef else { return }
            // AVAudioFile is not declared Sendable but is documented safe
            // for serial single-writer access. The tap callback fires on a
            // single audio queue, so concurrent writes can't happen.
            try? writer.write(from: buffer)
            _ = self  // silence unused-self warning under -strict-concurrency
        }

        do {
            try engine.start()
            self.inputEngine = engine
            var payload: [String: Any] = [
                "message": "audio input capture started (\(Int(format.sampleRate))Hz)",
                "sampleRate": Int(format.sampleRate),
                "channels": Int(format.channelCount)
            ]
            if let path = savedPath { payload["filePath"] = path }
            completion(WireFormat.success(payload))
        } catch {
            completion(WireFormat.error("input capture failed: \(error.localizedDescription)"))
        }
    }

    private func stopInputCapture(completion: @escaping @Sendable ([String: Any]) -> Void) {
        if let engine = inputEngine {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
            self.inputEngine = nil
            // Closing the AVAudioFile writes the final CAF header so the
            // file is playable. Apple does this automatically on dealloc,
            // but we drop the reference deterministically here.
            var savedPath: String? = nil
            sessionsQueue.sync {
                self.inputAudioFile = nil
                savedPath = self.inputSavePath
                self.inputSavePath = nil
            }
            var payload: [String: Any] = ["message": "audio input capture stopped"]
            if let path = savedPath { payload["filePath"] = path }
            completion(WireFormat.success(payload))
        } else {
            completion(WireFormat.success("no active input capture"))
        }
    }

    private func listOutputDevices(completion: @escaping @Sendable ([String: Any]) -> Void) {
        completion(WireFormat.success("use 'system_profiler SPAudioDataType' for device list"))
    }

    private func listInputDevices(completion: @escaping @Sendable ([String: Any]) -> Void) {
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        completion(WireFormat.success([
            "defaultInput": [
                "sampleRate": format.sampleRate,
                "channels": format.channelCount
            ]
        ]))
    }
}

@available(macOS 13.0, *)
final class AudioStreamOutput: NSObject, SCStreamOutput, @unchecked Sendable {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else { return }
        let format = AVAudioFormat(streamDescription: asbd)
        guard let format = format else { return }
        let frameCount = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }
        pcmBuffer.frameLength = frameCount

        if let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) {
            var length = 0
            var dataPointer: UnsafeMutablePointer<Int8>?
            CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)
            if let dataPointer = dataPointer, let destination = pcmBuffer.floatChannelData?[0] {
                memcpy(destination, dataPointer, min(length, Int(frameCount) * MemoryLayout<Float>.size))
            }
        }

        AudioDomain.setLatestBuffer(pcmBuffer)
    }
}
