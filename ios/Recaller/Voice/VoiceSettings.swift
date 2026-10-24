import Foundation

/// The Voice section of Settings: same fields and defaults as the desktop (model, language, hint).
/// Kept on this phone only, like the desktop (voice settings are never synced).
nonisolated struct VoiceSettings: Codable, Equatable, Sendable {
    var model: String = "gpt-transcribe"
    /// "" = auto. Otherwise a code such as "en" (the desktop field allows 12 characters).
    var language: String = ""
    /// Vocabulary hint: words it should spell right.
    var hint: String = ""

    static let defaultsKey = "voiceSettings"

    /// The desktop's Settings › Transcription model list, in its order.
    static let models: [(id: String, label: String)] = [
        ("gpt-transcribe", "gpt-transcribe (recommended)"),
        ("gpt-4o-mini-transcribe", "gpt-4o-mini-transcribe (fastest)"),
        ("gpt-4o-transcribe", "gpt-4o-transcribe"),
        ("whisper-1", "whisper-1 (no live text)"),
    ]

    init(model: String = "gpt-transcribe", language: String = "", hint: String = "") {
        self.model = model
        self.language = language
        self.hint = hint
    }

    // Tolerates missing keys, so a future field doesn't wipe the saved ones.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? "gpt-transcribe"
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? ""
        hint = try c.decodeIfPresent(String.self, forKey: .hint) ?? ""
    }

    /// Trimmed, with an empty model falling back to the default, as the desktop's `settings:set`.
    var normalized: VoiceSettings {
        let m = model.trimmingCharacters(in: .whitespacesAndNewlines)
        return VoiceSettings(model: m.isEmpty ? "gpt-transcribe" : m,
                             language: language.trimmingCharacters(in: .whitespacesAndNewlines),
                             hint: hint.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    static func load(from defaults: UserDefaults) -> VoiceSettings {
        guard let data = defaults.data(forKey: defaultsKey),
              let settings = try? JSONDecoder().decode(VoiceSettings.self, from: data) else { return VoiceSettings() }
        return settings.normalized
    }

    func save(to defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(normalized) else { return }
        defaults.set(data, forKey: Self.defaultsKey)
    }

    static func load() -> VoiceSettings { load(from: .standard) }
    func save() { save(to: .standard) }
}

/// The OpenAI API key, kept in this phone's Keychain (never synced, same as the desktop).
enum OpenAIKey {
    static let account = "openai-api-key"

    /// The saved key, or nil when none is set.
    static var value: String? {
        guard let key = Keychain.string(account)?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else { return nil }
        return key
    }

    /// Saves the key (trimmed); nil or empty removes it.
    static func set(_ key: String?) {
        let trimmed = key?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            Keychain.delete(account)
        } else {
            Keychain.set(trimmed, for: account)
        }
    }
}
