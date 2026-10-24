import SwiftUI

/// What the composer sheet edits.
struct ComposerRequest: Identifiable, Equatable {
    enum Kind: Equatable {
        case newNote(projectId: String)
        case editNote(noteId: String)
        case editStage(projectId: String, list: String)
    }
    let id = UUID()
    var kind: Kind
    var title: String
    var text: String
    var images: [ImageRef]
    var dictate = false
    var openedIds: [String] = []
}

enum SheetKind: String, Identifiable {
    case settings, search, notepad, eaten, newColumn
    var id: String { rawValue }
}

struct RootView: View {
    @EnvironmentObject private var store: AppStore
    @State private var selectedId: String?
    @State private var composer: ComposerRequest?
    @State private var sheet: SheetKind?
    @State private var columnSettings: ProjectView?
    @State private var parts: PartsRequest?
    @State private var direction: Edge = .trailing

    private var projects: [ProjectView] { store.board.projects }
    private var selected: ProjectView? {
        projects.first { $0.id == selectedId } ?? projects.first
    }

    var body: some View {
        ZStack {
            Theme.canvas.ignoresSafeArea()
            CanvasDots().ignoresSafeArea()

            VStack(spacing: 0) {
                TopBar(sheet: $sheet, onNewColumn: { sheet = .newColumn })
                if !projects.isEmpty {
                    ColumnStrip(projects: projects, selectedId: selected?.id) { id in
                        select(id)
                    } onAdd: {
                        sheet = .newColumn
                    }
                }
                content
            }

            ToastOverlay()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let p = selected {
                ActionBar(
                    onNew: { composer = newNote(p, dictate: false) },
                    onDictate: { composer = newNote(p, dictate: true) }
                )
            }
        }
        .sheet(item: $composer) { req in
            ComposerView(request: req)
                .environmentObject(store)
        }
        .sheet(item: $sheet) { kind in
            Group {
                switch kind {
                case .settings: SettingsView()
                case .search: SearchView { id in select(id) }
                case .notepad: NotepadSheet()
                case .eaten: EatenSheet()
                case .newColumn: NewColumnSheet { id in select(id) }
                }
            }
            .environmentObject(store)
        }
        .sheet(item: $columnSettings) { p in
            ColumnSettingsSheet(projectId: p.id)
                .environmentObject(store)
        }
        .sheet(item: $parts) { req in
            PartsSheet(request: req) { edit in
                parts = nil
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(350))
                    composer = edit
                }
            }
            .environmentObject(store)
        }
        #if DEBUG
        .task { await devShow() }
        #endif
        .onChange(of: projects.map(\.id)) { _, ids in
            if let id = selectedId, !ids.contains(id) { selectedId = ids.first }
        }
    }

    @ViewBuilder private var content: some View {
        if !store.ready {
            Spacer()
            if let err = store.startError {
                Text(err).font(Fonts.ui(15)).foregroundStyle(.white.opacity(0.8)).padding()
            } else {
                ProgressView().tint(Theme.leaf)
            }
            Spacer()
        } else if let p = selected {
            ColumnPage(
                project: p,
                onSwipe: { step in move(step) },
                onCompose: { composer = $0 },
                onSettings: { columnSettings = p },
                onParts: { parts = $0 }
            )
            .id(p.id)
            .transition(.asymmetric(insertion: .move(edge: direction).combined(with: .opacity),
                                    removal: .move(edge: direction == .trailing ? .leading : .trailing).combined(with: .opacity)))
        } else {
            EmptyBoard { sheet = .newColumn }
        }
    }

    #if DEBUG
    /// Development only: RECALLER_DEV_SHOW=settings | search | notepad | eaten | composer | column:<n> | parts | columnSettings
    /// opens that screen a moment after launch, for screenshots in the Simulator.
    private func devShow() async {
        guard let what = ProcessInfo.processInfo.environment["RECALLER_DEV_SHOW"] else { return }
        try? await Task.sleep(for: .seconds(2.5))
        for step in what.split(separator: ",") {
            let bits = step.split(separator: ":")
            switch bits.first {
            case "column": if bits.count > 1, let n = Int(bits[1]), projects.indices.contains(n) { select(projects[n].id) }
            case "settings": sheet = .settings
            case "search": sheet = .search
            case "notepad": sheet = .notepad
            case "eaten": sheet = .eaten
            case "new": sheet = .newColumn
            case "composer": if let p = selected { composer = newNote(p, dictate: false) }
            case "parts": if let p = selected { parts = PartsRequest(projectId: p.id, list: "used") }
            case "columnSettings": columnSettings = selected
            case "add": if bits.count > 1, let p = selected { await store.act("addNote", p.id, String(bits[1]), [Any]()) }
            case "cook": if let p = selected, let n = p.notes.first { store.send("moveToCooked", n.id) }
            default: break
            }
            try? await Task.sleep(for: .seconds(0.8))
        }
    }
    #endif

    private func newNote(_ p: ProjectView, dictate: Bool) -> ComposerRequest {
        ComposerRequest(kind: .newNote(projectId: p.id), title: p.name, text: p.draft, images: p.draftImages, dictate: dictate)
    }

    private func select(_ id: String) {
        guard id != selected?.id else { return }
        let from = projects.firstIndex { $0.id == selected?.id } ?? 0
        let to = projects.firstIndex { $0.id == id } ?? 0
        direction = to >= from ? .trailing : .leading
        Haptics.select()
        withAnimation(.spring(response: 0.38, dampingFraction: 0.9)) { selectedId = id }
    }

    private func move(_ step: Int) {
        guard let i = projects.firstIndex(where: { $0.id == selected?.id }) else { return }
        let j = i + step
        guard projects.indices.contains(j) else {
            Haptics.soft()
            return
        }
        select(projects[j].id)
    }
}

