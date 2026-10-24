# 02: Architecture

This file describes version 1.16.0 on both platforms:

- **Windows** (the owner's main install): committed on branch `v1` as "1.16" (`664212a`) and merged into `main` by PR #1 (`dd5a3b0`).
- **The Mac edition** of the same 1.16.0 (seventh session, 2026-09-29): committed on branch `masos` as "mac build" (`16961eb` + `9536853`) and pushed; merged into `main` with 1.17.0 on 2026-10-06 (PR #2). It reuses the Windows code, and every Mac difference is fenced: `IS_MAC` in JavaScript, `body.is-mac` in CSS, the `mac` / `dmg` sections in `package.json`. On Windows the `masos` code behaves exactly like 1.16.0. Finder's `.DS_Store`, committed by accident in `16961eb`, was taken out of git and git-ignored in a follow-up commit, "fix" (`f86cf19`, also pushed).
- An earlier Mac attempt (1.17.0, sixth session) was discarded and is kept as `stash@{0}` (on the Mac; the PC has no stash). None of it was used; the build never read it.
- **1.17.0, accounts and sync** (eighth session, 2026-09-30 to 10-01): built, tested and packaged (the 1.17.0 dmg and Windows installer, 2026-10-01) on `masos`; committed and pushed on 2026-10-01 ("huge", `4370072`), released as GitHub Release `v1.17.0` and merged into `main` on 2026-10-06. Its Google Cloud side is live since 2026-10-01 (`15`, status). It adds optional accounts and local-first sync of the board to Google Cloud for both platforms. The section "Accounts and sync (1.17.0)" below covers its modules, IPC and security; the full design, and where the code differs from it, is `15_accounts_and_sync.md`. Signed out, the app behaves exactly like 1.16.0.

Mac-only behaviour is marked **On a Mac**. Anything unmarked applies to both platforms. `14_macos.md` describes the whole Mac edition in one place: every difference, its flows, the build and the Mac-safe tests.

## Stack

- **Electron 44.4.5**: Chromium plus Node 24, main process in CommonJS.
- **Packaging:** electron-builder 26.15.3.
  - **Windows:** an NSIS one-click installer for x64. `npm run dist` on the PC; from a Mac use `npm run dist:win`, which pins `--x64` (a bare `--win nsis` on Apple Silicon builds an arm64 app the PC can't run).
  - **Mac (`masos` only):** a dmg for Apple Silicon (arm64 only), ad-hoc signed (`identity: "-"`), no hardened runtime, not notarised: `npm run dist:mac` makes `dist/Recaller-1.16.0-arm64.dmg`. Its Info.plist has `com.akhan.recaller`, `LSMinimumSystemVersion` 13.0 and an `NSMicrophoneUsageDescription`. Intel Macs are neither built nor tested.
- **UI:** vanilla JavaScript, HTML and CSS in the renderer. No framework, bundler or build step for the UI; scripts load as classic `<script>` tags in order: `icons.js`, `voice.js`, `app.js` (1.16), and since 1.17.0 `icons.js`, `voice.js`, `sync-apply.js`, `app.js`, `account.js`.
- **Dependencies:** none at runtime. Only `electron` and `electron-builder` are devDependencies. Fonts are copied `.woff2` files, not npm packages. 1.17.0 added no dependency: accounts and sync use raw REST calls, no Firebase SDK.
- **Speech-to-text:** the OpenAI API (`POST /v1/audio/transcriptions`), called only from the main process with Node's built-in `fetch`, `FormData` and `Blob`.
- **Cloud (1.17.0):** Firebase on Google Cloud project `recaller-cloud` (us-east1): Identity Platform for accounts, Cloud Firestore for the board, Cloud Storage for pictures. Called only from the main process through Electron's `net.fetch`, which follows the system's proxies and certificates. The project is Terraform in `infra/` (`infra/README.md`).
- **Machines:** the Windows PC (Windows 11, x64, one 5120×1392 ultrawide at 100%) and the owner's MacBook Pro (macOS 26.5.1, Apple M5 Pro, one Retina screen of 3024×1964 px at 2×, 1512×982 pt). The Mac edition was built and tested only on that Mac.

## Processes and windows

1. **Main process** (`src/main.js`): the app lifecycle, the one main window, the settings and data files, backups, the clipboard, global hotkeys, the image protocol, screenshots and transcription. **On a Mac** also the menu bar. Since 1.17.0 also accounts and sync, through the facade `src/cloud/index.js` (see "Accounts and sync" below).
2. **Main window renderer** (`src/renderer/*`): the whole UI. Its preload is `src/preload.js`, which exposes `window.recaller`.
3. **Screenshot overlay window** (`src/overlay/*`): a temporary, frameless, always-on-top window covering one display while the user drags out a region. Its preload is `src/overlay/preload.js`, which exposes `window.shot`.

Both preloads run with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`.

**On Windows**, closing the window quits the app. **On a Mac** the app keeps running with its window hidden: the red button and ⌘W hide the window, ⌘Q quits, and a Dock click or the global hotkey brings it back.

## Source files and responsibilities

```
recaller/
  package.json            name "recaller", productName "Recaller", appId com.akhan.recaller, version, scripts,
                          electron-builder config (win + nsis; on masos also mac + dmg)
  README.md               user-facing guide (install, usage table, shortcuts, voice, updating, data)
  build/icon.png          512×512 app icon (monstera leaf on an emerald rounded square), generated; the Windows icon
  build/icon-mac.png      masos: 1024×1024 Mac icon on Apple's grid (824 px body inset 100 px, radius 185, soft shadow),
                          generated; electron-builder turns it into the Mac app's .icns
  scripts/
    run-electron.js       launches Electron with ELECTRON_RUN_AS_NODE removed and the repo root as its working
                          directory (used by npm start / test / icon / capture)
    make-icon.js          renders build/icon.png from the SVG sprite in src/renderer/index.html;
                          with --mac (npm run icon:mac) it renders only build/icon-mac.png
    cloud-config.js       1.17: npm run cloud:config checks infra/gcp/project.json and copies it to
                          src/cloud/project.json; --check (predist, predist:mac, predist:win, prepack) stops a
                          build without it unless RECALLER_NO_CLOUD=1. Prints no key
    accounts-on.js        1.17: npm run test:accounts-on runs multi-copy, update-safety and features with
                          accounts on and nobody signed in, and fails if the app sends any request
  infra/                  1.17: the Google Cloud project as Terraform (terraform/bootstrap, terraform/prod), the
                          security rules (firebase/), and owner-run scripts (scripts/: auth-settings.sh,
                          rules-test.js, rules-smoke.js, purge-unverified.js). Runbook: infra/README.md.
                          infra/gcp/project.json (the app config, holds the API key) is git-ignored
  src/
    main.js               app entry (see below)
    preload.js            window.recaller bridge (IPC wrappers, listeners, and `platform`)
    store.js              crash-safe JSON: atomic write (tmp + rename with retries), read with .bak fallback, backup copy;
                          since 1.17 writeJsonAtomic returns the text it wrote (sync fingerprints it)
    cloud/                1.17, main process only (see "Accounts and sync"):
      project.json        generated by npm run cloud:config, git-ignored: projectId, apiKey, storageBucket,
                          authDomain, region. Without it accounts are off
      config.js           loadConfig(): endpoints, enabled flag, mock/fast/offline flags, token-store mode
      http.js             createHttp(): JSON and bytes requests over net.fetch, Google errors → CloudError codes,
                          serverNow() from Date headers
      codec.js            Firestore typed values, document encoding with _json, docId()
      auth.js             Identity Toolkit and Secure Token REST calls
      firestore.js        get, batchGet, runQuery (paged), commit
      storage.js          Storage v0: multipart (≤ 256 KiB) or resumable upload, download, stat, list, remove
      tokens.js           the token store: the refresh token sealed with safeStorage in sync/account.json
      account.js          the account's life: sign-up, verification, sign-in, sign-out, deletion, single-flight
                          ID tokens, the 5-wrong-passwords lock-out
      index.js            the facade main.js calls: init, IPC handlers, hooks; the only one that requires electron
    sync/                 1.17, main process only, plain Node (dependencies injected):
      keys.js             fractional order keys (base 62)
      model.js            data file → model, cloud documents → model, encoding, pristine-Welcome checks, counts
      diff.js             the local board against the shadow → writes
      merge.js            three-way, union and restore merges → a patch for the page and the new shadow
      state.js            the sync/ folder: device.json, state.json, shadow.json
      engine.js           createSync(): the loop (push, pull, first sync, audit, account deletion, pictures);
                          completePictures() fetches the board's missing full-size pictures before a sign-out
                          or an account deletion
    transcribe.js         OpenAI transcription: form building, SSE streaming parser, retries and fallbacks, error codes
    images.js             image store in <userData>/images, recaller-img:// protocol, garbage collection; since 1.17
                          also pictures by id for sync (has, size, readFile, writeWithId, ensureThumb), and a
                          full size that isn't here is shown and copied from its thumbnail
    screenshot.js         region snip: hide window, desktopCapturer, overlay window, crop, store;
                          on a Mac also the Screen Recording check
    backups.js            backup folders in <userData>/backups: create/list/prune/daily/readData/imageIds
    overlay/
      overlay.html        full-screen snip UI (captured screen as background, dim veil, selection box, size label, hint);
                          its own CSP meta tag
      overlay.js          pointer and key handling for selecting a region; sends done/cancel
      preload.js          window.shot = { image, ready, done, cancel }
    renderer/
      index.html          DOM shell: SVG sprite (monstera symbol and mask), top bar, stage with board, scroll arrows,
                          selection bar, toasts, lightbox dialog, settings dialog; CSP meta tag;
                          Mac labels as data-mac / data-mac-title attributes (masos)
      styles.css          all styling: tokens, themes, densities, title fonts, Cooked palettes, components
                          (about 1900 lines with 1.17, 1820 for the 1.16 Mac edition, 1801 in Windows 1.16; the 1.17
                          account block sits before the macOS block, which is at the end)
      icons.js            window.ICONS: inline SVG strings (stroke icons on a 24px grid; 1.17 adds cloud,
                          cloudOff and cloudAlert)
      voice.js            window.Voice: mic capture, voice-activity segmentation, transcribe() wrapper
      sync-apply.js       1.17: window.SyncApply (UMD, also required by main): applyPatch() and the per-device key
                          lists. Pure; reuses the page's live objects
      app.js              the whole UI app (about 3900 lines with 1.17 on masos, 3675 for the 1.16 Mac edition, 3576 in
                          Windows 1.16; one IIFE; see "Renderer design")
      account.js          1.17: Settings › Account & sync, the choice panels, the top-bar #sync-status indicator
      fonts/              Geist, Geist Mono, Instrument Sans, Plus Jakarta Sans, Onest, Sora, Space Grotesk,
                          Manrope, Inter (woff2) plus OFL licence files
  tests/e2e/              end-to-end suites (see 06_build_test_release.md); on masos also mac-harness.js,
                          which keeps every suite quiet on a Mac and does nothing on Windows; 1.17 adds sync.e2e.js
  tests/unit/             1.17: node --test unit tests for src/cloud, src/sync, sync-apply.js, src/images.js,
                          main.js's quit, the account page (in a vm), the GCP mock and its rules twin, and the
                          privacy note's wording (plain Node, no windows)
  tests/mock-gcp/         1.17: an in-process mock of Identity Toolkit, Secure Token, Firestore and Storage on
                          127.0.0.1, with a JavaScript twin of the security rules
  tests/rules/cases.js    1.17: the shared rules cases (the twin and the real Rules API both run them)
  tests/support/peer.js   1.17: a headless second computer (the real engine and clients, no Electron)
  ai_memory/              this handoff
```

### `src/main.js`, section by section

- **Top of file:**
  - `IS_MAC = process.platform === 'darwin'` fences every line added for the Mac edition. Four older checks from 1.5.0 test `process.platform` directly and were left alone: `titleBarOverlay`, `applyTheme()`, the menu branch and `window-all-closed`.
  - Sets `userData` to `RECALLER_DATA_DIR` if that env var is set (`path.resolve()`d against the working directory, which `run-electron.js` sets to the repo root). Otherwise it pins it to `path.join(app.getPath('appData'), 'Recaller')`: `%APPDATA%\Recaller` on Windows, `~/Library/Application Support/Recaller` on a Mac.
  - Registers the `recaller-img` privileged scheme; this must happen before `app` is ready.
- **`THEMES`** holds the window-controls overlay colours per theme: deep `#082a1f` with symbols `#e7f7ee`, soft `#fbfdfc` with symbols `#0c2a1d`. The title bar overlay is 48px high. On Windows these colour the native minimise, maximise and close buttons. **On a Mac** the window keeps the system traffic lights, so only `color` is used, as the window background.
- **`DEFAULT_SETTINGS`:**
  - `model: 'gpt-transcribe'`, `language: ''`, `hint: ''`
  - `hotkey`: `'CommandOrControl+Alt+R'` (Ctrl+Alt+R) on Windows. **On a Mac** `'Control+Alt+R'` (⌃⌥R): the same physical keys, because `CommandOrControl` means ⌘ there and ⌥⌘R is VS Code's Reveal in Finder. Like every default, it applies only when the settings file has no `hotkey` key.
  - `shotHotkey: ''`
  - `hideAfterCopy: false`, `theme: 'deep'`
  - `apiKey: null`, `bounds: null`, `maximized: false`
  - `lastVersion` is written at runtime.
- **Settings:**
  - `loadSettings()` merges defaults with the stored file, keeping unknown keys. When the main file (not its `.bak`) was read, it copies it to `.bak`; this happens once per app start.
  - `saveSettings()` writes atomically. It runs on every `settings:set`, 400ms after every move or resize, on close, and when a new version first runs.
  - `getApiKey()` tries, in order: a stored `{ enc }`, decrypted with `safeStorage` when encryption is available (on failure main logs `[settings] could not decrypt API key:` and moves on); a stored `{ plain }`; the `OPENAI_API_KEY` env var.
  - `setApiKey()` stores `{ enc }` when `safeStorage.isEncryptionAvailable()`, otherwise `{ plain }`, and `null` for an empty key.
  - `publicSettings()` is the only settings shape the renderer ever sees: `hasKey`, `keySource`, `keyHint` (the key's last 4 characters), `model`, `language`, `hint`, `hotkey`, `hotkeyOk`, `shotHotkey`, `shotHotkeyOk`, `hideAfterCopy`, `theme` and `dataDir`. Never the key itself. `keySource` is `'saved'` whenever the file holds any key object, even one that can't be decrypted, then `'env'`, else `null`. The renderer doesn't use `dataDir`.
- **Data:**
  - `loadData()` runs on every `data:load`, which is every page load (start, the reload after a restore, a DevTools reload). It flushes any pending write first (unless a restore is in progress), turns `restoring` off, reads with `.bak` fallback, and copies a good main file to `.bak`.
  - Renderer saves arrive through `data:save` and are ignored while restoring or when `projects` isn't an array. `scheduleDataWrite` is a trailing 250ms debounce (every save restarts the timer), and `flushData` writes atomically.
  - Flushes on Windows: window `close`, `before-quit`, `window-all-closed` and `session-end` (Windows shutdown or sign-out).
  - **On a Mac** also on the window's `closed` event and on `will-quit`, because ⌘Q never reaches `window-all-closed` and the page's last save (sent on `beforeunload`) arrives after `close`. The hourly daily-backup timer flushes too. `session-end` never fires on a Mac.
- **The window:**
  - Default size 1280×820, minimum 480×400. Saved bounds are restored only if they overlap a display's work area by at least 80px across and 40px down.
  - `titleBarStyle: 'hidden'`. On Windows, `titleBarOverlay` takes the `THEMES` colours, so the native Windows controls sit on the right end of the app's top bar. **On a Mac:** `titleBarOverlay: true`, `trafficLightPosition: { x: 16, y: 16 }` (the three buttons span x 16–70, centred in the 48px top bar) and `acceptFirstMouse: true` (a click on a card while another app is in front both brings Recaller forward and copies the card).
  - `show: false` until `ready-to-show`.
  - 1.19: with `settings.widget` set, the window is created at the widget's bounds and made always on top (`applyWidgetWindow(true)`); `rememberBounds()` and the `close` handler then save `settings.widgetBounds` instead of `bounds` and `maximized`.
  - Bounds and maximised state are saved 400ms after every move or resize (`rememberBounds()`) and on close. **On a Mac** a full-screen frame is never saved as the window's bounds.
  - **On a Mac, closing hides.** The `close` handler flushes and saves the bounds as usual. Then, unless the app is quitting (`quitting` is set in `before-quit`, for example by ⌘Q), it cancels the close and hides the window. A full-screen window first leaves full screen and hides on `leave-full-screen`, because hiding it in full screen would leave an empty black Space.
  - **On a Mac, full screen:** the window sends `app:command` `'fullscreen-on'` or `'fullscreen-off'` to the page on `enter-full-screen`, `leave-full-screen` and every `did-finish-load`. The page then gives the traffic lights' space back to the top bar.
- **Context menu:** in editable fields, up to 5 spelling suggestions and "Add to dictionary" (for a misspelt word), then Undo, Redo, Cut, Copy, Paste and Select All. That Undo is native text undo, separate from the app's undo history. Selected text outside a field gets a lone Copy. Anything else gets no menu.
- **DevTools:** F12 or Control+Shift+I, and **on a Mac** also ⌘⌥I (matched on `input.code === 'KeyI'`, because Option changes `input.key`). Only when the app is not packaged. On a Mac keyboard F12 needs fn.
- **`summon()`** creates the window if there is none; otherwise it restores, shows and focuses it and sends `app:summoned`. **On a Mac** it also calls `app.show()` first (undoing ⌘H or `app.hide()`) and `app.focus({ steal: true })` before focusing, so the hotkey pressed in another app brings Recaller to the front.
- **`toggleWindow()`** (the show/hide hotkey): when the window is visible, focused and not minimised, Windows minimises it. **On a Mac** it hides the app (`app.hide()`), which hands focus straight back to the previous app, so a paste lands there. Otherwise it calls `summon()`.
- **`screenshotFromAnywhere()`** runs when the global screenshot hotkey fires. It captures, summons the window, and sends `shot:captured` to the page. **On a Mac:**
  - a cancelled snip calls `app.hide()` when Recaller wasn't on screen before, handing focus back (never on `BUSY`, which would hide a snip still in progress);
  - the result is sent with `sendWhenLoaded()`, because a window that `summon()` has just created is still loading. Windows sends it at once.
- **`applyHotkeys()`** unregisters everything, then registers `hotkey` (toggle the window) and `shotHotkey` (screenshot) with `globalShortcut`. It records whether each registration succeeded (`hotkeyOk`), and Settings shows that status. An accelerator that fails leaves that hotkey off.
- **`applyTheme()`** sets the window background colour when the theme changes, and on Windows also the title-bar overlay colours (`setTitleBarOverlay` is Windows and Linux only).
- **The Mac menu bar (`macMenu()`, on a Mac only):**
  - **Recaller:** About, Settings… (⌘,), Services, Hide Recaller (⌘H), Hide Others, Show All, Quit (⌘Q). Settings… shows the window and sends `app:command` `'settings'`.
  - **Edit:** Undo (⌘Z) and Redo (⇧⌘Z) are custom items, not roles: they send `app:command` `'undo'` / `'redo'` only while the window is visible and not minimised, so ⌘Z never changes a board that is out of sight. The page picks text undo or its own history. Then the Cut, Copy, Paste, Paste and Match Style and Select All roles.
  - **Window:** Minimize with **no** ⌘M (⌘M is Dictate in the page), Zoom, Close Window (⌘W, which hides the window through the `close` handler), Bring All to Front.
  - **Help:** How Recaller Works, which shows the window and sends `'help'`. No accelerator; the page already handles `?`.
  - `sendWhenLoaded(channel, payload)` sends at once, or on `did-finish-load` while the page is still loading.
  - `showForCommand()` brings the window up for a menu command: it creates the window if there is none, otherwise `app.show()`, restore, show and focus. It is used instead of `summon()`, whose `app:summoned` would move focus to the search box.
  - `app.setAboutPanelOptions()` gives the About panel the name Recaller, the version and the credit "Your prompts and notes, one click away."
  - A source run shows `build/icon-mac.png` in the Dock when that file exists (`app.dock.setIcon`). Its menu bar is headed "Electron", because macOS names the first menu after the running bundle; the packaged app says Recaller.
  - Windows (and Linux) get no application menu (`Menu.setApplicationMenu(null)`).
- **Update protection:** `protectData()` runs at startup before the window opens.
  - If `settings.lastVersion` differs from `app.getVersion()`, it creates an `upgrade` backup (skipped when there is no data file yet) and then records the new version, rewriting the whole settings file.
  - It then creates a daily backup if the last one is more than 24 hours old.
  - **On a Mac** an hourly timer repeats the daily check (after flushing pending data), because a Mac app runs for days without restarting.
- **`restoreBackup(id)`:**
  1. Read and check the backup's data file. If it can't be read or has no `projects` array, return `{ ok: false, error: "That backup couldn't be read." }` and touch nothing.
  2. Flush pending data.
  3. Create a `before-restore` backup (with `restoredFrom: id`).
  4. Set `restoring = true`, so incoming saves are ignored; clear the write timer and drop `pendingData` (and, since 1.17, `pendingMeta`). Signed in, `cloud.onRestore(id)` runs just before this, so the next sync is a restore merge that deletes nothing from the account.
  5. Write the parsed backup over the data file, atomically. It is re-serialised with 2-space indentation, not copied byte for byte.
  6. Reload the page after 50ms. The next `data:load` turns `restoring` off.

  Restore replaces notes only; settings are not restored.

  Known hole: steps 3 and 5 aren't inside a try/catch. If either throws, the invoke rejects instead of returning `{ ok: false }`, and the Restore click handler has no catch, so no toast appears. If the write throws, `restoring` also stays true, and every later save is silently dropped until the next page load.
- **`inOrder(write)`** chains all clipboard writes, which are async in Electron 44, so they finish in the order they were requested.
- **Lifecycle:**
  - A single-instance lock, which is tied to the data folder; a second launch calls `summon()` in the running app.
  - `app.setAppUserModelId('com.akhan.recaller')` runs on every platform; it only matters on Windows.
  - Menus: `macMenu()` on a Mac (above); none on Windows and Linux.
  - A permission request handler and a permission check handler both allow only `media` and `clipboard-sanitized-write`.
  - **On a Mac** the `app:open-privacy` handler is registered (see the IPC contract).
  - Every web contents denies new windows (http(s) links open in the system browser) and blocks navigation.
  - `activate` (on a Mac, a Dock click) creates the window if there is none. **On a Mac** it also summons a hidden window.
  - `before-quit` flushes and, **on a Mac**, sets `quitting`. `will-quit` unregisters the global shortcuts, after a flush **on a Mac**. `window-all-closed` flushes and quits, except on a Mac.
- **Accounts and sync hooks (1.17.0).** `const cloud = require('./cloud')`. Every hook returns at once while accounts are off or signed out, and none throws into main:
  - `cloud.init({...})` right after `protectData()`, with main's own pieces: `safeStorage`, `userData`, `isPackaged`, `getWindow`, `images`, `backups`, `flushData`, `hasPendingWrite`, `isRestoring`, `holdSaves` (ignore saves while "Also remove this board" runs, like `restoring`), `getDeviceSettings` (an allow-list: theme, model, language, hint, hotkey, shotHotkey, hideAfterCopy; never `apiKey`, `bounds` or `lastVersion`), `appVersion`, `platform`, and `onShutdown` (records `sessionEndingAt`, below);
  - `loadData()` calls `cloud.onLoadResult({ from: 'main' | 'bak' | null, value, file })` before its `.bak` copy; `data:load` calls `cloud.onPageLoading()` first;
  - `scheduleDataWrite(data, meta)` keeps `pendingMeta = cloud.mergeSaveMeta(pendingMeta, meta)` (null while signed out). Signed in, a save that acknowledges a patch (`meta.ack`) first flushes the save waiting before it, so the engine sees what that one held. `flushData()` keeps `pendingData` when the write throws (as before) and, after a good write, calls `cloud.onFileWritten(data, meta, text)`: the engine reads the board only as it is on disk;
  - `restoreBackup()` calls `cloud.onRestore(id)` after the `before-restore` backup and clears `pendingMeta` with `pendingData`;
  - the window's `focus`, `blur`, `show`, `hide`, `minimize` and `restore` call `cloud.onWindowState()`; `summon()` calls `cloud.onSummon()`;
  - `image:copy`, signed in, fetches a picture from another computer (`cloud.ensureImage(id)`) and writes it to the clipboard inside the `inOrder()` queue, so a copy made after it still lands last; `images.serve({ fetchMissing: cloud.ensureImage })` fetches missing files for `recaller-img://`. A full size that still isn't here (offline, or signed out since) is served and copied from its thumbnail;
  - `cloud.registerIpc(ipcMain)` at the end of `registerIpc()`;
  - a third `before-quit` listener, after the flush and the Mac's `quitting`: when signed in with changes not uploaded, it cancels the quit once, flushes, gives `cloud.finalPush(1500)` up to 1.5 s, then quits (`finalPushDone` lets the second `before-quit` through);
  - **except while the computer logs out, restarts or shuts down:** on Windows the window's `session-end` sets `sessionEnding`. **On a Mac** powerMonitor's `shutdown` (through the `onShutdown` dep; watched from the first sign-in on, never before it, and never on ⌘Q) sets `sessionEndingAt`, and it counts only for 60 s, so a log out the person cancels doesn't turn the final push off for the rest of the run. The quit then goes through at once, because holding it up would make macOS say Recaller cancelled the log out. What didn't upload goes up at the next start.

### Mac additions in `src/screenshot.js`

- `systemPreferences` is loaded only on a Mac. The code's comment says that on Windows, loading it sets up a hidden window for colour broadcasts.
- **Screen Recording check:** at the start of `capture()` (after the `BUSY` check), if `systemPreferences.getMediaAccessStatus('screen')` isn't `'granted'`, it calls `desktopCapturer.getSources()` once with a zero-size thumbnail and returns `{ ok: false, code: 'PERMISSION', error }` without snipping. That call makes macOS list Recaller under Screen Recording and shows macOS's own prompt the first time. The error text is: "Recaller needs permission to record the screen. In System Settings › Privacy & Security › Screen & System Audio Recording, turn Recaller on (or off and on again after an update), then quit and reopen Recaller."
- **Full screen:** a full-screen main window leaves full screen before it hides (`leaveFullScreen()`, which waits up to 2s), because the snip would otherwise capture an empty black Space. The window comes back windowed.
- **Focus:** the overlay gets `acceptFirstMouse: true`, and `app.focus({ steal: true })` runs before `overlay.focus()`, so Esc and the first drag work when the snip starts from another app.
- The empty-capture error says "macOS returned an empty screen capture." (Windows keeps "Windows returned an empty screen capture.").
- `setVisibleOnAllWorkspaces` is deliberately not used, because it flickers the Dock. Snipping over another app's full-screen Space is untested.

None of this has been verified against a real Screen Recording prompt: the Mac test run skips the real snip.

## IPC contract

**Renderer → main (`window.recaller.*` in `preload.js`):**

| Preload function | Channel | Type | Payload → result |
| --- | --- | --- | --- |
| `loadData()` | `data:load` | invoke | → the parsed data object or `null` |
| `saveData(data, meta)` | `data:save` | send | full data object; debounced write; ignored while restoring. Since 1.17 a second argument `meta = { session, seq, contentSeq, labels, ack? }` (sync's bookkeeping); main keeps it only while signed in, and bad meta counts as `{}` |
| `copy(text)` | `clipboard:write` | invoke | string → `true` (serialised) |
| `setWidget(on, projectId)` | `window:widget` | invoke | 1.19: `true` turns the window into the widget (360 × 640 or `settings.widgetBounds`, always on top, min 300 × 360, not maximizable; a Mac leaves full screen first), `false` puts back the board's own bounds (`settings.bounds`, maximized if it was). A string `projectId` (≤ 200 chars) is saved as `settings.widgetProject` → the new state |
| `minimize()` | `window:minimize` | invoke | minimises the window on Windows; **on a Mac** hides the app (`app.hide()`), like ⌘H |
| `getSettings()` | `settings:get` | invoke | → public settings object |
| `setSettings(patch)` | `settings:set` | invoke | patch keys: apiKey, model, language, hint, hotkey, shotHotkey, hideAfterCopy, theme → public settings |
| `openDataFolder()` | `app:open-data-folder` | invoke | opens the data folder with `shell.openPath`: `%APPDATA%\Recaller` in Explorer on Windows, `~/Library/Application Support/Recaller` in Finder on a Mac |
| `listBackups()` | `backups:list` | invoke | → `[{ id, kind, createdAt, appVersion, fromVersion?, toVersion?, restoredFrom?, projects, notes, unreadable? }]`, newest first |
| `createBackup()` | `backups:create` | invoke | flush, then a `manual` backup → id or `null` |
| `restoreBackup(id)` | `backups:restore` | invoke | → `{ ok }` or `{ ok: false, error }`; the page reloads on success |
| `saveImage(bytes)` | `image:save` | invoke | Uint8Array (PNG or JPEG) → `{ ok, image: { id, w, h } }` or `{ ok: false, error }` |
| `copyImage(id)` | `image:copy` | invoke | writes the PNG as `image/png` to the clipboard → `true`/`false` |
| `gcImages(keepIds)` | `images:gc` | invoke | deletes unreferenced image files older than 1 hour (backups are also treated as references) |
| `captureScreen()` | `shot:capture` | invoke | → `{ ok: true, image }`, `{ ok: false, code: 'CANCELLED' \| 'BUSY' \| 'FAILED', error? }`, and **on a Mac** also `code: 'PERMISSION'` with the Screen Recording text |
| `transcribe(bytes, mime, context, onEvent)` | `stt:transcribe` | invoke | `{ reqId, bytes, mime, context }` → `{ ok, text }` or `{ ok: false, code, error }` |
| `openPrivacy(kind)` | `app:open-privacy` | invoke | **Mac only**: the handler is registered only on a Mac, and only Mac-gated code calls it. `'microphone'` or `'screen'` opens that pane of System Settings › Privacy & Security (`x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone` or `?Privacy_ScreenCapture`) → `true`; any other value → `false` |

**Accounts and sync (1.17.0), `window.recaller.account.*` and `window.recaller.sync.*`.** Registered by `cloud.registerIpc()`. Main checks every payload: an email of at most 254 characters matching `^[^\s@]+@[^\s@]+\.[^\s@]+$`, a password string of 1–4096 characters, a `choice` from the allow-list. One account operation runs at a time; another gets `{ ok: false, code: 'BUSY' }`. Results are `{ ok: true }` or `{ ok: false, code, retryAfterMs? }` (codes in `15`, 3.6). With accounts off, `account:get` still answers `{ enabled: false, state: 'signed-out' }`, the other account calls and `sync:choose` answer `UNAVAILABLE`, `sync:now` answers `null`, and the sends are ignored.

| Preload function | Channel | Type | Payload → result |
| --- | --- | --- | --- |
| `account.get()` | `account:get` | invoke | → `AccountState`: `enabled`, `state` (`signed-out`, `unverified`, `signed-in`, `needs-sign-in`, `deleted`, `disabled`), `email`, `keyStore`, and while signed in `sync` (phase, pending, last synced, errors, progress), `choice`, `devices`, `counts`, `deleting` (`what` is `save-pictures`, `pictures`, `notes` or `account`), and `signingOut` (`{ what: 'pictures', done, total }`, only while a plain sign-out saves the full-size pictures) |
| `account.signUp(email, password, privacyVersion)` | `account:sign-up` | invoke | → `Result`; sends the verification email |
| `account.signIn(email, password)` | `account:sign-in` | invoke | → `Result` (also from `needs-sign-in`) |
| `account.resendVerification()` | `account:resend-verification` | invoke | → `Result` |
| `account.checkVerified()` | `account:check-verified` | invoke | → `Result & { verified }`; shares a lookup already on its way |
| `account.discardUnverified()` | `account:discard-unverified` | invoke | "Use a different email": deletes the unverified account only if it was made in the last few minutes (`accounts:delete` wants a recent sign-in) and wasn't verified meanwhile; otherwise it is left for `infra/scripts/purge-unverified.js`. Then signs out (`NETWORK` and `TOO_MANY_ATTEMPTS` change nothing) → `Result` |
| `account.resetPassword(email)` | `account:reset-password` | invoke | → `Result`, ok for unknown emails too (enumeration protection). Main sends at most one link per email a minute: another answers `{ ok: false, code: 'RESET_UNAVAILABLE', retryAfterMs }` |
| `account.signOut({ force, removeBoard, removeUnreadable })` | `account:sign-out` | invoke | → `Result`, or `{ ok: false, code: 'PENDING', pending, localOnly? }` while changes wait. With `removeBoard`, also while anything exists only here, and while kept copies of an unreadable notes file exist that `removeUnreadable` didn't agree to remove (`localOnly.unreadable` says how many). A plain sign-out first saves the full-size pictures here for at most 20 s and answers `{ ok: true, picturesLeft }` when some stayed in the account |
| `account.deleteAccount(password)` | `account:delete` | invoke | → `Result`; progress arrives in `account:changed`, starting with `save-pictures` (nothing is deleted until the full-size pictures are saved here) |
| `account.onChanged(fn)` | `account:changed` (main → page) | listener | `AccountState`, sent on every change |
| `sync.ready({ session })` | `sync:ready` | send | the page finished `init()`; sync may start sending patches |
| `sync.nack({ patchId, reason })` | `sync:nack` | send | `reason` `'stale'` (the page's `contentSeq` moved) or `'invalid'` |
| `sync.now()` | `sync:now` | invoke | Sync now → the sync status, or `null` signed out |
| `sync.choose(choice)` | `sync:choose` | invoke | `upload`, `combine`, `use-account`, `not-now`, `delete-everywhere`, `keep` or `retry` → `Result` |
| `sync.onPatch(fn)` | `sync:patch` (main → page) | listener | a `Patch` (`15`, 5.8): entity upserts and removals, final list orders, counters, notices |

**Preload listeners and values:**

| Member | Meaning |
| --- | --- |
| `onSummoned(fn)` | calls `fn()` on `app:summoned`; returns an unsubscribe function |
| `onScreenshot(fn)` | calls `fn(result)` on `shot:captured`; returns an unsubscribe function |
| `onCommand(fn)` | calls `fn(name)` on `app:command`; returns an unsubscribe function. Defined on both platforms, called only by Mac-gated code |
| `platform` | `process.platform`: `'win32'` on the PC, `'darwin'` on a Mac. `app.js` and `voice.js` read it to set their Mac flag |

**Main → renderer:**

| Channel | Meaning |
| --- | --- |
| `stt:event` | `{ reqId, type: 'delta', delta }` or `{ reqId, type: 'reset' }` while a transcription request runs. The preload filters by `reqId` and calls `onEvent` |
| `app:summoned` | the global hotkey brought the window up; the page focuses search unless the user is busy |
| `shot:captured` | result of the global screenshot hotkey; the page attaches the image to the active or new composer. **On a Mac** it is sent once the page has loaded, and a `PERMISSION` result shows a toast with an Open Settings button |
| `app:command` | **Mac only**: a string name. From the menu bar: `'settings'`, `'help'`, `'undo'`, `'redo'`. From the window: `'fullscreen-on'`, `'fullscreen-off'` |

**Overlay window.** Its IPC is scoped to the overlay's web contents with `webContents.ipc`:

| Channel | Meaning |
| --- | --- |
| `shot:image` | invoke → `{ bytes }`, the captured screen as JPEG quality 90, used as the background |
| `shot:ready` | the page has decoded the image; main then shows the overlay |
| `shot:done` | `{ x, y, w, h }` in CSS pixels, or `{ full: true }` |
| `shot:cancel` | the user cancelled |

## Security model

- **Renderer isolation:** context isolation and sandboxing, no Node access. Only the whitelisted `window.recaller` API is exposed.
- **CSP:** two meta tags are the whole policy; nothing in main sets one.
  - `index.html`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: recaller-img:; media-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'`. The page itself cannot make network requests; all network traffic goes through main.
  - `overlay.html`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src blob:; font-src 'self'; object-src 'none'; base-uri 'none'`.
  - Keep `base-uri 'none'` when editing either one: it has no fallback.
- **Image protocol:** `recaller-img://img/<32 hex>.png` (full size) and `.../<id>.t.png` (thumbnail). The handler validates the id with a regex, so there is no path traversal. A missing thumbnail falls back to the full image, and since 1.17 a missing full size falls back to the thumbnail (a picture from another computer known here only by its preview; with 1.16 data every picture has both files).
- **API key:** encrypted at rest with `safeStorage`, and never sent to the renderer. The code has no platform branch; the operating system supplies the protection.
  - **Windows:** DPAPI. The encryption key sits in Chromium's `Local State` file in the data folder.
  - **On a Mac:** the Keychain (Electron's documented macOS backend). The encryption key is a login-keychain item, which for the packaged app should be named "Recaller Safe Storage". Saving a key may bring a keychain prompt ("Always Allow"), and because each ad-hoc-signed build has a new signature, the prompt may come back after a rebuild. Untested: the test suites use a `{ plain }` test key, so they never touch the keychain, and nothing is recorded from the owner's first run of the packaged app (late on 2026-09-29).
  - Stored as `{ enc: base64 }`, or `{ plain }` only if OS encryption is unavailable.
  - A blob encrypted on one computer can't be decrypted on the other, so the key can't move between the PC and the Mac; it has to be pasted again.
  - Backups copy `recaller-settings.json`, so every backup folder holds the key blob (in plain text if it was saved as `{ plain }`). Never print or share backup settings files.
- **Accounts and sync (1.17.0):**
  - **The page never sees a token, the API key or the cloud config.** It gets `AccountState`, `Result`s and patches only. The CSP is unchanged (`connect-src 'none'`); every Google call goes through `net.fetch` in main.
  - **Passwords** cross IPC only for sign-up, sign-in, re-authentication and deletion. Main passes them straight to Identity Toolkit and never stores or logs them. Deletion holds the password only for the length of that call.
  - **The refresh token** is the only long-lived secret. In a packaged build (`tokenStore: 'secure'`) it is sealed with `safeStorage` and kept as `{ enc }` in `sync/account.json`: DPAPI on Windows (`keyStore: 'dpapi'`), the keychain **on a Mac** (`'keychain'`, the same "Recaller Safe Storage" item as the API key). Linux's `basic_text` fallback counts as not secure. If sealing isn't possible, the token is never written: the sign-in lasts for the session (`'session'`), and Settings says so. `{ plain }` is never stored. A sealed token for another cloud project (`project` mismatch) is ignored.
  - **ID tokens** (one hour) live in memory only, refreshed single-flight 5 minutes before they expire, after a 401, and on resume.
  - **Runs from source never touch the keychain:** the token store defaults to `memory` (nothing written). `test-file` (a readable `{ testPlain }`) is allowed only with a loopback mock, in a run from source; `RECALLER_TOKEN_STORE=secure` is an explicit opt-in. Every development override (`RECALLER_GCP_BASE`, `RECALLER_GCP_REAL`, `RECALLER_TOKEN_STORE`, `RECALLER_SYNC_FAST`, `RECALLER_SYNC_OFFLINE`) is ignored when `app.isPackaged`, and `RECALLER_GCP_BASE` must be `http://127.0.0.1:PORT` or `http://localhost:PORT`.
  - **Accounts are off** without `src/cloud/project.json`, and in any run that sets `RECALLER_DATA_DIR` without a mock base (unless `RECALLER_GCP_REAL=1`, from source only). So the older suites run exactly as in 1.16.
  - **The API key** in `project.json` is public by design (it ships in every copy and only names the project); the security rules and the verified-email sign-in protect the data. It still stays out of git and out of logs: the config object hides it from `console.log`, and logs carry error codes only, never a message that could hold an email or note text.
  - **Security rules** (`infra/firebase/*.rules`): a user whose email is verified reads and writes only `users/{uid}` and `users/{uid}/images/`. Board writes make no `get()` calls; a board commit must raise the head's `rev` by exactly one; nothing is hard-deleted except while the account is being deleted. Details in `15`, 4.8 and 4.9.
  - **What arrives from the account is untrusted text.** A note id can now come from another computer, so the Notes lists of the Cooked note and the Served text escape it where they build their HTML (`partsHtml`), as note text always was (a security fix from 1.17's final review).
  - **The data on Google's side** is encrypted in transit and at rest, but not end to end: the project owner could read it (the privacy note says so).
- **Permissions and navigation:**
  - Chromium level: the request and check handlers grant only `media` and `clipboard-sanitized-write`. `media` is granted without looking at the media types, so a camera request would pass too; the renderer only ever asks for audio.
  - **On a Mac**, macOS adds its own layer. The microphone needs the Info.plist `NSMicrophoneUsageDescription` (macOS asks on first use) and, when refused, the composer offers an Open System Settings button. Screen Recording is checked before every snip (see `screenshot.js` above). The session never saw either prompt (the Mac tests use a fake microphone and skip the real snip), and the owner's first run isn't reported yet.
  - Navigation and new windows are denied.
- **Code signing:** the Windows installer is unsigned (SmartScreen may warn). The Mac app is ad-hoc signed, has no hardened runtime and isn't notarised; `spctl` rejects it, as expected for an unnotarised app. A downloaded or AirDropped copy is quarantined, and macOS lets it open only after Open Anyway in System Settings › Privacy & Security. The dmg built on the owner's Mac carries no quarantine attribute. The session never launched the packaged app: the test suites ran its `app.asar` code (with the development Electron), and all passed. The owner first opened it from the dmg late on 2026-09-29.

## Renderer design (`src/renderer/app.js`)

One IIFE. After the top constants comes a short `// ---- macOS (1.16 Mac edition)` block (see "Mac helpers in the renderer"), then the commented sections, in this order (the names are the code's own section headers):

1. utilities
2. data
3. undo / redo
4. search
5. views
6. note actions
7. project actions
8. composer
9. gestures
10. board scrolling
11. clicks & keys on the board
12. menus
13. toasts
14. lightbox
15. search (the search box's own handlers; the same word as section 4)
16. settings
17. global keys
18. boot

Since 1.18, right after `render()`, come `// ---- column groups (1.18)` (`boardLayout()`, the group views and menu, `setGroup()`, `renameGroup()`, `moveGroup()`), `// ---- Eating (1.18)` (`setEating()`, `paintEating()`, `revealColumn()`), the minimize helpers (`unhide()`, `setMinimized()`) and the Claude Code format (`setClaudeCode()`, `settleCooked()`); `claudeCodeText()` and `CC_GUIDE` sit with the top constants, and `cookedText()` (what Cooked shows and copies) next to `augmentedText()`. `render()` draws `boardLayout()`: a lone column goes straight on the board, a group's columns go inside its `.col-group > .group-cols`. Since 1.20: `isMinimized()`, `isNotepad()`, `boardProjects()` and `setBoardOrder()` sit with the top constants; the notepad block (`openNotepad()`, `notepadInput()`, `saveNotepadNow()`, `paintNotepad()`, called from `render()`) follows the Eaten drawer; and the gestures section's column drag (`dropContainer()`, `dropUnits()`, `unitAfter()`) is followed by the group drag (`startGroupGesture()`, `beginGroupDrag()`, `groupDragMove()`, `groupDragEnd()`), started from the board's `pointerdown` on `.group-head` / `.group-strip`. Since 1.17 a `// ---- sync (1.17)` block sits at the end of section 17, just before boot: `SESSION`, `saveSeq`, `contentSeq`, `pendingLabels`, `syncBusy()`, `tryApplyPatch()`, `noticeText()` (the sync toasts), the "Other version" tag's tooltip, `window.RecallerUI`, and the `api.sync.onPatch` handler. `init()` ends with `api.sync?.ready({ session })`.

- **State:**
  - `data` is the persisted document (see `03`).
  - `ui` holds ephemeral state: `search`, `composing` (project id with the new-prompt composer open), `editing` (id of the note being edited), `lastProjectId`, `settings` (the public settings), `selection` (the ids picked by Ctrl+click, or ⌘-click on a Mac, in order) and `anchor` (the last plain-clicked note, used for Explorer-style selection).
- **Rendering: keyed reconciliation, no virtual DOM.**
  - `columns` (Map projectId → column view) and `cards` (Map noteId → card view) keep DOM nodes alive across renders.
  - `render()` rebuilds the order with `syncChildren(parent, nodes)`, which moves only the nodes that changed. This keeps focus, scroll, animations and open editors intact.
  - Each card view keeps a signature string (text, search key, expanded, copy count, image ids, highlight id, and since 1.17 the "Other version" tag's tooltip) and only rewrites its DOM when that changes. There is no stage in it: cards exist only in Cooking since 1.6. The time label is rewritten on every render, outside the signature, and the selection ring and badge are set in `syncList`.
  - The Cooked note and the Served text are rendered per column with their own signatures (`augSig`, `finalSig`), which include the search key so matches get highlighted. Their Notes lists come from `partsHtml()`.
  - Column widths: `updateColumn()` sets `style.width` from `colWidth(id)` (reads `data.prefs.colWidths`), except for the column being resized. `render()` ends with `paintWidthReset()`, which enables or disables the top-bar ↔ button.
  - `render()` is skipped while a drag is active.
- **Body classes (the look switches):** `render()` sets `density-<compact|slim|roomy>`, `title-<font>` and `cooked-<ocean|teal|midnight|graphite>` on `<body>` from `data.prefs` (with fallbacks `slim`, `instrument`, `ocean`); `applyTheme()` sets `theme-<deep|soft>` from the settings file. `index.html` ships `density-slim theme-deep title-instrument cooked-ocean` so the first paint already looks right. **On a Mac** `app.js` also adds `is-mac` at startup, and `is-fullscreen` while the window is in full screen.
- **Persistence:** `persist()` sends the whole `data` object to main right after every change. `persistSoon()` is a trailing 400ms debounce, restarted on every call. Two things use it: draft typing (the new-prompt composer's `onDraft`) and `rememberProject()` (`prefs.lastProjectId`, set by a press inside a column). On Windows nothing flushes that timer when the page unloads (see Shutdown). **On a Mac** a `beforeunload` listener sends the waiting save.
- **Undo/redo:**
  - Snapshot-based: `checkpoint(label)` stores `JSON.stringify(data.projects)` before every user-visible change. The stack holds at most 80.
  - `applySnapshot()` restores projects but carries over live UI and counter fields: drafts, draft images, collapsed and expanded flags, copy counts, last-copied time and the note `expanded` flag. So undo only rewinds what the user actually did.
  - Toasts carrying Undo are dismissed whenever a new checkpoint is made, so "Undo" always means the latest change.
- **Composer component:** `createComposer(options)` returns `{ root, focus, startVoice, toggleVoice, screenshot, addImage, value, images, isBusy, destroy }`. It is used for new prompts, editing a card, and the stage editors. It holds all voice, screenshot, paste and drop logic for its textarea.
- **Cooking header and the New prompt | Dictate bar (1.8):** `createColumn()` renders `.cook-headrow > .cook-head` (chevron, flame, "Cooking", `.cook-count`) above `.col-new`. The column view's `countEl` now points at `.cook-count`. `updateColumn()` toggles `.column.cooking-collapsed` from `project.notesCollapsed` (ignored while searching), and CSS hides `.active-list` / `.active-empty` when it's set. The board click handler toggles the flag; `addNote()`, `moveBetween(…, 'notes')` and `dragEnd()` into `notes` clear it. The two bar halves are both `.new-prompt` buttons (`.col-add` and `.col-mic`), so `querySelector('.new-prompt')` finds New prompt first.
- **Right-click to edit (1.10):** a board `contextmenu` listener maps the target to `startEdit(id)` (card), `editStage(col, 'used' | 'combined')` (the Cooked note or Served body), or `editStage(col, list, partId)` (a `.final-part` row). It calls `preventDefault()` only when it handles the event, and skips when text is selected or the target is an input or composer, so main's native menu (Copy, or the field menu) still appears then. **On a Mac** a right-click (or Control+click) selects the word under the pointer before `contextmenu` fires. So a capturing `pointerdown` listener records the selection as the button goes down (`selectionAtPress`), the handler checks that instead, and it clears the Mac's word selection when it opens an editor. Control+click therefore edits, like a right-click.
- **New-prompt composer closes on save (1.10):** its `onSave` calls `addNote()` then `closeComposer('', [])`.
- **Fixed-size stage texts (1.7):** `.aug-text` / `.final-text` are limited by CSS to `--stage-lines` (6). `measureCards()` → `paintMore()` shows the slim "Show more / Show less" bar (`.aug-more` / `.final-more`, class `stage-more`) when the text overflows. `col.augExpanded` / `col.finalExpanded` are session-only (always `false` at start). The `fits` class only removes the fade; the height limit never depends on measurement.
- **Scrollers inside columns (1.7):** `SCROLLERS` lists what scrolls on its own (`.col-scroll`, `textarea`, the opened-up texts, the Notes lists). The board wheel handler walks up from the target and leaves the wheel alone if any of them can scroll. `onScrollbar(e)` stops a pointerdown or click on one of their scrollbars from starting a gesture or a copy.
- **Card hover bar (1.11):** `createCard()` renders only `.act-hl` (highlighter menu) and `.act-used.act-primary` ("↓ Cooked" → `toggleUsed()` → `moveBetween(id, 'used')`). Editing a card is right-click or E/F2 (`startEdit()`).
- **Focused-card keys** (board `keydown` on a focused `.card`): Enter or Space copies, E or F2 edits, Delete or Backspace deletes, U moves the card to Cooked (`toggleUsed()`), H toggles the amber highlight, and ↑/↓ move focus through every card on the board. On Windows modifiers aren't checked. **On a Mac** a key held with ⌘, ⌃ or ⌥ is left alone so it reaches the menus (⌘H hides the app instead of toggling the highlight); only ⌘⌫ (⌘Delete) deletes the card, like the Finder.
- **Sorting (1.7):** `sortOldestFirst(projectId)` (⋯ menu) sorts `notes` by `createdAt`, as an undoable step.
- **Help (1.7):** `<dialog id="help">` in `index.html`. `openHelp()` fills in the user's show/hide key (through `prettyAccel()`); it opens from `#open-help`, `F1`, or `?` when not typing. The global key handler ignores keys while it's open. **On a Mac** the Help button's tooltip says `(?)`, Help › How Recaller Works in the menu bar opens it too, and F1 needs fn on most Mac keyboards.
- **Stage editors (1.6):** `editStage(projectId, list, partId?)` opens a composer for the Cooked note (`list` `'used'`, placed in `.aug-wrap`) or the Served text (`'combined'`, placed in `.final-edit-host`).
  - Without `partId` it edits the whole text. If the text or images changed, `saveStageEdit()` replaces the list with ONE new note followed by any notes that arrived while the editor was open. The new note has a new id and `createdAt`, `copied` 0, no highlight and `usedAt` set to now.
  - With `partId` it edits that note alone.
  - Both kinds have a trash button since 1.15 (`createComposer`'s `allowDelete` plus a `deleteLabel` tooltip): a part editor's calls `deletePart()`, and the whole-text editor's calls `deleteStageText(projectId, list, openedIds)`, which removes only the notes that were in the text when it opened (toast "Cooked note deleted" / "Served text deleted", from `STAGE_WHOLE`).
  - The open editor is `col.stageEditor = { list, partId, composer }`; `closeStageEditors()` runs before any other editor opens and on undo/redo. `isEditing()` reports whether any editor is open. `movePart(id, ±1)` reorders parts; `clearStage(id, list)` backs the Clear Cooked / Clear Served menu items.
- **Notes-list rows (`partsHtml()`):** each `.final-part` row has `.fp-up`, `.fp-down`, `.fp-edit`, the send-back button (`.ap-back.fp-back` in Cooked, `.fp-back` in Served) and, since 1.15, `.fp-del` (trash → `deletePart(col.id, list, id)`; `deletePart()` also closes an open editor on that stage first). The board `click` listener routes them:
  - `.fp-up` / `.fp-down` → `movePart()`, which finds the list itself with `locate(id)`;
  - `.fp-edit` and `.fp-del` use `part.closest('.aug-parts')` to tell Cooked from Served;
  - the send-back button is routed by class: `.ap-back` is checked before `.fp-back`, so the Cooked button, which has both classes, goes to `moveBetween(id, 'notes')`, and a Served one to `sendBackFromFinal(id)`.

  Buttons are skipped by the Cooked note's press gesture, so a click on one never copies or drags the note. A press on a Cooked row's text (not a button) does start that gesture.
- **Board frame (1.16, CSS only):** `.stage` (the element holding the backdrop leaves, the board and the arrows) has a margin (2px top, 12px sides and bottom), `border-radius: 14px`, `overflow: hidden` and a transparent 1px border with the `--frame-edge` gradient painted as its last `border-box` background layer. `body`'s background is `--topbar`, so the margin reads as part of the top bar. Things that must escape the frame (the drag ghost, menus, toasts, dialogs) are attached to `body` or are `position: fixed`, so the clipping doesn't affect them.
- **Board arrows (`#pan-left` / `#pan-right`, "board scrolling" section):** `updatePan()` sets `hidden` when there's nothing more to scroll that way (on board scroll, window resize and after render). Since 1.16 a `pointermove` listener on `.stage` (`board.parentElement`) calls `setPanNear(-1 | 0 | 1)` when the pointer is within `PAN_ZONE` (96px) of the stage's left or right edge, which toggles `.is-near` on the matching arrow; `pointerleave` clears it. CSS keeps an arrow at `opacity: 0; pointer-events: none` unless it has `.is-near` or `:focus-visible`, and hides both under `body.is-dragging` / `body.is-panning`. A click scrolls one column (`columnStep()`); holding for 320ms glides.
- **Gestures:** a custom pointer-event engine, not HTML5 drag-and-drop.
  - `trackPointer(e, { onMove, onEnd })` listens on `window`. It cancels if a move arrives with no buttons pressed, or if the window loses focus.
  - Card gesture: a press shorter than 240ms without moving copies. Moving 7px or more to the left (mostly horizontally) swipes. Any other movement, or holding for 240ms, drags. A long press that never moved still counts as a click.
  - Multi-select uses `multiKey(e)`: Ctrl (or Meta) on Windows, ⌘ **on a Mac**. **On a Mac** the board `pointerdown` returns at once for Control+click (left button with `ctrlKey`): no copy, select, drag or pan; the `contextmenu` listener edits instead.
  - The Cooked note has its own gesture (`startAugGesture`): click copies, swipe left moves it down, dragging it onto Served moves it down.
  - Column resize (`startColumnResize`): a pointerdown on `.col-resize` (checked before any other card or header gesture) drags the width, snapping to the default within 6px. It sets `resizing` and `dragActive` so re-renders don't fight it, and on release saves through `setColWidth()`. Double-click (board `dblclick`) calls `resetColumnWidth()`; the top-bar button calls `resetColumnWidths()`, whose toast Undo restores the previous `prefs.colWidths` object. `remeasure(cols)` re-checks the "Show more" buttons after width or density changes.
  - Columns can be dragged by their header to reorder them.
  - Dragging uses a fixed-position ghost clone, a placeholder, FLIP animations (`flip()`), and auto-scroll near the edges of the board and columns.
- **Startup sequence (`init`):**
  1. `loadData()`. The result `raw` is `null` when there is no file, when neither the file nor its `.bak` can be read or parsed (or it holds a falsy JSON value), or when the call rejects.
  2. `data = normalize(raw) || seedData()`: the "Welcome" seed when `raw` is null or has no `projects` array. `normalize()` is described precisely in `03` (invariant 2).
  3. Persist at once when `!raw || !(Number(raw.version) >= DATA_VERSION)`: no file, no readable file, a failed load, or a version that is missing or below 2. An up-to-date file is not rewritten.
     - **Known hole:** an unreadable data file (with no readable `.bak`) is treated like a first run. The seed is written over it about 250ms later, and step 7's image cleanup, which then sees only the seed's references, deletes image files older than 1 hour that no backup references. The good copies are then only in `backups/`. A file that parses but has no `projects` array also shows the seed; it is overwritten at once if its version is missing or below 2, otherwise by the first change.
  4. Restore `lastProjectId`.
  5. `getSettings()` and apply the theme.
  6. `render()` and `paintHistory()`, then restore scroll positions (not tied to an animation frame).
  7. Mark the page ready (it fades in), update the arrows, then clean up unreferenced images (`gcImages`).
- **Shutdown:**
  - On `beforeunload`, `saveScrollNow()` saves scroll positions, but only if the user scrolled in this session and the position differs from the saved one. When it does save, the whole `data` object goes out, including any draft still in memory.
  - **On a Mac** a second `beforeunload` listener, registered earlier so it runs first, clears `persistSoon()`'s timer and persists. `draftTimer` is never reset after it fires, so once any draft typing or column change has happened in a page's life, every later unload on a Mac sends one extra save; that is harmless.
  - Windows: `close` flushes main's pending write, the page's last save (if any) arrives, then `window-all-closed` flushes that and the app quits. `before-quit` and `session-end` flush too.
  - **On a Mac**, ⌘Q runs `before-quit` (flush, `quitting = true`), the window's `close` (flush), the page's `beforeunload` saves, then `closed` and `will-quit`, which both flush again. That order is Electron's documented one; `window-all-closed` is not emitted on ⌘Q. The red button and ⌘W only hide the window, so the page is not unloaded.
  - What can still be lost on Windows: draft text typed since the last pause of 400ms or more, and a just-changed `lastProjectId`, unless another save (such as the scroll save) carries them.
  - Tested: the features suite's Mac check types a draft, reloads the page at once and finds the draft saved. A real ⌘Q hasn't been verified.

### Mac helpers in the renderer (`masos`)

- **The flag:** `IS_MAC = api.platform === 'darwin'` near the top of `app.js`. `voice.js` has its own `MAC` from `window.recaller.platform`.
- **The `// ---- macOS` block** (before section 1). Each helper returns its input, or behaves exactly as before, on Windows:
  - `kb(label)` turns a Windows key label into Mac symbols in Apple's order: `kb('Ctrl+Shift+S')` → `⇧⌘S`, `kb('Ctrl+Enter')` → `⌘↩`, and `kb('Ctrl+Y')` → `⇧⌘Z` (a Mac redoes with ⇧⌘Z). It understands Ctrl (→ ⌘), Alt (→ ⌥) and Shift (→ ⇧) plus one key. It is used in the Welcome seed tips, the undo and redo titles, the New prompt, Resume draft and Dictate titles, and the composer's screenshot, save and mic titles. Seed tip 6 uses its own `IS_MAC ? '⌘' : 'Ctrl'` ("Hold ⌘ and click several notes").
  - `modKey(e)`, for the app's shortcuts: `e.metaKey && !e.ctrlKey` on a Mac, so ⌃K, ⌃F, ⌃N and ⌃M stay text-editing keys; `e.ctrlKey || e.metaKey` on Windows. Used by the global keydown handler and the composer's textarea.
  - `multiKey(e)`, for multi-select clicks: `e.metaKey` on a Mac, where Control+click is a right-click; `e.ctrlKey || e.metaKey` on Windows.
  - At startup, before anything is drawn: add `is-mac` to `<body>`, copy every `data-mac` attribute into its element's `textContent` and every `data-mac-title` into its `title`.
- **Draft flush:** the Mac-only `beforeunload` listener next to `persistSoon()` (see Shutdown).
- **Board:** the Control+click guard in `pointerdown`, `selectionAtPress` for right-clicks, and the focused-card key rule (all above).
- **Settings:**
  - `prettyAccel()` keeps the Windows expression (`CommandOrControl` → `Ctrl`, `+` → ` + `). **On a Mac** it calls `macAccel()`: symbols in ⌃⌥⇧⌘ order with no separators, then the key, so `'Control+Alt+R'` shows as `⌃⌥R`. Arrow names become ↑ ↓ ← →, Enter or Return becomes ↩, Esc becomes ⎋, and Plus becomes +.
  - The shortcut recorder saves Control as `'Control'` and ⌘ as `'Command'` on a Mac (Windows: `'CommandOrControl'` and `'Super'`), names punctuation from `e.code` (`MAC_CODE_KEYS`, because Option changes `e.key`), and asks for "Use at least one of ⌃, ⌥, ⇧ or ⌘".
  - The key status reads "Saved in your Mac’s keychain. Paste a new key to replace it." instead of "Saved and encrypted on this PC. …". As on Windows, it shows whenever the file holds a key object and some key is usable: a decryptable `{ enc }`, a `{ plain }` one, or one that can't be decrypted while `OPENAI_API_KEY` is set (the env key is then used under the "Saved" label). A key that can't be decrypted, with no `OPENAI_API_KEY`, shows "Needed for voice…", with Remove still offered.
- **Permission buttons:**
  - The composer's screenshot error with code `'PERMISSION'` gets an **Open System Settings** button (`api.openPrivacy('screen')`).
  - A global snip's `PERMISSION` result shows a 12-second toast with **Open Settings**.
  - A microphone `DENIED` error gets **Open System Settings** (`api.openPrivacy('microphone')`).
- **Menu commands (`api.onCommand`, registered only on a Mac):**
  - `'fullscreen-on'` / `'fullscreen-off'` toggle `body.is-fullscreen`.
  - `'settings'` opens Settings unless it is already open (repainting it would wipe what's being typed).
  - `'help'` opens Help.
  - `'undo'` / `'redo'`: in a text field, `document.execCommand(name)`, the field's own undo; with Settings, Help or the lightbox open, nothing; otherwise the board's `undo()` / `redo()`.
- **CSS** (the macOS block at the end of `styles.css`): `body.is-mac .topbar { padding-left: 84px }` (14px under `body.is-mac.is-fullscreen`), Mac font stacks on `body.is-mac` (Geist first, then `-apple-system`; Geist Mono first, then `ui-monospace`, "SF Mono", Menlo), and the system font for `kbd`, because none of the bundled fonts has ⌘ ⇧ ⌥ ⌃ ↩. Details in `05`.
- **Measured on the owner's Mac** (the features suite's `INFO` line): `env(titlebar-area-x)` is 92px, the top bar's padding-left 84px, `getWindowButtonPosition()` `{ x: 16, y: 16 }`, and the logo sits at x 84 with its centre at y 24. Nobody has reported on the real traffic lights yet.

## Accounts and sync (1.17.0)

A summary; the design is `15_accounts_and_sync.md`, and its section 0 lists where the code differs from it.

- **Local first.** The data file stays the source of truth. The engine never writes it: it reads the board only as main wrote it (`onLoadResult`, `onFileWritten`), and changes from the cloud reach the board only as patches the page applies and saves. Signed out, there is no `sync/` folder, no network, no timer and no quit delay.
- **Layers in main:** `cloud/index.js` (the facade: IPC, hooks, the engine's life) → `cloud/account.js` (sign-in and ID tokens, with `cloud/tokens.js`) and `sync/engine.js` (the loop) → `cloud/firestore.js` and `cloud/storage.js` → `cloud/http.js` → `net.fetch`. Everything below the facade gets its dependencies injected and runs under plain Node: the unit tests and the headless peer (`tests/support/peer.js`) use it without Electron.
- **One loop, one network task at a time.** Triggers only set what is wanted (pull, push, device record); `run()` does the work.
  - **Push:** about 2 s after a save that changed content (at most 10 s after the first), as one or more commits of at most 400 writes and 8 MiB. Each commit raises the account head's `rev` by exactly one under an `updateTime` precondition, so pushes are fast-forward only. Pictures upload before the commit that names them. Copy counts alone wait for blur, hide, the next content push, 10 minutes or quit.
  - **Pull:** reads the head, then the documents with `_sync.rev` in `(state.rev, head.rev]`, merges them with the file on disk against the shadow (the board as last synced), and sends the page a patch. The shadow advances only once the page's acknowledging save is on disk.
  - **When:** the head is polled every 60 s while focused, 5 min while visible but unfocused, 30 min while hidden. Summon, focus and show pull at once, but at most once per 10 s after the last head read (`pullSoon()`); resume, unlock, back online, page ready, Sync now and the account becoming signed in pull at once without that limit. Failures back off 5 s, 15 s, 1 min, 5 min, then every 15 min.
- **The page's side.** `persist()` sends `meta` with every save: the page load's `session`, a `seq`, `contentSeq` (raised by every content change, undo and redo included) and the undo labels since the last save (for the mass-delete guard). A patch based on an older `contentSeq`, or for another page load, is answered `stale` and merged again. A patch that changes content waits while anything holds the board (an editor, a drag or press, a menu, dictation, an Undo toast) and then clears the undo history. Counter-only patches apply at once. `window.RecallerUI = { toast, openSettings, relTime }` is what `account.js` uses from `app.js`.
- **Files on disk:** the `sync/` folder (`device.json`, `account.json`, `state.json`, `shadow.json`) and `recaller-data.unreadable-*.json` copies; see `03`.
- **Startup with a saved sign-in:** `cloud.init()` reads `sync/` with no network call; the engine starts the loop when the page says `sync:ready`. A sign-in in mid-session starts it then.
- **Pictures from another computer** arrive as thumbnails after each patch; the full size comes down on demand (lightbox, copy). `engine.completePictures()` fetches every missing full size the board shows before a plain sign-out (at most 20 s; what's left stays in the account) and before an account deletion (if one can't be saved, nothing is deleted). Where a full size is still missing, `images.js` shows and copies the thumbnail.

## `src/renderer/voice.js` (summary; full flow in `04`)

- **`Voice.start({ onLevel, onSegment, onAutoStop })`** opens the mic and records with `MediaRecorder` (`audio/webm;codecs=opus`, 48 kbps).
- **Segmentation:** a level meter samples the input every 50ms, and the recording is split into phrases at pauses. Each phrase is a standalone webm blob passed to `onSegment` in spoken order.
- **`stop()`** hands off the final phrase and resolves with how many phrases were sent.
- **`cancel()`** discards the recording.
- **`Voice.transcribe(audio, { context, onDelta, onReset })`** calls `window.recaller.transcribe`.
- **A blocked microphone** (`NotAllowedError` or `SecurityError`) throws code `DENIED`. Windows says "Microphone blocked. Allow it in Windows Settings › Privacy & security › Microphone." **On a Mac**: "Microphone blocked. In System Settings › Privacy & Security › Microphone, turn Recaller on (or off and on again after an update), then try again."

## `src/transcribe.js` (summary; full flow in `04`)

- **Streaming:** requests are streamed for `gpt-transcribe`, `gpt-4o-transcribe` and `gpt-4o-mini-transcribe`. Streaming parses server-sent events (`transcript.text.delta`, then `transcript.text.done`). `whisper-1` cannot stream.
- **Language:** for `gpt-transcribe` it is sent as `languages[]`, and as `language` for other models.
- **Prompt:** the prompt is the vocabulary hint plus the last 400 characters of what was already dictated.
- **Retries and fallbacks:**
  - One automatic retry for network, server and stream errors, after 600ms, preceded by `onReset`.
  - On a 400 error, one plain retry without the optional parameters.
  - If a streamed result comes back empty, one unstreamed request to confirm.
- **Timeout:** 90 seconds.
- **Error codes:** `NO_KEY`, `AUTH` (401), `RATE` (429), `BAD_REQUEST` (400), `SERVER` (5xx), `HTTP`, `NETWORK`, `TIMEOUT`, `STREAM`. The `stt:transcribe` handler returns `UNKNOWN` for any error without a code (for example a malformed JSON body on a 200 response).
- **Mock server:** the `RECALLER_OPENAI_BASE` env var replaces the whole API base, `/v1` included, because the code appends only `/audio/transcriptions`; an override must end in `/v1`. The tests use it to point at a local mock.
