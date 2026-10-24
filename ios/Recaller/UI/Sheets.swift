import SwiftUI

// MARK: - toast

struct ToastOverlay: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        VStack {
            Spacer()
            if let t = store.toast {
                HStack(spacing: 12) {
                    Text(t.text)
                        .font(Fonts.ui(14, .medium))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(3)
                    if let action = t.action {
                        Button {
                            t.onAction?()
                            withAnimation { store.toast = nil }
                        } label: {
                            Text(action).font(Fonts.ui(14, .bold)).foregroundStyle(Theme.primaryDeep)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(Capsule().fill(Theme.mint))
                .overlay(Capsule().strokeBorder(Theme.primary.opacity(0.25)))
                .shadow(color: .black.opacity(0.3), radius: 12, y: 4)
                .padding(.horizontal, 24)
                .padding(.bottom, 74)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .id(t.id)
            }
        }
        .allowsHitTesting(store.toast != nil)
    }
}

// MARK: - a dark sheet

/// Sheets share the shell colour and light text.
struct DarkSheet<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content
                .scrollContentBackground(.hidden)
                .background(Theme.shell.ignoresSafeArea())
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(Theme.shell, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }.font(Fonts.ui(15, .semibold))
                    }
                }
        }
    }
}

// MARK: - search

struct SearchView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    var onOpen: (String) -> Void
    @State private var query = ""
    @State private var results: [Hit] = []
    @FocusState private var focused: Bool

    struct Hit: Decodable, Identifiable {
        var projectId: String
        var list: String
        var noteId: String
        var text: String
        var id: String { noteId }
    }

    var body: some View {
        DarkSheet(title: "Search") {
            List {
                ForEach(results) { hit in
                    let p = store.board.projects.first { $0.id == hit.projectId }
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            Circle().fill(Theme.accent(p?.color ?? "")).frame(width: 7, height: 7)
                            Text(p?.name ?? "").font(Fonts.ui(12, .semibold)).foregroundStyle(.white.opacity(0.7))
                            Text(hit.list == "notes" ? "Cooking" : hit.list == "used" ? "Cooked" : "Served")
                                .font(Fonts.ui(11)).foregroundStyle(.white.opacity(0.45))
                        }
                        Text(hit.text).font(Fonts.ui(15)).foregroundStyle(.white).lineLimit(4)
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(Color.white.opacity(0.06))
                    .contentShape(Rectangle())
                    .onTapGesture {
                        store.copy(text: hit.text)
                        if hit.list == "notes" { store.send("copied", hit.noteId, 1) }
                    }
                    .swipeActions(edge: .trailing) {
                        Button {
                            onOpen(hit.projectId)
                            dismiss()
                        } label: { Label("Open column", systemImage: "rectangle.portrait.on.rectangle.portrait") }
                        .tint(Theme.primary)
                    }
                }
                if !query.isEmpty && results.isEmpty {
                    Text("No notes match.").foregroundStyle(.white.opacity(0.6)).listRowBackground(Color.clear)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search every column")
            .onChange(of: query) { _, q in run(q) }
            .safeAreaInset(edge: .bottom) {
                if !results.isEmpty {
                    Text("Tap to copy · swipe to open its column").font(Fonts.ui(12)).foregroundStyle(.white.opacity(0.5)).padding(.bottom, 6)
                }
            }
        }
    }

    private func run(_ q: String) {
        guard !q.trimmingCharacters(in: .whitespaces).isEmpty else {
            results = []
            return
        }
        Task {
            let data = await store.raw("search", q)
            results = (try? JSONDecoder().decode([Hit].self, from: data)) ?? []
        }
    }
}

// MARK: - notepad

struct NotepadSheet: View {
    @EnvironmentObject private var store: AppStore
    @State private var text = ""
    @State private var saveTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    var body: some View {
        DarkSheet(title: "Notepad") {
            VStack(spacing: 10) {
                TextEditor(text: $text)
                    .font(Fonts.ui(16))
                    .foregroundStyle(Theme.ink)
                    .lineSpacing(3)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(hex: 0xFFFDF5)))
                    .focused($focused)
                HStack {
                    Text("One scratch page, saved as you type and synced.").font(Fonts.ui(12)).foregroundStyle(.white.opacity(0.55))
                    Spacer()
                    Button {
                        store.copy(text: text)
                    } label: { Label("Copy", systemImage: "doc.on.doc").font(Fonts.ui(13, .semibold)) }
                    .disabled(text.isEmpty)
                }
            }
            .padding(14)
        }
        .onAppear {
            text = store.board.notepad?.text ?? ""
            store.setBusy("editing", true)
            focused = text.isEmpty
        }
        .onDisappear {
            saveTask?.cancel()
            if text != (store.board.notepad?.text ?? "") { store.send("setNotepadText", text) }
            store.setBusy("editing", false)
        }
        .onChange(of: text) { _, t in
            saveTask?.cancel()
            saveTask = Task {
                try? await Task.sleep(for: .milliseconds(600))
                guard !Task.isCancelled else { return }
                store.send("setNotepadText", t)
            }
        }
    }
}

