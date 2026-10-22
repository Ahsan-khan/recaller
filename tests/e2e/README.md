# End-to-end tests

These suites drive the real Recaller app with synthetic mouse and keyboard input. Each one runs against a throwaway data folder, and the features suite adds a mock OpenAI server and a fake microphone. Test windows stay mostly off-screen and don't take focus. The one exception is the features suite's real screen snip on Windows, which focuses its overlay and then Recaller; on a Mac it is skipped.

| Command | Suite | Checks |
| --- | --- | --- |
| `npm run test:features` | `features.e2e.js`: layout, copy, swipe, drag, stages, editing, reordering and deleting parts, clearing, pictures in Cooked and Served, highlight, Ctrl+click, live dictation, images, scrolling (and the board arrows showing only near their edge), the board frame, settings, column widths, the 1.18 features (the top-bar +, Clear, the Claude Code format, Eating, minimized columns, groups, the Soft header, Done and the Eaten drawer), the 1.19 features (an Eating strip that shows every column, and the widget), snip, persistence | 166 (171 on a Mac) |
| `npm run test:update` | `update-safety.e2e.js`: a new version must leave the user's data byte-for-byte unchanged, back it up and restore it | 21 (9 with `MODE=real`) |
| `npm run test:multicopy` | `multi-copy.e2e.js`: Ctrl+click as a real person does it | 12 |
| `npm run test:sync` | `sync.e2e.js`: accounts and sync (1.17) against a local mock of Google Cloud, with a second computer: see below | 43 |
| `npm run test:accounts-on` | `scripts/accounts-on.js`: multi-copy, update-safety and features again with accounts **on** and nobody signed in, the state a build with a cloud config starts in. A test data folder alone turns accounts off, so the plain runs never see it. It points `RECALLER_GCP_BASE` at a local listener and fails if the app sends it any request. `npm run test:accounts-on -- features` runs one suite | the three suites' counts, plus the no-request check |
| `npm test` | the unit tests (`npm run test:unit`), then multi-copy, update-safety, features, the same three with accounts on (`test:accounts-on`), and sync | |
| `npm run capture` | `capture-board.js`: renders a sample board to `.out/*.png` for visual review | |

- **Test a packaged build:** set `APP_MAIN` to the absolute path: PowerShell `$env:APP_MAIN = "$PWD\dist\win-unpacked\resources\app.asar\src\main.js"`, or Git Bash `export APP_MAIN="$(pwd -W)/dist/win-unpacked/resources/app.asar/src/main.js"`.
- **Real data:** `MODE=real` runs the update-safety suite on a *copy* of `%APPDATA%\Recaller`. Delete `.out\data-real` afterwards.
- **Output:** everything goes to `.out/`, which is git-ignored.
- **Before running:** run `node --check <file>` on any suite you edit. A syntax error pops up an Electron error dialog on screen.
- **One suite at a time.** Read each suite's `n/n passed` line: `npm test` chains them with `&&`, but `run-electron.js` passes on a crashed or killed Electron as success.

## Accounts and sync: `sync.e2e.js`

It runs the accounts and sync of `ai_memory/15_accounts_and_sync.md` (section 7.5) end to end, with nothing reaching Google.

