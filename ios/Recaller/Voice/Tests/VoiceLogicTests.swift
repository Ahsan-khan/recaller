import AVFoundation
import XCTest
@testable import Recaller

// Pure-logic tests for dictation: phrase cutting, SSE parsing, the multipart request, text
// insertion and the transcription retry rules (against a fake transport — never the real API).

// MARK: - PhraseCutter

final class PhraseCutterTests: XCTestCase {
    private let speech: Float = 0.1     // level 0.7
    private let quiet: Float = 0.001    // level 0.007
    private let tick = 50.0

    /// Feeds `ms` of one level; returns the phrases cut meanwhile.
    private func feed(_ cutter: inout PhraseCutter, _ rms: Float, ms: Double) -> [PhraseCutter.Phrase] {
        var out: [PhraseCutter.Phrase] = []
        for _ in 0..<Int(ms / tick) {
            if let p = cutter.feed(rms: rms, durationMs: tick) { out.append(p) }
        }
        return out
    }

    func testPauseCutsAPhrase() {
        var c = PhraseCutter()
        XCTAssertEqual(feed(&c, speech, ms: 1000), [])
        let cuts = feed(&c, quiet, ms: 600)
        XCTAssertEqual(cuts, [PhraseCutter.Phrase(reason: .pause, durationMs: 1550, speechMs: 1000, keep: true)])
        XCTAssertEqual(c.kept, 1)
    }

    func testShortPauseDoesNotCut() {
        var c = PhraseCutter()
        XCTAssertEqual(feed(&c, speech, ms: 1000), [])
        XCTAssertEqual(feed(&c, quiet, ms: 500), [])   // 500 ms < 550 ms
        XCTAssertEqual(feed(&c, speech, ms: 1000), [])
        XCTAssertEqual(c.ageMs, 2500)
    }

    func testPhraseMustBeAtLeastOneAndAHalfSeconds() {
        var c = PhraseCutter()
        _ = feed(&c, speech, ms: 300)
        let cuts = feed(&c, quiet, ms: 2000)
        XCTAssertEqual(cuts.count, 1)
        XCTAssertEqual(cuts[0].reason, .pause)
        XCTAssertEqual(cuts[0].durationMs, 1500)        // not at 850 ms, when the pause was already long enough
    }

    func testTooLittleSpeechIsNotAPause() {
        var c = PhraseCutter()
        _ = feed(&c, speech, ms: 200)                    // < 250 ms of speech
        XCTAssertEqual(feed(&c, quiet, ms: 2000), [])    // no pause cut before 5 s
    }

    func testMonologueIsCutAtNineSeconds() {
        var c = PhraseCutter()
        let cuts = feed(&c, speech, ms: 20_000)
        XCTAssertEqual(cuts.map(\.reason), [.hardMax, .hardMax])
        XCTAssertEqual(cuts.map(\.durationMs), [9000, 9000])
        XCTAssertTrue(cuts.allSatisfy(\.keep))
        XCTAssertEqual(c.ageMs, 2000)
    }

    func testAfterFiveSecondsCutsAtTheNextDip() {
        var c = PhraseCutter()
        var cuts: [PhraseCutter.Phrase] = []
        // 1.3 s of words, then a 100 ms dip between words, over and over.
        for _ in 0..<6 {
            cuts += feed(&c, speech, ms: 1300)
            cuts += feed(&c, quiet, ms: 100)
        }
        XCTAssertEqual(cuts.first?.reason, .softMax)
        XCTAssertEqual(cuts.first?.durationMs, 5600)     // the first dip completed after 5 s
        XCTAssertEqual(cuts.first?.keep, true)
    }

    func testSilenceIsDropped() {
        var c = PhraseCutter()
        let cuts = feed(&c, quiet, ms: 6000)
        XCTAssertEqual(cuts, [PhraseCutter.Phrase(reason: .softMax, durationMs: 5000, speechMs: 0, keep: false)])
        XCTAssertEqual(c.kept, 0)
    }

    func testOnlyTakeIsAlwaysSent() {
        var c = PhraseCutter()
        _ = feed(&c, quiet, ms: 700)
        XCTAssertEqual(c.finish().keep, true)            // ≥ 600 ms and nothing sent yet

        var short = PhraseCutter()
        _ = feed(&short, quiet, ms: 500)
        XCTAssertEqual(short.finish().keep, false)
    }

