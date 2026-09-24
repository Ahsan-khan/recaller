# 02: Architecture

## Stack

- **Electron 44.4.5**: Chromium plus Node 24, main process in CommonJS.
- **Packaging:** electron-builder 26.15.3, producing an NSIS one-click installer for Windows x64.
- **UI:** vanilla JavaScript, HTML and CSS in the renderer. No framework, bundler or build step for the UI; scripts load as classic `<script>` tags in order: `icons.js`, `voice.js`, `app.js`.
- **Dependencies:** none at runtime. Only `electron` and `electron-builder` are devDependencies. Fonts are copied `.woff2` files, not npm packages.
- **Speech-to-text:** the OpenAI API (`POST /v1/audio/transcriptions`), called only from the main process with Node's built-in `fetch`, `FormData` and `Blob`.

## Processes and windows

1. **Main process** (`src/main.js`): the app lifecycle, the one main window, the settings and data files, backups, the clipboard, global hotkeys, the image protocol, screenshots and transcription.
2. **Main window renderer** (`src/renderer/*`): the whole UI. Its preload is `src/preload.js`, which exposes `window.recaller`.
3. **Screenshot overlay window** (`src/overlay/*`): a temporary, frameless, always-on-top window covering one display while the user drags out a region. Its preload is `src/overlay/preload.js`, which exposes `window.shot`.

Both preloads run with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`.

## Source files and responsibilities

```
recaller/
  package.json            name "recaller", productName "Recaller", appId com.akhan.recaller, version, scripts, electron-builder config
  README.md               user-facing guide (install, usage table, shortcuts, voice, updating, data)
  build/icon.png          512×512 app icon (monstera leaf on an emerald rounded square), generated
  scripts/
    run-electron.js       launches Electron with ELECTRON_RUN_AS_NODE removed (used by npm start / test / icon)
    make-icon.js          renders build/icon.png from the SVG sprite in src/renderer/index.html
  src/
    main.js               app entry (see below)
    preload.js            window.recaller bridge (IPC wrappers)
    store.js              crash-safe JSON: atomic write (tmp + rename with retries), read with .bak fallback, backup copy
    transcribe.js         OpenAI transcription: form building, SSE streaming parser, retries and fallbacks, error codes
    images.js             image store in <userData>/images, recaller-img:// protocol, garbage collection
    screenshot.js         region snip: hide window, desktopCapturer, overlay window, crop, store
    backups.js            backup folders in <userData>/backups: create/list/prune/daily/readData/imageIds
    overlay/
      overlay.html        full-screen snip UI (captured screen as background, dim veil, selection box, size label, hint)
      overlay.js          pointer and key handling for selecting a region; sends done/cancel
      preload.js          window.shot = { image, ready, done, cancel }
    renderer/
      index.html          DOM shell: SVG sprite (monstera symbol and mask), top bar, stage with board, scroll arrows,
                          selection bar, toasts, lightbox dialog, settings dialog; CSP meta tag
      styles.css          all styling: tokens, themes, densities, title fonts, components (~1600 lines)
      icons.js            window.ICONS: inline SVG strings (stroke icons on a 24px grid)
      voice.js            window.Voice: mic capture, voice-activity segmentation, transcribe() wrapper
      app.js              the whole UI app (~3400 lines, one IIFE; see "Renderer design")
      fonts/              Geist, Geist Mono, Instrument Sans, Plus Jakarta Sans, Onest, Sora, Space Grotesk,
                          Manrope, Inter (woff2) plus OFL licence files
  tests/e2e/              end-to-end suites (see 06_build_test_release.md)
  ai_memory/              this handoff
```

### `src/main.js`, section by section

- **Top of file:**
  - Sets `userData` to `RECALLER_DATA_DIR` if that env var is set, otherwise pins it to `%APPDATA%\Recaller`.
  - Registers the `recaller-img` privileged scheme; this must happen before `app` is ready.
- **`THEMES`** holds the window-controls overlay colours per theme: deep `#082a1f` with symbols `#e7f7ee`, soft `#fbfdfc` with symbols `#0c2a1d`. The title bar overlay is 48px high.
- **`DEFAULT_SETTINGS`:**
  - `model: 'gpt-transcribe'`, `language: ''`, `hint: ''`
  - `hotkey: 'CommandOrControl+Alt+R'`, `shotHotkey: ''`
  - `hideAfterCopy: false`, `theme: 'deep'`
  - `apiKey: null`, `bounds: null`, `maximized: false`
  - `lastVersion` is written at runtime.
