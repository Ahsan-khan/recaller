import PhotosUI
import SwiftUI

/// The editor for a new prompt, a card, or the whole Cooked or Served text. Save closes it (the owner's
/// rule); a new prompt's unsaved text stays as the column's draft.
struct ComposerView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let request: ComposerRequest

    @State private var text: String
    @State private var images: [ImageRef]
    @State private var selection: TextSelection?
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var saving = false
    @StateObject private var dictation = Dictation()
    @State private var dictAt = 0 // where dictated text goes (UTF-16 offset)
    @State private var draftTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    init(request: ComposerRequest) {
        self.request = request
        _text = State(initialValue: request.text)
        _images = State(initialValue: request.images)
    }

    private var isNew: Bool {
        if case .newNote = request.kind { return true }
        return false
    }

    private var canSave: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !images.isEmpty
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                editor
                if !images.isEmpty {
                    ImageStrip(images: images, size: 70) { ref in
                        withAnimation { images.removeAll { $0.id == ref.id } }
                        saveDraftSoon()
                    }
                    .padding(.horizontal, 2)
                }
                DictationBar(dictation: dictation, onStop: { dictation.stop() }, onSettings: openSettings)
                tools
            }
            .padding(.horizontal, 14)
            .padding(.top, 6)
            .padding(.bottom, 10)
            .background(Theme.shell.ignoresSafeArea())
            .navigationTitle(isNew ? "New text" : request.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.shell, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { cancel() }.foregroundStyle(.white.opacity(0.85))
                }
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text(isNew ? "New text" : request.title).font(Fonts.ui(15, .semibold)).foregroundStyle(.white)
                        if isNew {
                            Text(request.title).font(Fonts.ui(11.5)).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { save() } label: {
                        Text("Save").font(Fonts.ui(15.5, .bold))
                    }
                    .foregroundStyle(canSave ? Theme.leaf : .white.opacity(0.35))
                    .disabled(!canSave || saving)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(dictation.isActive)
        .onAppear(perform: appear)
        .onDisappear(perform: disappear)
        .onChange(of: photoItems) { _, items in loadPhotos(items) }
        .onChange(of: text) { _, _ in saveDraftSoon() }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                if let image, let ref = store.storeImage(image) { images.append(ref) }
                showCamera = false
            }
            .ignoresSafeArea()
        }
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $text, selection: $selection)
                .font(Fonts.ui(16.5))
                .foregroundStyle(Theme.ink)
                .lineSpacing(3)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .focused($focused)
            if text.isEmpty {
                Text(dictation.isActive ? "Listening…" : "Type a prompt, or tap the mic and speak.")
                    .font(Fonts.ui(16.5))
                    .foregroundStyle(Theme.ink3)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 16)
                    .allowsHitTesting(false)
            }
        }
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.white))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(dictation.isActive ? Theme.recording.opacity(0.7) : Theme.leaf.opacity(0.35), lineWidth: dictation.isActive ? 1.5 : 1)
        )
    }

    private var tools: some View {
        HStack(spacing: 10) {
            PhotosPicker(selection: $photoItems, maxSelectionCount: 6, matching: .images) {
                ToolIcon(system: "photo.on.rectangle")
            }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button { showCamera = true } label: { ToolIcon(system: "camera") }
            }
            Button { pastePicture() } label: { ToolIcon(system: "doc.on.clipboard") }
            if isNew && !text.isEmpty {
                Button {
                    withAnimation { text = "" }
                    Haptics.soft()
                } label: { ToolIcon(system: "eraser") }
            }
            Spacer()
            MicButton(active: dictation.isActive, level: dictation.level) { toggleDictation() }
        }
        .foregroundStyle(.white)
    }

    // MARK: - lifecycle

    private func appear() {
        switch request.kind {
        case .newNote(let pid): store.setBusy("composer", pid)
        default: store.setBusy("editing", true)
        }
        dictAt = text.utf16.count
        selection = TextSelection(insertionPoint: text.endIndex)
        dictation.onText = { delta in insertDictated(delta) }
        dictation.onRetract = { s in retractDictated(s) }
        dictation.textBeforeInsertionPoint = { String(text.utf16.prefix(dictAt)) ?? text }
        if request.dictate {
            Task {
                try? await Task.sleep(for: .milliseconds(350))
                startDictation()
            }
        } else {
            focused = true
        }
    }

    private func disappear() {
        dictation.stop()
        switch request.kind {
        case .newNote: store.setBusy("composer", false)
        default: store.setBusy("editing", false)
        }
    }

    // MARK: - dictation

    private func toggleDictation() {
        if dictation.isActive {
            dictation.stop()
        } else {
            startDictation()
        }
    }

    private func startDictation() {
        if let sel = selection, case .selection(let range) = sel.indices {
            dictAt = text.utf16.distance(from: text.utf16.startIndex, to: range.upperBound.samePosition(in: text.utf16) ?? text.utf16.endIndex)
        } else {
            dictAt = min(dictAt, text.utf16.count)
        }
        Haptics.tap()
        dictation.start(context: String(text.utf16.prefix(dictAt)) ?? "")
    }

    private func index(_ utf16: Int) -> String.Index {
        let clamped = max(0, min(utf16, text.utf16.count))
        return String.Index(utf16Offset: clamped, in: text)
    }

    private func insertDictated(_ delta: String) {
        let at = index(dictAt)
        text.insert(contentsOf: delta, at: at)
        dictAt = min(text.utf16.count, dictAt + delta.utf16.count)
        selection = TextSelection(insertionPoint: index(dictAt))
    }

    private func retractDictated(_ s: String) {
        let end = index(dictAt)
        let before = text[..<end]
        guard before.hasSuffix(s) else { return }
        let start = text.index(end, offsetBy: -s.count)
        text.removeSubrange(start..<end)
        dictAt = max(0, dictAt - s.utf16.count)
    }

    private func openSettings() {
        dismiss()
    }

    // MARK: - pictures

    private func loadPhotos(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        photoItems = []
        Task {
            for item in items {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data), let ref = store.storeImage(img) {
                    withAnimation { images.append(ref) }
                }
            }
            saveDraftSoon()
        }
    }

    private func pastePicture() {
        if let img = UIPasteboard.general.image, let ref = store.storeImage(img) {
            withAnimation { images.append(ref) }
            saveDraftSoon()
        } else if let s = UIPasteboard.general.string, !s.isEmpty {
            let at = selection.flatMap { sel -> String.Index? in
                if case .selection(let r) = sel.indices { return r.upperBound }
                return nil
            } ?? text.endIndex
            text.insert(contentsOf: s, at: at)
        } else {
            store.show("Nothing to paste")
        }
    }

    // MARK: - drafts, save, cancel

    private func saveDraftSoon() {
        guard case .newNote(let pid) = request.kind else { return }
        draftTask?.cancel()
        let t = text
        let imgs = images.map { ["id": $0.id, "w": $0.w, "h": $0.h] as [String: Any] }
        draftTask = Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            store.send("setDraft", pid, t, imgs)
        }
    }

    private func imageArgs() -> [[String: Any]] {
        images.map { ["id": $0.id, "w": $0.w, "h": $0.h] }
    }

    private func save() {
        guard canSave, !saving else { return }
        saving = true
        dictation.stop()
        draftTask?.cancel()
        let body = text
        Task {
            var res: CoreResult
            switch request.kind {
            case .newNote(let pid):
                res = await store.act("addNote", pid, body, imageArgs())
                if res.succeeded { await store.act("setDraft", pid, "", [Any]()) }
            case .editNote(let id):
                res = await store.act("editNote", id, body, imageArgs())
            case .editStage(let pid, let list):
                res = await store.act("editStage", pid, list, body, imageArgs(), request.openedIds)
            }
            saving = false
            if res.succeeded {
                Haptics.success()
                dismiss()
            } else {
                store.show(res.error == "empty" ? "Nothing to save" : "Couldn't save: \(res.error ?? "unknown")")
            }
        }
    }

    private func cancel() {
        dictation.cancel()
        if case .newNote(let pid) = request.kind {
            draftTask?.cancel()
            store.send("setDraft", pid, text, imageArgs())
            if canSave { store.show("Draft kept") }
        }
        dismiss()
    }
}

