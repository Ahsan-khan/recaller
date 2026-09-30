# 12: Development recipes (how to make common changes safely)

Function and variable names below are real; search for them in the files. Line numbers drift, names don't.

The recipes apply to both platforms unless marked **On a Mac** or **On Windows**. The Windows app is 1.16.0 on `main` and `v1`; the Mac edition of 1.16.0 is on branch `masos`, committed and pushed as "mac build" (`16961eb` + `9536853`, 2026-09-29) and not merged into `main`. Every Mac difference must stay fenced so Windows behaves exactly as before (see "Add a Mac-only behaviour"). Before any Mac work, read `14_macos.md`, which describes the whole Mac edition.

## Before any change

- Check the branch: Mac work happens on `masos`. Leave `main` and `v1` alone; they are the Windows app. The owner commits and pushes themselves. Leave `stash@{0}` (the discarded 1.17.0 Mac attempt, never used) alone unless the owner asks.
- Run from source against a **throwaway data folder**, never the owner's:
  - **On Windows** (PowerShell): `$env:RECALLER_DATA_DIR = "$env:TEMP\recaller-dev"; npm start`
  - **On a Mac** (zsh): `RECALLER_DATA_DIR="$TMPDIR/recaller-dev" npm start` (details in the next recipe). The PowerShell form sets nothing in zsh.
  - `npm start` without it uses the real data folder: `%APPDATA%\Recaller` on Windows, `~/Library/Application Support/Recaller` on a Mac.
  - If the installed Recaller is running and both use the same data folder, the single-instance lock hands focus to the installed app and the dev copy quits.
- DevTools, in a dev run only (disabled when packaged): F12 or Control+Shift+I; **on a Mac** also ⌘⌥I (F12 needs fn on a Mac keyboard). The Mac menu bar has no View or Developer menu.
- After editing JavaScript: `node --check <file>`.

## Run from source on a Mac

1. In `/Users/ahsan/Documents/GitHub/recaller` on branch `masos`, run `npm install` if `node_modules` is missing.
2. Start it on a scratch folder: `RECALLER_DATA_DIR="$TMPDIR/recaller-dev" npm start`.
   - zsh needs `NAME=value` with no spaces around `=`.
   - Use an absolute path: the value is `path.resolve()`d against Electron's working directory, which `scripts/run-electron.js` sets to the repo root. `$TMPDIR` is the per-user temporary folder under `/var/folders/`.
   - The npm scripts remove `ELECTRON_RUN_AS_NODE`, which the owner's VS Code terminal sets to 1. To call Electron directly, use `env -u ELECTRON_RUN_AS_NODE npx electron .`.
3. What you'll see:
   - a real, focused window on the owner's screen, showing the Welcome board (the scratch folder starts empty);
   - `build/icon-mac.png` in the Dock, if that file exists (`npm run icon:mac` makes it);
   - a menu bar headed "Electron", because macOS names the first menu after the running bundle. The packaged app says Recaller.
4. The run registers the global show/hide hotkey ⌃⌥R (the Mac default) unless the scratch settings say otherwise. If another app already holds it (for example the installed Recaller, while it runs), Settings says "Taken by another app — try another combo".
5. Quit with ⌘Q. The red button and ⌘W only hide the window; the Dock icon or ⌃⌥R brings it back.
6. Without `RECALLER_DATA_DIR` the run would use `~/Library/Application Support/Recaller`, the folder the installed Mac app uses (it holds the owner's real Mac notes since their first run, late on 2026-09-29; while the installed app runs, the single-instance lock hands the dev copy's launch to it). At startup it writes there:
   - a `recaller-settings.json.bak` and a `recaller-data.json.bak` copy;
   - an `upgrade` backup (only when a data file exists) and a settings rewrite, when `lastVersion` isn't 1.16.0;
   - a daily backup when one is due, pruning the oldest of that kind;
   - and it deletes unreferenced image files older than 1 hour.

   After that it rewrites settings on every move, resize and close, and data on every change. Don't do it without the owner's OK.
