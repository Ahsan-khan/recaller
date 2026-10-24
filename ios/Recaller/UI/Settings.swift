import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @State private var voice = VoiceSettings.load()
    @State private var key = ""
    @State private var hasKey = OpenAIKey.value != nil

    var body: some View {
        DarkSheet(title: "Settings") {
            Form {
                Section {
                    AccountSection()
                } header: { Text("Account & sync") }
                .listRowBackground(Color.white.opacity(0.07))

                Section {
                    if hasKey {
                        HStack {
                            Label("OpenAI key saved", systemImage: "key.fill").foregroundStyle(.white)
                            Spacer()
                            Button("Remove", role: .destructive) {
                                OpenAIKey.set(nil)
                                hasKey = false
                            }
                        }
                    } else {
                        SecureField("Paste your OpenAI API key", text: $key)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button("Save key") {
                            OpenAIKey.set(key)
                            key = ""
                            hasKey = OpenAIKey.value != nil
                            if hasKey { Haptics.success() }
                        }
                        .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    Picker("Model", selection: $voice.model) {
                        ForEach(VoiceSettings.models, id: \.id) { m in Text(m.label).tag(m.id) }
                    }
                    TextField("Language (blank = automatic)", text: $voice.language)
                        .textInputAutocapitalization(.never)
                    TextField("Words it should know (names, jargon)", text: $voice.hint, axis: .vertical)
                } header: {
                    Text("Voice")
                } footer: {
                    Text("Dictation sends what you say to OpenAI with your own key. The key stays in this iPhone's keychain and never syncs.")
                }
                .listRowBackground(Color.white.opacity(0.07))
                .onChange(of: voice) { _, v in store.updateVoiceSettings(v) }

                Section {
                    Picker("Join notes with", selection: Binding(get: { store.board.joiner }, set: { store.send("setJoiner", $0) })) {
                        Text("A blank line").tag("blank")
                        Text("A new line").tag("line")
                    }
                } header: {
                    Text("Notes")
                } footer: {
                    Text("How Cooked and Served join their notes. This setting syncs.")
                }
                .listRowBackground(Color.white.opacity(0.07))

                Section {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")
                    LabeledContent("Columns", value: "\(store.board.projects.count)")
                } header: { Text("About") }
                .listRowBackground(Color.white.opacity(0.07))
            }
        }
    }
}

// MARK: - account

private func accountError(_ code: String?, deleting: Bool = false) -> String {
    switch code {
    case "INVALID_EMAIL": return "That email address doesn't look right."
    case "WEAK_PASSWORD": return "Use at least 8 characters."
    case "EMAIL_EXISTS": return "There's already an account with this email."
    case "WRONG_PASSWORD": return deleting ? "Password is wrong." : "Email or password is wrong."
    case "USER_DISABLED": return "This account has been turned off."
    case "TOO_MANY_ATTEMPTS": return "Too many tries from this network. Wait a few minutes, then try again."
    case "LOCKED_OUT": return "Too many wrong passwords. Try again in a little while."
    case "SIGNUP_PAUSED": return "New accounts are paused right now. Try again later."
    case "RESET_UNAVAILABLE": return "Recaller can't send a reset link right now. Wait a while, then try again."
    case "NETWORK": return "Can't reach Recaller's cloud. Check your internet connection."
    case "NOT_VERIFIED": return "Not verified yet. The email can take a minute; check your spam folder too."
    case "BUSY": return "One moment: another account step is still running."
    default: return "Accounts aren't available right now. Try again later."
    }
}

private struct AccountSection: View {
    @EnvironmentObject private var store: AppStore
    enum Mode { case none, create, signIn, forgot }
    @State private var mode: Mode = .none
    @State private var email = ""
    @State private var password = ""
    @State private var busy: String?
    @State private var message: String?
    @State private var error: String?
    @State private var confirmSignOut = false
    @State private var pendingCount = 0
    @State private var removeBoard = false
    @State private var deleting = false
    @State private var deletePassword = ""
    @State private var deleteWord = ""

