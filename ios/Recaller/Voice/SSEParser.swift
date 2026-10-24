import Foundation

/// One event of a streamed transcription.
nonisolated enum TranscriptEvent: Sendable, Equatable {
    /// `transcript.text.delta`: the next fragment of text.
    case delta(String)
    /// `transcript.text.done`: the whole text of the phrase.
    case done(String)
    /// An `error` event (or any event carrying `error`).
    case error(String)
}

/// Incremental parser for the server-sent events of `/v1/audio/transcriptions?stream=true`,
/// as in the desktop's `readStream`: blocks are separated by a blank line, `data:` lines of a block
/// are joined, `[DONE]` and unparsable payloads are skipped. CR and CRLF line ends are accepted.
/// Works on bytes, so a UTF-8 character split across network chunks is not damaged.
nonisolated struct SSEParser: Sendable {
    private var buffer: [UInt8] = []
    private var lastWasCR = false

    init() {}

    /// Feeds raw bytes; returns the events completed by them.
    mutating func feed<S: Sequence>(_ bytes: S) -> [TranscriptEvent] where S.Element == UInt8 {
        var events: [TranscriptEvent] = []
        for byte in bytes {
            if byte == 0x0D { // \r → \n (and swallow the \n of a \r\n)
                lastWasCR = true
                append(0x0A, into: &events)
                continue
            }
            if byte == 0x0A && lastWasCR {
                lastWasCR = false
                continue
            }
            lastWasCR = false
            append(byte, into: &events)
        }
        return events
    }

    mutating func feed(_ text: String) -> [TranscriptEvent] {
        feed(Array(text.utf8))
    }

    /// Call at the end of the stream: handles a last block without a trailing blank line.
    mutating func finish() -> [TranscriptEvent] {
        defer { buffer.removeAll() }
        let text = String(decoding: buffer, as: UTF8.self)
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        return Self.handle(block: text).map { [$0] } ?? []
    }

    private mutating func append(_ byte: UInt8, into events: inout [TranscriptEvent]) {
        buffer.append(byte)
        let n = buffer.count
        guard byte == 0x0A, n >= 2, buffer[n - 2] == 0x0A else { return }
        let block = String(decoding: buffer[0..<(n - 2)], as: UTF8.self)
        buffer.removeAll(keepingCapacity: true)
        if let event = Self.handle(block: block) { events.append(event) }
    }

    static func handle(block: String) -> TranscriptEvent? {
        let payload = block
            .split(separator: "\n", omittingEmptySubsequences: false)
            .filter { $0.hasPrefix("data:") }
            .map { line -> String in
                let rest = line.dropFirst(5)
                return String(rest.drop(while: { $0 == " " || $0 == "\t" }))
            }
            .joined(separator: "\n")
        guard !payload.isEmpty, payload != "[DONE]",
              let data = payload.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let event = object as? [String: Any] else { return nil }
        let type = event["type"] as? String
        if type == "transcript.text.delta", let delta = event["delta"] as? String {
            return .delta(delta)
        }
        if type == "transcript.text.done", let text = event["text"] as? String {
            return .done(text)
        }
        if type == "error" || event["error"] != nil {
            let message = (event["error"] as? [String: Any])?["message"] as? String
            return .error(message ?? "Transcription failed mid-way.")
        }
        return nil
    }
}