- **Settings:**
  - `loadSettings()` merges defaults with the stored file, keeping unknown keys, and writes a `.bak` copy.
  - `saveSettings()` writes atomically.
  - `getApiKey()` decrypts the stored key with `safeStorage` (Windows DPAPI); if none is stored, it falls back to the `OPENAI_API_KEY` env var.
  - `publicSettings()` is the only settings shape the renderer ever sees. It includes `hasKey`, `keySource` and the key's last 4 characters, but never the key itself.
- **Data:**
  - `loadData()` flushes any pending write first (unless a restore is in progress), reads with `.bak` fallback, and backs up a good file at session start.
  - Renderer saves arrive through `data:save`. They are debounced 250ms (`scheduleDataWrite`) and written atomically by `flushData`.
  - Flushes also happen on window close, `before-quit`, `window-all-closed` and Windows `session-end`.
- **The window:**
  - Default size 1280×820, minimum 480×400. Saved bounds are restored only if they are still on a visible display.
  - `titleBarStyle: 'hidden'` with a `titleBarOverlay`, so the native Windows controls sit on the app's top bar.
  - `show: false` until `ready-to-show`.
  - Bounds and maximised state are saved on move, resize and close.
- **Context menu:** spelling suggestions, "Add to dictionary", and cut/copy/paste/select all in editable fields.
- **DevTools:** F12 or Ctrl+Shift+I, but only when the app is not packaged.
- **`summon()` and `toggleWindow()`** show and focus the window, or minimise it if it is already focused.
- **`screenshotFromAnywhere()`** runs when the global screenshot hotkey fires. It captures, summons the window, and sends `shot:captured` to the page.
- **`applyHotkeys()`** registers `hotkey` (toggle the window) and `shotHotkey` (screenshot) with `globalShortcut`. It records whether each registration succeeded, and Settings shows that status.
- **`applyTheme()`** updates the window background and title-bar overlay colours when the theme changes.
- **Update protection:** `protectData()` runs at startup before the window opens.
  - If `settings.lastVersion` differs from `app.getVersion()`, it creates an `upgrade` backup and then records the new version.
  - It then creates a daily backup if the last one is more than 24 hours old.
- **`restoreBackup(id)`:**
  1. Flush pending data.
  2. Create a `before-restore` backup.
  3. Set `restoring = true`, so incoming saves are ignored.
  4. Write the backup's data file over the current one (atomically).
  5. Reload the page. The next `data:load` turns `restoring` off.

  Restore replaces notes only; settings are not restored.
- **`inOrder(write)`** chains all clipboard writes, which are async in Electron 44, so they finish in the order they were requested.
- **Lifecycle:**
  - A single-instance lock; a second launch focuses the existing window.
  - macOS gets a minimal menu; Windows and Linux get none.
  - The permission handler grants only `media` (microphone) and `clipboard-sanitized-write`.
  - Every web contents denies new windows (http(s) links open in the system browser) and blocks navigation.

## IPC contract

**Renderer → main (`window.recaller.*` in `preload.js`):**

| Preload function | Channel | Type | Payload → result |
| --- | --- | --- | --- |
| `loadData()` | `data:load` | invoke | → the parsed data object or `null` |
| `saveData(data)` | `data:save` | send | full data object; debounced write; ignored while restoring |
| `copy(text)` | `clipboard:write` | invoke | string → `true` (serialised) |
| `minimize()` | `window:minimize` | invoke | minimises the window |
| `getSettings()` | `settings:get` | invoke | → public settings object |
| `setSettings(patch)` | `settings:set` | invoke | patch keys: apiKey, model, language, hint, hotkey, shotHotkey, hideAfterCopy, theme → public settings |
| `openDataFolder()` | `app:open-data-folder` | invoke | opens `%APPDATA%\Recaller` in Explorer |
| `listBackups()` | `backups:list` | invoke | → `[{ id, kind, createdAt, appVersion, fromVersion?, toVersion?, projects, notes }]`, newest first |
| `createBackup()` | `backups:create` | invoke | flush, then a `manual` backup → id or `null` |
| `restoreBackup(id)` | `backups:restore` | invoke | → `{ ok }` or `{ ok: false, error }`; the page reloads on success |
| `saveImage(bytes)` | `image:save` | invoke | Uint8Array (PNG or JPEG) → `{ ok, image: { id, w, h } }` or `{ ok: false, error }` |
| `copyImage(id)` | `image:copy` | invoke | writes the PNG as `image/png` to the clipboard → `true`/`false` |
| `gcImages(keepIds)` | `images:gc` | invoke | deletes unreferenced image files older than 1 hour (backups are also treated as references) |
| `captureScreen()` | `shot:capture` | invoke | → `{ ok: true, image }`, `{ ok: false, code: 'CANCELLED' \| 'BUSY' \| 'FAILED', error? }` |
| `transcribe(bytes, mime, context, onEvent)` | `stt:transcribe` | invoke | `{ reqId, bytes, mime, context }` → `{ ok, text }` or `{ ok: false, code, error }` |