    var body: some View {
        let a = store.account
        Group {
            if !a.enabled {
                Text("Accounts aren't part of this build.").foregroundStyle(.white.opacity(0.7))
            } else {
                switch a.state {
                case "signed-in": signedIn(a)
                case "unverified": unverified(a)
                case "needs-sign-in": needsSignIn(a)
                case "deleted", "disabled":
                    VStack(alignment: .leading, spacing: 10) {
                        Text(a.state == "deleted" ? "This account was deleted. Your notes here are safe." : "This account has been turned off. Your notes here are safe.")
                            .foregroundStyle(.white)
                        Button("Use without an account") { run("sign-out", ["force": true]) }
                    }
                default: signedOut
                }
            }
            if let error { Text(error).font(Fonts.ui(13)).foregroundStyle(Color(hex: 0xFCA5A5)) }
            if let message { Text(message).font(Fonts.ui(13)).foregroundStyle(Theme.leaf) }
            if let busy {
                HStack(spacing: 8) { ProgressView(); Text(busy).font(Fonts.ui(13)).foregroundStyle(.white.opacity(0.7)) }
            }
        }
        .task { await store.refreshAccount() }
    }

    // MARK: signed out

    @ViewBuilder private var signedOut: some View {
        switch mode {
        case .none:
            Text("Keep this board in your own Recaller account, and on every device where you sign in. Recaller works the same without an account.")
                .font(Fonts.ui(14)).foregroundStyle(.white.opacity(0.8))
            HStack {
                Button { mode = .create } label: { Text("Create account").bold() }
                    .buttonStyle(.borderedProminent)
                Button("Sign in") { mode = .signIn }
                    .buttonStyle(.bordered)
            }
        case .create, .signIn:
            TextField("you@example.com", text: $email)
                .keyboardType(.emailAddress).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
            SecureField("Password (at least 8 characters)", text: $password)
                .textContentType(mode == .create ? .newPassword : .password)
            if mode == .create {
                Button { submitCreate() } label: { Text("Create account").bold() }
                    .buttonStyle(.borderedProminent).disabled(busy != nil)
                Button("I already have an account") { mode = .signIn; error = nil }
                Text("By creating an account you agree to how your data is stored: your email and a hash of your password with Google Identity Platform, and your board and its pictures in Recaller's Google Cloud project.")
                    .font(Fonts.ui(12)).foregroundStyle(.white.opacity(0.55))
            } else {
                Button { submitSignIn() } label: { Text("Sign in").bold() }
                    .buttonStyle(.borderedProminent).disabled(busy != nil)
                Button("Forgot password?") { mode = .forgot; error = nil }
                Button("Create an account instead") { mode = .create; error = nil }
            }
            Button("Cancel", role: .cancel) { reset() }
        case .forgot:
            Text("We'll email you a link to set a new password.").foregroundStyle(.white.opacity(0.8))
            TextField("you@example.com", text: $email)
                .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Send link") {
                guard !email.isEmpty else { error = "Type your email above first."; return }
                run("reset-password", ["email": email], busyText: "Sending…") { _ in
                    message = "If there's an account for \(email), a link is on its way (if it isn't in your inbox, look in Spam). After you change the password, sign in again on each device."
                }
            }
            Button("Cancel", role: .cancel) { mode = .signIn }
        }
    }

    // MARK: unverified

    @ViewBuilder private func unverified(_ a: AccountState) -> some View {
        Text("Check your email").font(Fonts.ui(16, .semibold)).foregroundStyle(.white)
        Text("We sent a link to \(a.email ?? "your email"). Open it, then come back to Recaller. Not in your inbox? Look in Spam. Nothing is uploaded until your email is verified.")
            .font(Fonts.ui(14)).foregroundStyle(.white.opacity(0.8))
        Button { checkVerified() } label: { Text("I've verified").bold() }.buttonStyle(.borderedProminent)
        Button("Send again") {
            run("resend-verification", nil, busyText: "Sending…") { _ in message = "Sent again to \(a.email ?? ""). Not in your inbox? Look in Spam." }
        }
        Button("Use a different email") { run("discard-unverified", nil) }
    }

    // MARK: needs sign-in

    @ViewBuilder private func needsSignIn(_ a: AccountState) -> some View {
        Text("You're signed out on this iPhone because your password changed or your sign-in expired. Your notes here are safe, and changes you make meanwhile upload after you sign in.")
            .font(Fonts.ui(14)).foregroundStyle(.white.opacity(0.8))
        SecureField("Password", text: $password).textContentType(.password)
        Button { email = a.email ?? ""; submitSignIn() } label: { Text("Sign in").bold() }.buttonStyle(.borderedProminent)
        Button("Stop syncing", role: .destructive) { run("sign-out", ["force": true]) }
    }

    // MARK: signed in

    @ViewBuilder private func signedIn(_ a: AccountState) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(a.email ?? "").font(Fonts.ui(16, .semibold)).foregroundStyle(.white)
            Text(statusLine(a)).font(Fonts.ui(13)).foregroundStyle(statusIsBad(a) ? Color(hex: 0xFCD34D) : .white.opacity(0.7))
        }
        if let choice = a.choice { ChoicePanel(choice: choice, email: a.email ?? "") }
        let others = (a.devices ?? []).filter { $0.current != true }
        if !others.isEmpty {
            Text("Also signed in on: " + others.map { d in "\(d.name)\(d.lastSeenAt.map { " · " + relTime($0) } ?? "")" }.joined(separator: ", "))
                .font(Fonts.ui(12.5)).foregroundStyle(.white.opacity(0.6))
        }
        if a.sync?.phase == "paused" && a.sync?.error?.code == "PERMISSION" {
            Button("Retry") { run("sync:choose", ["choice": "retry"]) }
        }
        HStack {
            Button("Sync now") { store.syncNow(); Haptics.tap() }.buttonStyle(.bordered)
            Spacer()
            Button("Sign out") { startSignOut() }.buttonStyle(.bordered)
        }
        Button("Change password") {
            run("reset-password", ["email": a.email ?? ""], busyText: "Sending…") { _ in
                message = "We emailed \(a.email ?? "you") a link to set a new password (if it isn't in your inbox, look in Spam). After you change it, sign in again on each device."
            }
        }
        if deleting {
            deletePanel(a)
        } else {
            Button("Delete account…", role: .destructive) { deleting = true }
        }
        Text("This board is kept in your account and on every device where you sign in. Changes sync by themselves; Sync now only skips the wait. Your sign-in is kept in this iPhone's keychain.")
            .font(Fonts.ui(12)).foregroundStyle(.white.opacity(0.5))
            .confirmationDialog(signOutTitle, isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button(pendingCount > 0 ? "Sign out anyway" : "Sign out", role: .destructive) { signOut(force: true, remove: false) }
                if pendingCount == 0 {
                    Button("Sign out and remove the board from this iPhone", role: .destructive) { signOut(force: false, remove: true) }
                }
                Button(pendingCount > 0 ? "Keep syncing" : "Cancel", role: .cancel) {}
            } message: {
                Text(pendingCount > 0
                     ? "\(pendingCount) change\(pendingCount == 1 ? "" : "s") haven't uploaded yet. They stay on this iPhone; notes you deleted may come back if you sign in again later."
                     : "Sign out of \(a.email ?? "")? Your board stays on this iPhone unless you remove it.")
            }
    }

    @ViewBuilder private func deletePanel(_ a: AccountState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Delete your Recaller account?").font(Fonts.ui(16, .bold)).foregroundStyle(Color(hex: 0xFCA5A5))
            Text("This deletes your account and everything in it from Google Cloud. This iPhone keeps its own copy of the board. Other devices keep theirs but stop syncing. Google's backups of the deleted data expire within 7 days. This can't be undone.")
                .font(Fonts.ui(13.5)).foregroundStyle(.white.opacity(0.85))
            SecureField("Password", text: $deletePassword).textContentType(.password)
            TextField("Type DELETE to confirm", text: $deleteWord).textInputAutocapitalization(.characters).autocorrectionDisabled()
            if let d = a.deleting {
                Text(progressText(d)).font(Fonts.ui(13)).foregroundStyle(.white.opacity(0.7))
            }
            HStack {
                Button("Delete account", role: .destructive) {
                    run("delete", ["password": deletePassword], busyText: "Deleting…", deleting: true) { _ in
                        deleting = false
                        store.show("Account deleted. Your board stays on this iPhone.")
                    }
                }
                .buttonStyle(.borderedProminent).tint(Theme.danger)
                .disabled(deletePassword.isEmpty || deleteWord != "DELETE" || busy != nil)
                Button("Cancel") { deleting = false; deletePassword = ""; deleteWord = "" }
            }
        }
        .padding(.vertical, 4)
    }

    private func progressText(_ p: SyncProgress) -> String {
        let n = "\(p.done ?? 0) of \(p.total ?? 0)"
        switch p.what {
        case "save-pictures": return "Saving full-size pictures to this iPhone… \(n)"
        case "pictures": return "Deleting pictures… \(n)"
        case "notes": return "Deleting notes… \(n)"
        default: return "Deleting account…"
        }
    }

    private var signOutTitle: String { pendingCount > 0 ? "Changes are waiting" : "Sign out?" }

    private func statusIsBad(_ a: AccountState) -> Bool {
        ["paused", "update-needed", "deleting-elsewhere", "choosing"].contains(a.sync?.phase ?? "")
    }

    private func statusLine(_ a: AccountState) -> String {
        guard let s = a.sync else { return "Signed in" }
        switch s.phase {
        case "synced": return s.lastSyncedAt.map { "Synced · \(relTime($0))" } ?? "Synced"
        case "syncing": return "Syncing…"
        case "pending":
            let n = s.pending ?? 0
            return n == 1 ? "1 change waiting to upload" : "\(n) changes waiting to upload"
        case "offline": return "Offline · changes upload when you're back online"
        case "waiting": return "Changes from another device will appear when you close the editor."
        case "choosing": return "Choose how to sync this iPhone's board"
        case "update-needed": return "Your account was synced by a newer Recaller. Update Recaller on this iPhone to keep syncing."
        case "deleting-elsewhere": return "This account is being deleted on another device."
        case "paused":
            switch s.error?.code {
            case "PERMISSION": return "Sync paused · the cloud refused a change. It stays on this iPhone."
            case "QUOTA": return "Sync paused · Google Cloud is busy. Recaller will try again in a few minutes."
            case "SERVER": return "Sync paused · Google Cloud had a problem. Trying again soon."
            case "BAD_REQUEST": return "Sync paused · this version of Recaller hit an error. Your notes are safe on this iPhone."
            default:
                if (s.tooLarge ?? 0) > 0 { return "Sync paused · \(s.tooLarge!) note(s) are too large to sync (over 900 KB). They stay on this iPhone." }
                return "Sync paused · something went wrong. Trying again soon."
            }
        default: return "Signed in"
        }
    }

    // MARK: actions

    private func reset() {
        mode = .none
        password = ""
        error = nil
        message = nil
    }

    private func submitCreate() {
        guard password.count >= 8 else { error = accountError("WEAK_PASSWORD"); return }
        run("sign-up", ["email": email, "password": password, "privacyVersion": "2026-10-01"], busyText: "Creating account…") { _ in
            password = ""
            mode = .none
        }
    }

    private func submitSignIn() {
        run("sign-in", ["email": email, "password": password], busyText: "Signing in…") { _ in
            password = ""
            mode = .none
            Haptics.success()
        }
    }

    private func checkVerified() {
        Task {
            busy = "Checking…"
            let data = await store.accountCall("check-verified")
            busy = nil
            let r = try? JSONDecoder().decode(CoreResult.self, from: data)
            if r?.verified == true {
                message = nil
                Haptics.success()
            } else {
                error = accountError(r?.ok == false ? r?.code : "NOT_VERIFIED")
            }
            await store.refreshAccount()
        }
    }

    private func startSignOut() {
        pendingCount = store.account.sync?.pending ?? 0
        confirmSignOut = true
    }

    private func signOut(force: Bool, remove: Bool) {
        run("sign-out", ["force": force, "removeBoard": remove], busyText: "Signing out…") { r in
            if let left = r.picturesLeft, left > 0 {
                store.show("Signed out. \(left) full-size picture\(left == 1 ? "" : "s") stay in your account, and this iPhone keeps the previews.")
            } else {
                store.show(remove ? "Signed out. The board was removed from this iPhone." : "Signed out. Your board stays on this iPhone.")
            }
        }
    }

    private func run(_ op: String, _ payload: [String: Any]?, busyText: String? = nil, deleting: Bool = false, onOK: ((CoreResult) -> Void)? = nil) {
        error = nil
        message = nil
        busy = busyText
        Task {
            let r = await store.account(op, payload)
            busy = nil
            if r.succeeded {
                onOK?(r)
            } else if r.code == "PENDING" {
                pendingCount = r.pending ?? 1
                confirmSignOut = true
            } else {
                error = accountError(r.code, deleting: deleting)
                Haptics.warning()
            }
        }
    }
}