7. Don't dictate or snip in a source run unless the owner asks: that would bring up macOS's real microphone or Screen Recording prompts, on behalf of the development Electron or the terminal that started it. Neither has been tried.
8. To stop a stuck development or test Electron, kill it by its full path, `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, so no other Electron-based app is hit.
9. Don't run `npm run icon` (without `:mac`) on the Mac unless you mean to: it rewrites the tracked Windows icon, `build/icon.png`.

## Add an app setting stored by main (like the model, hotkeys or theme)

1. `src/main.js`: add a default to `DEFAULT_SETTINGS`. Existing users get the default only because the key is missing, so their other values stay intact. If the default must differ on a Mac, write `IS_MAC ? … : …`, as `hotkey` does; the same only-when-missing rule applies.
2. `src/main.js`: expose it in `publicSettings()`, and accept it in the `settings:set` handler. String keys are in the `for (const key of [...])` list (they are trimmed); add booleans and enums like `hideAfterCopy` and `theme`. Check an enum with `Object.hasOwn(…)`: the theme check's `patch.theme in THEMES` also accepts inherited names such as `'constructor'`. `settings:set` always rewrites the file, and re-registers hotkeys only when `hotkey` or `shotHotkey` is in the patch.
3. `src/renderer/index.html`: add the field inside `#settings-form`, following the existing `.field` / `.field-grid` / `.segmented` / `.switch` patterns. The form is a `<form method="dialog">`, so every new button needs `type="button"`; an untyped button submits the form and closes Settings. (Pressing Enter in the API key, Language or Vocabulary inputs also closes Settings; that is current behaviour.)
4. `src/renderer/app.js`, "settings" section:
   - add the element to the `f` object;
   - paint it in `paintSettings(s)`;
   - on change, call `saveSetting({ key: value })`.
5. Document it in the root `README.md` and in `ai_memory/03` and `04`.

## Add a UI preference stored in the data file (like density, title font, separator or column widths)

1. Read it as `data.prefs.<name>` with a fallback where it is used; don't write the default. `normalize()` already keeps unknown `prefs` keys.
2. Add a control in Settings (buttons with `type="button"`, as above), then paint it in `paintDensity()`. The joiner and title-font controls are the examples to copy.
3. On click: set `data.prefs.<name>`, then `persist()`, then `render()`.
4. If it changes a class on `<body>`, do that in `render()` (see `density-*` and `title-*`).
5. Keep it out of `data.projects` if undo shouldn't rewind it (see how `prefs.colWidths` works: `colWidth()`, `setColWidth()`, `resetColumnWidths()`).

## Add a new action on a prompt card

1. `createCard()`: add a `<button class="card-act act-yourthing" title="…">` inside `.card-actions`, and keep a reference in the returned view if it is needed.
2. `updateCard()`: set its icon, title and visibility if they depend on state. Add any new state to the `sig` string so the card re-renders.
3. The board `click` listener ("clicks & keys on the board"): `if (e.target.closest('.act-yourthing') && wrap) return yourAction(wrap.dataset.id);`
4. Optional keyboard key: the board `keydown` handler for a focused `.card`. **On a Mac** that handler returns early whenever ⌘, ⌃ or ⌥ is held (so they reach the menus; only ⌘⌫ deletes), so give a new key no modifier, or add it to the Mac branch on purpose.
5. `yourAction(id)`: `const loc = locate(id)`, then `checkpoint('Label')` BEFORE changing anything, then mutate, then `persist()`, then `render()`. Show a toast with Undo if the change is visible: `toast('Done', { action: 'Undo', onAction: undo, history: true })`.
6. Buttons inside cards are skipped by the card gesture engine (its `closest('button, …')` check), so they won't trigger copy or drag.
7. A title that names a shortcut goes through `kb()` (see "Label a shortcut on both platforms").

## Add an action on the Cooked note or the Served text

- **Markup:** in `createColumn()`, in the `section.used` (Cooked) or `section.final` (Served) template. Keep a reference in the column view object.
- **Rendering:** in `updateColumn()`, in the "Cooked" and "Served" blocks. If a new state affects the markup, add it to `augSig` or `finalSig`.
- **Notes-list row buttons:** add them in `partsHtml()` (shared by both stages) and handle them in the board `click` listener's `.final-part` branch. It already routes:
  - `.fp-up` / `.fp-down` → `movePart()`, which finds the list itself with `locate(id)`;
  - `.fp-edit` and `.fp-del` (delete, 1.15), which tell the stages apart with `part.closest('.aug-parts')`;
  - the send-back buttons, by class: `.ap-back` (Cooked → prompts, `moveBetween(id, 'notes')`) is checked before `.fp-back` (Served → Cooked, `sendBackFromFinal(id)`), because the Cooked button carries both classes. Keep that order.

  Each button costs 22px of the row's text room on hover; with five, a slim-width row keeps ~60px (the features suite checks at least 40px), so a sixth button needs a smaller size or a menu. The Cooked rows sit inside `.aug-note`: a press on a row's text (not a button) starts the whole Cooked note's gesture (a click copies all of Cooked, a left swipe or drag moves the whole note), so any new row interaction must stop that gesture.