// MARK: - Eaten

struct EatenSheet: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        DarkSheet(title: "Eaten") {
            List {
                if store.board.eaten.isEmpty {
                    Text("Finished rounds land here when you tap Done on an Eating column. They stay on this iPhone.")
                        .font(Fonts.ui(14)).foregroundStyle(.white.opacity(0.65))
                        .listRowBackground(Color.clear)
                }
                ForEach(groupedDays, id: \.0) { day, rounds in
                    Section(day) {
                        ForEach(rounds) { r in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 6) {
                                    Circle().fill(Theme.accent(r.color)).frame(width: 7, height: 7)
                                    Text(r.name).font(Fonts.ui(12.5, .semibold)).foregroundStyle(.white.opacity(0.8))
                                    Spacer()
                                    if let done = r.doneAt {
                                        Text(Date(timeIntervalSince1970: done / 1000), style: .time).font(Fonts.mono(11)).foregroundStyle(.white.opacity(0.5))
                                    }
                                }
                                Text(r.text).font(Fonts.ui(14.5)).foregroundStyle(.white).lineLimit(5)
                            }
                            .padding(.vertical, 3)
                            .listRowBackground(Color.white.opacity(0.06))
                            .contentShape(Rectangle())
                            .onTapGesture { store.copy(text: r.text) }
                            .swipeActions(edge: .leading) {
                                Button { store.send("serveAgain", r.id) } label: { Label("Serve again", systemImage: "arrow.uturn.backward") }
                                    .tint(Theme.primary)
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { store.send("deleteEaten", r.id) } label: { Label("Delete", systemImage: "trash") }
                            }
                        }
                    }
                }
            }
        }
    }

    private var groupedDays: [(String, [EatenRound])] {
        let f = DateFormatter()
        f.dateStyle = .medium
        var order: [String] = []
        var map: [String: [EatenRound]] = [:]
        for r in store.board.eaten {
            let key = f.string(from: Date(timeIntervalSince1970: (r.doneAt ?? 0) / 1000))
            if map[key] == nil { order.append(key) }
            map[key, default: []].append(r)
        }
        return order.map { ($0, map[$0] ?? []) }
    }
}

// MARK: - columns

struct NewColumnSheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    var onCreated: (String) -> Void
    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        DarkSheet(title: "New column") {
            VStack(alignment: .leading, spacing: 14) {
                TextField("Project name", text: $name)
                    .font(Fonts.title(20))
                    .padding(.horizontal, 14).frame(height: 52)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.white.opacity(0.08)))
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(create)
                Button(action: create) {
                    Text("Create column").font(Fonts.ui(16, .semibold)).frame(maxWidth: .infinity).frame(height: 50)
                        .background(Capsule().fill(Theme.primary))
                }
                .foregroundStyle(.white)
                Spacer()
            }
            .padding(16)
        }
        .presentationDetents([.height(250)])
        .onAppear { focused = true }
    }

    private func create() {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            let r = n.isEmpty ? await store.act("addProject") : await store.act("addProject", n)
            if r.succeeded, let id = r.id {
                Haptics.success()
                dismiss()
                onCreated(id)
            }
        }
    }
}

