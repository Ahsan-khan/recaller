import SwiftUI

/// Cooked (one combined note) or Served (the final text), as one row of the column's list.
struct StageRow: View {
    enum Kind { case cooked, served }
    @EnvironmentObject private var store: AppStore
    let kind: Kind
    let project: ProjectView
    var onCompose: (ComposerRequest) -> Void
    var onParts: (PartsRequest) -> Void
    @State private var expanded = false
    @State private var copiedFlash = false
    @State private var confirmDelete = false

    private var stage: StageView { kind == .cooked ? project.cooked : project.served }
    private var list: String { kind == .cooked ? "used" : "combined" }
    private var name: String { kind == .cooked ? "Cooked" : "Served" }
    private var bg: Color { kind == .cooked ? Theme.cookedBg : Theme.servedBg }
    private var edge: Color { kind == .cooked ? Theme.cookedEdge : Theme.servedEdge }
    private var label: Color { kind == .cooked ? Theme.cookedLabel : Theme.servedLabel }
    private var box: Color { kind == .cooked ? Theme.cookedNote : Theme.servedBox }
    private var bar: Color { kind == .cooked ? Theme.cookedAccent : Theme.primaryDeep }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: kind == .cooked ? "flame.fill" : "checkmark.seal.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(label.opacity(0.8))
                Text(name).stageLabel(label)
                if stage.parts.count > 1 {
                    Text("\(stage.parts.count) notes").font(Fonts.mono(11)).foregroundStyle(label.opacity(0.65))
                }
                if kind == .cooked, project.cookedFormat == "claude-code" {
                    Tag(text: "Claude Code", fg: Theme.cookedLabel, bg: .white.opacity(0.7))
                }
                Spacer()
                if !stage.isEmpty { menu }
            }

            if stage.isEmpty {
                Text(kind == .cooked
                     ? "Move prompts here with ↓ Cooked. They're joined into one note."
                     : "Serve the Cooked note to build the final text here.")
                    .font(Fonts.ui(13))
                    .foregroundStyle(label.opacity(0.7))
                    .padding(.bottom, 4)
            } else {
                noteBox
                footer
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(bg)
        .overlay(alignment: .top) { Rectangle().fill(edge).frame(height: 1) }
        .listRowInsets(EdgeInsets())
        .listRowBackground(bg)
        .listRowSeparator(.hidden)
        .swipeActions(edge: .trailing, allowsFullSwipe: kind == .cooked) {
            if kind == .cooked && !stage.isEmpty {
                Button { serve() } label: { Label("Serve", systemImage: "arrow.down.to.line") }
                    .tint(Theme.primaryDeep)
            }
        }
        .confirmationDialog(kind == .cooked ? "Delete the Cooked note?" : "Delete the Served text?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                store.send("deleteStage", project.id, list)
                store.showUndo(kind == .cooked ? "Cooked note deleted" : "Served text deleted")
            }
        }
    }

    private var noteBox: some View {
        HStack(spacing: 0) {
            Rectangle().fill(bar).frame(width: 3.5)
            VStack(alignment: .leading, spacing: 8) {
                if !stage.text.isEmpty {
                    Text(stage.text)
                        .font(Fonts.ui(15))
                        .foregroundStyle(Theme.ink)
                        .lineSpacing(2.5)
                        .lineLimit(expanded ? nil : 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if !stage.images.isEmpty {
                    ImageStrip(images: stage.images, size: 58)
                }
                if stage.text.count > 260 || stage.text.split(separator: "\n").count > 6 {
                    Button(expanded ? "Show less" : "Show more") {
                        withAnimation(.easeInOut(duration: 0.25)) { expanded.toggle() }
                    }
                    .font(Fonts.ui(12.5, .semibold))
                    .foregroundStyle(label)
                    .buttonStyle(.borderless)
                }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
        }
        .background(box)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(edge))
        .overlay {
            if copiedFlash { CopiedChip().transition(.scale(scale: 0.8).combined(with: .opacity)) }
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onTapGesture { copy() }
        .contextMenu {
            Button { copy() } label: { Label("Copy \(name.lowercased())", systemImage: "doc.on.doc") }
            Button { edit() } label: { Label("Edit", systemImage: "pencil") }
            Button { onParts(PartsRequest(projectId: project.id, list: list)) } label: { Label("Notes", systemImage: "list.bullet") }
        }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Button { copy() } label: {
                Label("Copy", systemImage: "doc.on.doc")
                    .font(Fonts.ui(13, .semibold))
                    .padding(.horizontal, 12).frame(height: 32)
                    .background(Capsule().fill(.white.opacity(0.75)))
                    .overlay(Capsule().strokeBorder(edge))
            }
            .foregroundStyle(label)
            .buttonStyle(.borderless)
            Button { onParts(PartsRequest(projectId: project.id, list: list)) } label: {
                Label("Notes", systemImage: "list.bullet")
                    .font(Fonts.ui(13, .semibold))
                    .padding(.horizontal, 12).frame(height: 32)
                    .background(Capsule().fill(.white.opacity(0.75)))
                    .overlay(Capsule().strokeBorder(edge))
            }
            .foregroundStyle(label)
            .buttonStyle(.borderless)
            Spacer()
            if kind == .cooked {
                Button { serve() } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "arrow.down").font(.system(size: 12, weight: .bold))
                        Text("Served").font(Fonts.ui(13.5, .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).frame(height: 32)
                    .background(Capsule().fill(Theme.primaryDeep))
                }
                .buttonStyle(.borderless)
            } else if project.eating != nil {
                Button {
                    Haptics.success()
                    store.send("doneEating", project.id)
                    store.showUndo("Moved to Eaten")
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
                        Text("Done").font(Fonts.ui(13.5, .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).frame(height: 32)
                    .background(Capsule().fill(Theme.eating))
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private var menu: some View {
        Menu {
            Button { edit() } label: { Label("Edit \(name.lowercased())", systemImage: "pencil") }
            Button { onParts(PartsRequest(projectId: project.id, list: list)) } label: { Label("Notes", systemImage: "list.bullet") }
            if kind == .cooked {
                Button {
                    store.send("setCookedFormat", project.id, project.cookedFormat == "claude-code" ? nil : "claude-code")
                } label: {
                    Label(project.cookedFormat == "claude-code" ? "Plain format" : "Format for Claude Code", systemImage: "chevron.left.forwardslash.chevron.right")
                }
            }
            Divider()
            Button(role: .destructive) { confirmDelete = true } label: { Label("Delete \(name.lowercased())", systemImage: "trash") }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(label)
                .frame(width: 30, height: 26)
                .background(Capsule().fill(.white.opacity(0.6)))
        }
    }

    private func copy() {
        store.copy(text: stage.text)
        store.send("copiedStage", project.id, list)
        withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) { copiedFlash = true }
        Task {
            try? await Task.sleep(for: .seconds(1.1))
            withAnimation(.easeOut(duration: 0.25)) { copiedFlash = false }
        }
    }

    private func serve() {
        Haptics.success()
        store.send("serveCooked", project.id)
    }

    private func edit() {
        let text = stage.parts.count == 1 ? stage.parts[0].text : stage.text
        onCompose(ComposerRequest(kind: .editStage(projectId: project.id, list: list), title: "Edit \(name)", text: text,
                                  images: stage.images, openedIds: stage.parts.map(\.id)))
    }
}

// MARK: - the parts of Cooked or Served

struct PartsSheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let request: PartsRequest
    var onEdit: (ComposerRequest) -> Void

    private var project: ProjectView? { store.board.projects.first { $0.id == request.projectId } }
    private var parts: [NoteView] {
        guard let p = project else { return [] }
        return request.list == "used" ? p.cooked.parts : p.served.parts
    }
    private var name: String { request.list == "used" ? "Cooked" : "Served" }

    var body: some View {
        NavigationStack {
            List {
                if parts.isEmpty {
                    Text("Nothing here.").foregroundStyle(.secondary)
                }
                ForEach(Array(parts.enumerated()), id: \.element.id) { i, note in
                    HStack(alignment: .top, spacing: 12) {
                        Text("\(i + 1)").font(Fonts.mono(12, .semibold)).foregroundStyle(.secondary).frame(width: 18)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(note.text.isEmpty ? "Picture" : note.text).font(Fonts.ui(14.5)).lineLimit(4)
                            if !note.images.isEmpty { ImageStrip(images: note.images, size: 44) }
                        }
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(Color.white.opacity(0.07))
                    .contentShape(Rectangle())
                    .onTapGesture { store.copy(note) }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            store.send("deleteNote", note.id)
                            store.showUndo("Note deleted")
                        } label: { Label("Delete", systemImage: "trash") }
                        Button {
                            onEdit(ComposerRequest(kind: .editNote(noteId: note.id), title: "Edit note", text: note.text, images: note.images))
                        } label: { Label("Edit", systemImage: "pencil") }
                        .tint(Theme.cookedAccent)
                    }
                    .swipeActions(edge: .leading) {
                        Button {
                            store.send("sendBack", note.id)
                        } label: { Label(request.list == "used" ? "To Cooking" : "To Cooked", systemImage: "arrow.uturn.up") }
                        .tint(Theme.primaryDeep)
                    }
                }
                .onMove { from, to in
                    guard let i = from.first else { return }
                    store.send("reorderNote", parts[i].id, to > i ? to - 1 : to)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.shell.ignoresSafeArea())
            .navigationTitle("\(name) notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                Text("Tap to copy one. Swipe left to edit or delete, right to send it back.")
                    .font(Fonts.ui(12)).foregroundStyle(.secondary).padding(.bottom, 8)
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.shell)
    }
}