- **Clicks:** the board `click` listener also handles `.aug-move`, `.aug-edit`, `.final-edit`, `.aug-parts-btn`, `.final-parts-btn`, `.aug-more`, `.final-more` and clicks on `.final-text` (copy).
- **Editing:** reuse `editStage(projectId, list, partId?)`; don't create another composer host.
- **Remember:** data `used` is Cooked and `combined` is Served (`STAGE_NAME` maps them). `augmentedText(project)` gives the Cooked text and `finalText(project)` the Served text; `stageText(project, list)` picks one by list. All three join with `joiner()`.

## Add or change a data field

1. Only ever *add* fields; never remove, rename or reinterpret existing ones.
2. **Normalising:** in `normalize()`, add a clean-up only if the field is dangerous when malformed. Otherwise the spread (`...n`, `...p`) already keeps it. Give it a default when you read it. Remember what `normalize()` already drops and fills in (`03`, invariant 2): a new field must survive it.
3. **UI-only fields** that undo shouldn't rewind (flags, counters) must be carried over in `applySnapshot()`.
4. **Fields that hold images** must be added to `referencedImageIds()` in `app.js` and to `imageIds()` in `src/backups.js`, or image cleanup will delete their files.
5. **Tests:**
   - `tests/e2e/update-safety.e2e.js` compares the saved file with the original. If the new field is added on every save (as `combined: []` was), allow exactly that addition, and nothing more.
   - The test must still see the file untouched right after launch.
6. **Version:** bump `DATA_VERSION` only for a real format change. Any migration must be lossless, run once, and rely on the automatic upgrade backup.
7. **Both platforms** read and write the same file, so a field must mean the same thing on Windows and on a Mac. Never store a path, a key name or anything else platform-specific in the data file.

## Make a change undoable

- **Simple changes:** call `checkpoint('Human label')` right before mutating `data.projects`.
- **Changes whose outcome is only known later** (drags): take `const before = snapshot()` first, then call `pushHistory(label, before)` only if something actually changed.
- **Toasts:** use `history: true` so they are dismissed when a newer change is made.
- **Excluded:** copies, collapsing and expanding, drafts and settings are deliberately not undoable.

## Add a main-process capability (a new IPC call)

1. `src/main.js` `registerIpc()`: `ipcMain.handle('area:verb', (e, arg) => …)`. Validate every input, because the renderer is untrusted.
2. `src/preload.js`: expose `yourFn: (arg) => ipcRenderer.invoke('area:verb', arg)`.
3. Call it from `app.js` as `api.yourFn(…)`.
4. Add the row to the IPC table in `ai_memory/02_architecture.md`.
5. Network calls belong in main only; the page's CSP blocks them.
6. **Mac only?** Register the handler inside `if (IS_MAC)`, as `app:open-privacy` is, and call the preload function only from Mac-gated code. The preload function itself may be unconditional (`openPrivacy`, `onCommand`). Allow-list string arguments with `Object.hasOwn`, as `PRIVACY_PANES` does.

## Add a Mac-only behaviour

The rule: one codebase, two downloads, and Windows behaves exactly as in 1.16.0. So every Mac difference goes behind a fence.