// MARK: - top bar

private struct TopBar: View {
    @EnvironmentObject private var store: AppStore
    @Binding var sheet: SheetKind?
    var onNewColumn: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                LeafMark().frame(width: 24, height: 24)
                Text("Recaller")
                    .font(Fonts.title(21, .semibold))
                    .foregroundStyle(.white)
            }
            Spacer(minLength: 4)
            SyncBadge { sheet = .settings }
            Button { sheet = .notepad } label: {
                Label("Notepad", systemImage: "note.text")
                    .font(Fonts.ui(13, .semibold))
                    .labelStyle(.titleAndIcon)
                    .padding(.horizontal, 11)
                    .frame(height: 32)
                    .background(Capsule().fill(.white.opacity(0.1)))
                    .overlay(Capsule().strokeBorder(.white.opacity(0.14)))
            }
            .foregroundStyle(.white)
            Button { sheet = .search } label: {
                Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .semibold)).frame(width: 34, height: 34)
            }
            .foregroundStyle(.white)
            .background(Circle().fill(.white.opacity(0.1)))
            Menu {
                Button { onNewColumn() } label: { Label("New column", systemImage: "plus.rectangle.on.rectangle") }
                if store.board.undo.can {
                    Button { store.send("undo") } label: { Label("Undo \(store.board.undo.label ?? "")", systemImage: "arrow.uturn.backward") }
                }
                if store.board.redo.can {
                    Button { store.send("redo") } label: { Label("Redo \(store.board.redo.label ?? "")", systemImage: "arrow.uturn.forward") }
                }
                Button { sheet = .eaten } label: { Label("Eaten", systemImage: "fork.knife") }
                Divider()
                Button { sheet = .settings } label: { Label("Settings", systemImage: "gearshape") }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 15, weight: .bold)).frame(width: 34, height: 34)
                    .background(Circle().fill(.white.opacity(0.1)))
            }
            .foregroundStyle(.white)
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 8)
    }
}

/// The cloud in the top bar: shown only when something needs attention or is running long.
private struct SyncBadge: View {
    @EnvironmentObject private var store: AppStore
    var action: () -> Void

    var body: some View {
        let a = store.account
        let phase = a.sync?.phase ?? ""
        let attention: Bool = {
            switch a.state {
            case "unverified", "needs-sign-in", "deleted", "disabled": return true
            case "signed-in": return ["choosing", "paused", "update-needed", "deleting-elsewhere"].contains(phase)
            default: return false
            }
        }()
        let offline = a.state == "signed-in" && phase == "offline"
        let syncing = a.state == "signed-in" && phase == "syncing"
        if attention || offline || syncing {
            Button(action: action) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: offline ? "icloud.slash" : phase == "paused" ? "exclamationmark.icloud" : "icloud")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white.opacity(offline ? 0.6 : 0.95))
                        .symbolEffect(.pulse, isActive: syncing)
                        .frame(width: 34, height: 34)
                    if attention {
                        Circle().fill(Color(hex: 0xF59E0B)).frame(width: 7, height: 7).offset(x: -6, y: 7)
                    }
                }
                .background(Circle().fill(.white.opacity(0.1)))
            }
            .transition(.scale.combined(with: .opacity))
        }
    }
}

// MARK: - column chips

