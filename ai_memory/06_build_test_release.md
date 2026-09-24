# 06: Build, test and release

## Prerequisites (owner's machine, as used so far)

- Windows 11, Node 24.19, npm 11.17, Git Bash and PowerShell. Python 3.12 is optional; it was only used for patch scripts.
- `npm install` installs `electron@44` and `electron-builder@26`.
- **Electron 44 downloads its binary lazily** the first time `electron` is required. If `node_modules/electron/dist` is missing, run `node node_modules/electron/install.js`.
- **npm 11 prints "allow-scripts" warnings** about install scripts. They are harmless.

## The environment trap

The owner's VS Code / Claude Code terminal sets `ELECTRON_RUN_AS_NODE=1`, which makes `electron` behave like plain Node: `require('electron').app` is undefined, and you get "Cannot read properties of undefined (reading 'commandLine')".

- `scripts/run-electron.js` removes that variable before launching Electron. All `npm start`, `npm test*`, `npm run icon` and `npm run capture` scripts go through it.
- If you call Electron directly, use `env -u ELECTRON_RUN_AS_NODE npx electron <file>` in Git Bash, or `Remove-Item Env:ELECTRON_RUN_AS_NODE` in PowerShell.

## Commands (run in `recaller/`)

| Command | What it does |
| --- | --- |
| `npm start` | Run from source. Uses the real `%APPDATA%\Recaller` data unless `RECALLER_DATA_DIR` is set |
| `npm run dist` | Build `dist/Recaller Setup <version>.exe` (NSIS one-click, per-user, desktop and Start-menu shortcuts). Also leaves the unpacked app in `dist/win-unpacked/` |
| `npm run pack` | Build only `dist/win-unpacked/` (no installer) |
| `npm run icon` | Regenerate `build/icon.png` from the SVG sprite |
| `npm test` | Run all three end-to-end suites: multi-copy, then update-safety, then features |
| `npm run test:features` / `test:update` / `test:multicopy` | Run one suite |
| `npm run capture` | Render a sample board to `tests/e2e/.out/*.png` for visual review |

**Environment variables:**
- `RECALLER_DATA_DIR`: use another data folder.
- `RECALLER_OPENAI_BASE`: point transcription at a mock server.
- `APP_MAIN`: which `main.js` the tests load, for example the packaged one.
- `MODE=real`: run the update-safety suite against a copy of the owner's real data.

## Build notes

- **Packaging config** (electron-builder, in `package.json`):
  - `files: ["src/**/*", "build/icon.png", "package.json"]`
  - `win.target: nsis`
  - `nsis: { oneClick: true, perMachine: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: "Recaller", deleteAppDataOnUninstall: false }`
