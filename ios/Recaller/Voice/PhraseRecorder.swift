import AVFoundation
import Foundation

/// Records the microphone with AVAudioEngine and cuts it into phrases with `PhraseCutter`.
/// Each kept phrase is a standalone AAC `.m4a` file (mono, ~48 kbps) handed to `onSegment` in
/// spoken order; phrases without speech are deleted. Cuts happen at an exact sample, so no audio
/// is lost or doubled at a boundary.
///
/// Thread-safety: everything mutable lives on `queue`; `start`, `stop` and `cancel` are called from
/// the main actor. The audio session is configured and activated by the caller (`Dictation`).
nonisolated final class PhraseRecorder: @unchecked Sendable {
    struct Segment: Sendable, Equatable {
        let url: URL
        let durationMs: Double
    }

    enum StartError: Error {
        case noInput
        case failed(String)
    }

    static let blockMs: Double = 50 // the desktop's meter tick
    static let bitRate = 48_000

    /// Called on the recorder's queue with the smoothed level, every 50 ms.
    var onLevel: (@Sendable (Float) -> Void)?
    /// Called on the recorder's queue with each kept phrase, in order.
    var onSegment: (@Sendable (Segment) -> Void)?
    /// Called on the recorder's queue if writing fails mid-way (the recording should be stopped).
    var onFailure: (@Sendable (String) -> Void)?

    let directory: URL
    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "com.akhan.recaller.voice.recorder", qos: .userInitiated)

    // queue-only state
    private var cutter = PhraseCutter()
    private var file: AVAudioFile?
    private var fileURL: URL?
    private var monoFormat: AVAudioFormat?
    private var blockFrames = 2400
    private var blockSum: Float = 0
    private var blockCount = 0
    private var finished = false

    init(directory: URL) {
        self.directory = directory
    }

    deinit {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    /// Starts recording. Throws when there is no microphone or the engine won't start.
    func start() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else { throw StartError.noInput }
        guard let mono = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: inputFormat.sampleRate,
                                       channels: 1, interleaved: false) else {
            throw StartError.failed("Could not start the microphone.")
        }
        let needsConversion = !(inputFormat.commonFormat == .pcmFormatFloat32 && !inputFormat.isInterleaved)
        let converter = needsConversion ? AVAudioConverter(from: inputFormat, to: mono) : nil
        if needsConversion && converter == nil { throw StartError.failed("Could not start the microphone.") }

        try queue.sync {
            monoFormat = mono
            blockFrames = max(1, Int(inputFormat.sampleRate * Self.blockMs / 1000))
            cutter = PhraseCutter()
            finished = false
            try openFile()
        }

        let box = ConverterBox(converter)
        input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(blockFrames * 2), format: inputFormat) { [weak self] buffer, _ in
            guard let self, let samples = box.mono(buffer, format: mono) else { return }
            self.queue.async { self.process(samples) }
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            queue.sync { discardFile() }
            throw StartError.failed(error.localizedDescription)
        }
    }

    /// Stops listening. The last phrase is handed to `onSegment` if it is worth sending, then
    /// `completion` gets the number of phrases kept during the whole session (both on the queue).
    func stop(completion: @escaping @Sendable (Int) -> Void) {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        queue.async {
            guard !self.finished else { return completion(self.cutter.kept) }
            self.flushBlock()
            self.finished = true
            let phrase = self.cutter.finish()
            self.closeFile(keep: phrase.keep, durationMs: phrase.durationMs)
            completion(self.cutter.kept)
        }
    }

    /// Stops and throws the current phrase away.
    func cancel() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        queue.async {
            self.finished = true
            self.discardFile()
        }
    }

    // MARK: - queue

    private func process(_ samples: [Float]) {
        guard !finished, let mono = monoFormat else { return }
        var writtenUpTo = 0
        for i in samples.indices {
            let x = samples[i]
            blockSum += x * x
            blockCount += 1
            guard blockCount >= blockFrames else { continue }
            let rms = (blockSum / Float(blockCount)).squareRoot()
            let ms = Double(blockCount) / mono.sampleRate * 1000
            blockSum = 0
            blockCount = 0
            let phrase = cutter.feed(rms: rms, durationMs: ms)
            onLevel?(cutter.meter)
            if let phrase {
                write(samples[writtenUpTo...i])
                writtenUpTo = i + 1
                closeFile(keep: phrase.keep, durationMs: phrase.durationMs)
                do { try openFile() } catch {
                    finished = true
                    onFailure?("Could not keep recording.")
                    return
                }
            }
        }
        if writtenUpTo < samples.count { write(samples[writtenUpTo...]) }
    }

    /// Feeds a last partial block so the final phrase's speech time is counted.
    private func flushBlock() {
        guard blockCount > 0, let mono = monoFormat else { return }
        let rms = (blockSum / Float(blockCount)).squareRoot()
        let ms = Double(blockCount) / mono.sampleRate * 1000
        blockSum = 0
        blockCount = 0
        // A cut here would only re-close the same audio; the final phrase is closed by stop().
        var probe = cutter
        if probe.feed(rms: rms, durationMs: ms) == nil { cutter = probe }
    }

    private func write(_ slice: ArraySlice<Float>) {
        guard let file, let mono = monoFormat, !slice.isEmpty,
              let buffer = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: AVAudioFrameCount(slice.count)),
              let channel = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = AVAudioFrameCount(slice.count)
        slice.withUnsafeBufferPointer { src in
            channel.update(from: src.baseAddress!, count: slice.count)
        }
        try? file.write(from: buffer)
    }

    private func openFile() throws {
        guard let mono = monoFormat else { return }
        let url = directory.appendingPathComponent("phrase-\(UUID().uuidString).m4a")
        var settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: mono.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: Self.bitRate,
        ]
        do {
            file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        } catch {
            // Some rates (a Bluetooth headset's 16 kHz) don't take 48 kbps: let the encoder choose.
            settings.removeValue(forKey: AVEncoderBitRateKey)
            file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        }
        fileURL = url
    }

    private func closeFile(keep: Bool, durationMs: Double) {
        file?.close()
        file = nil
        guard let url = fileURL else { return }
        fileURL = nil
        if keep {
            onSegment?(Segment(url: url, durationMs: durationMs))
        } else {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func discardFile() {
        file?.close()
        file = nil
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        fileURL = nil
    }
}

/// Turns a tap buffer into mono Float32 samples (channel 0 when the input is already Float32;
/// otherwise through an AVAudioConverter). Used only from the tap's thread.
nonisolated private final class ConverterBox: @unchecked Sendable {
    private let converter: AVAudioConverter?

    init(_ converter: AVAudioConverter?) {
        self.converter = converter
    }

    func mono(_ buffer: AVAudioPCMBuffer, format: AVAudioFormat) -> [Float]? {
        let frames = Int(buffer.frameLength)
        guard frames > 0 else { return nil }
        if let converter {
            guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: buffer.frameLength) else { return nil }
            do { try converter.convert(to: out, from: buffer) } catch { return nil }
            guard let channel = out.floatChannelData?[0] else { return nil }
            return Array(UnsafeBufferPointer(start: channel, count: Int(out.frameLength)))
        }
        guard let channel = buffer.floatChannelData?[0] else { return nil }
        return Array(UnsafeBufferPointer(start: channel, count: frames))
    }
}