- **The cloud** is the in-process mock in `tests/mock-gcp/` (Identity Toolkit, Secure Token, Firestore and Storage, with a twin of the security rules), listening on 127.0.0.1 only. The suite sets `RECALLER_GCP_BASE` to it before the app starts, so `project.json` is never read and the real project is never called; any request either computer makes beyond the loopback mock is refused and fails check 42. It also sets `RECALLER_TOKEN_STORE=test-file` (the sign-in goes to a readable `sync/account.json`) and `RECALLER_SYNC_FAST=1` (fast timers: most waits are a tenth, and the app polls every 1–2 s).
- **Computer A** is the real app, in the suite's own process, in `.out/sync-a`.
- **Computer B** is the headless peer, `tests/support/peer.js`: the same engine, account and REST clients over `.out/sync-b`, with a stand-in for main and for the page. It plays the owner's other computer (a Windows PC when the suite runs on a Mac, and a Mac on the PC). It is taken from `APP_MAIN`'s tree when that tree has one (a copy of the source), otherwise from this repo.
- **What it covers (43 checks, numbered as in 7.5):** signed out with the cloud on (no request, no `sync/` folder, the file untouched); the account forms (Enter and Esc, the short password, wrong passwords and the lock-out, password reset with its neutral answer, the 60 s wait on Send link, main's one link per email a minute and the reCAPTCHA refusal, sign-ups paused); sign-up, verification and the first upload (every note and picture, keys in screen order, unknown fields, the resumable 1 MB picture, uploads before the commit that needs them); B's edits reaching A; the joiner; copy counts; offline conflicts; a delete against an edit; a project deleted under a new note or a draft; patches held back by an open editor, an Undo toast, a copy and a drag; offline with changes waiting; expired and revoked tokens; a precondition race; a refused document; a 950 KB note; unknown fields both ways; unreadable files and the `.bak`; restoring a backup; the mass-delete guard; a second account, Combine and "Use my account's board"; signing out (with changes waiting, and removing the board, with no trace of it left in Recaller's files); deleting the account, with its gating on B; security (no token or password reaches the page, the CSP, no console errors, nothing beyond the mock); and quitting with a change waiting, which ends the run.
- **Order:** checks 9–11 run before the sign-up (while signed out, so the lock-out runs out by itself), 40 runs inside 39's deletion, and 41 last, because it quits the app.
- **Mac-safe** like the others (`mac-harness.js`), plus: `safeStorage` is a tripwire (a call fails check 42 or 43, and nothing is ever sealed; the suite stops with `HARNESS FAIL` before the app starts if it can't replace `encryptString` and `decryptString`), `shell.openExternal` is stubbed and counted on both platforms (check 43), there are no global hotkeys, and the window never takes focus (the suite tells the sync engine about focus itself). `window.confirm` is answered in the page for the restore check. Like the other suites it uses the real clipboard.
- **Screenshots** of each account state, for review, go to `.out/sync-shots/` (most in the Deep theme, two in Soft). The log is wherever you send it, for example `npm run test:sync > tests/e2e/.out/sync.log 2>&1`.
- **About 2½ minutes.** The same 43 checks run on a Mac and on the PC; check 43 is "Mac only" on a Mac and its Windows counterpart (no focus taken, DPAPI untouched) on the PC.

## On a Mac

The same commands work on a Mac. `mac-harness.js` keeps a run out of your way there, and does nothing on Windows.

- **Out of sight:** there's no Dock icon. Each test window sits just past the outer edge of your displays, with a 2 px sliver left on screen so macOS keeps drawing it, and your pointer passes through it. The app can't take focus or hide itself, and no native menu, System Settings or Finder window opens.
- **⌘ for Ctrl:** the suites send ⌘ wherever they send Ctrl on Windows (multi-select clicks, ⌘↩, ⌘Z, ⌘Y, ⌘N). Check names still say Ctrl.
- **Features suite:** it skips the real screen snip (3 checks, printed as `SKIP`), which would need Screen Recording permission and would capture your screen. It adds 8 Mac checks: the logo beside the traffic lights, ⌘ key names, Control+click, a real right-click, the menu bar, hide after copying, ⌘H, and a draft saved on quit. That makes 171 checks on a Mac (with the 1.19 checks). An `INFO` line prints the title-bar measurements, for tuning.
- **Sync suite:** 43 checks, as on the PC. It never touches the keychain.
- **Test a packaged build:** from the repo root, use an absolute path: `APP_MAIN="$PWD/dist/mac-arm64/Recaller.app/Contents/Resources/app.asar/src/main.js" npm test`. A relative path gets past the `HARNESS FAIL: no app at …` check, but `require()` then fails and Electron shows an error dialog on screen.
- **Real data:** `MODE=real` copies `~/Library/Application Support/Recaller`. Delete `.out/data-real` afterwards.
- **Retina capture:** `SCALE=2 npm run capture` renders at 2×.
- **Clipboard:** the suites use the real clipboard, as on Windows.

Full details are in `../../ai_memory/06_build_test_release.md`.
