import AVFoundation
import Foundation
import UIKit

/// Why dictation stopped with a message (desktop wording; iPhone paths in Settings).
nonisolated struct DictationError: Error, Equatable, Sendable {
    enum Kind: Sendable, Equatable { case noKey, badKey, quota, micDenied, network, server, other }
    let kind: Kind
    let message: String

    init(kind: Kind, message: String) {
        self.kind = kind
        self.message = message
    }

    /// Shown when Dictate is pressed with no key (the desktop's inline error; offer "Add key").
    static let noKey = DictationError(kind: .noKey, message: "Voice needs an OpenAI API key.")
    /// Offer a button that opens `UIApplication.openSettingsURLString` (Settings › Recaller).
    static let micDenied = DictationError(kind: .micDenied, message:
        "Microphone blocked. In Settings › Privacy & Security › Microphone, turn Recaller on, then try again.")
    static let noMic = DictationError(kind: .other, message: "No microphone found.")
    static let micBusy = DictationError(kind: .other, message: "The microphone is in use by another app.")
    static let micFailed = DictationError(kind: .other, message: "Could not start the microphone.")
    /// Nothing usable was recorded (the desktop shows this as a plain, non-error message).
    static let nothingHeard = DictationError(kind: .other, message: "Didn't catch that. Try speaking a little longer.")

    init(_ error: TranscribeError) {
        switch error.code {
        case .noKey: self.init(kind: .noKey, message: error.message)
        case .auth: self.init(kind: .badKey, message: error.message)
        case .rate: self.init(kind: .quota, message: error.message)
        case .network, .timeout, .stream: self.init(kind: .network, message: error.message)
        case .server: self.init(kind: .server, message: error.message)
        case .badRequest, .http, .unknown: self.init(kind: .other, message: error.message)
        }
    }

    /// True for key problems: the UI offers Settings instead of Retry / Discard.
    var needsKey: Bool { kind == .noKey || kind == .badKey }
}

/// Live, phrase-by-phrase dictation (the desktop's `voice.js` plus the composer's queue in app.js):
/// the microphone is cut into phrases at pauses, each phrase is transcribed in order while recording
/// continues, and the text streams out through `onText` word by word.
@MainActor
final class Dictation: ObservableObject {
    enum Phase: Equatable { case idle, starting, recording, finishing, failed(DictationError) }

    @Published private(set) var phase: Phase = .idle
    /// 0…1, smoothed, for a live meter.
    @Published private(set) var level: Float = 0
    /// Seconds since recording began (for an m:ss timer).
    @Published private(set) var elapsed: TimeInterval = 0
    /// True while a phrase is being transcribed (the desktop's "Writing…" vs "Listening…").
    @Published private(set) var isWriting = false
    /// Phrases recorded but not transcribed yet (a failed one stays here for `retry()`).
    @Published private(set) var pendingCount = 0

    /// Text to insert at the dictation point, in order; streamed (deltas). The first phrase starts
    /// with a space when the text before the dictation point doesn't end in whitespace, and so does
    /// each following phrase, like the desktop.
    var onText: ((String) -> Void)?
    /// Remove this text, which is the tail of what `onText` inserted (before a retry, when the final
    /// text differs from the streamed one, when a phrase fails, or on `cancel()`). Usually rare.
    var onRetract: ((String) -> Void)?
    /// Optional: the live text before the dictation point, if the user may edit while dictating.
    /// Used to decide the leading space of each phrase (otherwise the start context plus dictated text is used).
    var textBeforeInsertionPoint: (() -> String)?

    static let maxDuration: TimeInterval = 15 * 60
    static let mime = "audio/mp4"

    var transcriber = Transcriber()
    var settingsProvider: () -> VoiceSettings = { VoiceSettings.load() }
    var keyProvider: () -> String? = { OpenAIKey.value }

    private var recorder: PhraseRecorder?
    private var queue: [PhraseRecorder.Segment] = []
    private var worker: Task<Void, Never>?
    private var session = 0            // bumped by cancel(): late callbacks of an old session land nowhere
    private var startedAt: Date?
    private var timer: Timer?
    private var heard = 0              // phrases handed off this session
    private var recordingDone = true   // the recorder has delivered its last phrase
    private var context = ""           // text before the cursor + dictated text, for the prompt
    private var lastCharacter: Character?
    private var insertion: PhraseInsertion?   // the phrase streaming in
    private var streamed = ""                 // its deltas so far
    private var observers: [NSObjectProtocol] = []
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    private let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Dictation", isDirectory: true)

    init() {}

    var isActive: Bool {
        switch phase {
        case .starting, .recording, .finishing: return true
        case .idle, .failed: return false
        }
    }

    // MARK: - API

