import Foundation

// The board as the core's view() draws it (ios/core/board.js). Read-only on this side: every change goes
// back to the core as an action, so the stored board keeps every field this app doesn't know about.

struct ImageRef: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var w: Double
    var h: Double
}

struct ConflictTag: Codable, Hashable, Sendable {
    var device: String?
    var at: Double?
}

struct NoteView: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var text: String
    var images: [ImageRef]
    var copied: Double
    var lastCopiedAt: Double
    var highlight: String?
    var conflict: ConflictTag?
    var createdAt: Double
    var updatedAt: Double
    var usedAt: Double
}

struct StageView: Codable, Hashable, Sendable {
    var text: String
    var parts: [NoteView]
    var images: [ImageRef]
    var isEmpty: Bool { parts.isEmpty }
}

struct ProjectView: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var name: String
    var color: String
    var group: String?
    var minimized: Bool
    var eating: Double?
    var cookedFormat: String?
    var notes: [NoteView]
    var cooked: StageView
    var served: StageView
    var draft: String
    var draftImages: [ImageRef]
}

struct HistoryStep: Codable, Hashable, Sendable {
    var can: Bool
    var label: String?
}

struct NotepadView: Codable, Hashable, Sendable {
    var projectId: String?
    var noteId: String?
    var text: String
}

struct EatenRound: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var project: String?
    var name: String
    var color: String
    var text: String
    var startedAt: Double?
    var doneAt: Double?
    var images: [ImageRef]
}

struct BoardView: Codable, Sendable {
    var joiner: String
    var undo: HistoryStep
    var redo: HistoryStep
    var projects: [ProjectView]
    var notepad: NotepadView?
    var eaten: [EatenRound]
    var devices: [String: String]?

    static let empty = BoardView(joiner: "blank", undo: .init(can: false, label: nil), redo: .init(can: false, label: nil),
                                 projects: [], notepad: nil, eaten: [], devices: nil)
}

// AccountState (ai_memory/15, 3.6), as the core's account:get answers it.
struct SyncStatus: Codable, Hashable, Sendable {
    var phase: String
    var pending: Int?
    var lastSyncedAt: Double?
    var tooLarge: Int?
    var quarantined: Int?
    var error: SyncError?
    struct SyncError: Codable, Hashable, Sendable { var code: String? }
}

struct SyncChoice: Codable, Hashable, Sendable {
    var kind: String
    var count: Int?
    var local: Counts?
    var remote: Counts?
    var otherAccount: String?
    struct Counts: Codable, Hashable, Sendable {
        var projects: Int?
        var notes: Int?
        var images: Int?
        var pictures: Int?
    }
}

struct DeviceInfo: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var name: String
    var platform: String?
    var lastSeenAt: Double?
    var current: Bool?
}

struct SyncProgress: Codable, Hashable, Sendable {
    var what: String?
    var done: Int?
    var total: Int?
}

struct AccountState: Codable, Sendable {
    var enabled: Bool
    var state: String
    var email: String?
    var keyStore: String?
    var sync: SyncStatus?
    var choice: SyncChoice?
    var devices: [DeviceInfo]?
    var deleting: SyncProgress?
    var signingOut: SyncProgress?

    static let signedOut = AccountState(enabled: false, state: "signed-out")

    init(enabled: Bool, state: String) {
        self.enabled = enabled
        self.state = state
    }

    var isSignedIn: Bool { state == "signed-in" }
}

/// A Result from an account call: { ok } or { ok: false, code }.
struct CoreResult: Codable, Sendable {
    var ok: Bool?
    var code: String?
    var error: String?
    var id: String?
    var pending: Int?
    var verified: Bool?
    var retryAfterMs: Double?
    var picturesLeft: Int?
    var projectId: String?
    var noteId: String?
    var to: String?

    var succeeded: Bool { ok == true }
}