// MARK: - pieces

private struct ToolIcon: View {
    let system: String
    var body: some View {
        Image(systemName: system)
            .font(.system(size: 17, weight: .medium))
            .frame(width: 44, height: 44)
            .background(Circle().fill(.white.opacity(0.09)))
            .overlay(Circle().strokeBorder(.white.opacity(0.12)))
    }
}

private struct MicButton: View {
    let active: Bool
    let level: Float
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if active {
                    Circle().fill(Theme.recording.opacity(0.25))
                        .scaleEffect(1 + CGFloat(level) * 0.45)
                        .animation(.easeOut(duration: 0.12), value: level)
                }
                Circle()
                    .fill(active ? Theme.recording : Theme.primary)
                    .frame(width: 58, height: 58)
                    .shadow(color: (active ? Theme.recording : Theme.primary).opacity(0.5), radius: 10, y: 3)
                Image(systemName: active ? "stop.fill" : "mic.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .contentTransition(.symbolEffect(.replace))
            }
            .frame(width: 72, height: 72)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(active ? "Stop dictating" : "Dictate")
    }
}

/// Listening / Writing, the timer and the errors with what to do about them.
private struct DictationBar: View {
    @ObservedObject var dictation: Dictation
    var onStop: () -> Void
    var onSettings: () -> Void