**Main → renderer:**

| Channel | Meaning |
| --- | --- |
| `stt:event` | `{ reqId, type: 'delta', delta }` or `{ reqId, type: 'reset' }` while a transcription request runs. The preload filters by `reqId` and calls `onEvent` |
| `app:summoned` | the global hotkey brought the window up; the page focuses search unless the user is busy |
| `shot:captured` | result of the global screenshot hotkey; the page attaches the image to the active or new composer |

**Overlay window.** Its IPC is scoped to the overlay's web contents with `webContents.ipc`:

| Channel | Meaning |
| --- | --- |
| `shot:image` | invoke → `{ bytes }`, the captured screen as JPEG quality 90, used as the background |
| `shot:ready` | the page has decoded the image; main then shows the overlay |
| `shot:done` | `{ x, y, w, h }` in CSS pixels, or `{ full: true }` |
| `shot:cancel` | the user cancelled |

## Security model

- **Renderer isolation:** context isolation and sandboxing, no Node access. Only the whitelisted `window.recaller` API is exposed.
- **CSP** (index.html): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: recaller-img:; media-src 'self' blob:; connect-src 'none'`. The page itself cannot make network requests; all network traffic goes through main.
- **Image protocol:** `recaller-img://img/<32 hex>.png` (full size) and `.../<id>.t.png` (thumbnail). The handler validates the id with a regex, so there is no path traversal. A missing thumbnail falls back to the full image.
- **API key:** encrypted at rest with `safeStorage` (DPAPI). It is stored as `{ enc: base64 }`, or `{ plain }` only if OS encryption is unavailable. It never reaches the renderer.
- **Permissions and navigation:** only the microphone and clipboard-write permissions are granted. Navigation and new windows are denied.

## Renderer design (`src/renderer/app.js`)

One IIFE, organised in commented sections, in this order:

1. utilities
2. data
3. undo/redo
4. search
5. views
6. note actions
7. project actions
8. composer
9. gestures
10. board scrolling
11. clicks and keys
12. menus
13. toasts
14. lightbox
15. search input
16. settings
17. global keys
18. boot

- **State:**
  - `data` is the persisted document (see `03`).
  - `ui` holds ephemeral state: `search`, `composing` (project id with the new-prompt composer open), `editing` (id of the note being edited), `lastProjectId`, `settings` (the public settings), `selection` (Ctrl+click ids in order) and `anchor` (the last plain-clicked note, used for Explorer-style selection).
- **Rendering: keyed reconciliation, no virtual DOM.**
  - `columns` (Map projectId → column view) and `cards` (Map noteId → card view) keep DOM nodes alive across renders.
  - `render()` rebuilds the order with `syncChildren(parent, nodes)`, which moves only the nodes that changed. This keeps focus, scroll, animations and open editors intact.
  - Each card view keeps a signature string (text, stage, search, expanded, copy count, images, highlight) and only rewrites its DOM when that changes.
  - The Combined note and the Final text are rendered per column with their own signatures (`augSig`, `finalSig`), which include the search key so matches get highlighted. Their Notes lists come from `partsHtml()`.
  - Column widths: `updateColumn()` sets `style.width` from `colWidth(id)` (reads `data.prefs.colWidths`), except for the column being resized. `render()` ends with `paintWidthReset()`, which enables or disables the top-bar ↔ button.
  - `render()` is skipped while a drag is active.
- **Persistence:** `persist()` sends the whole `data` object to main after every change. `persistSoon()` debounces draft typing by 400ms.
- **Undo/redo:**
  - Snapshot-based: `checkpoint(label)` stores `JSON.stringify(data.projects)` before every user-visible change. The stack holds at most 80.
  - `applySnapshot()` restores projects but carries over live UI and counter fields: drafts, draft images, collapsed and expanded flags, copy counts, last-copied time and the note `expanded` flag. So undo only rewinds what the user actually did.
  - Toasts carrying Undo are dismissed whenever a new checkpoint is made, so "Undo" always means the latest change.
