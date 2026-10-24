import Foundation

/// Splits a recording into phrases at pauses, the same way the desktop's `voice.js` does.
///
/// Feed it the RMS of each block of microphone audio (the recorder uses 50 ms blocks, like the
/// desktop's 50 ms meter tick) and it tells you when to close the current phrase and whether that
/// phrase is worth sending. Pure logic: no audio, no clock, so it can be unit-tested.
///
/// - The level is `min(1, RMS × 7)`; the meter shown to the user is that level, smoothed
///   (rises at once, falls by 20 % per tick).
/// - The noise floor follows quiet moments down at once and creeps up slowly; speech is
///   `max(0.025, floor × 2.5 + 0.012)`, silence `max(0.015, floor × 1.6 + 0.006)`.
/// - A phrase is cut after a 550 ms pause once it holds ≥ 250 ms of speech and is ≥ 1.5 s long;
///   after 5 s at the next 100 ms dip; always at 9 s.
/// - A phrase with too little speech is dropped (models invent words for silence). The last phrase
///   needs only 120 ms of speech, and the only take of a session is always sent if it lasted ≥ 600 ms.
nonisolated struct PhraseCutter: Sendable {
    struct Config: Sendable, Equatable {
        var minSpeechLevel: Float = 0.025
        var minSilenceLevel: Float = 0.015
        var pauseMs: Double = 550
        var minSegmentMs: Double = 1500
        var minSpeechMs: Double = 250
        var minFinalSpeechMs: Double = 120
        var minFirstMs: Double = 600
        var softMaxMs: Double = 5000
        var softDipMs: Double = 100
        var hardMaxMs: Double = 9000
    }

    /// Why a phrase was closed.
    enum Reason: Sendable, Equatable { case pause, softMax, hardMax, final }

    /// A closed phrase. `keep == false` means it held no speech and should be thrown away.
    struct Phrase: Sendable, Equatable {
        let reason: Reason
        let durationMs: Double
        let speechMs: Double
        let keep: Bool
    }

    let config: Config
    /// Smoothed level, 0…1, for a live meter.
    private(set) var meter: Float = 0
    /// Noise floor estimate.
    private(set) var floor: Float = 0.02
    /// The phrase being recorded.
    private(set) var ageMs: Double = 0
    private(set) var speechMs: Double = 0
    private(set) var silentMs: Double = 0
    /// Phrases handed off (kept) so far this session.
    private(set) var kept = 0

    init(config: Config = Config()) {
        self.config = config
    }

    /// Feeds one block of audio. Returns the phrase that ends with this block, if any; the next
    /// block then starts a new phrase.
    mutating func feed(rms: Float, durationMs: Double) -> Phrase? {
        let level = min(1, max(0, rms) * 7)
        meter = level > meter ? level : meter * 0.8 + level * 0.2

        floor = level < floor ? level : min(0.2, floor * 1.003 + 0.00002)
        let speechLevel = max(config.minSpeechLevel, floor * 2.5 + 0.012)
        let silenceLevel = max(config.minSilenceLevel, floor * 1.6 + 0.006)
        if level > speechLevel {
            speechMs += durationMs
            silentMs = 0
        } else if level < silenceLevel {
            silentMs += durationMs
        }
        ageMs += durationMs

        let pause = silentMs >= config.pauseMs && speechMs >= config.minSpeechMs && ageMs >= config.minSegmentMs
        let soft = ageMs >= config.softMaxMs && silentMs >= config.softDipMs
        let hard = ageMs >= config.hardMaxMs
        guard pause || soft || hard else { return nil }
        return close(reason: pause ? .pause : soft ? .softMax : .hardMax, minSpeech: config.minSpeechMs, final: false)
    }

    /// Closes the last phrase when recording stops.
    mutating func finish() -> Phrase {
        close(reason: .final, minSpeech: config.minFinalSpeechMs, final: true)
    }

    private mutating func close(reason: Reason, minSpeech: Double, final: Bool) -> Phrase {
        // Never throw away the only recording of a session: trust the user who pressed the mic.
        let onlyTake = final && kept == 0 && ageMs >= config.minFirstMs
        let keep = speechMs >= minSpeech || onlyTake
        let phrase = Phrase(reason: reason, durationMs: ageMs, speechMs: speechMs, keep: keep)
        if keep { kept += 1 }
        ageMs = 0
        speechMs = 0
        silentMs = 0
        return phrase
    }
}