struct ColumnSettingsSheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let projectId: String
    @State private var name = ""
    @State private var group = ""
    @State private var confirm: String?

    private var project: ProjectView? { store.board.projects.first { $0.id == projectId } }
    private var groups: [String] {
        var seen: [String] = []
        for p in store.board.projects { if let g = p.group, !seen.contains(g) { seen.append(g) } }
        return seen
    }

    var body: some View {
        DarkSheet(title: "Column") {
            if let p = project {
                Form {
                    Section("Name") {
                        TextField("Name", text: $name)
                            .font(Fonts.title(18))
                            .onSubmit { rename() }
                    }
                    .listRowBackground(Color.white.opacity(0.07))
                    Section("Colour") {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 6), spacing: 10) {
                            ForEach(Theme.palette) { s in
                                Button {
                                    Haptics.select()
                                    store.send("recolorProject", p.id, s.id)
                                } label: {
                                    Circle().fill(s.color)
                                        .frame(width: 36, height: 36)
                                        .overlay(Circle().strokeBorder(.white, lineWidth: p.color == s.id ? 3 : 0))
                                        .overlay(Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(.white).opacity(p.color == s.id ? 1 : 0))
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(s.name)
                            }
                        }
                        .padding(.vertical, 6)
                    }
                    .listRowBackground(Color.white.opacity(0.07))
                    Section("Group") {
                        TextField("No group", text: $group).onSubmit { regroup() }
                        if !groups.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack {
                                    ForEach(groups, id: \.self) { g in
                                        Button(g) {
                                            group = g
                                            regroup()
                                        }
                                        .font(Fonts.ui(13, .semibold))
                                        .padding(.horizontal, 12).frame(height: 30)
                                        .background(Capsule().fill(p.group == g ? Theme.primary : .white.opacity(0.1)))
                                        .foregroundStyle(.white)
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }
                        if p.group != nil {
                            Button("Remove from group") {
                                group = ""
                                regroup()
                            }
                        }
                    }
                    .listRowBackground(Color.white.opacity(0.07))
                    Section {
                        Toggle("Eating", isOn: Binding(get: { p.eating != nil }, set: { on in store.send(on ? "startEating" : "stopEating", p.id) }))
                        Toggle("Minimized", isOn: Binding(get: { p.minimized }, set: { store.send("setMinimized", p.id, $0) }))
                        Toggle("Cooked as a Claude Code prompt", isOn: Binding(get: { p.cookedFormat == "claude-code" }, set: { store.send("setCookedFormat", p.id, $0 ? "claude-code" : nil) }))
                    }
                    .listRowBackground(Color.white.opacity(0.07))
                    Section {
                        HStack {
                            Button { move(-1) } label: { Label("Move left", systemImage: "arrow.left") }
                            Spacer()
                            Button { move(1) } label: { Label("Move right", systemImage: "arrow.right") }
                        }
                        .buttonStyle(.borderless)
                        Button("Sort prompts oldest first") { store.send("sortPrompts", p.id) }
                    }
                    .listRowBackground(Color.white.opacity(0.07))
                    Section {
                        Button("Clear Cooked", role: .destructive) { confirm = "used" }.disabled(p.cooked.isEmpty)
                        Button("Clear Served", role: .destructive) { confirm = "combined" }.disabled(p.served.isEmpty)
                        Button("Delete column", role: .destructive) { confirm = "delete" }
                    }
                    .listRowBackground(Color.white.opacity(0.07))
                }
                .onAppear {
                    name = p.name
                    group = p.group ?? ""
                }
                .onDisappear {
                    rename()
                }
                .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
                    Button(confirm == "delete" ? "Delete column" : "Clear", role: .destructive) {
                        guard let c = confirm else { return }
                        if c == "delete" {
                            store.send("deleteProject", p.id)
                            store.showUndo("Column deleted")
                            dismiss()
                        } else {
                            store.send("clearList", p.id, c)
                            store.showUndo(c == "used" ? "Cooked cleared" : "Served cleared")
                        }
                        confirm = nil
                    }
                }
            } else {
                Text("This column is gone.").foregroundStyle(.white.opacity(0.7))
            }
        }
    }

    private var confirmTitle: String {
        switch confirm {
        case "delete": return "Delete “\(project?.name ?? "")” and everything in it?"
        case "used": return "Clear everything in Cooked?"
        default: return "Clear everything in Served?"
        }
    }

    private func rename() {
        guard let p = project else { return }
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !n.isEmpty && n != p.name { store.send("renameProject", p.id, n) }
    }

    private func regroup() {
        guard let p = project else { return }
        let g = group.trimmingCharacters(in: .whitespacesAndNewlines)
        let target: String? = g.isEmpty ? nil : g
        if target != p.group { store.send("setGroup", p.id, target) }
    }

    private func move(_ step: Int) {
        guard let p = project, let i = store.board.projects.firstIndex(where: { $0.id == p.id }) else { return }
        let j = i + step
        guard store.board.projects.indices.contains(j) else { return }
        store.send("moveProject", p.id, j)
    }
}
