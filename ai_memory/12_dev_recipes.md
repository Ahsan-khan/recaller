# 12: Development recipes (how to make common changes safely)

Function and variable names below are real; search for them in the files. Line numbers drift, names don't.

## Before any change

- Run from source against a **throwaway data folder**, never the owner's:
  PowerShell: `$env:RECALLER_DATA_DIR = "$env:TEMP\recaller-dev"; npm start`
  - `npm start` without it uses the real `%APPDATA%\Recaller`.
  - If the installed Recaller is running and both use the same data folder, the single-instance lock hands focus to the installed app and the dev copy quits.
- DevTools: press F12 in the dev window. They are disabled when packaged.
- After editing JavaScript: `node --check <file>`.

## Add an app setting stored by main (like the model, hotkeys or theme)

1. `src/main.js`: add a default to `DEFAULT_SETTINGS`. Existing users get the default only because the key is missing, so their other values stay intact.
2. `src/main.js`: expose it in `publicSettings()`, and accept it in the `settings:set` handler. String keys are in the `for (const key of [...])` list; add booleans and enums like `hideAfterCopy` and `theme`.
3. `src/renderer/index.html`: add the field inside `#settings-form`, following the existing `.field` / `.field-grid` / `.segmented` / `.switch` patterns.
4. `src/renderer/app.js`, "settings" section:
   - add the element to the `f` object;
   - paint it in `paintSettings(s)`;
   - on change, call `saveSetting({ key: value })`.
5. Document it in the root `README.md` and in `ai_memory/03` and `04`.

## Add a UI preference stored in the data file (like density, title font, separator or column widths)

1. Read it as `data.prefs.<name>` with a fallback where it is used; don't write the default. `normalize()` already keeps unknown `prefs` keys.
2. Add a control in Settings, then paint it in `paintDensity()`. The joiner and title-font controls are the examples to copy.
3. On click: set `data.prefs.<name>`, then `persist()`, then `render()`.
4. If it changes a class on `<body>`, do that in `render()` (see `density-*` and `title-*`).
5. Keep it out of `data.projects` if undo shouldn't rewind it (see how `prefs.colWidths` works: `colWidth()`, `setColWidth()`, `resetColumnWidths()`).

## Add a new action on a prompt card

1. `createCard()`: add a `<button class="card-act act-yourthing" title="…">` inside `.card-actions`, and keep a reference in the returned view if it is needed.
2. `updateCard()`: set its icon, title and visibility if they depend on state. Add any new state to the `sig` string so the card re-renders.
3. The board `click` listener ("clicks & keys on the board"): `if (e.target.closest('.act-yourthing') && wrap) return yourAction(wrap.dataset.id);`
4. Optional keyboard key: the board `keydown` handler for a focused `.card`.
5. `yourAction(id)`: `const loc = locate(id)`, then `checkpoint('Label')` BEFORE changing anything, then mutate, then `persist()`, then `render()`. Show a toast with Undo if the change is visible: `toast('Done', { action: 'Undo', onAction: undo, history: true })`.
6. Buttons inside cards are skipped by the card gesture engine (its `closest('button, …')` check), so they won't trigger copy or drag.

## Add an action on the Cooked note or the Served text

- **Markup:** in `createColumn()`, in the `section.used` (Cooked) or `section.final` (Served) template. Keep a reference in the column view object.
- **Rendering:** in `updateColumn()`, in the "Cooked" and "Served" blocks. If a new state affects the markup, add it to `augSig` or `finalSig`.
- **Notes-list row buttons:** add them in `partsHtml()` (shared by both stages) and handle them in the board `click` listener's `.final-part` branch, which already routes `.fp-up`, `.fp-down`, `.fp-edit`, `.ap-back` (Cooked → prompts) and `.fp-back` (Served → Cooked). Tell the stages apart with `part.closest('.aug-parts')`.
- **Clicks:** the board `click` listener also handles `.aug-move`, `.aug-edit`, `.final-edit`, `.aug-parts-btn`, `.final-parts-btn`, `.aug-more`, `.final-more` and clicks on `.final-text` (copy).
- **Editing:** reuse `editStage(projectId, list, partId?)`; don't create another composer host.
- **Remember:** data `used` is Cooked and `combined` is Served (`STAGE_NAME` maps them). Cooked texts come from `augmentedText(project)` and `finalText(project)` (or `stageText(project, list)`), all using `joiner()`.