- **Install location:** `%LOCALAPPDATA%\Programs\recaller\`. The installer launches the app when it finishes.
- **Unsigned:** the build runs a signtool step, but there is no certificate, so the installer is unsigned and Windows SmartScreen may warn ("More info → Run anyway").
- **First build downloads:** Electron zip, NSIS, 7zip and resources into electron-builder's cache. A build takes about 1 minute.
- **Known flake:** the build sometimes exits with code 127 partway (while unpacking Electron or building NSIS), leaving `dist/win-unpacked.tmp` and `.tmp.lock`. Fix: `rm -rf dist/win-unpacked dist/win-unpacked.tmp dist/win-unpacked.tmp.lock`, then build again.
- **Before each release:** clean the old output first with `rm -rf dist/win-unpacked dist/*.exe dist/*.blockmap`.

## How the owner installs and updates

1. Give them `dist\Recaller Setup X.Y.Z.exe`. They double-click it; it installs over the previous version (closing the running app if needed) and relaunches.
2. Their data in `%APPDATA%\Recaller` is untouched, and the new version makes an `upgrade` backup on first start.
3. **Currently installed:** 1.5.0 (as of 2026-09-24).

## End-to-end test suites (`tests/e2e/`)

The suites drive the real app with synthetic mouse and keyboard input (`webContents.sendInputEvent`). They are not unit tests.

- **How they run:** each suite is an Electron *main* script. It sets `RECALLER_DATA_DIR` to a throwaway folder in `tests/e2e/.out/`, seeds data and settings files, then `require`s the app's `main.js` (the `APP_MAIN` env var, defaulting to `src/main.js`).
- **Output:** screenshots and data go to `tests/e2e/.out/`, which is git-ignored.

### Rules the suites follow (keep them)

- **Never disturb the owner.**
  - Every window's `show` is replaced with: move off-screen first (about 200px visible at the far edge of the display, away from the mouse), then `showInactive`. Test windows never take focus.
  - Moving the window in `browser-window-created` is not enough, because the app later re-applies its saved position. The move must happen inside the `show` override.
- **The owner's real mouse can interfere.** If they move it over the visible sliver, the app correctly treats that as the button being released. A resulting one-off failure in a drag or pan check is interference; re-run before debugging.
- **Off-screen windows don't draw frames.**
  - Wheel and scroll input, and `requestAnimationFrame`, stall.
  - Call `await webContents.capturePage()` to force a frame before reading scroll positions.
  - App code must not depend on animation frames for correctness (the startup code doesn't).
- **Check syntax first:** run `node --check` on a suite before launching it. A syntax error makes Electron show an "App threw an error" dialog on the owner's screen until it times out.
- **Real captures are deleted:** the features suite's real screen-snip test captures the owner's actual screen once. The suite deletes the images afterwards. Never view or keep those files.

### `features.e2e.js` (69 checks, about 3 minutes)

**Setup:**
- **Seed data:** seven projects in the old v1 format, which also exercises loading old data.
- **Settings:** a plain test API key (`sk-test-harness-1234`) and no global hotkeys.
- **Mock OpenAI server** on 127.0.0.1:
  - records every request (URL, auth header, model, stream flag, prompt, file part);
  - replies "Phrase one.", "Phrase two.", and so on;
  - streams server-sent events (`transcript.text.delta` word by word every 90ms, then `transcript.text.done`) when `stream=true`;
  - a `fail500` mode returns 503.
- **Fake microphone:** Chromium flags `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream` and `--use-file-for-fake-audio-capture=<speech.wav>`. The WAV is generated at 48kHz mono: 0.4s silence, then twice [1.8s of voice-like harmonic tone with syllable modulation, then a 1.1s pause], then 1.4s of silence, looped. This makes the app's pause detection cut real phrases.

**Coverage:**
- **Layout:**
  - slim width ≈268px;
  - the New prompt bar is under the header, not in it;
  - it opens the composer in its place;
  - long names wrap to two lines, clear of ⋯;
  - neighbouring column headers and sections have different colours;
  - Deep is the default theme;
  - headers are dark and solid.
- **Copy, swipe and undo:**
  - click copies;
  - swipe deletes;
  - undo via Ctrl+Z, the toolbar button and the toast;
  - redo with Ctrl+Y.
- **Drag:**
  - drag into Augmented (joins into the note);
  - the move toast and its Undo;
  - dropping on a collapsed Augmented header;
  - vertical reorder.
- **Stages** (built in a spare column):
  - three typed prompts;
  - two moved to Augmented join as "Gamma three\n\nBeta two";
  - clicking copies the combined note;
  - a left swipe moves it into Used;
  - a second batch via the **Move to Used** button is appended with the separator;
  - a third batch dragged onto Used;
  - Copy all copies the text and says "Copied";
  - the Copy all button overlaps nothing;
  - a prompt is sent back out of Augmented;
  - the three stages have different colours;
  - the "New line" separator setting works.
- **Highlight:** the menu offers four colours and shows the "Check again" tag; Ctrl+Z removes it; H toggles it.
- **Ctrl+click:** two notes in click order with a blank line between; badges 1 and 2 and the bar; Ctrl+click again removes; Esc clears; "Move to Augmented" joins them in, and Ctrl+Z undoes it.
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
- **Scrolling:** the arrow is visible and scrolls one column; the wheel over a header scrolls sideways; dragging empty canvas pans.
- **Settings:** the Compact density narrows columns; the Soft theme can be picked and is saved.
- **Columns:** reorder, then undo.
- **Real screen snip** (last): the overlay opens and Recaller hides; the snip attaches and Recaller returns; a full PNG and a thumbnail are stored.
- **Persistence:** v2 format, images on notes, density preference.
- **No renderer console errors.**

### `update-safety.e2e.js` (20 checks synthetic, 9 in real mode; about 40s)

**Synthetic "old install":**
- v2 data with unknown future fields at every level (top level, prefs, project, note, image);
- a project colour unknown to this version (`galaxy`), density `roomy`;
- an unsaved draft with an image, collapsed stages, six projects and a long column;
- settings with theme `soft`, the model, language, hint, `hideAfterCopy`, a plain key, `lastVersion: "1.2.0"` and an unknown `futureSetting`;
- image files that are referenced, orphaned (old) and referenced only by a backup;
- a pre-existing manual backup.

**Checks:**
- **On launch:**
  - the notes file is byte-for-byte unchanged, with the same modified time;
  - every existing setting keeps its value (window bounds are excluded, because the test moves the window);
  - `lastVersion` is updated;
  - an upgrade backup exists and is identical to the old data;
  - a daily backup exists.
- **On screen:** every project and note is shown; the theme, density and colours are kept (including the unknown one); the draft, collapsed states, last-used project, and draft text and image are all restored.
- **Images:** the orphan is deleted; the others are kept.
- **After a real edit:** the file equals the original except for the edited counters and the allowed empty `combined: []` lists.
- **Scroll positions** come back after a reload (within ±4px).
- **Restore** brings deleted notes back, the pre-restore state is itself backed up, and the backups are listed in Settings.

**`MODE=real`:**
- **What it runs on:** a *copy* of `%APPDATA%\Recaller` (data, settings, images) in `tests/e2e/.out/data-real`. It prints counts only, never note text.
- **Checks:** byte-identical after launch; settings unchanged; backup made; every project and note shown; theme and density kept.
- **Afterwards:** delete `tests/e2e/.out/data-real` (it holds the owner's notes and encrypted key).
- **If the owner's real file changes during the run**, that is them using the installed app, not the test.

### `multi-copy.e2e.js` (12 checks, about 30s)

It tests Ctrl+click as a real person would:
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

It renders a fixed sample (stages, highlights, a long two-line column name, an empty Used) and writes `tests/e2e/.out/<OUT>.png`, `<OUT>-zoom.png` (2× the left area) and `<OUT>-settings.png`. Use it to check visual changes; set `OUT` to name the files.

### Running the suites against the packaged build (do this before every release)

PowerShell:
```
$env:APP_MAIN = "$PWD\dist\win-unpacked\resources\app.asar\src\main.js"
npm test
$env:MODE = "real"; npm run test:update; Remove-Item Env:MODE
Remove-Item -Recurse -Force tests\e2e\.out\data-real
Remove-Item Env:APP_MAIN
```

## Release checklist

1. Make the change. Keep the invariants in `03`.
2. Run `node --check` on every edited JavaScript file.
3. Run the relevant suites on source, and add checks for new behaviour to `features.e2e.js`.
4. Bump `version` in `package.json`.
5. Update the user guide in `README.md`, and `ai_memory/08_changelog.md`.
6. Clean `dist`, then `npm run dist` (retry once if it exits with 127).
7. Run all suites against `dist/win-unpacked/resources/app.asar/src/main.js`, including `MODE=real`.
8. Hand the owner the installer path, and explain what changed and how to use it.

## Git status (important)

- **Repository:** `C:\Users\User\Documents\iresine` (branch `main`, with one initial commit `52faa2d` that predates Recaller).
- **Nothing committed:** the whole `recaller/` folder is **untracked**. The owner never asked for a commit, so nothing from this project has been committed or pushed.
- **When committing is requested:** make a branch, then commit with the attribution the environment requires.
- **Ignored:** `.gitignore` in `recaller/` ignores `node_modules/`, `dist/` and `tests/e2e/.out/`.
- **Unrelated changes:** the iresine repo also has uncommitted changes in `ReinforcementLearning/` that belong to other work. Don't touch them.