    /// Starts listening. `context` is the text before the cursor (its last 400 characters go into the
    /// prompt, and its last character decides the first phrase's leading space). Asks for the
    /// microphone the first time.
    func start(context: String) {
        switch phase {
        case .starting, .recording, .finishing: return
        case .idle, .failed: break
        }
        guard let key = keyProvider(), !key.isEmpty else {
            phase = .failed(.noKey)
            return
        }
        if queue.isEmpty { removeStaleFiles() }
        self.context = String(context.suffix(600))
        lastCharacter = context.last
        session += 1
        let mine = session
        heard = 0
        recordingDone = false
        elapsed = 0
        level = 0
        phase = .starting
        Task { await self.begin(session: mine) }
    }

    /// Stops listening; phrases already recorded still finish, then phase → .idle.
    func stop() {
        switch phase {
        case .starting:
            cancel()
        case .recording:
            stopRecording()
            phase = .finishing
        case .idle, .finishing, .failed:
            break
        }
    }

    /// Stops and drops everything still pending (the phrase streaming in is taken back out).
    func cancel() {
        session += 1
        recorder?.cancel()
        recorder = nil
        recordingDone = true
        worker?.cancel()
        worker = nil
        if let insertion, !insertion.inserted.isEmpty { onRetract?(insertion.inserted) }
        insertion = nil
        dropQueue()
        isWriting = false
        teardown()
        phase = .idle
    }

    /// After a failed phrase: transcribes the pending phrases again (the recorded audio is reused).
    func retry() {
        guard case .failed = phase else { return }
        guard !queue.isEmpty else {
            phase = .idle
            return
        }
        guard keyProvider()?.isEmpty == false else {
            phase = .failed(.noKey)
            return
        }
        phase = .finishing
        beginBackgroundTask()
        pump()
    }

    /// After a failed phrase: drops the pending phrases.
    func discard() {
        guard case .failed = phase else { return }
        dropQueue()
        phase = .idle
    }

    // MARK: - Recording