    func testLastPhraseNeedsOnlyAShortWord() {
        var c = PhraseCutter()
        _ = feed(&c, speech, ms: 1000)
        _ = feed(&c, quiet, ms: 600)                    // first phrase kept
        _ = feed(&c, speech, ms: 150)
        _ = feed(&c, quiet, ms: 200)
        XCTAssertEqual(c.finish(), PhraseCutter.Phrase(reason: .final, durationMs: 400, speechMs: 150, keep: true))

        var d = PhraseCutter()
        _ = feed(&d, speech, ms: 1000)
        _ = feed(&d, quiet, ms: 600)
        _ = feed(&d, speech, ms: 100)                    // < 120 ms
        _ = feed(&d, quiet, ms: 1000)
        XCTAssertEqual(d.finish().keep, false)
    }

    func testMeterRisesAtOnceAndFallsSlowly() {
        var c = PhraseCutter()
        _ = c.feed(rms: 0.1, durationMs: tick)
        XCTAssertEqual(c.meter, 0.7, accuracy: 1e-6)
        _ = c.feed(rms: 0, durationMs: tick)
        XCTAssertEqual(c.meter, 0.56, accuracy: 1e-6)
        _ = c.feed(rms: 1, durationMs: tick)
        XCTAssertEqual(c.meter, 1, accuracy: 1e-6)      // clamped to 1
    }

    func testNoiseFloorFollowsQuietDownAndCreepsUp() {
        var c = PhraseCutter()
        _ = c.feed(rms: 0.001, durationMs: tick)
        XCTAssertEqual(c.floor, 0.007, accuracy: 1e-6)
        _ = c.feed(rms: 0.1, durationMs: tick)
        XCTAssertEqual(c.floor, 0.007 * 1.003 + 0.00002, accuracy: 1e-6)
    }

    func testBetweenThresholdsCountsAsNeither() {
        var c = PhraseCutter()
        _ = c.feed(rms: 0.001, durationMs: tick)        // floor 0.007 → speech > 0.0295, silence < 0.0172
        _ = c.feed(rms: 0.003, durationMs: tick)        // level 0.021: neither
        XCTAssertEqual(c.speechMs, 0)
        XCTAssertEqual(c.silentMs, 50)
    }
}

// MARK: - SSEParser

final class SSEParserTests: XCTestCase {
    func testDeltasAndDone() {
        var p = SSEParser()
        let stream = """
        data: {"type":"transcript.text.delta","delta":"Hello"}

        data: {"type":"transcript.text.delta","delta":" world"}

        data: {"type":"transcript.text.done","text":"Hello world."}

        data: [DONE]


        """
        XCTAssertEqual(p.feed(stream), [.delta("Hello"), .delta(" world"), .done("Hello world.")])
        XCTAssertEqual(p.finish(), [])
    }

    func testSplitAcrossChunksAndUTF8() {
        let bytes = Array("data: {\"type\":\"transcript.text.delta\",\"delta\":\"café ✓\"}\r\n\r\ndata: {\"type\":\"transcript.text.done\",\"text\":\"café ✓\"}".utf8)
        var p = SSEParser()
        var events: [TranscriptEvent] = []
        for byte in bytes { events += p.feed([byte]) }   // one byte at a time: splits é and ✓ and \r\n
        XCTAssertEqual(events, [.delta("café ✓")])
        XCTAssertEqual(p.finish(), [.done("café ✓")])    // last block without a blank line
    }

    func testCRLineEndsMultiLineDataAndJunk() {
        var p = SSEParser()
        let text = "event: x\rdata: {\"type\":\"transcript.text.delta\",\r\ndata: \"delta\":\"a\"}\r\r: comment\n\ndata: not json\n\ndata: {\"type\":\"other\"}\n\n"
        XCTAssertEqual(p.feed(text), [.delta("a")])
    }

