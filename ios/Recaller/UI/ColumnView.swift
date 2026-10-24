import SwiftUI

struct PartsRequest: Identifiable {
    let id = UUID()
    var projectId: String
    var list: String // "used" (Cooked) or "combined" (Served)
}

/// One column on the phone's screen: its coloured header, then Cooking, Cooked and Served.
struct ColumnPage: View {
    @EnvironmentObject private var store: AppStore
    let project: ProjectView
    var onSwipe: (Int) -> Void
    var onCompose: (ComposerRequest) -> Void
    var onSettings: () -> Void
    var onParts: (PartsRequest) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ColumnHeader(project: project, onSettings: onSettings)
                .gesture(
                    DragGesture(minimumDistance: 24)
                        .onEnded { v in
                            guard abs(v.translation.width) > abs(v.translation.height) * 1.4, abs(v.translation.width) > 50 else { return }
                            onSwipe(v.translation.width < 0 ? 1 : -1)
                        }
                )
            List {
                cookingSection
                StageRow(kind: .cooked, project: project, onCompose: onCompose, onParts: onParts)
                StageRow(kind: .served, project: project, onCompose: onCompose, onParts: onParts)
                Color.clear.frame(height: 24)
                    .listRowBackground(Theme.column)
                    .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 0)
            .background(Theme.column)
        }
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(LinearGradient(colors: [Theme.leaf.opacity(0.45), Theme.primary.opacity(0.25)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.35), radius: 18, y: 8)
        .padding(.horizontal, 10)
    }

    @ViewBuilder private var cookingSection: some View {
        HStack {
            Text("Cooking").stageLabel(Theme.ink)
            if !project.notes.isEmpty {
                Text("\(project.notes.count)").font(Fonts.mono(11)).foregroundStyle(Theme.ink3)
            }
            Spacer()
        }
        .padding(.top, 14)
        .padding(.bottom, 2)
        .listRowInsets(EdgeInsets(top: 0, leading: 18, bottom: 0, trailing: 18))
        .listRowBackground(Theme.column)
        .listRowSeparator(.hidden)

        if project.notes.isEmpty {
            Text("New prompts land here. Tap one to copy it, swipe right to move it to Cooked.")
                .font(Fonts.ui(13))
                .foregroundStyle(Theme.ink3)
                .padding(.vertical, 10)
                .listRowInsets(EdgeInsets(top: 0, leading: 18, bottom: 6, trailing: 18))
                .listRowBackground(Theme.column)
                .listRowSeparator(.hidden)
        }

        ForEach(project.notes) { note in
            CardRow(note: note, accent: Theme.accent(project.color)) {
                onCompose(ComposerRequest(kind: .editNote(noteId: note.id), title: "Edit prompt", text: note.text, images: note.images))
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
            .listRowBackground(Theme.column)
            .listRowSeparator(.hidden)
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                Button {
                    Haptics.tap()
                    store.send("moveToCooked", note.id)
                } label: { Label("Cooked", systemImage: "arrow.down.to.line") }
                .tint(Theme.cookedAccent)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                Button(role: .destructive) {
                    store.send("deleteNote", note.id)
                    store.showUndo("Prompt deleted")
                } label: { Label("Delete", systemImage: "trash") }
            }
        }
        .onMove { from, to in
            guard let i = from.first else { return }
            let target = to > i ? to - 1 : to
            store.send("reorderNote", project.notes[i].id, target)
        }
    }
}

// MARK: - header

private struct ColumnHeader: View {
    @EnvironmentObject private var store: AppStore
    let project: ProjectView
    var onSettings: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                if let g = project.group {
                    Text(g).font(Fonts.ui(10.5, .bold)).tracking(0.6).textCase(.uppercase).foregroundStyle(.white.opacity(0.72))
                }
                Text(project.name)
                    .font(Fonts.title(19, .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                Text(summary)
                    .font(Fonts.ui(12, .medium))
                    .foregroundStyle(.white.opacity(0.78))
            }
            Spacer(minLength: 8)
            if let since = project.eating {
                EatingBadge(since: since)
            }
            Menu {
                Button { onSettings() } label: { Label("Column settings", systemImage: "slider.horizontal.3") }
                Button {
                    store.send(project.eating == nil ? "startEating" : "stopEating", project.id)
                } label: {
                    Label(project.eating == nil ? "Mark as Eating" : "Stop Eating", systemImage: "leaf")
                }
                Button {
                    store.send("setMinimized", project.id, !project.minimized)
                } label: {
                    Label(project.minimized ? "Open column" : "Minimize column", systemImage: project.minimized ? "rectangle.expand.vertical" : "rectangle.compress.vertical")
                }
                Divider()
                Button { store.send("sortPrompts", project.id) } label: { Label("Sort prompts oldest first", systemImage: "arrow.up.arrow.down") }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.white.opacity(0.16)))
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.header(project.color))
        .overlay(alignment: .topTrailing) {
            Image(systemName: "leaf.fill")
                .font(.system(size: 74))
                .foregroundStyle(.white.opacity(0.06))
                .rotationEffect(.degrees(-28))
                .offset(x: 14, y: -16)
                .allowsHitTesting(false)
        }
        .clipped()
    }

    private var summary: String {
        var parts: [String] = []
        parts.append(project.notes.count == 1 ? "1 prompt" : "\(project.notes.count) prompts")
        if !project.cooked.isEmpty { parts.append("Cooked") }
        if !project.served.isEmpty { parts.append("Served") }
        if project.minimized { parts.append("minimized") }
        return parts.joined(separator: " · ")
    }
}

