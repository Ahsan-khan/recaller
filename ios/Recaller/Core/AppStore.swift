import Foundation
import JavaScriptCore
import SwiftUI
import UIKit

/// The app's one store: starts the core, keeps the latest board and account state for the screens,
/// and sends every change back to the core.
@MainActor
final class AppStore: ObservableObject {
    @Published private(set) var board: BoardView = .empty
    @Published private(set) var account: AccountState = .signedOut
    @Published private(set) var ready = false
    @Published private(set) var startError: String?
    @Published var toast: Toast?

    let dataDir: URL
    private let host = JSHost()
    private var toastTask: Task<Void, Never>?

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        var text: String
        var action: String?
        var onAction: (() -> Void)?
        static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
    }

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dataDir = base.appendingPathComponent("Recaller", isDirectory: true)
        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
        host.onEvent = { [weak self] event, json in
            Task { @MainActor in self?.handle(event: event, json: json) }
        }
    }

    // MARK: - start

    func start() {
        let dir = dataDir.path
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let voice = VoiceSettings.load()
        // A run against the local mock of Google Cloud (Simulator, debug builds): RECALLER_GCP_BASE in the
        // scheme's environment, as on the desktop. Otherwise the real project.
        let env = ProcessInfo.processInfo.environment
        var opts: [String: Any] = [
            "dataDir": dir,
            "appVersion": version,
            "packaged": true,
            "deviceName": "this iPhone",
            "settings": ["model": voice.model, "language": voice.language, "hint": voice.hint],
        ]
        #if DEBUG
        if let base = env["RECALLER_GCP_BASE"], !base.isEmpty {
            opts["packaged"] = false
            opts["env"] = ["RECALLER_GCP_BASE": base, "RECALLER_TOKEN_STORE": "secure", "RECALLER_SYNC_FAST": env["RECALLER_SYNC_FAST"] ?? ""]
        }
        #endif
        guard let bundleURL = Bundle.main.url(forResource: "recaller-core", withExtension: "js", subdirectory: "core") else {
            startError = "The app is missing its core. Rebuild it."
            return
        }
        let moduleRoot = bundleURL.deletingLastPathComponent().path
        let optsJSON = String(data: try! JSONSerialization.data(withJSONObject: opts), encoding: .utf8)!
        host.queue.async { [host] in
            do {
                try host.load(bundleURL: bundleURL, moduleRoot: moduleRoot)
                let res = host.core?.invokeMethod("init", withArguments: [optsJSON])?.toString() ?? "{}"
                let view = host.core?.invokeMethod("view", withArguments: [])?.toString() ?? "{}"
                Task { @MainActor in
                    if let r = try? JSONDecoder().decode(CoreResult.self, from: Data(res.utf8)), r.ok != true {
                        self.startError = r.error ?? "Recaller couldn't start."
                    }
                    self.apply(viewJSON: Data(view.utf8))
                    self.ready = true
                    Task {
                        await self.refreshAccount()
                        #if DEBUG
                        await self.devSignIn()
                        #endif
                    }
                }
            } catch {
                Task { @MainActor in self.startError = "Recaller couldn't start: \(error.localizedDescription)" }
            }
        }
    }

    #if DEBUG
    /// Development only, against the local mock (ios/core/dev-mock.js): RECALLER_DEV_SIGNIN=email:password
    /// signs in at launch, so the Simulator can be tried without typing.
    private func devSignIn() async {
        let env = ProcessInfo.processInfo.environment
        guard env["RECALLER_GCP_BASE"] != nil, let pair = env["RECALLER_DEV_SIGNIN"], let colon = pair.firstIndex(of: ":"),
              account.state == "signed-out" else { return }
        _ = await account("sign-in", ["email": String(pair[..<colon]), "password": String(pair[pair.index(after: colon)...])])
    }
    #endif

    // MARK: - events from the core

    private func handle(event: String, json: Data) {
        switch event {
        case "board": apply(viewJSON: json)
        case "account":
            if let s = try? JSONDecoder().decode(AccountState.self, from: json) { account = s }
        case "toast":
            if let t = try? JSONSerialization.jsonObject(with: json) as? [String: Any], let text = t["text"] as? String, !text.isEmpty {
                show(text)
            }
        default: break
        }
    }

    private func apply(viewJSON: Data) {
        do {
            board = try JSONDecoder().decode(BoardView.self, from: viewJSON)
        } catch {
            print("[store] view didn't decode: \(error)")
        }
    }

    // MARK: - actions

    /// A board action (ios/core/board.js). The core sends the new view by itself.
    @discardableResult
    func act(_ name: String, _ args: Any?...) async -> CoreResult {
        let list = args.map { $0 ?? NSNull() }
        let argsJSON = (try? JSONSerialization.data(withJSONObject: list, options: [.fragmentsAllowed]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return await withCheckedContinuation { cont in
            host.queue.async { [host] in
                let out = host.core?.invokeMethod("act", withArguments: [name, argsJSON])?.toString() ?? "{}"
                let r = (try? JSONDecoder().decode(CoreResult.self, from: Data(out.utf8))) ?? CoreResult(ok: false, error: "no answer")
                cont.resume(returning: r)
            }
        }
    }

    /// A board action whose answer isn't a Result (search): its JSON as it came.
    func raw(_ name: String, _ args: Any?...) async -> Data {
        let list = args.map { $0 ?? NSNull() }
        let argsJSON = (try? JSONSerialization.data(withJSONObject: list, options: [.fragmentsAllowed]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return await withCheckedContinuation { cont in
            host.queue.async { [host] in
                let out = host.core?.invokeMethod("act", withArguments: [name, argsJSON])?.toString() ?? "null"
                cont.resume(returning: Data(out.utf8))
            }
        }
    }

    func send(_ name: String, _ args: Any?...) {
        let list = args.map { $0 ?? NSNull() }
        let argsJSON = (try? JSONSerialization.data(withJSONObject: list, options: [.fragmentsAllowed]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        host.queue.async { [host] in
            _ = host.core?.invokeMethod("act", withArguments: [name, argsJSON])
        }
    }

    /// An account or sync call (the desktop's account:* and sync:* IPC), answered with its JSON.
    func accountCall(_ op: String, _ payload: [String: Any]? = nil) async -> Data {
        let payloadJSON = payload.flatMap { try? JSONSerialization.data(withJSONObject: $0) }.flatMap { String(data: $0, encoding: .utf8) }
        return await withCheckedContinuation { cont in
            host.queue.async { [host] in
                var args: [Any] = [op]
                if let payloadJSON { args.append(payloadJSON) }
                guard let promise = host.core?.invokeMethod("account", withArguments: args) else {
                    cont.resume(returning: Data("{}".utf8))
                    return
                }
                let done: @convention(block) (JSValue) -> Void = { v in cont.resume(returning: Data((v.toString() ?? "null").utf8)) }
                let fail: @convention(block) (JSValue) -> Void = { _ in cont.resume(returning: Data(#"{"ok":false,"code":"UNAVAILABLE"}"#.utf8)) }
                promise.invokeMethod("then", withArguments: [JSValue(object: done, in: host.context)!, JSValue(object: fail, in: host.context)!])
            }
        }
    }

    func account(_ op: String, _ payload: [String: Any]? = nil) async -> CoreResult {
        let data = await accountCall(op, payload)
        let r = (try? JSONDecoder().decode(CoreResult.self, from: data)) ?? CoreResult(ok: false, code: "UNAVAILABLE")
        await refreshAccount()
        return r
    }

    func refreshAccount() async {
        let data = await accountCall("get")
        if let s = try? JSONDecoder().decode(AccountState.self, from: data) { account = s }
    }

    func syncNow() {
        Task {
            _ = await accountCall("sync:now")
            await refreshAccount()
        }
    }

    /// Holds the account's changes back while something is mid-edit ('editing', 'dictation', 'menu', 'undoToast', 'drag').
    func setBusy(_ what: String, _ on: Bool) {
        host.queue.async { [host] in
            _ = host.core?.invokeMethod("setBusy", withArguments: [what, on])
        }
    }

    /// The column whose new-text editor is open (nil when it closes): a change that removes that column waits.
    func setComposer(_ projectId: String?) {
        host.queue.async { [host] in
            _ = host.core?.invokeMethod("setBusy", withArguments: ["composer", projectId.map { $0 as Any } ?? false])
        }
    }

    func lifecycle(_ phase: ScenePhase) {
        let state: String
        switch phase {
        case .active: state = "active"
        case .inactive: state = "inactive"
        case .background: state = "background"
        @unknown default: return
        }
        if phase == .background {
            // Let the save and the final push finish while iOS keeps the app alive a little longer.
            let id = UIApplication.shared.beginBackgroundTask(withName: "Recaller sync")
            host.queue.async { [host] in
                _ = host.core?.invokeMethod("lifecycle", withArguments: [state])
                host.queue.asyncAfter(deadline: .now() + 9) {
                    Task { @MainActor in UIApplication.shared.endBackgroundTask(id) }
                }
            }
        } else {
            host.queue.async { [host] in _ = host.core?.invokeMethod("lifecycle", withArguments: [state]) }
        }
    }

    func updateVoiceSettings(_ s: VoiceSettings) {
        s.save()
        let json = String(data: (try? JSONEncoder().encode(s)) ?? Data("{}".utf8), encoding: .utf8) ?? "{}"
        host.queue.async { [host] in _ = host.core?.invokeMethod("setSettings", withArguments: [json]) }
    }

    // MARK: - copying

    func copy(_ note: NoteView) {
        Clipboard.copy(text: note.text)
        send("copied", note.id, 1)
        Haptics.tap()
        show("Copied")
    }

    func copy(text: String, label: String = "Copied") {
        Clipboard.copy(text: text)
        Haptics.tap()
        show(label)
    }

    func copyImage(_ ref: ImageRef) {
        Task {
            await ensureImage(ref.id, thumb: false)
            let url = ImageFiles.url(dataDir, id: ref.id, thumb: false)
            let fallback = ImageFiles.url(dataDir, id: ref.id, thumb: true)
            if let img = UIImage(contentsOfFile: url.path) ?? UIImage(contentsOfFile: fallback.path) {
                UIPasteboard.general.image = img
                Haptics.tap()
                show("Picture copied")
            } else {
                show("That picture isn't on this iPhone yet.")
            }
        }
    }

    // MARK: - pictures

    func imageURL(_ id: String, thumb: Bool) -> URL { ImageFiles.url(dataDir, id: id, thumb: thumb) }

    @discardableResult
    func ensureImage(_ id: String, thumb: Bool) async -> Bool {
        if FileManager.default.fileExists(atPath: imageURL(id, thumb: thumb).path) { return true }
        return await withCheckedContinuation { cont in
            host.queue.async { [host] in
                guard let promise = host.core?.invokeMethod("ensureImage", withArguments: [id, thumb]) else {
                    cont.resume(returning: false)
                    return
                }
                let done: @convention(block) (JSValue) -> Void = { v in cont.resume(returning: v.toBool()) }
                let fail: @convention(block) (JSValue) -> Void = { _ in cont.resume(returning: false) }
                promise.invokeMethod("then", withArguments: [JSValue(object: done, in: host.context)!, JSValue(object: fail, in: host.context)!])
            }
        }
    }

    func storeImage(_ image: UIImage) -> ImageRef? {
        try? ImageFiles.store(image, dataDir: dataDir)
    }

    // MARK: - toasts

    func show(_ text: String, action: String? = nil, duration: Double = 2.2, onAction: (() -> Void)? = nil) {
        toastTask?.cancel()
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            toast = Toast(text: text, action: action, onAction: onAction)
        }
        toastTask = Task {
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.25)) { self.toast = nil }
        }
    }

    /// After a change that Undo can take back: a toast with Undo, holding sync patches while it shows.
    func showUndo(_ text: String) {
        setBusy("undoToast", true)
        show(text, action: "Undo", duration: 4) { [weak self] in
            self?.send("undo")
        }
        Task {
            try? await Task.sleep(for: .seconds(4.2))
            self.setBusy("undoToast", false)
        }
    }
}

enum Clipboard {
    static func copy(text: String) {
        UIPasteboard.general.string = text
    }
}

@MainActor
enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func soft() { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func select() { UISelectionFeedbackGenerator().selectionChanged() }
}