    func testErrorEvent() {
        var p = SSEParser()
        XCTAssertEqual(p.feed("data: {\"type\":\"error\",\"error\":{\"message\":\"boom\"}}\n\n"), [.error("boom")])
        XCTAssertEqual(p.feed("data: {\"error\":\"x\"}\n\n"), [.error("Transcription failed mid-way.")])
    }
}

// MARK: - Request

final class TranscriptionRequestTests: XCTestCase {
    func testMultipartBodyIsExact() {
        var body = MultipartBody(boundary: "B")
        body.addFile("file", filename: "speech.m4a", mime: "audio/mp4", data: Data("AUDIO".utf8))
        body.addField("model", "gpt-transcribe")
        XCTAssertEqual(String(decoding: body.finalized(), as: UTF8.self),
                       "--B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.m4a\"\r\nContent-Type: audio/mp4\r\n\r\nAUDIO\r\n"
                       + "--B\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ngpt-transcribe\r\n--B--\r\n")
        XCTAssertEqual(body.contentType, "multipart/form-data; boundary=B")
    }

    func testFieldsForGptTranscribe() {
        let spec = TranscriptionRequest(model: "gpt-transcribe", language: "en", prompt: "PyTorch", stream: true)
        let request = spec.urlRequest(apiKey: "sk-test", audio: Data("AUDIO".utf8), mime: "audio/mp4", boundary: "B")
        let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
        XCTAssertEqual(request.url?.absoluteString, "https://api.openai.com/v1/audio/transcriptions")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer sk-test")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "multipart/form-data; boundary=B")
        XCTAssertEqual(request.timeoutInterval, 90)
        XCTAssertTrue(body.contains("filename=\"speech.m4a\"\r\nContent-Type: audio/mp4"))
        XCTAssertTrue(body.contains("name=\"languages[]\"\r\n\r\nen\r\n"))
        XCTAssertFalse(body.contains("name=\"language\""))
        XCTAssertTrue(body.contains("name=\"prompt\"\r\n\r\nPyTorch\r\n"))
        XCTAssertTrue(body.contains("name=\"stream\"\r\n\r\ntrue\r\n"))
    }

    func testOlderModelsTakeLanguageAndOmitEmptyFields() {
        let body = String(decoding: TranscriptionRequest(model: "whisper-1", language: "de").body(audio: Data(), mime: "audio/webm;codecs=opus", boundary: "B").finalized(), as: UTF8.self)
        XCTAssertTrue(body.contains("name=\"language\"\r\n\r\nde\r\n"))
        XCTAssertTrue(body.contains("filename=\"speech.webm\"\r\nContent-Type: audio/webm\r\n"))
        XCTAssertFalse(body.contains("prompt"))
        XCTAssertFalse(body.contains("stream"))
    }

    func testPromptIsHintPlusLast400Characters() {
        let context = String(repeating: "a", count: 500) + "END"
        let prompt = TranscriptionRequest.prompt(hint: "Recaller", context: context)
        XCTAssertEqual(prompt, "Recaller\n" + String(context.suffix(400)))
        XCTAssertEqual(TranscriptionRequest.prompt(hint: "", context: "hi"), "hi")
        XCTAssertEqual(TranscriptionRequest.prompt(hint: "h", context: ""), "h")
        XCTAssertEqual(TranscriptionRequest.fileExtension(for: "audio/mp4"), "m4a")
        XCTAssertEqual(TranscriptionRequest.fileExtension(for: "audio/ogg;codecs=opus"), "ogg")
    }

