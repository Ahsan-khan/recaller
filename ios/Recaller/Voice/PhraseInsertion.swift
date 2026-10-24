import Foundation

/// Where a phrase's text goes, as the desktop's `transcribeInto` (app.js) does it: the phrase is
/// inserted at the dictation point with a leading space if the text before it doesn't already end
/// in whitespace, and its own leading whitespace is dropped. While it streams, each update becomes
/// "retract this tail, then insert this" (usually only an insert: deltas just append; a retry or
/// a final text that differs from the streamed one needs a retract).
nonisolated struct PhraseInsertion: Sendable, Equatable {
    struct Step: Sendable, Equatable {
        /// Remove this text, which is the tail of what was inserted for this phrase.
        var retract: String
        /// Then insert this.
        var insert: String
        var isEmpty: Bool { retract.isEmpty && insert.isEmpty }
    }

    /// Everything inserted for this phrase so far (leading space included).
    private(set) var inserted = ""
    private var lead: String?
    private let before: Character?

    /// - Parameter before: the character just before the dictation point (nil at the start of the text).
    init(before: Character?) {
        self.before = before
    }

    /// The phrase now reads `full` (all deltas so far, or the final text): returns the edit to make.
    mutating func show(_ full: String) -> Step {
        let target = display(full)
        let a = Array(inserted.unicodeScalars)
        let b = Array(target.unicodeScalars)
        var common = 0
        while common < a.count, common < b.count, a[common] == b[common] { common += 1 }
        var retract = String.UnicodeScalarView()
        retract.append(contentsOf: a[common...])
        var insert = String.UnicodeScalarView()
        insert.append(contentsOf: b[common...])
        inserted = target
        return Step(retract: String(retract), insert: String(insert))
    }

    private mutating func display(_ full: String) -> String {
        let rest = String(full.drop(while: { $0.isWhitespace }))
        guard !rest.isEmpty else { return "" }
        if lead == nil { lead = Self.needsSpace(after: before) ? " " : "" }
        return (lead ?? "") + rest
    }

    static func needsSpace(after character: Character?) -> Bool {
        guard let character else { return false }
        return !character.isWhitespace
    }
}
