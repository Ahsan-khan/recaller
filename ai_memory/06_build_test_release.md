# 06: Build, test and release

Recaller is one codebase with two downloads. The Windows app (an NSIS installer) is the owner's main install and is built on the Windows PC. The Mac edition (a dmg, added in the seventh session; committed and pushed on branch `masos` as "mac build", merged into `main` on 2026-10-06) is built on the Mac. Everything here applies to both unless it is marked **Windows** / **On the PC** or **On a Mac**.

**1.17.0 (eighth session, accounts and sync)** adds unit tests, a local mock of Google Cloud, rules tests, a fourth e2e suite and a cloud-config step before every build. It is built and tested on `masos` in the working tree, but not committed, deployed or built yet; see "Accounts and sync: tests, mock and infra (1.17)" below and `15`.

## Prerequisites

**Windows PC (sessions 1–5):**
- Windows 11, Node 24.19, npm 11.17, Git Bash and PowerShell. Python 3.12 is optional; it was only used for patch scripts.

**Mac (seventh session):**
- A MacBook Pro with an Apple M5 Pro (arm64), macOS 26.5.1, one Retina screen (3024×1964 px at 2×, which is 1512×982 pt).
- Node 24.21.0 and npm 11.19.0 in `/usr/local/bin`; git 2.50.1 (Apple Git-155), which needs the Xcode Command Line Tools (`xcode-select -p` prints `/Library/Developer/CommandLineTools`); zsh 5.9; Python 3.13 (optional); Rosetta.
- There is no Homebrew, `gh`, PowerShell or Wine. The GitHub credentials live in GitHub Desktop, and the owner fetches, pulls and pushes themselves.
- `codesign`, `plutil`, `sips`, `hdiutil`, `spctl`, `xattr` and `file` come with macOS. They are used to check a Mac build (see "Checking a Mac build").

**Both:**
- `npm install` installs `electron@44` (44.4.5) and `electron-builder@26` (26.15.3). On the Mac, `node_modules/electron/dist` holds the arm64 `Electron.app`; on the PC it holds `electron.exe`.
- **Electron 44 downloads its binary lazily** the first time `electron` is required. If `node_modules/electron/dist` is missing, run `node node_modules/electron/install.js`.
- **npm 11 prints "allow-scripts" warnings** about install scripts. They are harmless.

## The environment trap

The owner's VS Code / Claude Code terminal sets `ELECTRON_RUN_AS_NODE=1` (on the PC, and on the Mac too), which makes `electron` behave like plain Node: `require('electron').app` is undefined, and you get "Cannot read properties of undefined (reading 'commandLine')".

- `scripts/run-electron.js` removes that variable before launching Electron. All `npm start`, `npm test*`, `npm run icon`, `npm run icon:mac` and `npm run capture` scripts go through it.
  - It passes Electron's exit code on as `code ?? 0`, so an Electron that dies from a signal (a crash or a kill) looks like success to npm, and `npm test` carries on to the next suite. Always read each suite's `n/n passed` line.
- If you call Electron directly, use `env -u ELECTRON_RUN_AS_NODE npx electron <file>` in Git Bash or in zsh on the Mac, or `Remove-Item Env:ELECTRON_RUN_AS_NODE` in PowerShell.

## Commands (run in `recaller/`)