1. **Pick the fence for the layer:**
   - **Main process** (`src/main.js`, `src/screenshot.js`): `const IS_MAC = process.platform === 'darwin';`, then `if (IS_MAC) …`, or spread window options with `...(IS_MAC ? { … } : {})`. Keep the Windows expression as the untouched other branch, for example `IS_MAC ? app.hide() : win?.minimize()`.
   - **Mac-only Electron modules:** load them only on a Mac. `screenshot.js` requires `systemPreferences` only when `IS_MAC`, because (per its comment) loading it on Windows sets up a hidden window.
   - **Menu → page:** add an item in `macMenu()`. Use `command('name')` to bring the window up and send `app:command`, or `edit('name')` to send only while the window is visible. Handle the name in the page's `api.onCommand` block. Use `sendWhenLoaded()` for anything sent right after a window may have been created, and `showForCommand()` rather than `summon()` (whose `app:summoned` moves focus to search).
   - **Renderer** (`app.js`): `IS_MAC` comes from `api.platform`; wrap Mac code in `if (IS_MAC)`. A helper may exist on both platforms, but on Windows it must return its input or behave exactly as before (`kb()`, `modKey()`, `multiKey()`, `prettyAccel()`).
   - **CSS:** `body.is-mac …` rules (and `body.is-mac.is-fullscreen`), only in the macOS block at the end of `styles.css`. Nothing above that block changes.
   - **HTML:** Mac text as `data-mac` / `data-mac-title` attributes (see "Label a shortcut on both platforms").
   - **Build:** the `mac` and `dmg` sections of `package.json` and new npm scripts. Never change `dist`, `pack`, `icon`, the `win` / `nsis` sections, `productName`, `appId` or the data path.
   - **Tests:** Mac-only checks inside the `if (IS_MAC)` block of `features.e2e.js` (see "Add end-to-end checks").
   - The four older darwin checks from 1.5.0 (`titleBarOverlay`, `applyTheme()`, the menu branch, `window-all-closed`) test `process.platform` directly. Leave them as they are.
2. **Keep the diff small.** Don't refactor, reformat or rename existing code, and don't fix unrelated bugs in the same change: every extra hunk is one more thing to prove harmless on Windows. Keep the file's style (2-space indent, single quotes, semicolons, LF line endings).
3. **Prove Windows is unchanged:**
   - Read `git diff main -- src scripts package.json tests` hunk by hunk. Every changed line must either sit inside a Mac fence or evaluate exactly as before when `IS_MAC` is false: the same strings byte for byte, the same handlers, timing and files written. Wrap a Windows string with `kb()` instead of retyping it.
   - `node --check` every changed file.
   - Run the Mac suites ("Test on a Mac"): they exercise all the shared code.
   - For main-process changes, a side-by-side run helps. In the seventh session a pure-Node script loaded the 1.16 and the `masos` `main.js`, `preload.js` and `screenshot.js` against a mocked `electron` module with `process.platform` set to `'win32'`, and drove both through startup, hotkeys, minimise, the DevTools keys, the global snip, the flushes, `activate` and quit. The two logs matched apart from stack-trace paths. That script lived in the session's scratch folder and is not in the repo; rebuild it if you need it.
   - On the PC, `npm test` must still give 12 + 21 + 134. As of 2026-09-29 the `masos` code has not been run on Windows at all; do this before any merge into `main`.
   - A Windows installer can be built on the Mac with `npm run dist:win` (x64 pinned), but it can't be run there.
4. **Document it:** the Mac parts of `02`, the flow in `04` (marked "On a Mac"), and the IPC table if you added a channel.

## Show a floating control only when the pointer comes near (like the 1.16 board arrows)