private struct EatingBadge: View {
    let since: Double
    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { ctx in
            let mins = max(0, Int(ctx.date.timeIntervalSince1970 - since / 1000) / 60)
            HStack(spacing: 4) {
                Image(systemName: "leaf.fill").font(.system(size: 10, weight: .bold))
                Text(mins < 60 ? "\(mins)m" : "\(mins / 60)h \(mins % 60)m").font(Fonts.mono(11.5, .semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 9).frame(height: 26)
            .background(Capsule().fill(Theme.eating.opacity(0.85)))
            .overlay(Capsule().strokeBorder(Theme.eatingBright.opacity(0.7)))
        }
    }
}

// MARK: - a prompt card

struct CardRow: View {
    @EnvironmentObject private var store: AppStore
    let note: NoteView
    let accent: Color
    var onEdit: () -> Void
    @State private var copiedFlash = false
    @State private var expanded = false

    var body: some View {
        let hl = Theme.highlight(note.highlight)
        HStack(spacing: 0) {
            Rectangle().fill(hl?.bar ?? accent).frame(width: 3.5)
            VStack(alignment: .leading, spacing: 8) {
                if !note.text.isEmpty {
                    Text(note.text)
                        .font(Fonts.ui(15))
                        .foregroundStyle(Theme.ink)
                        .lineSpacing(2.5)
                        .lineLimit(expanded ? nil : 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .multilineTextAlignment(.leading)
                }
                if !note.images.isEmpty {
                    ImageStrip(images: note.images, size: 64)
                }
                HStack(spacing: 8) {
                    if let hl {
                        Tag(text: hl.name, fg: hl.bar.mix(with: .black, by: 0.35), bg: hl.fill)
                    }
                    if note.conflict != nil {
                        Tag(text: "Other version", fg: Color(hex: 0x92400E), bg: Color(hex: 0xFFF3D4))
                    }
                    if note.copied > 0 {
                        Label("\(Int(note.copied))", systemImage: "doc.on.doc").font(Fonts.mono(11)).foregroundStyle(Theme.ink3)
                    }
                    Text(relTime(note.updatedAt)).font(Fonts.mono(11)).foregroundStyle(Theme.ink3)
                    Spacer(minLength: 4)
                    Button {
                        Haptics.tap()
                        store.send("moveToCooked", note.id)
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.down").font(.system(size: 10.5, weight: .bold))
                            Text("Cooked").font(Fonts.ui(12.5, .semibold))
                        }
                        .foregroundStyle(Theme.cookedLabel)
                        .padding(.horizontal, 10).frame(height: 26)
                        .background(Capsule().fill(Theme.cookedBg))
                        .overlay(Capsule().strokeBorder(Theme.cookedEdge))
                    }
                    .buttonStyle(.borderless)
                }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
        }
        .background(hl?.fill.opacity(0.55) ?? Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).strokeBorder(Theme.cardEdge))
        .overlay {
            if copiedFlash {
                CopiedChip().transition(.scale(scale: 0.8).combined(with: .opacity))
            }
        }
        .shadow(color: Theme.ink.opacity(0.06), radius: 3, y: 1.5)
        .contentShape(RoundedRectangle(cornerRadius: 13))
        .onTapGesture { copy() }
        .contextMenu {
            Button { copy() } label: { Label("Copy", systemImage: "doc.on.doc") }
            Button { onEdit() } label: { Label("Edit", systemImage: "pencil") }
            Button { store.send("moveToCooked", note.id) } label: { Label("Move to Cooked", systemImage: "arrow.down.to.line") }
            if note.text.count > 240 {
                Button { withAnimation { expanded.toggle() } } label: { Label(expanded ? "Show less" : "Show all", systemImage: "text.alignleft") }
            }
            Menu {
                ForEach(Theme.highlights) { h in
                    Button { store.send("highlight", note.id, h.id) } label: {
                        Label(h.name, systemImage: note.highlight == h.id ? "checkmark.circle.fill" : "circle.fill")
                    }
                }
                if note.highlight != nil {
                    Button { store.send("highlight", note.id, nil) } label: { Label("No highlight", systemImage: "circle.slash") }
                }
            } label: { Label("Highlight", systemImage: "highlighter") }
            Divider()
            Button(role: .destructive) {
                store.send("deleteNote", note.id)
                store.showUndo("Prompt deleted")
            } label: { Label("Delete", systemImage: "trash") }
        }
    }

    private func copy() {
        store.copy(note)
        withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) { copiedFlash = true }
        Task {
            try? await Task.sleep(for: .seconds(1.1))
            withAnimation(.easeOut(duration: 0.25)) { copiedFlash = false }
        }
    }
}

struct CopiedChip: View {
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy))
            Text("Copied").font(Fonts.ui(13, .semibold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 13).frame(height: 30)
        .background(Capsule().fill(Theme.primaryDeep))
        .shadow(color: .black.opacity(0.2), radius: 6, y: 2)
    }
}

struct Tag: View {
    let text: String
    let fg: Color
    let bg: Color
    var body: some View {
        Text(text)
            .font(Fonts.ui(11, .semibold))
            .foregroundStyle(fg)
            .padding(.horizontal, 7).padding(.vertical, 2.5)
            .background(Capsule().fill(bg))
    }
}

func relTime(_ ms: Double) -> String {
    guard ms > 0 else { return "" }
    let s = Date().timeIntervalSince1970 - ms / 1000
    if s < 60 { return "now" }
    if s < 3600 { return "\(Int(s / 60))m" }
    if s < 86400 { return "\(Int(s / 3600))h" }
    if s < 86400 * 7 { return "\(Int(s / 86400))d" }
    let f = DateFormatter()
    f.dateFormat = "d MMM"
    return f.string(from: Date(timeIntervalSince1970: ms / 1000))
}