private struct ColumnStrip: View {
    let projects: [ProjectView]
    let selectedId: String?
    var onSelect: (String) -> Void
    var onAdd: () -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(Array(projects.enumerated()), id: \.element.id) { i, p in
                        if let g = p.group, i == 0 || projects[i - 1].group != g {
                            Text(g)
                                .font(Fonts.ui(10.5, .bold)).tracking(0.6).textCase(.uppercase)
                                .foregroundStyle(Theme.leaf.opacity(0.75))
                                .padding(.leading, i == 0 ? 0 : 6)
                        }
                        Chip(project: p, selected: p.id == selectedId) { onSelect(p.id) }
                            .id(p.id)
                    }
                    Button(action: onAdd) {
                        Image(systemName: "plus")
                            .font(.system(size: 13, weight: .bold))
                            .frame(width: 34, height: 34)
                            .background(Circle().strokeBorder(.white.opacity(0.22), style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
                    }
                    .foregroundStyle(.white.opacity(0.8))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
            .onChange(of: selectedId) { _, id in
                guard let id else { return }
                withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo(id, anchor: .center) }
            }
            .onAppear { if let selectedId { proxy.scrollTo(selectedId, anchor: .center) } }
        }
        .padding(.bottom, 10)
    }
}

private struct Chip: View {
    let project: ProjectView
    let selected: Bool
    var action: () -> Void

    var body: some View {
        let accent = Theme.accent(project.color)
        Button(action: action) {
            HStack(spacing: 6) {
                if project.eating != nil {
                    Image(systemName: "leaf.fill").font(.system(size: 9, weight: .bold))
                        .foregroundStyle(selected ? .white : Theme.eatingBright)
                } else {
                    Circle().fill(selected ? .white.opacity(0.9) : accent).frame(width: 7, height: 7)
                }
                Text(project.name)
                    .font(Fonts.ui(13.5, selected ? .semibold : .medium))
                    .lineLimit(1)
                let count = project.notes.count
                if count > 0 {
                    Text("\(count)")
                        .font(Fonts.mono(10.5, .semibold))
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Capsule().fill(selected ? .white.opacity(0.22) : .white.opacity(0.1)))
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
            .foregroundStyle(.white.opacity(selected ? 1 : 0.82))
            .background {
                if selected {
                    Capsule().fill(Theme.header(project.color))
                        .shadow(color: accent.opacity(0.45), radius: 8, y: 3)
                } else {
                    Capsule().fill(.white.opacity(0.08))
                }
            }
            .overlay(Capsule().strokeBorder(.white.opacity(selected ? 0.25 : 0.1)))
            .opacity(project.minimized && !selected ? 0.55 : 1)
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: selected)
    }
}

// MARK: - bottom bar

private struct ActionBar: View {
    var onNew: () -> Void
    var onDictate: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onNew) {
                Label("New text", systemImage: "plus")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Rectangle().fill(.white.opacity(0.22)).frame(width: 1, height: 22)
            Button(action: onDictate) {
                Label("Dictate", systemImage: "mic.fill")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .font(Fonts.ui(15.5, .semibold))
        .foregroundStyle(.white)
        .frame(height: 52)
        .background(
            Capsule().fill(LinearGradient(colors: [Color(hex: 0x12B47D), Theme.primaryDeep], startPoint: .top, endPoint: .bottom))
        )
        .overlay(Capsule().strokeBorder(.white.opacity(0.18)))
        .shadow(color: .black.opacity(0.35), radius: 14, y: 6)
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(
            LinearGradient(colors: [Theme.canvasBottom.opacity(0), Theme.canvasBottom.opacity(0.9)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        )
    }
}

// MARK: - empty board, canvas art

private struct EmptyBoard: View {
    var onNew: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            LeafMark().frame(width: 54, height: 54).opacity(0.9)
            Text("No columns yet").font(Fonts.title(22)).foregroundStyle(.white)
            Text("A column holds one project's prompts.").font(Fonts.ui(14.5)).foregroundStyle(.white.opacity(0.7))
            Button(action: onNew) {
                Label("New column", systemImage: "plus").font(Fonts.ui(15, .semibold))
                    .padding(.horizontal, 20).frame(height: 44)
                    .background(Capsule().fill(Theme.primary))
            }
            .foregroundStyle(.white)
            Spacer()
        }
    }
}

/// The faint dot grid of the desktop's canvas.
struct CanvasDots: View {
    var body: some View {
        Canvas { ctx, size in
            let step: CGFloat = 20
            var y: CGFloat = 10
            while y < size.height {
                var x: CGFloat = 10
                while x < size.width {
                    ctx.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 1.4, height: 1.4)), with: .color(.white.opacity(0.055)))
                    x += step
                }
                y += step
            }
        }
        .allowsHitTesting(false)
    }
}

/// The monstera leaf of the logo, drawn.
struct LeafMark: View {
    var body: some View {
        GeometryReader { g in
            let s = min(g.size.width, g.size.height)
            ZStack {
                RoundedRectangle(cornerRadius: s * 0.28, style: .continuous)
                    .fill(LinearGradient(colors: [Color(hex: 0x34D399), Theme.primaryDeep], startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: "leaf.fill")
                    .font(.system(size: s * 0.52, weight: .semibold))
                    .foregroundStyle(.white)
                    .rotationEffect(.degrees(-12))
            }
        }
    }
}