1. Keep the element in the DOM; CSS hides it with `opacity: 0; pointer-events: none` and shows it under a state class (`.is-near`) and `:focus-visible`, so keyboard users can still reach it.
2. In `app.js`, listen for `pointermove` on the containing area (for the arrows, `.stage`), work out the zone from its `getBoundingClientRect()`, and toggle the class only when the zone changes (`setPanNear()`); clear it on `pointerleave`.
3. Hide it during gestures with `body.is-dragging` / `body.is-panning` rules.
4. Animate with the separate `translate` / `scale` properties, not `transform`, if hover also scales it (`07` #59).
5. In tests, check the class and computed `pointer-events` after a `mouseMove`, not `opacity` (`07` #61).

## Add a keyboard shortcut

- **Global in-app shortcuts:** the `document.addEventListener('keydown', …)` in the "global keys" section. Test the modifier with `modKey(e)`: Ctrl (or Meta) on Windows, ⌘ **on a Mac**, where ⌃ keys stay text-editing keys. Use `isTyping(e.target)` to avoid stealing keys from text fields; today only Z and Y check it, so K, F, N, M, S and `,` are caught even while typing.
- **Composer shortcuts:** in `createComposer()`'s textarea `keydown`, also with `modKey(e)`. Call `stopPropagation()` so the global handler doesn't also fire.
- **Multi-select clicks:** `multiKey(e)`, never `e.ctrlKey`: Control+click is a right-click on a Mac.
- **OS-wide shortcuts:** add a setting and register it in `applyHotkeys()` in `main.js`. A Mac default must name Control outright (`'Control+…'`), because `CommandOrControl` means ⌘ there.
- **On a Mac, check the menu bar first.** `macMenu()` owns ⌘, (Settings…), ⌘Z and ⇧⌘Z (Undo and Redo, routed back to the page as `app:command`), ⌘W (Close Window, which hides), ⌘H, ⌥⌘H and ⌘Q (roles), and the Edit roles (cut, copy, paste, paste and match style, select all). Window › Minimize deliberately has no ⌘M, because ⌘M is Dictate. A new ⌘ shortcut must not clash with these. A menu item that should act in the page sends `app:command`, and the page's `api.onCommand` handles it.
- **Labels:** see the next recipe.
- **Documentation:** update the table in `04` §20, the Help list in `index.html` (with its Mac label) and the root README.

## Label a shortcut on both platforms

Windows labels stay exactly as they were; a Mac gets Apple's symbols (⌃ Control, ⌥ Option, ⇧ Shift, ⌘ Command, ↩ Return).

- **Text built in JavaScript:** write the Windows label and wrap it in `kb()`, for example `` `Save (${kb('Ctrl+Enter')})` ``.
  - On Windows `kb()` returns the label unchanged.
  - On a Mac it writes the modifiers in Apple's order, then the key: `kb('Ctrl+Shift+S')` → `⇧⌘S`, `kb('Ctrl+Enter')` → `⌘↩`, `kb('Ctrl+,')` → `⌘,`. `kb('Ctrl+Y')` gives `⇧⌘Z`, because a Mac redoes with ⇧⌘Z.
  - It only understands Ctrl, Alt and Shift plus one key. Anything else (F1, Esc, "Hold Ctrl") needs its own `IS_MAC ? … : …`, as Welcome tip 6 does.
- **Text in `index.html`:** keep the Windows text as the element's content or `title`, and add `data-mac="…"` (replaces the text on a Mac) or `data-mac-title="…"` (replaces the tooltip).
  - `app.js` applies them once at startup, before the first render.
  - `data-mac` replaces `textContent`, so put it on an element that holds only text (a `kbd` or a `span`); any child elements would be lost. The "Minimize Recaller after copying" switch shows the pattern: its text is its own `span`, so only that text becomes "Hide Recaller after copying".
  - Text the page rewrites later (for example `#help-hotkey`, filled in by `openHelp()`) needs its Mac form in that code as well.
- **Global hotkeys** are stored as Electron accelerators and shown with `prettyAccel()`. On Windows it gives "Ctrl + Alt + R"; on a Mac `macAccel()` gives symbols in ⌃⌥⇧⌘ order with no separators ("⌃⌥R"). Help's row removes the " + " separators.
- **Mac menu shortcuts** are the `accelerator` strings in `macMenu()` (`'Command+,'`, `'Shift+Command+Z'`); macOS draws the symbols itself.
- **The Mac test:** the features suite's check "Mac: key names use ⌘" requires every Help `kbd` except `#help-hotkey` to contain ⌘ or to be `?`. A new Help row without a `data-mac` label fails it.
- **Fonts:** none of the bundled fonts has ⌘ ⇧ ⌥ ⌃ ↩. On a Mac `kbd` uses the system font (`body.is-mac kbd`), and other text falls back to it through the Mac font stacks.

## Change colours, add a palette colour or a highlight colour

- **Theme tokens:** the `:root` block and `body.theme-deep` in `styles.css`.
- **Title-bar colours:** `THEMES` in `main.js`. Keep them identical to `--topbar`. On Windows they colour the window-controls overlay. **On a Mac** only `color` is used, as the window background; the traffic lights keep their system colours.
- **Cooked palette (Settings › Cooked colour):** add a `body.cooked-x, .co-x { --aug-bar; --aug-bar-hover; --aug-ink; --aug-bg; --aug-edge; --aug-card; --aug-card-edge }` block in `styles.css` (next to the others), add `'x'` to `COOKED_COLORS` in `app.js`, and add a tile `<button type="button" class="cooked-opt co-x" data-value="x" role="radio"><span class="co-band">COOKED</span><small>Name</small></button>` inside `#set-cooked` in `index.html`. The picker is a 4-column grid. To change the default, edit `cookedColor()`'s fallback, the `cooked-…` class on `<body>` in `index.html`, and the `:root` `--aug-*` fallback values. Update the picker check in `features.e2e.js` (option count, default). Keep palettes light; never brown or violet (see `05`).
- **Project palette:** `PALETTE` in `app.js`. **Never change existing ids;** users' files store them. Append new entries at the end. The array order is the order new projects take. The ⋯ menu grid (`.menu-swatches`) sets only 9 columns of 19px, so extra swatches flow into new rows by themselves (18 colours make 2 rows), and `.menu` has no max-height.
- **Highlight colours:** `HIGHLIGHTS` in `app.js` (id, name, color, bg). The ids are stored in notes, so never rename them.
- **Stage colours:** the `--aug-*` tokens and the `.final` rules.
- **Board frame (1.16):** `--frame-edge` (a gradient), `--frame-glow` and `--frame-hi` in `:root` (Soft) and `body.theme-deep`. The geometry (margin, radius) is on `.stage`. If a rule changes `.stage`'s `background`, keep `var(--frame-edge) border-box` as its last layer and the other layers `padding-box`, or the edge disappears.
- **Judge colours at both scales:** the PC renders at 1×, the Mac at 2× (Retina draws 1.5px borders at full weight).

## Add a column-title font

1. Copy the Latin `.woff2` (for example from an `@fontsource-variable` package via `npm pack`) into `src/renderer/fonts/`, with its licence.
2. `styles.css`: add an `@font-face` (with a `unicode-range`), plus a `body.title-x, .t-x { --title-font…; --title-size…; --title-weight…; --title-track…; --title-case… }` rule.
3. `app.js`: add `x` to `TITLE_FONTS`. To make it the default, change `DEFAULT_TITLE_FONT` in `app.js`, the `:root, body.title-x, .t-x` rule in `styles.css`, and the `title-…` class on `<body>` in `index.html`. Users who picked a font keep theirs; only users without `prefs.titleFont` see the new default.
4. `index.html`: add a tile `<button type="button" class="title-opt t-x" data-value="x" role="radio"><span>Wildfire RL</span><small>Name</small></button>` (the picker is a 3-column grid; keep the count a multiple of 3). Keep `type="button"`: the tiles sit inside Settings' `<form method="dialog">`, and an untyped button would apply the font and also close Settings.
5. Compare visually before making it the default. For quick side-by-side comparisons of many candidates, render a standalone HTML page of mock headers in a window that never appears, and call `capturePage()`.
   - On Windows an *offscreen-rendering* window works: `new BrowserWindow({ show: false, webPreferences: { offscreen: true } })`.
   - **On a Mac**, `make-icon.js` got an empty frame from an offscreen window's `paint` event, so `renderMac()` uses a plain hidden window (`show: false`, `enableLargerThanScreen: true`) with `capturePage()` instead, and resizes the result, since a Retina capture can come back at 2×. Copy that if offscreen output comes back blank.
   - Mind the scale: `force-device-scale-factor` 1 matches the PC's 100% ultrawide but not the Mac's 2× Retina (1512×982 pt).
   - Then confirm in the app with `npm run capture`, which renders at 1×; **on a Mac** `SCALE=2 npm run capture` renders at 2×, as the owner sees it there.

## Change voice behaviour

- **Segmentation constants:** the named ones (`PAUSE_MS`, `MIN_SEGMENT_MS`, `MIN_SPEECH_MS`, `MIN_FINAL_SPEECH_MS`, `MIN_FIRST_MS`, `SOFT_MAX_MS`, `HARD_MAX_MS`, `MIN_SPEECH_LEVEL`, `MIN_SILENCE_LEVEL`, `TICK_MS`, `MAX_MS`) are at the top of `src/renderer/voice.js`. Others are inline:
  - in `startMeter()`: the ×7 level gain, the noise floor's start (0.02), cap (0.2) and creep (×1.003 + 0.00002), the threshold formulas (floor × 2.5 + 0.012 for speech, floor × 1.6 + 0.006 for silence) and the 150ms dip that cuts a long phrase;
  - in `openSegment()`: the 48 kbps bitrate and the 500ms recorder timeslice.
- **The fake microphone:** `speechWav()` in `features.e2e.js` plays 0.4s of silence, 1.8s of voice, a 1.1s pause, 1.8s of voice and 1.4s of silence, looping. The first cut lands about 2.9s in, and the suite waits up to about 4.7s for "Phrase one" while recording. So `PAUSE_MS` must stay below the WAV's 1.1s gap and `MIN_SEGMENT_MS` below about 2.9s, or the WAV must change with them. **On a Mac** the suite also disables Chromium's `AudioServiceSandbox`, without which the fake mic can't read the WAV.
- **Request shape, streaming, retries:** `src/transcribe.js`. The mock server in `features.e2e.js` imitates the API, so update it if the request or response format changes.
- **Insertion and editing while dictating:** `transcribeInto()`, `followUserEdit()` and `settle()` inside `createComposer()`.
- **Error texts:** `voice.js` throws `DENIED` for a blocked microphone with a Windows text, and **on a Mac** a System Settings text; on a Mac the composer adds an Open System Settings button (`api.openPrivacy('microphone')`).
- **Re-run the features suite after any change**, with the owner's OK (see "Add end-to-end checks").

## Add end-to-end checks

- **Where:** `tests/e2e/features.e2e.js`.
- **Helpers:**
  - `js(code)` runs code in the page;
  - `rect(selector, i)` gives an element's box with its centre;
  - `click(x, y)` and `clickSel(selector)`;
  - `mouse(type, x, y, extra)` and `drag(x0, y0, x1, y1, steps)` for gestures;
  - `key(code, modifiers)` and `type(text)` for keyboard input;
  - `texts(selector)`, `colTexts(projectId)`, `augOf(projectId)` and `composerValue()` read the page;
  - `shot(name)` takes a screenshot;
  - `check(name, ok, detail)` records a result;
  - from `mac-harness.js`: `IS_MAC`, and `MOD`, the app's modifier (`'control'` on Windows, `'meta'` on a Mac). Send `[MOD]`, never `['control']`, for the app's shortcuts and multi-select clicks. Send the real `'control'` only to test Control itself, as the Mac Control+click check does.
- **Mock server:** `mockMode = 'fail500'` forces 503s; `received[]` holds the requests.
- **Seed data:** projects `p1`, `p2`, `p3` and `px0`–`px3`.
- **Workspace:** the stages tests use the "Writing" column (`px1`) and scroll it into view first.
- **Platform-specific checks:**
  - Mac-only checks go in the `if (IS_MAC)` block that sits just before the real-snip step. Each one must put back what it changes, and the page-reload check stays last in that block.
  - The real screen snip (3 checks) runs only on Windows; on a Mac the suite prints a `SKIP` line instead.
  - A check added outside those blocks raises both counts: Windows 134 → 135 and Mac 139 → 140. Update `06` and `tests/e2e/README.md`, which quote them.
- **Before running:** `node --check`, then `npm run test:features`, with the owner's OK:
  - every run overwrites their clipboard, on both platforms;
  - **on Windows** the suite ends with a real snip of their screen (its images are deleted when the run finishes normally), and a 200px sliver of the test window stays on screen;
  - **on a Mac** the harness keeps the run out of sight (next recipe).
- **Read the result from the log:** run it in the background and grep for the `n/n passed` line. `scripts/run-electron.js` exits with `code ?? 0`, so an Electron that crashed or was killed looks like success to npm.

## Test on a Mac

The same npm scripts work on a Mac. `tests/e2e/mac-harness.js` keeps a run out of the owner's way there, and does nothing on Windows.

1. **Ask the owner first.** They agreed to the Mac-safe runs on 2026-09-29 ("Yes, run them"). Every run still overwrites their clipboard.
2. `node --check` every suite you changed.
3. Run in the background and grep the log for `passed`: `npm run test:multicopy`, `npm run test:update`, `npm run test:features`, or `npm test` for all three (multi-copy, then update-safety, then features).
4. **Expected** (2026-09-29, on source and against the packaged `app.asar` alike): multi-copy 12/12, update-safety 21/21, features 139/139. Features also prints `SKIP  real screen snip (3 checks)` and an `INFO` line with the title-bar measurements. The packaged run's log is `tests/e2e/.out/mac-pkg-all.log`. On Windows the suites count 12 + 21 + 134; they last ran there on 1.16.0 in the fifth session, and not yet on the `masos` code.
5. **What the harness does on a Mac** (all four scripts call `quiet()` before `require(APP_MAIN)` and place windows with `macRect()`):
   - no Dock icon (`app.dock.hide()`);
   - each test window sits past the outer left or right edge of all displays, on the side away from the cursor, at the top of the display that forms that edge, with a 2px sliver left on screen. macOS stops drawing a window that is wholly off screen, and `capturePage` and animations stop with it. With several displays the sliver still lands on a screen: checked with simulated screens, but the suites have only run on the built-in one;
   - the windows ignore the real mouse (`setIgnoreMouseEvents(true)`); `sendInputEvent` still reaches them;
   - no native menu, System Settings or Finder window opens: `Menu.prototype.popup`, `shell.openExternal` and `shell.openPath` are stubbed;
   - the app can't take focus or hide itself: `app.focus` and `app.show` do nothing, and `app.hide` only counts calls (`macState.hides`);
   - `MOD` is `'meta'` and `MOD_KEY` `'Meta'`, so the suites send ⌘ wherever Windows sends Ctrl. The check names still say Ctrl;
   - the features suite disables `AudioServiceSandbox` so the fake microphone works. It uses Chromium's fake-device switches, so no real microphone opens;
   - the suites seed a `{ plain }` test API key (or none), so the keychain is never touched.
6. **The 8 Mac checks** (features):
   1. the logo clears the traffic lights and is level with them;
   2. key names use ⌘ (search box, Help, Settings, Undo);
   3. Control+click on a card opens its editor, without copying or selecting it;
   4. a real right-click on the Served text opens its editor, not the Copy menu;
   5. the menu bar has 4 menus, Window › Minimize has no ⌘M, and Edit › Undo while typing in an editor undoes the typing, not the board;
   6. "Hide Recaller after copying" calls `app.hide()` instead of minimising;
   7. ⌘H on a focused card leaves its highlight alone (sent as a DOM event, because a real ⌘H would reach the menu and hide the test app);
   8. a draft typed right before a page reload (as before ⌘Q) is saved.
7. **Test a packaged build:** `npm run dist:mac`, then `APP_MAIN="$PWD/dist/mac-arm64/Recaller.app/Contents/Resources/app.asar/src/main.js" npm run test:features` (and the other suites). Use a plain `$PWD` path; Git Bash's `pwd -W` doesn't exist in zsh. The harness can't tell which version it loaded (`app.getVersion()` reports Electron's 44.4.5 there), so make sure `dist/` holds the build you mean. The discarded 1.17.0 builds were moved to `dist/_discarded-1.17.0/`.
8. **Real data:** `MODE=real npm run test:update` copies `~/Library/Application Support/Recaller` (data, settings, images) into `tests/e2e/.out/data-real`. Without a data or settings file there, it prints `HARNESS FAIL` and stops without a dialog. Delete `.out/data-real` afterwards. The folder holds the owner's real notes since their first run (late on 2026-09-29), so run it only with their OK.
9. **Retina capture:** `SCALE=2 npm run capture` renders the sample board at 2× (Mac only; the default is 1×).
10. **If a run hangs:** multi-copy and `capture-board.js` have no `.catch` on `app.whenReady()`, so an exception leaves Electron running (with its 2px sliver) instead of printing `HARNESS FAIL`. Kill it by its full path (see "Run from source on a Mac").
11. **Still untested on a Mac** (by the suites, and not reported from the owner's first run late on 2026-09-29): real key presses and the real traffic lights, the menu bar driven from the keyboard, a real snip and real dictation (with their Screen Recording and microphone prompts), the keychain, the packaged `Recaller.app` itself (the suites load only its `app.asar`), full-screen Spaces and Intel Macs. The `masos` code hasn't been run on Windows either.
