import Foundation

/// Builds the `POST /v1/audio/transcriptions` request, field for field as the desktop's `buildForm`.
nonisolated struct TranscriptionRequest: Sendable, Equatable {
    static let defaultBase = URL(string: "https://api.openai.com/v1")!
    /// gpt-transcribe takes a `languages` array; older models take a single `language`.
    static let usesLanguageArray: Set<String> = ["gpt-transcribe"]
    /// whisper-1 can't stream completed files.
    static let streamable: Set<String> = ["gpt-transcribe", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"]
    static let timeout: TimeInterval = 90

    var model: String
    var language: String = ""
    var prompt: String = ""
    var stream: Bool = false

    /// The prompt is the vocabulary hint plus the last 400 characters already dictated, so
    /// phrase-by-phrase segments read as one continuous text.
    static func prompt(hint: String, context: String) -> String {
        [hint, String(context.suffix(400))].filter { !$0.isEmpty }.joined(separator: "\n")
    }

    /// Same mapping as `extensionFor` in transcribe.js.
    static func fileExtension(for mime: String) -> String {
        if mime.contains("ogg") { return "ogg" }
        if mime.contains("mp4") || mime.contains("m4a") { return "m4a" }
        if mime.contains("wav") { return "wav" }
        return "webm"
    }

    func body(audio: Data, mime: String, boundary: String = "recaller-\(UUID().uuidString)") -> MultipartBody {
        var form = MultipartBody(boundary: boundary)
        let type = mime.split(separator: ";").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? ""
        form.addFile("file", filename: "speech.\(Self.fileExtension(for: mime))", mime: type.isEmpty ? "audio/webm" : type, data: audio)
        form.addField("model", model)
        if !language.isEmpty {
            form.addField(Self.usesLanguageArray.contains(model) ? "languages[]" : "language", language)
        }
        if !prompt.isEmpty { form.addField("prompt", prompt) }
        if stream { form.addField("stream", "true") }
        return form
    }

    func urlRequest(apiKey: String, audio: Data, mime: String, base: URL = defaultBase,
                    boundary: String = "recaller-\(UUID().uuidString)") -> URLRequest {
        let form = body(audio: audio, mime: mime, boundary: boundary)
        var request = URLRequest(url: base.appendingPathComponent("audio/transcriptions"))
        request.httpMethod = "POST"
        request.timeoutInterval = Self.timeout
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = form.finalized()
        return request
    }
}

/// A failed transcription, with the desktop's codes and wording.
nonisolated struct TranscribeError: Error, Equatable, Sendable {
    enum Code: String, Sendable { case noKey, auth, rate, badRequest, server, http, network, timeout, stream, unknown }
    let code: Code
    let message: String

    static let noKey = TranscribeError(code: .noKey, message: "Add your OpenAI API key in Settings to use voice.")
    static let auth = TranscribeError(code: .auth, message: "OpenAI rejected the API key. Update it in Settings.")
    static let network = TranscribeError(code: .network, message: "Couldn't reach OpenAI. Check your internet connection.")
    static let timeout = TranscribeError(code: .timeout, message: "Transcription timed out. Try again.")
    static let dropped = TranscribeError(code: .stream, message: "The connection dropped while transcribing.")

    /// Maps an HTTP error status to the desktop's error (`detail` is OpenAI's `error.message`).
    static func http(status: Int, detail: String) -> TranscribeError {
        switch status {
        case 401: return .auth
        case 429: return TranscribeError(code: .rate, message: "OpenAI rate limit or quota reached. \(detail)")
        case 400: return TranscribeError(code: .badRequest, message: detail)
        case 500...: return TranscribeError(code: .server, message: "OpenAI had a problem (\(status)). Try again.")
        default: return TranscribeError(code: .http, message: "\(status): \(detail)")
        }
    }

    /// OpenAI's `error.message` from an error body, like `readError`.
    static func detail(from body: Data, status: Int) -> String {
        if let object = try? JSONSerialization.jsonObject(with: body) {
            if let message = ((object as? [String: Any])?["error"] as? [String: Any])?["message"] as? String {
                return message
            }
            if let text = String(data: body, encoding: .utf8) { return text }
        }
        let reason = HTTPURLResponse.localizedString(forStatusCode: status)
        return reason.isEmpty ? "HTTP \(status)" : reason
    }
}

/// The HTTP layer, swappable so the retry rules can be tested without the network.
nonisolated protocol TranscriptionTransport: Sendable {
    /// Sends the request. Returns the status, the Content-Type and the body as chunks.
    /// Throws `TranscribeError.network` / `.timeout` when the request can't be made.
    func send(_ request: URLRequest) async throws -> TransportResponse
}

nonisolated struct TransportResponse: Sendable {
    let status: Int
    let contentType: String
    let body: AsyncThrowingStream<[UInt8], Error>

    init(status: Int, contentType: String, body: AsyncThrowingStream<[UInt8], Error>) {
        self.status = status
        self.contentType = contentType
        self.body = body
    }

    /// A response whose body is already in memory.
    init(status: Int, contentType: String, data: Data) {
        self.status = status
        self.contentType = contentType
        self.body = AsyncThrowingStream { continuation in
            continuation.yield([UInt8](data))
            continuation.finish()
        }
    }

    func collect() async throws -> Data {
        var out = Data()
        for try await chunk in body { out.append(contentsOf: chunk) }
        return out
    }
}

nonisolated struct URLSessionTransport: TranscriptionTransport {
    var session: URLSession = .shared

    func send(_ request: URLRequest) async throws -> TransportResponse {
        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch {
            throw Self.map(error)
        }
        let http = response as? HTTPURLResponse
        let stream = AsyncThrowingStream<[UInt8], Error> { continuation in
            let task = Task {
                var chunk: [UInt8] = []
                chunk.reserveCapacity(512)
                do {
                    for try await byte in bytes {
                        chunk.append(byte)
                        // Hand over each line as it arrives, so text appears word by word.
                        if byte == 0x0A || chunk.count >= 512 {
                            continuation.yield(chunk)
                            chunk.removeAll(keepingCapacity: true)
                        }
                    }
                    if !chunk.isEmpty { continuation.yield(chunk) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: Self.map(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        return TransportResponse(status: http?.statusCode ?? 0,
                                 contentType: http?.value(forHTTPHeaderField: "Content-Type") ?? "",
                                 body: stream)
    }

    static func map(_ error: Error) -> Error {
        if error is CancellationError { return error }
        if let url = error as? URLError {
            if url.code == .cancelled { return CancellationError() }
            if url.code == .timedOut { return TranscribeError.timeout }
        }
        return TranscribeError.network
    }
}

/// Transcribes one phrase with the desktop's retry rules (`transcribe` in transcribe.js):
/// - network, 5xx and stream errors are retried once after 600 ms (`onReset` first);
/// - a 400 (a rejected optional parameter) is retried once with the audio and model only, unstreamed;
/// - an empty streamed result is confirmed once with an unstreamed request;
/// - 401 → "key" error, 429 → OpenAI's quota message.
nonisolated struct Transcriber: Sendable {
    var transport: any TranscriptionTransport = URLSessionTransport()
    var base: URL = TranscriptionRequest.defaultBase
    var retryDelay: Duration = .milliseconds(600)

    /// - Parameters:
    ///   - onDelta: each streamed fragment, in order.
    ///   - onReset: the text streamed so far must be discarded (before a retry).
    func transcribe(audio: Data, mime: String, apiKey: String?, settings: VoiceSettings, context: String,
                    onDelta: @escaping @MainActor (String) -> Void = { _ in },
                    onReset: @escaping @MainActor () -> Void = {}) async throws -> String {
        guard let apiKey, !apiKey.isEmpty else { throw TranscribeError.noKey }
        let stream = TranscriptionRequest.streamable.contains(settings.model)
        let full = TranscriptionRequest(model: settings.model, language: settings.language,
                                        prompt: TranscriptionRequest.prompt(hint: settings.hint, context: context))
        do {
            var streamed = full
            streamed.stream = stream
            let text = try await request(streamed, apiKey: apiKey, audio: audio, mime: mime, onDelta: onDelta)
            // An empty streamed result is suspicious (phrases are only sent when speech was heard),
            // so confirm once with a plain request before giving up.
            if text.isEmpty && stream {
                return try await request(full, apiKey: apiKey, audio: audio, mime: mime, onDelta: onDelta)
            }
            return text
        } catch let error as TranscribeError where [.network, .server, .stream].contains(error.code) {
            await onReset()
            try await Task.sleep(for: retryDelay)
            var again = full
            again.stream = stream
            return try await request(again, apiKey: apiKey, audio: audio, mime: mime, onDelta: onDelta)
        } catch let error as TranscribeError where error.code == .badRequest {
            await onReset()
            return try await request(TranscriptionRequest(model: settings.model), apiKey: apiKey,
                                     audio: audio, mime: mime, onDelta: onDelta)
        }
    }

    private func request(_ spec: TranscriptionRequest, apiKey: String, audio: Data, mime: String,
                         onDelta: @escaping @MainActor (String) -> Void) async throws -> String {
        let urlRequest = spec.urlRequest(apiKey: apiKey, audio: audio, mime: mime, base: base)
        return try await withDeadline(TranscriptionRequest.timeout) {
            let response = try await transport.send(urlRequest)
            guard (200..<300).contains(response.status) else {
                let body = (try? await response.collect()) ?? Data()
                throw TranscribeError.http(status: response.status,
                                           detail: TranscribeError.detail(from: body, status: response.status))
            }
            if response.contentType.contains("text/event-stream") {
                return try await readStream(response.body, onDelta: onDelta)
            }
            let body: Data
            do { body = try await response.collect() } catch { throw Self.streamFailure(error) }
            let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
            guard let object else { throw TranscribeError(code: .unknown, message: "Transcription failed.") }
            let text = object["text"].map { "\($0)" } ?? ""
            return text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private func readStream(_ body: AsyncThrowingStream<[UInt8], Error>,
                            onDelta: @escaping @MainActor (String) -> Void) async throws -> String {
        var parser = SSEParser()
        var partial = ""
        var final: String?
        func handle(_ events: [TranscriptEvent]) async throws {
            for event in events {
                switch event {
                case .delta(let delta):
                    partial += delta
                    await onDelta(delta)
                case .done(let text):
                    final = text
                case .error(let message):
                    throw TranscribeError(code: .stream, message: message)
                }
            }
        }
        do {
            for try await chunk in body { try await handle(parser.feed(chunk)) }
            try await handle(parser.finish())
        } catch let error as TranscribeError {
            throw error
        } catch {
            throw Self.streamFailure(error)
        }
        return (final ?? partial).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func streamFailure(_ error: Error) -> Error {
        if error is CancellationError { return error }
        if let error = error as? TranscribeError, error.code == .timeout { return error }
        return TranscribeError.dropped
    }
}

/// Runs `work`, failing with `TranscribeError.timeout` after `seconds` in total (like
/// `AbortSignal.timeout(90_000)` on the desktop; URLRequest's own timeout is per idle period).
nonisolated func withDeadline<T: Sendable>(_ seconds: TimeInterval,
                               _ work: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await work() }
        group.addTask {
            try await Task.sleep(for: .seconds(seconds))
            throw TranscribeError.timeout
        }
        defer { group.cancelAll() }
        guard let first = try await group.next() else { throw CancellationError() }
        return first
    }
}