    func testErrorMapping() {
        XCTAssertEqual(TranscribeError.http(status: 401, detail: "x"), .auth)
        XCTAssertEqual(TranscribeError.http(status: 429, detail: "You exceeded your current quota.").message,
                       "OpenAI rate limit or quota reached. You exceeded your current quota.")
        XCTAssertEqual(TranscribeError.http(status: 503, detail: "x").message, "OpenAI had a problem (503). Try again.")
        XCTAssertEqual(TranscribeError.http(status: 404, detail: "nope").message, "404: nope")
        XCTAssertEqual(TranscribeError.detail(from: Data(#"{"error":{"message":"bad"}}"#.utf8), status: 400), "bad")
    }
}

// MARK: - M4APadding

final class M4APaddingTests: XCTestCase {
    func testStripsPaddingAndKeepsTheAudio() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("pad-\(UUID().uuidString).m4a")
        let stripped = url.deletingPathExtension().appendingPathExtension("small.m4a")
        defer { try? FileManager.default.removeItem(at: url); try? FileManager.default.removeItem(at: stripped) }
        let rate = 48_000.0
        let format = try XCTUnwrap(AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(rate * 2)))
        buffer.frameLength = buffer.frameCapacity
        for i in 0..<Int(buffer.frameLength) { buffer.floatChannelData![0][i] = 0.3 * sin(Float(i) * 0.0576) }
        do {
            let file = try AVAudioFile(forWriting: url, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 48_000,
            ], commonFormat: .pcmFormatFloat32, interleaved: false)
            try file.write(from: buffer)
            file.close()
        }
        let original = try Data(contentsOf: url)
        let small = M4APadding.strip(original)
        XCTAssertLessThan(small.count, original.count)
        try small.write(to: stripped)
        func decode(_ u: URL) throws -> [Float] {
            let f = try AVAudioFile(forReading: u)
            let b = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: f.processingFormat, frameCapacity: AVAudioFrameCount(f.length)))
            try f.read(into: b)
            return Array(UnsafeBufferPointer(start: b.floatChannelData![0], count: Int(b.frameLength)))
        }
        XCTAssertEqual(try decode(url), try decode(stripped))
        XCTAssertEqual(M4APadding.strip(Data([0, 1, 2])), Data([0, 1, 2]))   // not an m4a: unchanged
    }
}

// MARK: - PhraseInsertion

final class PhraseInsertionTests: XCTestCase {
    typealias Step = PhraseInsertion.Step

    func testStreamsWithALeadingSpace() {
        var p = PhraseInsertion(before: "a")
        XCTAssertEqual(p.show(""), Step(retract: "", insert: ""))
        XCTAssertEqual(p.show(" Hello"), Step(retract: "", insert: " Hello"))
        XCTAssertEqual(p.show(" Hello world"), Step(retract: "", insert: " world"))
        XCTAssertEqual(p.show("Hello world."), Step(retract: "", insert: "."))
        XCTAssertEqual(p.show("Hello, world."), Step(retract: " world.", insert: ", world."))
        XCTAssertEqual(p.inserted, " Hello, world.")
        XCTAssertEqual(p.show(""), Step(retract: " Hello, world.", insert: ""))   // reset before a retry
        XCTAssertEqual(p.show("Again"), Step(retract: "", insert: " Again"))
    }

    func testNoSpaceAtStartOrAfterWhitespace() {
        var start = PhraseInsertion(before: nil)
        XCTAssertEqual(start.show("Hi").insert, "Hi")
        var afterSpace = PhraseInsertion(before: " ")
        XCTAssertEqual(afterSpace.show("Hi").insert, "Hi")
        var afterNewline = PhraseInsertion(before: "\n")
        XCTAssertEqual(afterNewline.show("  Hi").insert, "Hi")
    }
}

// MARK: - Transcriber retry rules (fake transport)

private final class FakeTransport: TranscriptionTransport, @unchecked Sendable {
    enum Reply { case response(status: Int, type: String, body: String), streamDrop(String), error(Error) }
    private let lock = NSLock()
    private var replies: [Reply]
    private(set) var requests: [URLRequest] = []

    init(_ replies: [Reply]) { self.replies = replies }

    var bodies: [String] { lock.withLock { requests.map { String(decoding: $0.httpBody ?? Data(), as: UTF8.self) } } }

    func send(_ request: URLRequest) async throws -> TransportResponse {
        let reply: Reply = lock.withLock {
            requests.append(request)
            return replies.isEmpty ? .error(TranscribeError.network) : replies.removeFirst()
        }
        switch reply {
        case .response(let status, let type, let body):
            return TransportResponse(status: status, contentType: type, data: Data(body.utf8))
        case .streamDrop(let partial):
            let stream = AsyncThrowingStream<[UInt8], Error> { c in
                c.yield(Array(partial.utf8))
                c.finish(throwing: URLError(.networkConnectionLost))
            }
            return TransportResponse(status: 200, contentType: "text/event-stream", body: stream)
        case .error(let error):
            throw error
        }
    }
}