    private func begin(session mine: Int) async {
        let permission = AVAudioApplication.shared.recordPermission
        var granted = permission == .granted
        if permission == .undetermined {
            granted = await AVAudioApplication.requestRecordPermission()
        }
        guard mine == session, phase == .starting else { return }
        guard granted else { return fail(.micDenied) }

        let audio = AVAudioSession.sharedInstance()
        do {
            try audio.setCategory(.record, mode: .default, options: [.allowBluetoothHFP])
            try audio.setActive(true)
        } catch {
            let code = AVAudioSession.ErrorCode(rawValue: (error as NSError).code)
            return fail(code == .insufficientPriority || code == .cannotInterruptOthers || code == .isBusy
                        ? .micBusy : .micFailed)
        }
        guard audio.isInputAvailable else {
            deactivateSession()
            return fail(.noMic)
        }

        let recorder = PhraseRecorder(directory: directory)
        recorder.onLevel = { [weak self] value in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.received(level: value, session: mine) } }
        }
        recorder.onSegment = { [weak self] segment in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.received(segment: segment, session: mine) } }
        }
        recorder.onFailure = { [weak self] _ in
            DispatchQueue.main.async { MainActor.assumeIsolated { if self?.session == mine { self?.stop() } } }
        }
        do {
            try recorder.start()
        } catch PhraseRecorder.StartError.noInput {
            deactivateSession()
            return fail(.noMic)
        } catch {
            deactivateSession()
            return fail(.micFailed)
        }
        self.recorder = recorder
        startedAt = Date()
        phase = .recording
        observe()
        beginBackgroundTask()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        if !queue.isEmpty { pump() } // phrases left from a failed session resume
    }

    private func tick() {
        guard let startedAt, phase == .recording else { return }
        elapsed = Date().timeIntervalSince(startedAt)
        if elapsed >= Self.maxDuration { stop() } // the 15-minute cap
    }

    private func stopRecording() {
        timer?.invalidate()
        timer = nil
        level = 0
        guard let recorder else { return }
        self.recorder = nil
        let mine = session
        recorder.stop { [weak self] kept in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.recordingFinished(kept: kept, session: mine) } }
        }
    }

    private func received(level value: Float, session mine: Int) {
        guard mine == session, phase == .recording else { return }
        level = value
    }

    private func received(segment: PhraseRecorder.Segment, session mine: Int) {
        guard mine == session else {
            try? FileManager.default.removeItem(at: segment.url)
            return
        }
        heard += 1
        queue.append(segment)
        pendingCount = queue.count
        if case .failed = phase { return } // waits for retry()
        pump()
    }

    private func recordingFinished(kept: Int, session mine: Int) {
        guard mine == session else { return }
        recordingDone = true
        deactivateSession()
        if case .failed = phase { return }
        if heard == 0 && queue.isEmpty && worker == nil {
            teardown()
            phase = .failed(.nothingHeard)
            return
        }
        finishIfDone()
    }

    // MARK: - Transcription queue

    private func pump() {
        guard worker == nil, !queue.isEmpty else { return }
        let mine = session
        isWriting = true
        worker = Task { [weak self] in
            await self?.drain(session: mine)
        }
    }

    private func drain(session mine: Int) async {
        while mine == session, let segment = queue.first {
            do {
                try await transcribe(segment, session: mine)
                guard mine == session else { return }
                if queue.first == segment { queue.removeFirst() }
                pendingCount = queue.count
                try? FileManager.default.removeItem(at: segment.url)
            } catch {
                guard mine == session else { return }
                worker = nil
                isWriting = false
                if error is CancellationError { return }
                let failure = (error as? TranscribeError).map(DictationError.init) ?? DictationError(kind: .other, message: "Transcription failed.")
                // Stop listening; the phrase being recorded joins the queue for Retry.
                if phase == .recording { stopRecording() }
                phase = .failed(failure)
                teardown()
                return
            }
        }
        guard mine == session else { return }
        worker = nil
        isWriting = false
        finishIfDone()
    }

    private func transcribe(_ segment: PhraseRecorder.Segment, session mine: Int) async throws {
        let audio = try await Task.detached(priority: .userInitiated) { M4APadding.strip(try Data(contentsOf: segment.url)) }.value
        guard mine == session else { throw CancellationError() }
        let settings = settingsProvider().normalized
        let before = textBeforeInsertionPoint?().last ?? lastCharacter
        insertion = PhraseInsertion(before: before)
        streamed = ""
        let result: String
        do {
            result = try await transcriber.transcribe(
                audio: audio, mime: Self.mime, apiKey: keyProvider(), settings: settings, context: context,
                onDelta: { [weak self] delta in
                    guard let self, mine == self.session else { return }
                    self.streamed += delta
                    self.show(self.streamed)
                },
                onReset: { [weak self] in
                    guard let self, mine == self.session else { return }
                    self.streamed = ""
                    self.show("")
                })
        } catch {
            if mine == session { show(""); insertion = nil }
            throw error
        }
        guard mine == session else { throw CancellationError() }
        show(result)
        if let last = insertion?.inserted.last { lastCharacter = last }
        insertion = nil
        if !result.isEmpty {
            context = String("\(context) \(result)".trimmingCharacters(in: .whitespaces).suffix(600))
        }
    }

    private func show(_ text: String) {
        guard var current = insertion else { return }
        let step = current.show(text)
        insertion = current
        if !step.retract.isEmpty { onRetract?(step.retract) }
        if !step.insert.isEmpty { onText?(step.insert) }
    }

    private func finishIfDone() {
        guard recordingDone, worker == nil, queue.isEmpty else { return }
        switch phase {
        case .finishing, .recording:
            teardown()
            phase = .idle
        case .idle, .starting, .failed:
            break
        }
    }

    // MARK: - Housekeeping

    private func fail(_ error: DictationError) {
        teardown()
        phase = .failed(error)
    }

    private func dropQueue() {
        for segment in queue { try? FileManager.default.removeItem(at: segment.url) }
        queue.removeAll()
        pendingCount = 0
    }

    private func removeStaleFiles() {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    private func teardown() {
        timer?.invalidate()
        timer = nil
        level = 0
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll()
        if recorder == nil { deactivateSession() }
        endBackgroundTask()
    }

    /// Hands the audio back to other apps (music resumes). Synchronous, so it can't race a new start().
    private func deactivateSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// A phone call, a lost microphone (headset unplugged), the media server resetting or the app
    /// leaving the screen all stop dictation gracefully: what was said so far is still transcribed.
    private func observe() {
        let center = NotificationCenter.default
        let stopNow: @Sendable (Notification) -> Void = { [weak self] _ in
            Task { @MainActor in self?.stop() }
        }
        observers = [
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
                let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                guard raw.flatMap(AVAudioSession.InterruptionType.init) == .began else { return }
                Task { @MainActor in self?.stop() }
            },
            center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
                let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
                let reason = raw.flatMap(AVAudioSession.RouteChangeReason.init)
                guard reason == .oldDeviceUnavailable || reason == .noSuitableRouteForCategory else { return }
                Task { @MainActor in self?.stop() }
            },
            center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main, using: stopNow),
            center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main, using: stopNow),
            center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main, using: stopNow),
        ]
    }

    /// Lets the phrases still queued finish uploading if the app goes to the background.
    private func beginBackgroundTask() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Dictation") { [weak self] in
            MainActor.assumeIsolated { self?.endBackgroundTask() }
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}