    var body: some View {
        Group {
            switch dictation.phase {
            case .idle:
                EmptyView()
            case .starting:
                status(icon: "mic", text: "Starting mic…", color: .white.opacity(0.8))
            case .recording, .finishing:
                HStack(spacing: 10) {
                    Circle().fill(Theme.recording).frame(width: 8, height: 8)
                        .opacity(dictation.phase == .recording ? 1 : 0.4)
                    Text(dictation.phase == .finishing ? "Writing the last words…" : dictation.isWriting ? "Listening · writing…" : "Listening…")
                        .font(Fonts.ui(13.5, .medium))
                        .foregroundStyle(.white)
                    LevelMeter(level: dictation.level)
                    Spacer()
                    Text(timeString(dictation.elapsed)).font(Fonts.mono(12.5)).foregroundStyle(.white.opacity(0.7))
                }
                .padding(.horizontal, 14).frame(height: 40)
                .background(Capsule().fill(.white.opacity(0.08)))
            case .failed(let err):
                HStack(spacing: 10) {
                    Image(systemName: err.kind == .other ? "info.circle" : "exclamationmark.triangle.fill")
                        .foregroundStyle(err.kind == .other ? Theme.leaf : Color(hex: 0xF59E0B))
                    Text(err.message).font(Fonts.ui(13)).foregroundStyle(.white).lineLimit(3)
                    Spacer(minLength: 4)
                    if err.kind == .micDenied {
                        Button("Settings") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) }
                            .font(Fonts.ui(13, .semibold))
                    } else if err.needsKey {
                        Text("Add it in Settings").font(Fonts.ui(12, .semibold)).foregroundStyle(Theme.leaf)
                    } else if dictation.pendingCount > 0 {
                        Button("Retry") { dictation.retry() }.font(Fonts.ui(13, .semibold))
                        Button("Discard") { dictation.discard() }.font(Fonts.ui(13)).foregroundStyle(.white.opacity(0.7))
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.white.opacity(0.08)))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: dictation.phase)
    }

    private func status(icon: String, text: String, color: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
            Text(text).font(Fonts.ui(13.5, .medium))
            Spacer()
        }
        .foregroundStyle(color)
        .padding(.horizontal, 14).frame(height: 40)
        .background(Capsule().fill(.white.opacity(0.08)))
    }

    private func timeString(_ t: TimeInterval) -> String {
        let s = Int(t)
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

private struct LevelMeter: View {
    let level: Float
    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(0..<5) { i in
                let on = Float(i) < level * 6
                Capsule()
                    .fill(on ? Theme.leaf : .white.opacity(0.2))
                    .frame(width: 3, height: 6 + CGFloat(i) * 3)
            }
        }
        .animation(.easeOut(duration: 0.1), value: level)
    }
}

/// The camera, for a picture to attach.
struct CameraPicker: UIViewControllerRepresentable {
    var onDone: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.delegate = context.coordinator
        return p
    }

    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onDone: (UIImage?) -> Void
        init(onDone: @escaping (UIImage?) -> Void) { self.onDone = onDone }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onDone(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onDone(nil) }
    }
}