| Command | What it does |
| --- | --- |
| `npm start` | Run from source, in a normal window that takes focus. Uses the real data folder (`%APPDATA%\Recaller` on Windows, `~/Library/Application Support/Recaller` on a Mac) unless `RECALLER_DATA_DIR` is set. On start it makes an `upgrade` backup if the saved `lastVersion` differs (then stamps the new version), and a daily backup if the last one is over 24 hours old. It also registers the global show/hide hotkey: Ctrl+Alt+R on Windows and ⌃⌥R on a Mac, unless the settings file has its own `hotkey` (an empty one registers nothing). On the owner's machines, point it at a scratch `RECALLER_DATA_DIR` unless they asked for their real data |
| `npm run dist` | **Windows:** build `dist/Recaller Setup <version>.exe` (NSIS one-click, per-user, desktop and Start-menu shortcuts). Also leaves the unpacked app in `dist/win-unpacked/`. Run it on the PC: it names no arch, so on an Apple Silicon Mac it would build an arm64 Windows app (in `dist/win-arm64-unpacked/`) that the owner's x64 PC can't run |
| `npm run dist:win` | The same Windows installer with x64 pinned (`electron-builder --win nsis --x64`), for building it on the Mac. On the PC it gives the same result as `npm run dist`. It was not run in the seventh session |
| `npm run dist:mac` | **On a Mac:** `electron-builder --mac` builds `dist/Recaller-<version>-arm64.dmg` and the app in `dist/mac-arm64/Recaller.app`: Apple Silicon only, ad-hoc signed, not notarized |
| `npm run pack` | `electron-builder --dir`: only the unpacked app for the machine you're on, no installer. On the PC that is `dist/win-unpacked/`; on the Mac it is `dist/mac-arm64/Recaller.app` (no dmg; it replaces the one `dist:mac` made). A Windows unpacked build on the Mac needs `npx electron-builder --win --dir --x64` |
| `npm run icon` | Regenerate `build/icon.png` (512 px, the Windows icon) from the SVG sprite. It writes only that file |
| `npm run icon:mac` | Regenerate `build/icon-mac.png` (1024 px on Apple's icon grid) for the Mac app. It writes only that file. Made and run on the Mac |
| `npm test` | 1.16: run all three end-to-end suites: multi-copy, then update-safety, then features. Since 1.17: the unit tests first, then multi-copy, update-safety, features, accounts-on and sync. They are chained with `&&`, so a failing step stops the rest (but a crashed Electron counts as a pass; read each `n/n passed` line) |
| `npm run test:features` / `test:update` / `test:multicopy` | Run one suite |
| `npm run test:unit` | 1.17: `node --test "tests/unit/**/*.test.js"`, plain Node, no windows, no network beyond the loopback mock. 714 tests in 20 files since the storage-overwrite fix (702 at the morning's final gates) |
| `npm run test:sync` | 1.17: `tests/e2e/sync.e2e.js`, 43 checks against the local Google Cloud mock, with a headless second computer. About 2½ minutes |
| `npm run test:accounts-on` | 1.17: `scripts/accounts-on.js` runs multi-copy, update-safety and features again with accounts on and nobody signed in, the state a packaged build with a cloud config starts in. Without it the e2e suites always run with accounts off, because a test data folder turns them off (`src/cloud/config.js`, reason `test-data-dir`). It points `RECALLER_GCP_BASE` at a local listener and fails if the app sends it anything: signed out, Recaller makes no request. `npm run test:accounts-on -- features` runs one suite. About 2 minutes on the Mac |
| `npm run cloud:config` | 1.17: checks `infra/gcp/project.json` (Terraform's `app_config` output) and copies it to `src/cloud/project.json`, which the build packs. Both are git-ignored; the key is never printed |
| `predist`, `predist:mac`, `predist:win`, `prepack` | 1.17: run automatically before `dist`, `dist:mac`, `dist:win` and `pack`: `node scripts/cloud-config.js --check` stops the build without a valid `src/cloud/project.json`. `RECALLER_NO_CLOUD=1` turns that into a warning, and the build has no accounts |
| `npm run rules:test` | 1.17, owner's gcloud login: sends the rules texts and all `tests/rules/cases.js` cases to the Firebase Rules API's test method. Deploys, reads and writes nothing; free. `node infra/scripts/rules-test.js TEXT` runs only the matching cases |
| `npm run rules:smoke` | 1.17, owner's gcloud login: checks the deployed rules and the app's REST calls on the real project with two throwaway accounts, then deletes everything it made. Costs cents at most. Only after the live deploy |
| `npm run capture` | Render a sample board to `tests/e2e/.out/<OUT>*.png` for visual review. On a Mac, `SCALE=2 npm run capture` renders at Retina 2× (added in the seventh session but not run yet) |

**Environment variables:**
- `RECALLER_DATA_DIR`: use another data folder.
- `RECALLER_OPENAI_BASE`: point transcription at a mock server.
- `APP_MAIN`: which `main.js` the tests load, for example the packaged one.
- `MODE=real`: run the update-safety suite against a copy of the owner's real data.
- `OUT`: the file-name prefix for `npm run capture` (default `headers`).
- `SCALE` (On a Mac, `npm run capture` only): the device scale factor, `2` for a Retina capture. Windows ignores it.
- 1.17, all ignored in a packaged app:
  - `RECALLER_GCP_BASE=http://127.0.0.1:PORT`: every Google service goes to the mock (loopback only; anything else is refused);
  - `RECALLER_GCP_REAL=1`: lets a run with `RECALLER_DATA_DIR` use the real project (the manual check only). Without it, `RECALLER_DATA_DIR` without a mock turns accounts off, which keeps the older suites exactly as before;
  - `RECALLER_TOKEN_STORE=memory | test-file | secure`: `memory` (the default from source) writes nothing; `test-file` is allowed only with the mock; `secure` uses the keychain or DPAPI and can bring a keychain prompt on a Mac;
  - `RECALLER_SYNC_FAST=1`: timers ÷10 (polls every 1–2 s);
  - `RECALLER_SYNC_OFFLINE=1`: the engine behaves as if offline;
  - `RECALLER_NO_CLOUD=1`: build without `src/cloud/project.json` (no accounts).
- **Setting them:** PowerShell needs `$env:X = '…'` first. Git Bash and zsh take them inline, for example `MODE=real npm run test:update`.

## Build notes

- **Packaging config** (electron-builder, in `package.json`):
  - `files: ["src/**/*", "build/icon.png", "package.json"]` (unchanged by the Mac edition; `build/icon-mac.png` is a build resource that becomes the Mac app's `icon.icns`, not a file inside `app.asar`). Since 1.17 that includes `src/cloud/project.json` when `npm run cloud:config` has written it: the cloud config, API key included, ships inside `app.asar`. The key is public by design; it still stays out of git
  - `win.target: nsis` (no arch in the config; see `dist` and `dist:win` above)
  - `nsis: { oneClick: true, perMachine: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: "Recaller", deleteAppDataOnUninstall: false }`
  - **On a Mac** (seventh session): `mac: { target: [{ target: "dmg", arch: ["arm64"] }], icon: "build/icon-mac.png", category: "public.app-category.productivity", identity: "-", hardenedRuntime: false, darkModeSupport: true, extendInfo: { NSMicrophoneUsageDescription: "Recaller listens only while you dictate a prompt, and sends the recording to OpenAI to turn it into text." } }` and `dmg: { title: "Recaller ${version}" }`.
    - `identity: "-"` asks for an ad-hoc signature. Apple Silicon won't launch an app with a broken signature, and there is no Developer ID yet. Developer ID signing and notarization can be added to this block later.
    - `NSMicrophoneUsageDescription` is required: without it macOS kills the app when it opens the microphone.
    - `appId` (`com.akhan.recaller`), `productName`, the data folder, the NSIS config and `build/icon.png` were not changed.
- **Install location:** **Windows:** `%LOCALAPPDATA%\Programs\recaller\`. The installer launches the app when it finishes. **On a Mac:** `/Applications/Recaller.app`, dragged there from the dmg.
- **Signing:**
  - **Windows:** unsigned. The build runs a signtool step, but there is no certificate, so the installer is unsigned and Windows SmartScreen may warn ("More info → Run anyway").
  - **On a Mac:** ad-hoc signed, no hardened runtime, not notarized. The build log says `signing … identityName=- identityHash=none` and `skipped macOS notarization`. Gatekeeper rejects the app (`spctl` says "rejected"), which is expected; the install steps below get past it once. The ad-hoc signature changes with every build.
- **First build downloads:** Electron zip, NSIS, 7zip and resources into electron-builder's cache. A build takes about 1 minute. On the Mac the caches are `~/Library/Caches/electron` and `~/Library/Caches/electron-builder` (dmg-builder, 7zip, icons).
- **Known flake (seen on the PC):** the build sometimes exits with code 127 partway (while unpacking Electron or building NSIS), leaving `dist/win-unpacked.tmp` and `.tmp.lock`. Fix: `rm -rf dist/win-unpacked dist/win-unpacked.tmp dist/win-unpacked.tmp.lock`, then build again.
- **Before each release:** clean the old unpacked output with `rm -rf dist/win-unpacked dist/win-unpacked.tmp dist/win-unpacked.tmp.lock`. Older installers have been kept in `dist\` so far (it's git-ignored); delete them only if the owner wants the space back. **On a Mac,** `dist:mac` simply overwrites `dist/mac-arm64/` and the dmg of the same version.
- **What `dist/` holds on each machine:**
  - **On the PC** (fifth session): the installers for 1.5.0–1.16.0 (see below).
  - **On the Mac** (seventh session): `Recaller-1.16.0-arm64.dmg` (129 MB) and its `.blockmap`, `mac-arm64/Recaller.app`, `latest-mac.yml`, `builder-debug.yml` and `.icon-icns/`. Also `_discarded-1.17.0/`: the sixth session's discarded 1.17.0 builds (a dmg, an exe, `mac-arm64/`, `win-unpacked/`), moved there and kept, nothing deleted. Never hand those out, install them, or point `APP_MAIN` at them. There is no Windows build of 1.16.0 on the Mac.
  - `latest*.yml`, the `.blockmap` files and the `app-update.yml` inside the app are electron-builder's update metadata. Recaller has no auto-updater, so nothing reads them.

## How the owner installs and updates

**On the Windows PC:**
1. Give them `dist\Recaller Setup X.Y.Z.exe`. They double-click it; it installs over the previous version (closing the running app if needed) and relaunches.
2. Their data in `%APPDATA%\Recaller` is untouched, and the new version makes an `upgrade` backup on first start.
3. **Currently installed:** 1.17.0 since 2026-10-01 (about 20:23; checked on 2026-10-06), from the installer built on the Mac. 1.15.0 was installed in the fifth session; whether 1.16.0 ever was isn't known. Installers for 1.5.0–1.17.0 sit in the PC's `dist\` (1.10.0's was deleted after a mislabelled rebuild; see `07` #52); only `dist/win-unpacked*` is cleaned before a build. Always check the installed version at session start (see `13`).
4. **On another PC:** the installer is on GitHub as a release (`v1.17.0` since 2026-10-06; the repo is private, so sign in to GitHub first). Download `Recaller-Setup-X.Y.Z.exe` from it, run it, then sign in to the account to bring the notes over. No Git, Node or `node_modules` is needed.

**On the Mac:**
1. Give them `dist/Recaller-X.Y.Z-arm64.dmg`. They open it, drag Recaller onto the Applications link, eject the "Recaller X.Y.Z" disk (the eject button beside it in Finder's sidebar), and open Recaller from Applications. They shouldn't open the Recaller in the dmg window: that copy runs from the disk image, and the disk can't be ejected while it runs. If that happens, quit it (⌘Q), eject the disk and open Recaller from Applications; the notes are the same either way. To update, they first quit the running Recaller with ⌘Q (the red button and ⌘W only hide the window), then drag the new copy over the old one, choose Replace and eject the disk.
2. A dmg built on this Mac carries no quarantine attribute, so it opens straight away. A downloaded or AirDropped copy is quarantined: macOS says it can't verify the developer, and the owner clicks System Settings › Privacy & Security › Open Anyway once. Control-click › Open no longer gets past Gatekeeper on macOS 15 and later.
3. First use: the first dictation asks for the microphone. The first snip asks for Screen Recording (Recaller shows its own message with an Open System Settings button), and Recaller must then be quit and reopened. Saving the API key may bring a keychain prompt ("Always Allow"). Because the ad-hoc signature changes with every build, macOS may ask for the microphone, Screen Recording and the "Recaller Safe Storage" keychain item again after each update.
4. Their data lives in `~/Library/Application Support/Recaller` (the same files as on the PC). Updates leave it untouched, and the new version makes an `upgrade` backup on first start.
5. **Currently installed:** 1.16.0. The seventh session never launched the packaged app. Late on 2026-09-29, while the docs were being updated, the owner copied Recaller.app into `/Applications` (20:43:22) and three seconds later opened the copy inside the mounted dmg, not the one in Applications. That first run created `~/Library/Application Support/Recaller`, which now holds their real notes. At the end of the session the dmg copy was still the running Recaller and the "Recaller 1.16.0" disk was still mounted; the advice was to quit it (⌘Q), eject the disk and open Recaller from Applications (`10`, message 41). How the install, the permission prompts and the keychain prompt went isn't recorded yet; ask.
6. **Not done yet** (open in `09`): moving the PC's notes to the Mac would mean copying `recaller-data.json` and `images/` only. The API key is encrypted by Windows (DPAPI) and can't move; it is pasted again.

## End-to-end test suites (`tests/e2e/`)

The suites drive the real app with synthetic mouse and keyboard input (`webContents.sendInputEvent`). They are not unit tests.

- **How they run:** each suite is an Electron *main* script. It sets `RECALLER_DATA_DIR` to a throwaway folder in `tests/e2e/.out/`, seeds data and settings files, then `require`s the app's `main.js` (the `APP_MAIN` env var, defaulting to `src/main.js`).
- **Output:** screenshots and data go to `tests/e2e/.out/`, which is git-ignored. Each script wipes its own folders at the start: features uses `data2/`, `shots2/` and `speech.wav`; update-safety `data3/` (or `data-real/` in real mode, which is never deleted automatically); capture-board `data4/` plus `<OUT>*.png`; multi-copy `data5/`.
  - **On the Mac,** `.out/` also holds the seventh session's logs (`mac-multicopy.log`, `mac-update.log`, `mac-features.log`, `mac-build.log`, `mac-pkg-all.log`) and leftovers from the discarded sixth-session work: the other `*.log` files (`features.log` and `pkg-*.log` show 137 checks), `mac*.png`, `mic-diag.*` and `data4/`. Those leftovers say nothing about the current suites.
- **Mac-safe since the seventh session:** every script loads `tests/e2e/mac-harness.js`, which keeps a run out of the owner's way on a Mac and does nothing on Windows (see "On a Mac" below). The suites on `main` and `v1` don't have it: never run those on a Mac.

### Rules the suites follow (keep them)

- **Never disturb the owner.**
  - Every window's `show` is replaced with: move it mostly off-screen, then `showInactive`. How much stays visible depends on the suite and the platform:
    - **Windows:** features and update-safety leave a 200px strip of their 1360×860 window at the far edge of the cursor's display, on the side away from the mouse (features' snip overlay gets a 200px strip too). Multi-copy and capture-board leave 60px (of 1360×860 and 1360×820). Only features looks at other displays: if one exists that doesn't hold the cursor, it puts the whole window at that display's top-left instead.
    - **On a Mac:** `macRect()` puts every window just past the outer left or right edge of all displays, on the side away from the cursor, at the top of the display that forms that edge, with 2px left on screen (macOS stops drawing a window that is wholly off screen).
  - Moving the window in `browser-window-created` is not enough, because the app later re-applies its saved position. The move must happen inside the `show` override.
  - `focus()` itself is not intercepted. **Windows:** the real snip calls `overlay.focus()` and later `mainWindow.focus()`, so that step can take focus. **On a Mac** the snip is skipped, and `quiet()` makes `app.focus()` and `app.show()` do nothing.
- **The suites use the real clipboard** (both platforms). Many checks write and read it: features in many places, multi-copy before every case, update-safety when it copies a note. Whatever the owner had copied is lost, and if they copy something mid-run a clipboard check fails. That is interference, not an app bug.
- **The owner's real mouse can interfere (Windows).** If they move it over the visible sliver, the app correctly treats that as the button being released. A resulting one-off failure in a drag or pan check is interference; re-run before debugging. **On a Mac** the test windows ignore the real mouse (`setIgnoreMouseEvents(true)`).
- **Off-screen windows don't draw frames.**
  - Wheel and scroll input, and `requestAnimationFrame`, stall.
  - Call `await webContents.capturePage()` to force a frame before reading scroll positions.
  - App code must not depend on animation frames for correctness (the startup code doesn't).
  - **On a Mac** the 2px left on screen is what keeps a test window drawing at all.
- **Check syntax first:** run `node --check` on a suite before launching it. A syntax error makes Electron show an "App threw an error" dialog on the owner's screen until it times out.
- **Real captures are deleted:** the features suite's real screen-snip test (Windows only) captures the owner's actual screen once. The suite deletes the images afterwards, but only when the run finishes normally: after a `HARNESS FAIL` the capture stays in `tests/e2e/.out/data2/images/` until the next features run. Never view or keep those files.
- **Read the result line.** Grep each suite's log for `n/n passed`. `run-electron.js` reports success even when Electron was killed, and multi-copy and capture-board have no `catch` on their `whenReady` chain: an exception there leaves Electron running (and its window sliver on screen) until it is killed (see `13`).
- **Scale:** every script forces `force-device-scale-factor=1`, so screenshots are 1× even on the Mac's 2× Retina screen. Only `capture-board.js` takes `SCALE=2`, on a Mac.
- **The harness can't see the app's version.** Electron is started on a `.js` file, so inside the suites `app.getVersion()` is Electron's (44.4.5) and `app.name` is "Electron". A run against a packaged `app.asar` never says which version it loaded; check that separately (see "Checking a Mac build").

### On a Mac: `tests/e2e/mac-harness.js` (seventh session)

- **Exports:** `IS_MAC`; `MOD` (`'meta'` on a Mac, `'control'` on Windows: the app's shortcut and multi-select modifier); `MOD_KEY` (`'Meta'` / `'Control'`, the keyCode for holding it down); `macRect(W, H)`; `quiet()`; `macState` (`{ hides: 0 }`). On Windows every helper is inert: the suites call `macRect()` only when `IS_MAC`, and `quiet()` returns at once.
- **`quiet()`**, called before `require(APP_MAIN)`, on a Mac only:
  - hides the Dock icon (`app.dock?.hide()`);
  - makes every new window ignore the real mouse (`setIgnoreMouseEvents(true)`; `sendInputEvent` still reaches it);
  - stubs `Menu.prototype.popup`, `shell.openExternal` and `shell.openPath`, so no native menu, System Settings pane or Finder window opens;
  - makes `app.focus` and `app.show` do nothing and turns `app.hide` into a counter (`macState.hides`), so the test app can never take focus or hide itself.
- **⌘ for Ctrl:** the suites send `MOD` wherever they sent Ctrl on Windows (multi-select clicks, ⌘↩, ⌘Z, ⌘Y, ⌘N), and multi-copy holds `MOD_KEY` down. Check names still say Ctrl.
- **Features on a Mac:** it adds `AudioServiceSandbox` to `disable-features` (the sandboxed audio service can't read the fake-mic WAV), skips the real screen snip (3 checks, one `SKIP` line), and adds 8 Mac-only checks (listed below).
- **`MODE=real` on a Mac** copies `~/Library/Application Support/Recaller` (`app.getPath('appData')`). If the data or settings file is missing, it prints `HARNESS FAIL: no … in …` and exits cleanly, with no dialog. (Before the seventh session it read only `process.env.APPDATA`, which is unset on a Mac, and threw at load.)
- **The `HARNESS FAIL: no app at …` hint** "(APP_MAIN must be a Windows path)" now prints only on Windows.
- **Permission:** the owner approved running the Mac-safe suites on their Mac in the seventh session ("Yes, run them"). They still overwrite the clipboard.
- **Counts:** Windows 12 + 21 + 134 (unchanged). Mac 12 + 21 + 139 (134 − 3 skipped + 8 Mac checks). Seventh session, on source on the Mac: 12/12, 21/21 (synthetic) and 139/139, all 8 Mac checks passing.
- **Windows after the Mac edition:** the Windows side was not run in the seventh session (the Mac can't run the Windows app). That Windows behaves exactly as 1.16.0 rests on every Mac difference being fenced (`07` #65) and a hunk-by-hunk review, plus a plain-Node run of `main.js` against a mocked Electron with the platform set to `win32`, whose log of Electron calls matched 1.16's apart from stack-trace line numbers (run before the last reviewer fixes, which are all Mac-only). The first real check is `npm test` on the PC: 12 + 21 + 134.

### `features.e2e.js` (189 checks on Windows since 1.20.3, 187 in 1.20.2, 184 in 1.20.1, 180 in 1.20.0, 166 in 1.19, 158 in 1.18, 134 before; 194 on a Mac since 1.20.3, 192 in 1.20.2, 189 in 1.20.1, 185 in 1.20.0, 171 in 1.19, 163 in 1.18, 139 before; about 4 minutes)

**Setup:**
- **Seed data:** seven projects in the old v1 format, which also exercises loading old data.
- **Settings:** a plain test API key (`sk-test-harness-1234`) and no global hotkeys. A plain key never goes through `safeStorage`, so the suite never touches the Mac keychain.
- **Mock OpenAI server** on 127.0.0.1:
  - records every request (URL, auth header, model, stream flag, prompt, file part);
  - replies "Phrase one.", "Phrase two.", and so on;
  - streams server-sent events (`transcript.text.delta` word by word every 90ms, then `transcript.text.done`) when `stream=true`;
  - a `fail500` mode returns 503.
- **Fake microphone:** Chromium flags `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream` and `--use-file-for-fake-audio-capture=<speech.wav>`. The WAV (`tests/e2e/.out/speech.wav`, 16-bit PCM, 48kHz mono) holds 0.4s of silence, 1.8s of voice-like harmonic tone with syllable modulation, a 1.1s pause, another 1.8s of tone, then 1.4s of silence: 6.5s, which Chromium plays in a loop. (The code comment's "[1.8s voice, 1.1s pause] × 2" is slightly off: the second burst is followed only by the 1.4s silence.) This makes the app's pause detection cut real phrases. No real microphone is opened. **On a Mac** `AudioServiceSandbox` is disabled so the audio service can read the file.

**Coverage:**
- **Layout:**
  - slim width ≈268px;
  - column titles use Instrument Sans (the 1.6 default) and the font is loaded;
  - the top bar has no + Project button;
  - the New prompt bar is under the header, not in it;
  - it opens the composer in its place;
  - long names wrap to two lines, clear of ⋯;
  - neighbouring column headers and sections have different colours;
  - Deep is the default theme;
  - headers are dark and solid;
  - (1.16) the board has a rounded frame (radius ≥ 10px, a ≥1px border, a gradient edge layer clipped to `border-box`), inset at least 8px from the window's sides and bottom, and `body` has the top bar's background colour.
- **Copy, swipe and undo:**
  - click copies;
  - swipe deletes;
  - undo via Ctrl+Z, the toolbar button and the toast;
  - redo with Ctrl+Y.
- **Drag** (3 checks):
  - drag into Cooked (joins into the note);
  - the move shows an "Added to Cooked" toast with Undo;
  - Undo on the toast moves it back.
  - Nothing else drags cards: no check drops a card on a collapsed Cooked header or reorders cards by dragging, though the app supports both (untested). (Served parts are reordered with the ↑ ↓ buttons, and the Cooked note dragged onto Served, below.)
- **Stages** (built in a spare column):
  - the labels read Cooked and Served; the old card move-back button is gone;
  - three typed prompts;
  - two moved to Cooked join as "Gamma three\n\nBeta two";
  - clicking copies the combined note;
  - a left swipe moves it into Served;
  - a second batch via the **Move to Served** button is appended with the separator;
  - a third batch dragged onto Served;
  - Served has no counter and no Copy all; clicking the Served text copies it with a "Copied" chip;
  - the Served footer (stats, Notes, pencil) doesn't overlap;
  - a prompt is sent back out of Cooked;
  - the three stages differ in block colour, header and inner note colour;
  - the "New line" separator setting works.
- **Parts and editing** (same column):
  - the Served Notes list shows ↑ ↓ ✎ ↩ per part; ↓ then ↑ reorders and restores;
  - ✎ edits one Served part alone (the others stay separate);
  - the Served pencil edits the whole text into one note; two Ctrl+Z undo both edits;
  - a Cooked part can be edited alone; the Cooked pencil opens the whole note and Esc cancels;
  - a prompt that lands in Cooked while its editor is open survives the save.
- **Clearing:** the menu lists "Clear Cooked (1)" and "Clear Served (5)"; each empties only its own stage; Ctrl+Z restores.
- **Deleting inside Cooked and Served (1.15):** every Cooked Notes row has a trash; a row laid out with its five buttons still leaves at least 40px of text at slim width; the row trash deletes one note ("Note deleted" toast) and Ctrl+Z puts it back in place; the Cooked editor (opened by right-click) has a trash titled "Delete the whole cooked note" that empties Cooked, leaves Served alone, and Ctrl+Z restores both parts; a Served row's trash deletes one note and undoes. Screenshot `shots2/03c-cooked-row-trash.png` (the hovered row sits under the board's › arrow there; a scratch copy of `capture-board.js` that hovers a row in the first column shows the buttons clearly, see `13`).
- **Pictures in Cooked and Served (1.14):** the Cooked strip shows the picture, the Cooked text copies without it, a tile copies the picture, the picture moves to Served, the Served tile and text copy separately, and undo puts it all back.
- **Search in combined texts:** terms are marked inside the Cooked and Served texts.
- **Colours:** the menu has 18 swatches; picking Navy applies it (then undone).
- **1.7 checks:**
  - new prompts land at the bottom;
  - the Served text is held to 6 lines, and Show more opens it without writing `augExpanded`;
  - an empty Cooked has a transparent background and no helper sentence at rest (the border style is read but not asserted);
  - Cooked is a light section, Ocean blue by default (since 1.13): no dark header band, a pale block (every colour channel above 200) and a blue accent (hue between 190 and 235);
  - the ? button and F1 open the help, and Esc closes it;
  - ⋯ → Sort prompts oldest first sorts by `createdAt`, and Ctrl+Z restores the order.
- **1.8 checks:** New prompt and Dictate are equal halves with full labels; prompts sit under "Cooking · n" and the column title has no count; clicking Cooking folds and unfolds it (saved as `notesCollapsed`, removed when unfolded); a new prompt unfolds a folded Cooking.
- **Highlight:** the menu offers four colours and shows the "Check again" tag; Ctrl+Z removes it; H toggles it.
- **Ctrl+click** (⌘-click on a Mac): two notes in click order with a blank line between; badges 1 and 2 and the bar; Ctrl+click again removes; Esc clears; "Move to Cooked" joins them in, and Ctrl+Z undoes it.
- **Live dictation:**
  - the mic starts from the column;
  - text appears while still recording;
  - requests are streamed (`stream=true`, gpt-transcribe, webm);
  - the textarea stays editable;
  - text typed mid-recording is kept and dictation continues after it ("Phrase one. typed Phrase two.");
  - the context prompt contains the earlier text;
  - Ctrl+Enter saves;
  - Save during recording finishes, then saves;
  - a 503 is retried once, then Retry and Discard are offered;
  - the textarea stays editable after a failure;
  - Retry succeeds;
  - closing keeps the draft (badge).
- **Images:**
  - a pasted image (a generated gradient PNG) attaches, saves as a thumbnail and is served via `recaller-img://`;
  - clicking the thumbnail copies an image;
  - clicking the text copies text;
  - the lightbox opens.
- **Scrolling:** the right arrow is unhidden when the board overflows; (1.16) it is out of sight (no `.is-near`, `pointer-events: none`) with the pointer mid-board, and appears near the right edge with a visible, non-white ring of at least 1px; it scrolls one column; after that the left arrow appears only near the left edge while the right one leaves; the wheel over a header scrolls sideways; dragging empty canvas pans.
- **Settings:** the Compact density narrows columns; the Soft theme can be picked and is saved.
- **Column widths:** the ↔ button starts disabled; dragging two column edges resizes them (+90px, −40px) and saves `prefs.colWidths`; the button enables; it resets every column and removes the key; Undo on its toast restores; double-clicking an edge resets one column.
- **Columns:** reorder, then undo.
- **1.18** (24 checks, on a column made with the top-bar +, deleted again afterwards; the board is scrolled back to the start for the checks after it): the top-bar + (the old "no + Project button" check expects it now); New text; Listening… while recording; Clear and its Undo; the Claude Code format, its copy and back; serving it as one formatted note; Eating on, its strip and dot, the strip clear of every column, undo leaving Eating alone; Done moving the round to Eaten and its undo; the Eating menu (Done, or Stop eating); the Eaten drawer (Today, Copy, Serve again, Esc); minimize and open; a group made, joined, folded, opened and undone; the Soft header deeper than `--accent-tint`.
- **1.19** (8 checks on both platforms, after the 1.18 block): three columns eating at once show three whole chips, each with Done, and a count of 3, still below every column; the widget button makes one column and a picker with its name, main asks for 360 px and keeps it on top and saves `widget` / `widgetProject` (the suite stubs `setBounds`, `setSize` and `center` so the window stays off screen, and records the sizes asked for); the eating chips shrink to badges; the picker switches columns; the same button goes back to a full board, not on top; stopping Eating and undoing the moves leaves the columns as they were. (1.19.0 also had 2 Mac checks of a zoomed-out column drag, removed with it in 1.19.1.)
- **1.20** (14 checks on both platforms, after the 1.19 block; the seed holds a notepad project with a page and a conflict copy): `minimized` is synced (`SyncApply.isLocalKey`); a group made from p2 and p3, dragged by its band before p1 (a ghost card with its name, a slot, no card drop zones), and the release not folding it; p1 dragged into the lane (its slot inside the lane, the toast) and p3 dragged out; ⋯ › Move left, out of the group; seven undos put everything back; the notepad never a column; Ctrl+J opens it focused with the page and the other version; typing saves by itself into the hidden project; Copy; Add to the page; Esc; and a board change and its undo leaving it alone. The 1.18 minimize checks now expect `minimized`.
- **1.20.1** (4 checks, at the start of the 1.20 block): Eaten, the widget, Reset column widths, help and settings are in `#app-menu`, not the top bar; the notepad is a labelled, tinted pill; ☰ opens the menu with its rows, and Esc or a click away closes it; the notepad's pointer is an image. Checks that clicked a moved button open ☰ first (`fromMenu(sel)`).
- **1.20.2** (3 checks, after the 1.20 drags): p2 and p3 minimized share one stack, as rows with the names across; p3's row dragged before p1 leaves the stack, stays minimized and isn't opened by the release; clicks open both rows and the stack goes. The 1.18 minimize check expects a row in a stack.
- **1.20.3** (2 checks): with three columns eating, the board scrollbar is 28 px and the strip ends above it; a stack has `overflow-y: auto`, a max height, and stays inside the board.
- **Mac only** (8 checks, seventh session; they run just before the snip, and each puts back what it changes):
  - the logo clears the traffic lights and is centred on them (`getWindowButtonPosition()` is {x: 16, y: 16}; `.brand` starts at x ≥ 16 + 54 + 8 and its centre is within 3px of y 24);
  - key names use ⌘: the search box reads ⌘K, every Help key uses ⌘ (F1 reads ?), the Settings button's title has ⌘, and the Undo title has ⌘Z;
  - Control+click on a card opens its editor, without copying or selecting it;
  - a real right-click (`button: 'right'`) on the Served text opens its editor, not the Copy menu;
  - the menu bar has 4 menus, Window › Minimize has no ⌘M, and Edit › Undo (clicked with `Menu.getApplicationMenu().getMenuItemById('undo').click()`) undoes the typing in an open editor and leaves the board's history alone;
  - "Hide Recaller after copying" calls `app.hide()` (counted by the harness) instead of minimising;
  - ⌘H on a focused card leaves its highlight alone (sent as a DOM `keydown`: a real ⌘H that the page leaves alone would reach the menu and hide the test app);
  - a draft typed right before a reload (standing in for ⌘Q) is saved.
  - An `INFO` line logs `env(titlebar-area-x)` (92px), the top bar's padding-left (84px) and `getWindowButtonPosition()`, for tuning.
- **Real screen snip** (last; Windows only): the overlay opens and Recaller hides; the snip attaches and Recaller returns; a full PNG and a thumbnail (`<id>.png` and `<id>.t.png` in the test data's `images/`) are stored. **On a Mac** it is skipped with `SKIP  real screen snip (3 checks): on a Mac it needs Screen Recording permission and would capture your screen`.
- **Persistence:** v2 format, images on notes, density preference.
- **No renderer console errors.**

### `update-safety.e2e.js` (21 checks synthetic, 9 in real mode; about 40s)

**Synthetic "old install":**
- v2 data with unknown future fields at every level (top level, prefs, project, note, image);
- a project colour unknown to this version (`galaxy`), density `roomy`, and a saved column width (`prefs.colWidths: { pC: 300 }`);
- an unsaved draft with an image, collapsed stages, six projects and a long column;
- settings with theme `soft`, the model, language, hint, `hideAfterCopy`, a plain key, `lastVersion: "1.2.0"` and an unknown `futureSetting`;
- image files that are referenced, orphaned (old) and referenced only by a backup;
- a pre-existing manual backup.

**Checks:**
- **On launch:**
  - the notes file is byte-for-byte unchanged, with the same modified time;
  - every existing setting keeps its value (window bounds are excluded, because the test moves the window);
  - `lastVersion` is updated (inside the harness it becomes Electron's 44.4.5; see the rules above);
  - an upgrade backup exists and is identical to the old data;
  - a daily backup exists.
- **On screen:** every project and note is shown; the theme, density and colours are kept (including the unknown one); the resized column is 300px and the others keep the density width; the draft, collapsed states, last-used project, and draft text and image are all restored.
- **Images:** the orphan is deleted; the others are kept.
- **After a real edit:** the file equals the original except for the edited counters and the allowed empty `combined: []` lists.
- **Scroll positions** come back after a reload (within ±4px).
- **Restore** brings deleted notes back, the pre-restore state is itself backed up, and the backups are listed in Settings.
- **`MODE` spelling matters:** only `synthetic` (the default) runs the 12 extra checks. Any other value except `real` (a typo such as `MODE=Real`) seeds the synthetic data but runs only the 9 shared checks and reports 9/9.

**`MODE=real`:**
- **What it runs on:** a *copy* of the real data folder (`%APPDATA%\Recaller` on Windows; on a Mac `~/Library/Application Support/Recaller`) in `tests/e2e/.out/data-real`: the data file, the settings file and `images/` (not the backups). It prints counts only, never note text.
- **Checks:** byte-identical after launch; settings unchanged; backup made; every project and note shown; theme and density kept.
- **Afterwards:** delete `tests/e2e/.out/data-real` (it holds the owner's notes and encrypted key).
- **If the owner's real file changes during the run**, that is them using the installed app, not the test.
- **On a Mac** it is untested. The Mac data folder holds the owner's real notes since their first run (late on 2026-09-29), so run it only with their OK. Without a data or settings file it stops with `HARNESS FAIL: no … in …`.

### `multi-copy.e2e.js` (12 checks, about 30s)

It tests Ctrl+click as a real person would (on a Mac, ⌘-click with ⌘ held down):
- Ctrl held down first, then clicks 150ms apart;
- rapid clicks with no pause;
- slow 450ms presses;
- 4px wobble;
- a plain click then Ctrl+clicks, where the anchor is included;
- with the search box focused;
- with a composer open;
- switching away (blur) starts fresh;
- a click on empty canvas clears;
- an old plain click isn't pulled in after other actions;
- a plain click then a Ctrl+click on the same note gives no duplicate;
- the badge order.

### `capture-board.js`

It renders a fixed sample (stages with their Notes lists open, highlights, a long two-line column name, an empty Served, one resized column) and writes:
- `tests/e2e/.out/<OUT>.png`: the top 1360×780 of the 1360×820 window, top bar included;
- `<OUT>-zoom.png`: the left area at 2×;
- `<OUT>-menu.png`: the ⋯ menu with its swatches;
- `<OUT>-settings.png`: the top 400px of Settings;
- `<OUT>-help.png`: the help dialog.

Use it to check visual changes. `OUT` names the files (default `headers`). **On a Mac,** `SCALE=2` renders at Retina 2×, which is what the owner's Mac screen shows. Its Mac changes (`quiet()`, `macRect()`, `SCALE`) were not run in the seventh session, so the first Mac capture is also its first test.

### Running the suites against the packaged build (do this before every release)

**Windows,** PowerShell:
```
$env:APP_MAIN = "$PWD\dist\win-unpacked\resources\app.asar\src\main.js"
npm test
$env:MODE = "real"; npm run test:update; Remove-Item Env:MODE
Remove-Item -Recurse -Force tests\e2e\.out\data-real
Remove-Item Env:APP_MAIN
```

**Windows,** Git Bash (note `pwd -W`: `$PWD` is a POSIX path like `/c/Users/...` that Electron on Windows can't load, and `cygpath -w` fails on a path through the `.asar` file):
```
export APP_MAIN="$(pwd -W)/dist/win-unpacked/resources/app.asar/src/main.js"
npm test && MODE=real npm run test:update; rm -rf tests/e2e/.out/data-real; unset APP_MAIN
```

**On a Mac,** zsh (a plain `$PWD` path works; `pwd -W` doesn't exist there, prints "bad option: -W", and leaves `APP_MAIN` as `/dist/…`, so each suite stops with a quiet `HARNESS FAIL`):
```
export APP_MAIN="$PWD/dist/mac-arm64/Recaller.app/Contents/Resources/app.asar/src/main.js"
npm test; unset APP_MAIN
```
Add `MODE=real npm run test:update` (then `rm -rf tests/e2e/.out/data-real`) only with the owner's OK: the Mac has real data since their first run. Seventh session: 12/12, 21/21 and 139/139 against the packaged 1.16.0 `app.asar` (log: `tests/e2e/.out/mac-pkg-all.log`). The Mac can't test the Windows build.

Every suite checks that `APP_MAIN` exists and otherwise prints `HARNESS FAIL: no app at …` and exits. Without that guard, a bad path makes Electron pop an "App threw an error" dialog on the owner's screen (this happened once in the 1.6.0 session). `APP_MAIN` must be an absolute path, as in the recipes above: a relative one (such as `dist/…`) passes this check, because the suites run from the repo root, but `require()` then reads it as a package name and fails with an Electron error dialog on the owner's screen.

### Checking a Mac build

Run these from the repo root after `npm run dist:mac`. They only read (the mount is read-only and hidden from Finder), and none of them launches the app. Seventh-session results are in brackets.

1. **Signature:** `codesign -dv dist/mac-arm64/Recaller.app 2>&1` [`Identifier=com.akhan.recaller`, `Format=app bundle with Mach-O thin (arm64)`, `Signature=adhoc`, `TeamIdentifier=not set`]. Then `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/Recaller.app` [ends with "valid on disk" and "satisfies its Designated Requirement"].
2. **Info.plist:** `plutil -extract <key> raw dist/mac-arm64/Recaller.app/Contents/Info.plist` for `CFBundleIdentifier` [com.akhan.recaller], `CFBundleShortVersionString` [1.16.0], `NSMicrophoneUsageDescription` [must be present], `LSMinimumSystemVersion` [13.0], `LSApplicationCategoryType` [public.app-category.productivity] and `NSRequiresAquaSystemAppearance` [false, so dark mode follows the system].
3. **Icon:** `sips -g pixelWidth -g pixelHeight dist/mac-arm64/Recaller.app/Contents/Resources/icon.icns` [1024 × 1024, the Mac icon; 512 would suggest the Windows icon was used].
4. **Contents:** electron-builder strips `scripts`, `build` and `devDependencies` from the packaged `package.json`, so that one file differs by design. This compares every other file in the archive with the working tree and prints the packaged version (single quotes, so an interactive zsh leaves the `!` alone):
   ```
   node -e 'const a=require("@electron/asar"),fs=require("fs");const p="dist/mac-arm64/Recaller.app/Contents/Resources/app.asar";const files=a.listPackage(p,{isPack:false}).map((f)=>f.slice(1)).filter((f)=>f!=="package.json"&&"size" in a.statFile(p,f));const diff=files.filter((f)=>!fs.existsSync(f)||!a.extractFile(p,f).equals(fs.readFileSync(f)));console.log(files.length,"files compared, different:",diff.join(", ")||"none","| version",JSON.parse(a.extractFile(p,"package.json")).version)'
   ```
   [34 files compared (all of `src/`, that is the 15 source files plus the fonts and their licences, and `build/icon.png`), none different, version 1.16.0. The archive holds only `src/`, `build/icon.png` and `package.json`.]
5. **The dmg:** `hdiutil verify dist/Recaller-X.Y.Z-arm64.dmg` [checksum VALID]. To look inside without Finder: `mkdir -p "$TMPDIR/recaller-dmg" && hdiutil attach -readonly -nobrowse -mountpoint "$TMPDIR/recaller-dmg" dist/Recaller-X.Y.Z-arm64.dmg`, then `ls -l "$TMPDIR/recaller-dmg"` [Recaller.app and an Applications link], then `hdiutil detach "$TMPDIR/recaller-dmg"`.
6. **Gatekeeper:** `spctl --assess --type execute -vv dist/mac-arm64/Recaller.app` [prints "rejected" and exits with 3: expected for an ad-hoc, unnotarized app]. `xattr -l dist/Recaller-X.Y.Z-arm64.dmg` [no `com.apple.quarantine`, because it was built here, not downloaded].
7. **Architecture:** `file dist/mac-arm64/Recaller.app/Contents/MacOS/Recaller` ["Mach-O 64-bit executable arm64"].
8. **Don't open the app yourself.** It would open a real window on the owner's screen and may raise keychain or permission prompts. The owner opens it.

## Accounts and sync: tests, mock and infra (1.17)

Nothing here talks to the real Google Cloud except the two owner-run `rules:*` scripts and the manual two-computer check. The unit and rules counts are as of the storage-overwrite fix (2026-10-01, `15` section 0, item 34), the e2e counts as of the final gates the same morning; confirm them before quoting.

**Expected totals for `npm test` with 1.17:**
- Mac: unit tests (715), then 12 + 21 + 194, then the same 12 + 21 + 194 with accounts on (`test:accounts-on`, no request), then 43.
- PC: unit tests (715), then 12 + 21 + 189, then the same 12 + 21 + 189 with accounts on, then 43. First passed on the PC on 2026-10-23 (1.19.1: 714 and 166).

### Unit tests (`tests/unit/`, `npm run test:unit`)

Plain `node --test`: no Electron, no windows, no keychain. Twenty files, 714 tests (the rules twin's 219 cases count as subtests; 702 with 216 cases at the final gates, before the storage-overwrite fix; about 50 s on the Mac):

| File | Covers |
| --- | --- |
| `config.test.js` | overrides ignored when packaged; when accounts are on; only a loopback mock base; token-store defaults |
| `codec.test.js` | Firestore values round-trip; what goes to `_json`; `__proto__` safety; document ids |
| `clients.test.js` | the REST clients against the mock: error mapping, 401 then refresh then retry, precondition errors, query paging and framing, multipart and resumable uploads, the `Firebase` auth scheme |
| `keys.test.js`, `model.test.js`, `diff.test.js`, `merge.test.js`, `apply.test.js` | order keys; the data file as a model and the pristine-Welcome checks; local changes against the shadow; every merge rule; the page's `applyPatch` |
| `mock.test.js`, `rules-twin.test.js` | the mock's protocol; every rules case against the mock's JavaScript twin |
| `state.test.js` | the `sync/` folder: defensive reads, atomic writes, unknown fields kept, a copied folder getting a new device id, removal |
| `facade.test.js` | `src/cloud/index.js` in plain Node with a stand-in for Electron (`net.fetch` is the mock's, `powerMonitor` an event emitter) and main's debounced write: removing the board keeps the unreadable copies until the person agrees; a sign-in mid-session gets the `contentSeq` of the save on disk, not of one main still holds; a log out, restart or shut down on a Mac (`shutdown` watched once signed in, never before); a draft saved just before "Use my account's board" is acknowledged reaches the disk first, so it is backed up; a plain sign-out saves the full-size pictures held only as previews (at most 20 s; `picturesLeft` when some stay in the account, offline too, counting only pictures the account keeps; none saved when removing the board, or after a `PENDING` answer until "Sign out anyway"); deleting the account shows `save-pictures` first, and a failure there deletes nothing |
| `images.test.js` | `src/images.js` with a stand-in for Electron: signed out, every file served as in 1.16, and a picture known only by its preview shown and copied from it; signed in, the account is asked for the full size first |
| `quit.test.js` | `main.js`'s quit with sync, its own code run in a vm with stand-ins for `app`, the facade and the clock: signed out or with nothing to upload a quit is never held; with changes waiting, one final push of 1.5 s; never during a log out, restart or shut down; on a Mac a cancelled log out stops counting after a minute |
| `account-page.test.js` | `src/renderer/account.js` in a vm over a small DOM with a stand-in for `window.recaller`, as "this Mac" and "this PC": the "Saving full-size pictures…" lines of a sign-out and a deletion, the toasts after a sign-out, and a deletion that fails while saving ("Nothing was deleted…"); also the 60 s waits of [Send link] and "Change password" |
| `privacy.test.js` | the privacy note is the same in `src/renderer/account.js`, README and `15` (6.7), and names what the account really keeps: a deleted note's pictures, and every field of a computer's device record |
| `tokens.test.js`, `account.test.js` | the token store with a fake `safeStorage` (never plain text; session-only when sealing fails; another project's file ignored); sign-in, verification, lock-out, one reset link per email a minute, deletion |
| `engine.test.js` | two or three computers (engines over real temp folders and the headless peer) on one fake clock against the mock: push and pull both ways, races, chunk order, pictures before commits, the first-sync table, union triggers, refusals and quarantine, notes held back with a project the account doesn't have and a project's deletion held back for such a note, slow and lossy links, the audit, `completePictures` and the full-size pictures saved before a deletion, account deletion and its gating, and crash injection at every `await` |
| `fuzz.test.js` | three computers and random steps (edits, moves, deletes, offline, crashes, restarts); after every step the account holds no live note in a deleted or missing project; after quiescence the boards agree, the shadow equals the cloud, and in runs without deletes every text ever saved still exists. About a minute by default; `FUZZ_SEEDS=50 FUZZ_STEPS=2000` is the full run, and `FUZZ_SEED=n` replays one seed |

### The Google Cloud mock (`tests/mock-gcp/`)

- An in-process mock of Identity Toolkit, Secure Token, Firestore (REST v1) and Cloud Storage for Firebase (v0), on 127.0.0.1 only. There are no Firebase emulators here: they need Java, which the Mac doesn't have.
- It runs a JavaScript twin of the security rules on every read and write, counting access calls like the real service, and accepts Storage calls only with `Authorization: Firebase <token>`.
- It is deterministic: ids and tokens come from counters, and time from one controllable clock.
- Its control API plays the other computer (`remote(uid)`), injects failures (503, 429, offline, lost answers, a head bumped between read and commit, a denied document, a pause at any step), and manages accounts (verify, revoke, disable, delete, pause sign-ups). The full list is at the top of `tests/mock-gcp/index.js`.

### The headless peer (`tests/support/peer.js`)

The real engine, account, token store and REST clients over their own data folder, with stand-ins for main (the 250 ms debounced write, `loadData` with its `.bak`, restore) and for the page (normalize or seed, `contentSeq`, undo labels, busy states, the stale answer, acknowledging saves). The unit tests run several on a fake clock; the e2e suite runs one as computer B. It never starts Electron, and it is the reference for how `src/cloud/index.js` wires things.

### Rules cases: three layers, then the smoke test

1. `tests/rules/cases.js`: 219 cases (185 Firestore, 34 Storage), each a request with an expected ALLOW or DENY, named by the method the live service uses (in Storage every upload is a `create`). `node tests/rules/cases.js` checks the list and prints the counts.
2. The mock's twin passes every case (`rules-twin.test.js`, part of `npm run test:unit`).
3. The real rules texts pass every case on Google's own rules engine: `npm run rules:test` (owner's gcloud login; deploys nothing). All 219 passed on 2026-10-01, once the runner sent `resource: null` for a new upload (`07` #100).
4. After the live deploy, `npm run rules:smoke` checks the deployed rules and the app's REST calls on the real project, and prints a "Recorded" block of facts to copy into `15` (2.10). On 2026-10-01 it passed 43 of 45 (an upload over an existing picture was accepted); after the next plan's apply it must pass 45 of 45.

### `sync.e2e.js` (43 checks, `npm run test:sync`)

- **Setup:** computer A is the real app, in the suite's own process, in `.out/sync-a`; computer B is the headless peer in `.out/sync-b`. The suite starts the mock and sets `RECALLER_GCP_BASE`, `RECALLER_TOKEN_STORE=test-file` and `RECALLER_SYNC_FAST=1` before the app loads, so `project.json` is never read and nothing reaches Google; any request beyond the loopback mock fails a check.
- **Covers:** signed out with the cloud on (no request, no `sync/`, the file untouched); the account forms; sign-up, verification and the first upload; edits both ways; the joiner; copy counts; conflicts; patches held back by an editor, an Undo toast, a copy and a drag; offline; expired and revoked tokens; a precondition race; a refused document; a 950 KB note; unknown fields; unreadable files and the `.bak`; restore; the mass-delete guard; a second account, Combine and "Use my account's board"; sign-out and removing the board; account deletion and its gating; security (no token or password reaches the page, the CSP, nothing beyond the mock); quitting with a change waiting. The numbered list is in `tests/e2e/README.md` and `15`, 7.5.
- **Mac-safe** like the others, plus: `safeStorage.encryptString` and `decryptString` are tripwires (the suite stops with `HARNESS FAIL` before the app starts if it can't replace them), `shell.openExternal` is stubbed and counted on both platforms, there are no global hotkeys, and the window never takes focus. Check 43 is "Mac only" on a Mac and its Windows counterpart (no focus taken, DPAPI untouched) on the PC.
- Screenshots of each account state go to `.out/sync-shots/`.

### Infra (`infra/`)

- The Google Cloud project `recaller-cloud` is Terraform: `infra/terraform/bootstrap` (the state bucket `gs://recaller-cloud-tfstate`) and `infra/terraform/prod` (one file per concern). The rules texts are in `infra/firebase/`. The runbook, kill switches and recovery steps are in `infra/README.md`.
- Terraform is at `~/.local/bin/terraform` and gcloud at `~/google-cloud-sdk/bin/gcloud` on the Mac, both off the PATH. They use the owner's gcloud login (Application Default Credentials); there are no service account keys.
- **Never part of `npm test`,** and never run by an agent without the owner: plans print secrets unless masked (`07` #89), and an apply changes the live project.
- **Status (2026-10-01):** the sync additions (`sync.tf`, the sign-up switch, the real rules) are live since the owner's apply at about 17:54 UTC (`15`, status). The next plan, `infra/terraform/prod/prod.tfplan` (the Storage rules fix, Firebase's auto-created key cut to the sign-in APIs, the budget's new alerts), waits for the owner (`infra/README.md`, "The next plan").

### The manual two-computer check

After the deploy and a build: two source runs with their own data folders (`RECALLER_GCP_REAL=1 RECALLER_TOKEN_STORE=memory RECALLER_DATA_DIR=…`), a real email, Upload on one and Combine both on the other, a picture, an offline conflict, a password change and an account deletion. The steps are in `15`, 7.7. Not done yet. Which API key the email links carry is already settled: Firebase's auto-created browser key, not the app key (`07` #99).

## Release checklist

### Windows (on the PC)

1. Make the change. Keep the invariants in `03`.
2. Run `node --check` on every edited JavaScript file.
3. Look at it: `npm run capture` (or a scratch render), and view the PNGs. For taste changes, render options side by side.
4. Run the relevant suites on source, and add checks for new behaviour to `features.e2e.js`.
5. Bump `version` in `package.json` **as its own step** (never chained behind `&&`), then confirm it with `grep '"version"' package.json` (see `07` #52). Both editions share this version.
6. Update the user guide in `README.md` (the "This builds …" line and any changed rows), `ai_memory/08_changelog.md`, and every other affected `ai_memory` file (counts in `06`, `09`, `13` and `tests/e2e/README.md`, Windows and Mac; status line in `ai_memory/README.md`).
7. Clean `dist/win-unpacked*`, then `npm run dist` (retry once if it exits with 127). Confirm the build log line `building target=nsis file=dist\Recaller Setup X.Y.Z.exe` shows the new version.
8. Run all suites against the packaged app, including `MODE=real`, then delete `tests/e2e/.out/data-real`. Use `$(pwd -W)` for `APP_MAIN` in Git Bash. A single failure that passes on re-run is usually timing or the owner's mouse; re-run before debugging, and say so in the report.
9. Hand the owner the installer path, and explain what changed and how to use it (short, one line per item they asked for).
10. Don't commit; the owner commits each version themselves.
11. **If the owner asks for a GitHub Release** (as for 1.17.0 on 2026-10-06): GitHub turns spaces in an asset's name into dots, so copy the installer to the scratchpad as `Recaller-Setup-X.Y.Z.exe` first, then `gh release create vX.Y.Z <that file> --target <branch> --title "Recaller X.Y.Z" --notes-file <notes>`. Check the upload with `gh api repos/Ahsan-khan/recaller/releases/tags/vX.Y.Z --jq '.assets[].digest'` against `sha256sum` of the local file.

### Mac (on the Mac)

1. Work on `masos` until the owner decides otherwise. Keep every Mac difference fenced (`IS_MAC`, `body.is-mac`, the `mac` / `dmg` build sections) so that Windows stays exactly as it is (`07` #65).
2. Run `node --check` on every edited JavaScript file.
3. Look at it: `SCALE=2 npm run capture` shows what the Retina screen shows (not run on the Mac yet); view the PNGs.
4. Run the suites on source: 12 + 21 + 171, with one `SKIP` line. Put checks for Mac-only behaviour inside the `if (IS_MAC)` block of `features.e2e.js`.
5. If the version changes, bump it as its own step and confirm it (Windows step 5). The Mac edition of 1.16.0 kept 1.16.0 so that the two downloads match.
6. Update `README.md` and the affected `ai_memory` files (Windows step 6).
7. Run `npm run icon:mac` only if the icon changed. It rewrites `build/icon-mac.png`. It checks the capture before any scaling: if it is empty, not square or smaller than 1024px, the script prints "icon:mac: no usable capture", exits with code 1 and writes nothing. A Retina 2048px capture is then scaled down to exactly 1024px.
8. `npm run dist:mac`. Confirm the log lines `signing … identityName=- identityHash=none`, `skipped macOS notarization` and `building target=DMG arch=arm64 file=dist/Recaller-X.Y.Z-arm64.dmg`.
9. Check the build ("Checking a Mac build" above), then run the suites against the packaged `app.asar` (the zsh recipe above). Use `MODE=real` only with the owner's OK (it copies their real Mac notes), and delete `tests/e2e/.out/data-real` afterwards.
10. Hand the owner `dist/Recaller-X.Y.Z-arm64.dmg` with the install steps above, and say plainly what is untested (real key presses, the permission and keychain prompts, the first install).
11. Don't commit or push; the owner does it through GitHub Desktop. To see what's on GitHub without fetching, `git ls-remote origin` works read-only. The seventh session's Mac edition is committed and pushed on `masos` as "mac build" (`16961eb` + `9536853`, 2026-09-29), with its three new files `build/icon-mac.png`, `tests/e2e/mac-harness.js` and `ai_memory/14_macos.md`; it was merged into `main` with 1.17.0 on 2026-10-06 (see "Git status" below). Finder's `.DS_Store` went into `16961eb` by accident. At the owner's "fix it" it was taken out of git (`git rm --cached .DS_Store`; the file stays on disk) and added to `.gitignore`, so Finder's file won't be picked up again; the owner committed and pushed that as "fix" (`f86cf19`).
12. A matching Windows installer is built on the PC (Windows steps 7–8). `npm run dist:win` can build it on the Mac (untested there; confirm `archs=x64` in its `building target=nsis` log line), but the Mac can't run its suites.

### 1.17.0 additions (both platforms)

1. **Before the first build:** the live deploy must be done (`infra/README.md`, "Accounts and sync: the runbook"), so that `infra/gcp/project.json` holds the current `app_config` output. Then `npm run cloud:config` writes `src/cloud/project.json`. Without it every `dist*` and `pack` script stops (`predist` checks).
2. **The PC build:** either build it on the Mac with `npm run dist:win`, or copy the one git-ignored `src/cloud/project.json` into the PC's clone before `npm run dist`. Never commit it, and never print it.
3. **Tests:** `npm test` now includes the unit tests, `test:accounts-on` and `test:sync`. Run them on source, then against the packaged `app.asar` on each platform (the sync suite included). On the PC this is their first run.
4. **Before handing it out:** `npm run rules:smoke` passed on the real project, and the manual two-computer check (`15`, 7.7) passed.
5. **Sign-ups are open** (`signup_enabled = true`). Before sharing the app beyond the owner, pause them or add a hosted privacy and terms page (`15`, owner's answers).

## Git status (important)

- **Repository:** remote `origin` = https://github.com/Ahsan-khan/recaller.
  - On the PC: since 2026-09-24 Recaller is its own repo at `C:\Users\User\Documents\recaller` (moved out of `Documents\iresine\recaller`).
  - On the Mac: `/Users/ahsan/Documents/GitHub/recaller`, cloned on 2026-09-28.
- **Branches** (as of the ninth session, 2026-10-06):
  - `main` = `origin/main` = `9d30f1f` "Merge pull request #2 from Ahsan-khan/masos" (2026-10-06, at the owner's "okay merge masos to main"). Its tree is identical to `f724f71`, so `main` holds 1.17.0 and the Mac edition. Before that merge `main` was `dd5a3b0` (below).
  - `masos` = `origin/masos` = `f724f71` "Docs: the owner's messages from the 1.17 session; drop imports.tf after the deploy" (2026-10-01 20:19), on top of "huge" (`4370072`, 20:08), the owner's commit of 1.17.0.
  - **Tags and releases:** `v1.17.0` (on `f724f71`) is the repo's first tag. Its GitHub Release (2026-10-06) carries one asset, `Recaller-Setup-1.17.0.exe`. `gh release list` shows them.
- **Branches as of the seventh session** (2026-09-29; history):
  - `v1` = `origin/v1` = `664212a` "1.16". This is where the owner commits each version, with a short message: "Initial commit … (v1.5.0)" = `3876950`, "initial commits" = `296fd32` (1.6), "v1" = `ee2572a` (1.7), then "1.8" = `093c434`, "1.9" = `147b16d`, "1.10" = `2a04390`, "1.11" = `e1f8275`, "1.12" = `290c74d`, "1.13" = `0f7ceea`, "1.14" = `8776a32`, "1.15" = `7f101e6` and "1.16" = `664212a` (2026-09-26, committed together with the fifth session's `ai_memory`). The old note that 1.16.0 was uncommitted is out of date.
  - `main` = `origin/main` = `dd5a3b0` "Merge pull request #1 from Ahsan-khan/v1" (2026-09-29). Its tree is identical to `664212a`, so `main` holds 1.16.0. Before that merge `main` was `296fd32` (1.6.0); the old note "main has the 1.5.0 commit" was wrong.
  - `masos` = `origin/masos` = `33f62ed` "done" (2026-09-29 22:04, the seventh session's last doc updates; `git status -sb` showed `## masos...origin/masos` on 2026-10-01). Before that it was `f86cf19` "fix" (GitHub checked read-only with `git ls-remote origin` at 21:58 on 2026-09-29). The owner made it from `main` (`dd5a3b0`) on 2026-09-29 and published it, for the Mac app. "masos" is their own spelling; keep it.
    - **Committed and pushed:** the owner committed the Mac edition at 21:45 on 2026-09-29, as two commits both called "mac build", and pushed both. `16961eb` (21:45:34) is the snapshot they had staged at about 21:13: the changes to `package.json`, `scripts/make-icon.js`, `src/`, `tests/e2e/`, `README.md` and `ai_memory/`, and three new files (`build/icon-mac.png`, `tests/e2e/mac-harness.js`, `ai_memory/14_macos.md`). `9536853` (21:45:53) holds the fixes made after that staging: mostly docs, plus the `icon:mac` capture check in `scripts/make-icon.js` (now made before any scaling) and a comment in `tests/e2e/mac-harness.js`. At the owner's check (`10`, message 42), a read-only `git ls-remote origin` showed GitHub's `masos` at `9536853`, with `main` (`dd5a3b0`) and `v1` (`664212a`) unchanged. The working tree then matched the pushed commit exactly.
    - **Same as the tested dmg:** all 33 files under the pushed `src/` are byte-identical to the dmg's `app.asar`, and `build/icon-mac.png` is the same file. `package.json` differs only in the `scripts`, `build` and `devDependencies` fields, which electron-builder strips from the packaged copy.
    - **`.DS_Store`:** Finder's `.DS_Store` in the repo root went into `16961eb` by accident. At the owner's "fix it", `git rm --cached .DS_Store` took it out of git (the file stays on disk) and ".DS_Store" was added as the last line of `.gitignore`. The owner committed both as "fix" (`f86cf19`, 21:51:53, only those two changes) and pushed it. The docs update that recorded all this came after that commit, so it is left for the owner to commit and push.
    - **Merged into `main` on 2026-10-06** (PR #2, `9d30f1f`), together with 1.17.0. The suites hadn't run on the PC from `masos` first. `v1` was not touched.
  - `stash@{0}` (on the Mac only; the PC has no stash) "On v1: Discarded changes since 1.16 push (1.17.0 macOS work) — 2026-09-29" is the sixth session's discarded Mac attempt. The owner chose to start from scratch, so the Mac edition was built without it; it was never applied or popped. Leave it alone unless they ask; popping it would also bring back README and `ai_memory` files full of stale 1.17.0 statements.
- **Commit names:** commits made on the PC say "AKhan"; the Mac's git identity is "Ahsan-khan <ahsan.k@live.com>".
- **The eighth session (2026-09-30 to 10-01):** `masos` = `origin/masos` = `33f62ed` "done" (2026-09-29 22:04), the owner's commit of the seventh session's last doc updates. All of 1.17.0 (accounts and sync: `src/cloud/`, `src/sync/`, the new renderer files, the tests, `infra/`, `scripts/cloud-config.js`, `ai_memory/15_accounts_and_sync.md` and the edits to existing files) was uncommitted in the working tree then. The owner committed and pushed it that evening as "huge" (`4370072`, 20:08) and the docs as `f724f71` (20:19).
- **Line endings:** the repository stores LF. On the PC, Git for Windows' own system config sets `core.autocrlf=true` (`C:/Program Files/Git/etc/gitconfig`, found on 2026-10-06), so a file git checks out there can be CRLF in the working tree (`10_user_messages_verbatim.md` was, throughout) and `git diff` ignores the difference. The Mac has no `core.autocrlf`. The only `.gitattributes` is `infra/.gitattributes` (1.17), which keeps the rules, Terraform and shell files LF on every checkout: Terraform uploads the rules byte for byte, and Git Bash refuses a script with CRLF endings.
  - **On the PC** `app.js`, `styles.css`, the suites and the Markdown files are LF in the working tree, but `index.html` is CRLF (most likely Windows git's own conversion; not checked). Git warns "LF will be replaced by CRLF" on diff; that is harmless.
  - **On the Mac** every file is LF in the working tree, `index.html` included, and git prints no such warnings.
  - Keep each file's existing endings when patching: on the Mac a patch script must keep `index.html` LF.
- **When committing is requested:** the owner committed 1.8 to 1.16 on `v1` with the version as the message, but 1.17.0 on `masos` ("huge"), merged into `main` by PR #2; ask which branch before committing a new version. Add the attribution the environment requires. Push only when asked. **On the Mac,** don't fetch, pull or push at all: the credentials live in GitHub Desktop, and the owner does it.
- **Ignored:** `.gitignore` ignores `node_modules/`, `dist/`, `tests/e2e/.out/` and, since the owner's commit "fix" (`f86cf19`, 2026-09-29), `.DS_Store`. 1.17 adds the cloud config (`infra/**/project.json`, `src/cloud/project.json`: they hold the API key) and Terraform's local files (`.terraform/`, `*.tfstate`, `*.tfstate.*`, `*.tfplan`, crash logs, override files, `.terraformrc`, `terraform.rc`). The state lives in `gs://recaller-cloud-tfstate`, never in git.
- **GitHub CLI:** on the PC `gh` works from the PATH in Git Bash (2.101.0 on 2026-10-06, logged in as `Ahsan-khan` with the `repo` scope; if it's missing, try `C:\Program Files\GitHub CLI\gh.exe`). The Mac has no `gh`.