/// The engine's questions (ai_memory/15, 6.3): first upload, first merge, mass delete, a missing cloud board.
private struct ChoicePanel: View {
    @EnvironmentObject private var store: AppStore
    let choice: SyncChoice
    let email: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch choice.kind {
            case "first-upload":
                title("Upload this board?")
                para("Your account \(email) is empty. Upload this iPhone's board (\(counts(choice.local))) to it? It then syncs with every device where you sign in.")
                button("Upload this board", "upload", primary: true)
                button("Not now", "not-now")
            case "first-merge":
                title("Your account already has a board")
                para("Account: \(counts(choice.remote))\nThis iPhone: \(counts(choice.local))")
                button("Combine both", "combine", primary: true)
                button("Use my account's board", "use-account")
                button("Not now", "not-now")
                Text("Combine keeps everything from both; this iPhone's projects are added after your account's. Use my account's board replaces this iPhone's board and backs it up first.")
                    .font(Fonts.ui(12)).foregroundStyle(.white.opacity(0.55))
            case "mass-delete":
                title("Delete \(choice.count ?? 0) notes everywhere?")
                para("Recaller is about to delete \(choice.count ?? 0) notes from your account and every device, but no delete you made explains it.")
                button("Keep them in my account", "keep", primary: true)
                button("Delete them everywhere", "delete-everywhere", danger: true)
            case "account-gone":
                title("Your account's cloud board is missing")
                para("Your account exists, but its cloud board is empty or was removed.")
                button("Upload this board", "upload", primary: true)
            default:
                EmptyView()
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.primary.opacity(0.14)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.leaf.opacity(0.3)))
    }

    private func title(_ s: String) -> some View { Text(s).font(Fonts.ui(15.5, .bold)).foregroundStyle(.white) }
    private func para(_ s: String) -> some View { Text(s).font(Fonts.ui(13.5)).foregroundStyle(.white.opacity(0.85)) }

    private func counts(_ c: SyncChoice.Counts?) -> String {
        guard let c else { return "—" }
        let pics = c.pictures ?? c.images ?? 0
        return "\(c.projects ?? 0) projects · \(c.notes ?? 0) notes · \(pics) pictures"
    }

    private func button(_ label: String, _ answer: String, primary: Bool = false, danger: Bool = false) -> some View {
        Button {
            Task { _ = await store.account("sync:choose", ["choice": answer]) }
        } label: {
            Text(label).font(Fonts.ui(14, .semibold)).frame(maxWidth: .infinity).frame(height: 40)
                .background(Capsule().fill(primary ? Theme.primary : danger ? Theme.danger.opacity(0.25) : .white.opacity(0.1)))
        }
        .foregroundStyle(danger ? Color(hex: 0xFCA5A5) : .white)
        .buttonStyle(.plain)
    }
}