@MainActor
private final class Events {
    var log: [String] = []
}

@MainActor
final class TranscriberTests: XCTestCase {
    private let sse = "text/event-stream"
    private func sseBody(_ deltas: [String], done: String?) -> String {
        var s = deltas.map { "data: {\"type\":\"transcript.text.delta\",\"delta\":\"\($0)\"}\n\n" }.joined()
        if let done { s += "data: {\"type\":\"transcript.text.done\",\"text\":\"\(done)\"}\n\n" }
        return s
    }

    private func run(_ transport: FakeTransport, model: String = "gpt-transcribe", key: String? = "sk-test",
                     events: Events) async throws -> String {
        let t = Transcriber(transport: transport, retryDelay: .zero)
        return try await t.transcribe(audio: Data("AUDIO".utf8), mime: "audio/mp4", apiKey: key,
                                      settings: VoiceSettings(model: model, language: "en", hint: "Recaller"),
                                      context: "earlier words",
                                      onDelta: { events.log.append("+\($0)") },
                                      onReset: { events.log.append("reset") })
    }

    func testStreamsDeltasThenReturnsTheDoneText() async throws {
        let fake = FakeTransport([.response(status: 200, type: sse, body: sseBody(["Hello", " world"], done: " Hello world. "))])
        let events = Events()
        let text = try await run(fake, events: events)
        XCTAssertEqual(text, "Hello world.")
        XCTAssertEqual(events.log, ["+Hello", "+ world"])
        XCTAssertEqual(fake.requests.count, 1)
        XCTAssertTrue(fake.bodies[0].contains("name=\"stream\"\r\n\r\ntrue"))
        XCTAssertTrue(fake.bodies[0].contains("name=\"prompt\"\r\n\r\nRecaller\nearlier words\r\n"))
    }