- **Composer component:** `createComposer(options)` returns `{ root, focus, startVoice, toggleVoice, screenshot, addImage, value, images, isBusy, destroy }`. It is used for new prompts, editing a card, and the stage editors. It holds all voice, screenshot, paste and drop logic for its textarea.
- **Stage editors (1.6):** `editStage(projectId, list, partId?)` opens a composer for the Combined note (`list` `'used'`, placed in `.aug-wrap`) or the Final text (`'combined'`, placed in `.final-edit-host`). Without `partId` it edits the whole text and `saveStageEdit()` replaces the list with ONE note (only if the text or images changed). With `partId` it edits that note alone, and its trash button calls `deletePart()`. The open editor is `col.stageEditor = { list, partId, composer }`; `closeStageEditors()` runs before any other editor opens and on undo/redo. `isEditing()` reports whether any editor is open. `movePart(id, ±1)` reorders parts; `clearStage(id, list)` backs the Clear Combined / Clear Final menu items.
- **Gestures:** a custom pointer-event engine, not HTML5 drag-and-drop.
  - `trackPointer(e, { onMove, onEnd })` listens on `window`. It cancels if a move arrives with no buttons pressed, or if the window loses focus.
  - Card gesture: a press shorter than 240ms without moving copies. Moving 7px or more to the left (mostly horizontally) swipes. Any other movement, or holding for 240ms, drags. A long press that never moved still counts as a click.
  - The Combined note has its own gesture (`startAugGesture`): click copies, swipe left moves it down, dragging it onto Final moves it down.
  - Column resize (`startColumnResize`): a pointerdown on `.col-resize` (checked before any other card or header gesture) drags the width, snapping to the default within 6px. It sets `resizing` and `dragActive` so re-renders don't fight it, and on release saves through `setColWidth()`. Double-click (board `dblclick`) calls `resetColumnWidth()`; the top-bar button calls `resetColumnWidths()`, whose toast Undo restores the previous `prefs.colWidths` object. `remeasure(cols)` re-checks "Show more"/"Show all" after width or density changes.
  - Columns can be dragged by their header to reorder them.
  - Dragging uses a fixed-position ghost clone, a placeholder, FLIP animations (`flip()`), and auto-scroll near the edges of the board and columns.
- **Startup sequence (`init`):**
  1. `loadData()`, then `normalize()` it, or build the seed "Welcome" project if nothing loaded.
  2. Persist only if there was no file, or the file predates `DATA_VERSION`.
  3. Restore `lastProjectId`.
  4. `getSettings()` and apply the theme.
  5. `render()`, then restore scroll positions (not tied to an animation frame).
  6. Mark the page ready (it fades in), then clean up unreferenced images (`gcImages`).
- **Shutdown:**
  - On `beforeunload`, the renderer saves scroll positions if the user scrolled.
  - Main flushes on close, quit and session end.
  - Every other change was already sent immediately, so at most the last 250ms of writes are pending, and they are flushed on quit.

## `src/renderer/voice.js` (summary; full flow in `04`)

- **`Voice.start({ onLevel, onSegment, onAutoStop })`** opens the mic and records with `MediaRecorder` (`audio/webm;codecs=opus`, 48 kbps).
- **Segmentation:** a level meter samples the input every 50ms, and the recording is split into phrases at pauses. Each phrase is a standalone webm blob passed to `onSegment` in spoken order.
- **`stop()`** hands off the final phrase and resolves with how many phrases were sent.
- **`cancel()`** discards the recording.
- **`Voice.transcribe(audio, { context, onDelta, onReset })`** calls `window.recaller.transcribe`.

## `src/transcribe.js` (summary; full flow in `04`)

- **Streaming:** requests are streamed for `gpt-transcribe`, `gpt-4o-transcribe` and `gpt-4o-mini-transcribe`. Streaming parses server-sent events (`transcript.text.delta`, then `transcript.text.done`). `whisper-1` cannot stream.
- **Language:** for `gpt-transcribe` it is sent as `languages[]`, and as `language` for other models.
- **Prompt:** the prompt is the vocabulary hint plus the last 400 characters of what was already dictated.
- **Retries and fallbacks:**
  - One automatic retry for network, server and stream errors, after 600ms, preceded by `onReset`.
  - On a 400 error, one plain retry without the optional parameters.
  - If a streamed result comes back empty, one unstreamed request to confirm.
- **Timeout:** 90 seconds.
- **Error codes:** `NO_KEY`, `AUTH` (401), `RATE` (429), `BAD_REQUEST` (400), `SERVER` (5xx), `HTTP`, `NETWORK`, `TIMEOUT`, `STREAM`.
- **Mock server:** the `RECALLER_OPENAI_BASE` env var overrides the API base URL. The tests use it to point at a local mock.