## Add or change a data field

1. Only ever *add* fields; never remove, rename or reinterpret existing ones.
2. **Normalising:** in `normalize()`, add a clean-up only if the field is dangerous when malformed. Otherwise the spread (`...n`, `...p`) already keeps it. Give it a default when you read it.
3. **UI-only fields** that undo shouldn't rewind (flags, counters) must be carried over in `applySnapshot()`.
4. **Fields that hold images** must be added to `referencedImageIds()` in `app.js` and to `imageIds()` in `src/backups.js`, or image cleanup will delete their files.
5. **Tests:**
   - `tests/e2e/update-safety.e2e.js` compares the saved file with the original. If the new field is added on every save (as `combined: []` was), allow exactly that addition, and nothing more.
   - The test must still see the file untouched right after launch.
6. **Version:** bump `DATA_VERSION` only for a real format change. Any migration must be lossless, run once, and rely on the automatic upgrade backup.

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

## Add a keyboard shortcut

- **Global in-app shortcuts:** the `document.addEventListener('keydown', …)` in the "global keys" section. Use `isTyping(e.target)` to avoid stealing keys from text fields.
- **Composer shortcuts:** in `createComposer()`'s textarea `keydown`. Call `stopPropagation()` so the global handler doesn't also fire.
- **OS-wide shortcuts:** add a setting and register it in `applyHotkeys()` in `main.js`.
- **Documentation:** update the table in `04` §20 and the root README.

## Change colours, add a palette colour or a highlight colour

- **Theme tokens:** the `:root` block and `body.theme-deep` in `styles.css`.
- **Title-bar colours:** `THEMES` in `main.js`. Keep them identical to `--topbar`.
- **Project palette:** `PALETTE` in `app.js`. **Never change existing ids;** users' files store them. Append new entries at the end. The array order is the order new projects take. The ⋯ menu grid is 9 columns (`.menu-swatches`); with more than 27 colours, add a row or widen it.
- **Highlight colours:** `HIGHLIGHTS` in `app.js` (id, name, color, bg). The ids are stored in notes, so never rename them.
- **Stage colours:** the `--aug-*` tokens and the `.final` rules.

## Add a column-title font

1. Copy the Latin `.woff2` (for example from an `@fontsource-variable` package via `npm pack`) into `src/renderer/fonts/`, with its licence.
2. `styles.css`: add an `@font-face` (with a `unicode-range`), plus a `body.title-x, .t-x { --title-font…; --title-size…; --title-weight…; --title-track…; --title-case… }` rule.
3. `app.js`: add `x` to `TITLE_FONTS`. To make it the default, change `DEFAULT_TITLE_FONT` in `app.js`, the `:root, body.title-x, .t-x` rule in `styles.css`, and the `title-…` class on `<body>` in `index.html`. Users who picked a font keep theirs; only users without `prefs.titleFont` see the new default.
4. `index.html`: add a tile `<button class="title-opt t-x" data-value="x" role="radio"><span>Wildfire RL</span><small>Name</small></button>` (the picker is a 3-column grid; keep the count a multiple of 3).
5. Compare visually before making it the default. For quick side-by-side comparisons of many candidates, render a standalone HTML page of mock headers with an *offscreen-rendering* Electron window (`new BrowserWindow({ show: false, webPreferences: { offscreen: true } })` + `capturePage()`). No window ever appears, and the output is at the owner's 1× scale. Then confirm in the app with `npm run capture`.

## Change voice behaviour

- **Segmentation constants** (pause length, thresholds, limits): the top of `src/renderer/voice.js`. The fake-mic WAV in `features.e2e.js` depends on a pause of 700ms or less and a minimum segment length; re-run that suite after any change.
- **Request shape, streaming, retries:** `src/transcribe.js`. The mock server in `features.e2e.js` imitates the API, so update it if the request or response format changes.
- **Insertion and editing while dictating:** `transcribeInto()`, `followUserEdit()` and `settle()` inside `createComposer()`.

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
  - `check(name, ok, detail)` records a result.
- **Mock server:** `mockMode = 'fail500'` forces 503s; `received[]` holds the requests.
- **Seed data:** projects `p1`, `p2`, `p3` and `px0`–`px3`.
- **Workspace:** the stages tests use the "Writing" column (`px1`) and scroll it into view first.
- **Before running:** `node --check`, then `npm run test:features`.