    func testWhisperIsNotStreamedAndReadsJSON() async throws {
        let fake = FakeTransport([.response(status: 200, type: "application/json", body: #"{"text":" Hi there "}"#)])
        let text = try await run(fake, model: "whisper-1", events: Events())
        XCTAssertEqual(text, "Hi there")
        XCTAssertFalse(fake.bodies[0].contains("stream"))
        XCTAssertTrue(fake.bodies[0].contains("name=\"language\"\r\n\r\nen"))
    }

    func testServerErrorIsRetriedOnceAfterAReset() async throws {
        let fake = FakeTransport([
            .response(status: 502, type: "application/json", body: "{}"),
            .response(status: 200, type: sse, body: sseBody(["Ok"], done: "Ok")),
        ])
        let events = Events()
        let text = try await run(fake, events: events)
        XCTAssertEqual(text, "Ok")
        XCTAssertEqual(events.log, ["reset", "+Ok"])
        XCTAssertEqual(fake.requests.count, 2)
    }

    func testDroppedStreamIsRetriedAndPartialTextReset() async throws {
        let fake = FakeTransport([
            .streamDrop(sseBody(["Hel"], done: nil)),
            .response(status: 200, type: sse, body: sseBody(["Hello"], done: "Hello")),
        ])
        let events = Events()
        let text = try await run(fake, events: events)
        XCTAssertEqual(text, "Hello")
        XCTAssertEqual(events.log, ["+Hel", "reset", "+Hello"])
    }

    func testNetworkFailsAfterOneRetry() async {
        let fake = FakeTransport([.error(TranscribeError.network), .error(TranscribeError.network)])
        do {
            _ = try await run(fake, events: Events())
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? TranscribeError, .network)
            XCTAssertEqual(DictationError(error as! TranscribeError).kind, .network)
        }
        XCTAssertEqual(fake.requests.count, 2)
    }

    func testRejectedParameterRetriesWithAudioOnlyUnstreamed() async throws {
        let fake = FakeTransport([
            .response(status: 400, type: "application/json", body: #"{"error":{"message":"Unsupported parameter: 'languages'"}}"#),
            .response(status: 200, type: "application/json", body: #"{"text":"Plain"}"#),
        ])
        let events = Events()
        let text = try await run(fake, events: events)
        XCTAssertEqual(text, "Plain")
        XCTAssertEqual(events.log, ["reset"])
        let retry = fake.bodies[1]
        XCTAssertTrue(retry.contains("name=\"model\"\r\n\r\ngpt-transcribe"))
        for field in ["languages[]", "prompt", "stream"] { XCTAssertFalse(retry.contains("name=\"\(field)\""), field) }
    }

    func testUnauthorizedIsAKeyErrorWithoutRetry() async {
        let fake = FakeTransport([.response(status: 401, type: "application/json", body: #"{"error":{"message":"Incorrect API key"}}"#)])
        do {
            _ = try await run(fake, events: Events())
            XCTFail("should throw")
        } catch {
            let e = DictationError(error as! TranscribeError)
            XCTAssertEqual(e.kind, .badKey)
            XCTAssertEqual(e.message, "OpenAI rejected the API key. Update it in Settings.")
            XCTAssertTrue(e.needsKey)
        }
        XCTAssertEqual(fake.requests.count, 1)
    }

    func testQuotaShowsOpenAIsMessage() async {
        let fake = FakeTransport([.response(status: 429, type: "application/json", body: #"{"error":{"message":"You exceeded your current quota."}}"#)])
        do {
            _ = try await run(fake, events: Events())
            XCTFail("should throw")
        } catch {
            let e = DictationError(error as! TranscribeError)
            XCTAssertEqual(e.kind, .quota)
            XCTAssertEqual(e.message, "OpenAI rate limit or quota reached. You exceeded your current quota.")
        }
        XCTAssertEqual(fake.requests.count, 1)
    }

    func testEmptyStreamIsConfirmedWithAPlainRequest() async throws {
        let fake = FakeTransport([
            .response(status: 200, type: sse, body: sseBody([], done: "")),
            .response(status: 200, type: "application/json", body: #"{"text":"Found it"}"#),
        ])
        let text = try await run(fake, events: Events())
        XCTAssertEqual(text, "Found it")
        XCTAssertFalse(fake.bodies[1].contains("name=\"stream\""))
        XCTAssertTrue(fake.bodies[1].contains("name=\"prompt\""))
    }

    func testStreamErrorEventIsRetried() async throws {
        let fake = FakeTransport([
            .response(status: 200, type: sse, body: "data: {\"type\":\"error\",\"error\":{\"message\":\"boom\"}}\n\n"),
            .response(status: 200, type: sse, body: sseBody(["Fine"], done: "Fine")),
        ])
        let text = try await run(fake, events: Events())
        XCTAssertEqual(text, "Fine")
        XCTAssertEqual(fake.requests.count, 2)
    }

    func testNoKeyMakesNoRequest() async {
        let fake = FakeTransport([])
        do {
            _ = try await run(fake, key: nil, events: Events())
            XCTFail("should throw")
        } catch {
            XCTAssertEqual(error as? TranscribeError, .noKey)
        }
        XCTAssertEqual(fake.requests.count, 0)
    }
}

// MARK: - Settings

final class VoiceSettingsTests: XCTestCase {
    func testDefaultsAndModels() {
        XCTAssertEqual(VoiceSettings(), VoiceSettings(model: "gpt-transcribe", language: "", hint: ""))
        XCTAssertEqual(VoiceSettings.models.map(\.id), ["gpt-transcribe", "gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"])
    }

    func testSaveLoadAndTolerantDecoding() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "VoiceSettingsTests"))
        defaults.removePersistentDomain(forName: "VoiceSettingsTests")
        XCTAssertEqual(VoiceSettings.load(from: defaults), VoiceSettings())
        VoiceSettings(model: " whisper-1 ", language: " en", hint: "PyTorch ").save(to: defaults)
        XCTAssertEqual(VoiceSettings.load(from: defaults), VoiceSettings(model: "whisper-1", language: "en", hint: "PyTorch"))
        defaults.set(Data(#"{"hint":"x"}"#.utf8), forKey: VoiceSettings.defaultsKey)
        XCTAssertEqual(VoiceSettings.load(from: defaults), VoiceSettings(model: "gpt-transcribe", language: "", hint: "x"))
        defaults.removePersistentDomain(forName: "VoiceSettingsTests")
    }
}
