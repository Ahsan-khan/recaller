# 07: Gotchas and lessons learned

Each entry gives the symptom, the cause and the fix (or the rule to follow).

## Environment and tooling

1. **Electron starts as plain Node.**
   - Symptom: `app` is undefined, and you get "Cannot read properties of undefined (reading 'commandLine')".
   - Cause: `ELECTRON_RUN_AS_NODE=1` is inherited from the VS Code / Claude Code extension terminal. The Mac's VS Code terminal sets it too (seventh session).
   - Fix: use `scripts/run-electron.js` (all npm scripts do), or `env -u ELECTRON_RUN_AS_NODE` (Git Bash and zsh alike).
2. **Electron binary missing after `npm install`.**
   - Cause: Electron 44 downloads it lazily.
   - Fix: `node node_modules/electron/install.js`.
3. **electron-builder exits with 127 mid-build**, leaving `dist/win-unpacked.tmp(.lock)`.
   - Fix: delete `dist/win-unpacked*` and rebuild. It is a transient flake, seen on the PC (the one Mac build in the seventh session ran cleanly).
4. **Tool-call escaping when patching files with inline Python heredocs.**
   - Symptom: `\n` inside strings became real newlines, and a Windows path `\recaller` turned into a carriage return plus "ecaller" (it corrupted `README.md` once).
   - Symptom: very long inline heredocs made Git Bash fail with "unexpected EOF".
   - Fix: write patch scripts to a file first; use `chr(92)` for backslashes or raw strings; verify the output.
   - These were Git Bash problems on the PC. On the Mac (zsh) there are no Windows backslash paths, but writing patch scripts to a file is still the safe habit.
5. **Git Bash vs PowerShell:** both are available on the PC. npm scripts can't set env vars inline on Windows; use PowerShell `$env:X = '…'`. On the Mac there is only zsh (no PowerShell), and env vars go inline: `MODE=real npm run test:update` (see #82).

## Electron 44 API changes

6. **The clipboard is async:** `clipboard.readText()` and `writeText()` return Promises, so `await` them.
   - Images are written with `clipboard.write([new ClipboardItem({ 'image/png': new Blob([png]) })])`.
   - Async writes can finish out of order, so main chains them with `inOrder()`. Without it, a burst of Ctrl+clicks could leave an older, shorter text on the clipboard.
7. **Per-window IPC for the overlay:** `webContents.ipc.handle/on` scopes channels to one window (the snip overlay).
8. **`safeStorage` depends on Chromium's `Local State` file** in userData, which holds the encryption key. If that file is lost or reset, the stored API key can't be decrypted. The app then shows "no key", and the user pastes it again. Never delete `Local State`. On a Mac, `safeStorage` keeps its encryption key in the keychain instead (the "Recaller Safe Storage" item), and losing that item has the same effect; the Mac's Settings says "Saved in your Mac’s keychain" (#74).

## CSS and rendering

9. **Derived custom properties don't follow per-element changes.**
   - Symptom: every column header had the same tint.
   - Cause: variables like `--accent-tint: color-mix(… var(--accent) …)` were declared on `:root`, where they resolve once with the root `--accent`.
   - Fix: redeclare derived tokens on `:root, .column, .drag-ghost`.
10. **Text shadow softens titles:** `text-shadow` on white text over colour renders soft and blurry in Chromium on Windows, because it uses greyscale anti-aliasing. The owner called it "not clear". Don't use it on titles.
11. **Small, tight or grey text reads as muddy:** tight negative letter-spacing on 14px titles, and small grey monospace labels on grey backgrounds, read poorly on the owner's 100%-scaled ultrawide. Keep headings at least 15px, bold, with neutral tracking, and labels in dark ink.
12. **`display:none` SVG sprites break masks and gradients.** Keep the sprite rendered, sized 0×0 and positioned absolutely (`.sprite`).
13. **Module scripts over `file://`:** avoided entirely by loading renderer scripts as classic scripts sharing `window.*` namespaces.
14. **CSP must list the custom scheme:** `img-src` must include `recaller-img:` and `blob:`; `font-src 'self'` covers the bundled fonts.

## Pointer gestures

15. **Don't capture the pointer before a gesture starts.**
    - Cause: `setPointerCapture` on the board at pointerdown changes click and double-click targets, which broke double-click-to-rename.
    - Fix: track pointer moves and releases with `window` listeners; never capture early.
16. **Stale gestures from missed releases.**
    - Symptom: a drag or swipe kept following the mouse after the button was released. Seen when the owner's real mouse passed over a test window, and possible after an alt-tab.
    - Fix: a `pointermove` with `buttons === 0` during a gesture cancels it, and window `blur` cancels it too.
17. **Slow clicks became drags:** a press held longer than 240ms lifted the card and didn't copy. Fix: a drag that never moved 7px or more counts as a click.
18. **FLIP jitter:** reading `getBoundingClientRect()` on elements that are mid-animation made the drop position oscillate. Fix: hit-test with layout positions (`offsetTop`, `offsetLeft`) plus the container's rect.
19. **The drop target ran away:** inserting the placeholder above a collapsed header pushed the header down under the pointer. The user just follows it. Combined (then "Augmented") is now a single drop zone, which avoids this.
20. **Layout shift under a click:** closing an empty composer on pointerdown moved things under the cursor, so the click landed elsewhere. Fix: close on pointer *release*.
21. **Explorer-style multi-select:** people click one note and then Ctrl+click more. The first note must be included (the "anchor"), but only if nothing else happened in between; otherwise old clicks leak in. Clear the selection on window blur (switching away to paste), Esc anywhere, or a click on empty canvas.

## Voice

22. **Text only appeared at the end.** The owner saw no text until Save, and most likely pressed Save while recording. Live, phrase-by-phrase streaming fixed the underlying expectation.
23. **Fixed voice thresholds would drop quiet mics.** Use an adaptive noise floor, and always send the only take of a session if it lasted at least 600ms. Silent segments must *not* be sent, because transcription models tend to invent text for silence.
24. **Transcription API details:**
    - `gpt-transcribe` takes `languages[]` (an array field), not `language`.
    - `whisper-1` can't stream.
    - The streaming event names come from OpenAI's docs (`transcript.text.delta` / `transcript.text.done`).
    - If a streamed reply ever yields nothing (a format mismatch), the code re-asks without streaming.
25. **Editing while text streams in:** setting `textarea.value` programmatically resets the caret and the undo stack.
    - The composer saves and restores the user's selection around every insertion.
    - It works out the user's own edits by diffing against the last known value (common prefix and suffix), then shifts the dictation point and the streaming region accordingly.
    - `execCommand('insertText')` was used earlier but is no longer on the voice path.
26. **Save while transcribing** must wait: `pendingSave` finishes the queue, then saves.

## Screenshots

27. **The capture must exclude Recaller:** hide the window, wait about 260ms for Windows to remove it from the screen, then capture. On a Mac the same 260ms wait is used; before hiding, the snip checks the Screen Recording permission (#73) and leaves full screen (#72).
28. **Capture size:** `desktopCapturer.getSources` must request `thumbnailSize` = display size × scale factor. The crop scale is computed from the actual thumbnail size divided by the display bounds.
29. **The overlay cancels when it loses focus**, so it can't get stuck. A 3-minute safety timeout does the same. It shows on `shot:ready`, with a 2.5s fallback.

## Data safety

30. **Earlier versions changed user data on upgrade:** 1.1.0 recoloured projects, and early `normalize()` dropped unknown fields. Both were removed or fixed in 1.3.0. See the invariants in `03`.
31. **Saved scroll positions got overwritten** at startup when a smaller window clamped them. Fix: save scroll only when the user caused it (wheel, pointerdown or keydown within the last 1.5s), plus on `beforeunload`.
32. **Reload race:** a reload read the data file before the last debounced write. Fix: `data:load` flushes pending writes first.
33. **Restore race:** saves arriving during a restore could overwrite the restored file. Fix: the `restoring` flag ignores saves until the next `data:load`.

## Testing without disturbing the owner

34. **Test windows appeared on the owner's screen.**
    - Cause: calling `setBounds` in `browser-window-created` is overridden when the app applies its saved position.
    - Effect: the owner saw Soft-theme test windows and thought the deep green had been removed.
    - Fix: override `win.show` so it moves off-screen and then calls `showInactive`. On Windows a 200px or 60px strip stays visible (see `06`). On a Mac the override places the window with `macRect()` (2px on screen), and `quiet()` does the rest (#77).
35. **Off-screen windows draw no frames:** `requestAnimationFrame`, scroll events and wheel input stall. Force frames with `capturePage()`, and never make app correctness depend on rAF. The app's startup used to wait on rAF and could stay invisible while hidden; that was fixed. On a Mac a window wholly off screen stops drawing altogether (capture included), which is why 2px stay on screen there (#77).
36. **Synthetic wheel direction:** `sendInputEvent({ type: 'mouseWheel', deltaY: -120 })` corresponds to DOM `deltaY = +120`.
37. **Harness syntax errors** open an "App threw an error" dialog on the owner's screen. Always run `node --check` first.
38. **The real screen snip test** captures the owner's actual screen. Delete the images and never look at them.

## Working with this owner

39. **Dictated messages:** requests arrive dictated and fragmented. Interpret them, build, and state the interpretation plainly. Round 7's reading of the Augmented section was wrong, and the owner corrected it in round 8 without friction.
40. **Taste questions:** when they reject a design choice twice (fonts), stop guessing. Render the options side by side, pick the best as the default, and add a picker.
41. **Tell them about interference:** if the owner's own actions interfere with tests (using the installed app, moving the mouse), say so plainly rather than treating it as an app bug.

## Added in the 1.6.0 session

42. **Changing a default only reaches users who never chose.** Before making Instrument Sans the title default, the real data file was checked for `prefs.titleFont` (reading only that key, never note text). It was absent, so the owner saw the change without any data being rewritten. Do the same check before relying on a new default.
43. **`let` declarations and render order.** `render()` reads `resizing` and calls `paintWidthReset()`, which uses `widthResetBtn`. These are declared with `let`/`const` inside the IIFE, so they must be declared before the first `render()` runs; it runs from `init()` at the very end, which is fine. Don't call `render()` from top-level code placed above those declarations.
44. **Hidden buttons can still be clicked by tests.** The Notes-row buttons are `display: none` until hover; the suites call `element.click()` from page JS, which works regardless of visibility. Tests that use `sendInputEvent` would need a hover first.
45. **Quoting code inside `executeJavaScript` strings in harness scripts.** Nested quotes inside a JS string inside a Node string broke a scratch script. Use a template literal for the outer string. `node --check` caught it before Electron could show an error dialog, which is why that step matters.
46. **Offscreen rendering for design comparisons.** `new BrowserWindow({ show: false, webPreferences: { offscreen: true } })` with `capturePage()` renders a page with no window at all. That's ideal for side-by-side font or colour candidates without disturbing the owner. (The app suites still use the off-screen-window pattern, because they need real input events.) On the Mac, an offscreen window's `paint` frame came back empty when rendering the 1024px icon, so `icon:mac` uses a hidden window with `capturePage` instead (#76); check the output before relying on offscreen rendering there.
47. **Width changes don't re-run the "Show more" measurement by themselves.** Card signatures don't include the width, so after a resize or density change call `remeasure()`. Density changes had this gap before 1.6 too.
48. **`APP_MAIN` from Git Bash must be a Windows path.** `export APP_MAIN="$PWD/…"` gave `/c/Users/…`; Electron couldn't load it and showed an "App threw an error" dialog on the owner's screen, and the stuck test Electron processes had to be killed (only `node_modules\electron\dist\electron.exe`, never the installed `Recaller.exe`). Use `$(pwd -W)/…`. The suites now check that the path exists before `require` and exit quietly if not.
    - On the Mac (zsh) it is the other way round: `pwd -W` is a bad option, the substitution comes out empty, `APP_MAIN` becomes `/dist/…`, and each suite stops with a quiet `HARNESS FAIL`. Use a plain `"$PWD/…"`. Since the seventh session the hint "(APP_MAIN must be a Windows path)" prints only on Windows. Stuck test Electrons on a Mac are killed by their full path (#83).
49. **A stage editor open while its stage changes.** If a prompt lands in Combined while the whole-text editor is open, saving must not overwrite it. `saveStageEdit()` remembers which parts were open and keeps any that arrived, after the edited note (covered by a features check).
50. **A "fits" class must not remove the limit it was measured against.** `.aug-text.fits` / `.final-text.fits` used to set `max-height: none`. Once a text fit, it was never seen as overflowing again, and it grew without limit as notes were added. A new e2e check caught it in 1.7. Measurement-driven classes should only change cosmetics (the fade), never the constraint being measured. Keep clamping in plain CSS so it works even when no animation frame runs.
51. **The owner's real data explains vague complaints.** "Final is too long" turned out to be a 24-note Final with "Show all" saved on, plus the bug in 50. Reading only flags and counts (never text) from `%APPDATA%\Recaller\recaller-data.json` (on a Mac, `~/Library/Application Support/Recaller/recaller-data.json`) settled it quickly.
52. **Never chain the version bump behind a check with `&&`.** In 1.11 the bump (`sed` on package.json) was chained after a `node --check` that failed, so it never ran, and the next `npm run dist` rebuilt the new code as the old version, overwriting that installer. Bump the version as its own step, confirm `package.json`, and check the build log line `building target=nsis file=dist\Recaller Setup X.Y.Z.exe` before testing or handing over.
53. **Judge colour options as a set, and don't pick by metaphor.** 1.12 offered six Cooked palettes, three of them brown, and made caramel the default because "cooked = golden-brown". The owner found it repellent. Brown UI accents read as dirty; a picker full of near-duplicates isn't a real choice. Offer a few clearly different, conventionally pleasant options (blues, teals, neutrals) and check the default against the whole board, not just for contrast.

## Added in the 1.14.0 session

54. **One paste can't carry text and a picture into a chat box.** On Windows, one `clipboard.write([new ClipboardItem({ 'text/plain': …, 'image/png': … })])` puts both formats on the clipboard, and a Chromium page's paste event gets `text/plain` plus an `image/png` file. But the page decides what to keep: the Claude Code VS Code chat box (read in `webview/index.js` of the extension: `if (files.length > 0) { preventDefault(); attach(files); return }`) attaches the file and drops the text, and claude.ai and ChatGPT very likely do the same. Only one bitmap fits on the clipboard (a second ClipboardItem replaces the first). Several images can go on as files (`text/uri-list` or the raw `FileNameW` format become `FileDrop`), but then Chromium offers only the files and hides the text. So Recaller copies text and pictures separately (see `04` §13). Clipboard experiments overwrite the owner's clipboard; keep them short.

## Added in the 1.15.0 session

55. **Reading the installed version: `npx @electron/asar` can fail here.** With `npx --prefix …` it printed "'asar' is not recognized". What worked: `node -e "const a=require('@electron/asar');console.log(JSON.parse(a.extractFile(process.env.LOCALAPPDATA+'/Programs/recaller/resources/app.asar','package.json')).version)"` from the repo root (`@electron/asar` is installed as an electron-builder dependency). It writes nothing to disk. For a file in a subfolder of the archive, build the path with `path.join('src', 'renderer', 'styles.css')`: on Windows the archive only finds backslash paths, and a forward-slash path reports "not found in this archive".
    - **On a Mac** the one-liner doesn't work: `LOCALAPPDATA` is unset, so it reads `undefined/Programs/…`. Read the installed version with `plutil -extract CFBundleShortVersionString raw /Applications/Recaller.app/Contents/Info.plist` (an error means it isn't installed). `@electron/asar` finds forward-slash paths there, and the `path.join` form works on both.
56. **Hover screenshots near the board's right edge hide behind the › arrow.** The features suite's `px1` column sits at the right of the 1360px test window, so a hovered Notes row there is partly covered by the scroll arrow. (Since 1.16 the arrow only shows while the pointer is within 96px of the edge, but a hover there still brings it up.) For a clean look at hover-only buttons, use a scratch copy of `capture-board.js` and hover a row in the first column (`sendInputEvent({ type: 'mouseMove' })`, then `capturePage` of `.used` and `resize` 2×).
57. **Measuring hover-only buttons without a hover.** The Notes-row buttons are `display: none` until hover, so their size can't be read at rest. Setting `style.display = 'flex'` on `.fp-acts` in page JS, measuring, and clearing it again is deterministic and needs no mouse (the row-fit check in `features.e2e.js` does this).

## Added in the 1.16.0 session

58. **See-through light controls go grey on the dark canvas.** A frosted white disc (86% white plus `backdrop-filter`) looked fine over a light column but turned muddy grey-green over the Deep canvas. Floating controls that can sit over either need an opaque body; get the "sleek" from the edge (a slim ring and halo), not from transparency.
59. **`transform` is shared.** The arrows slide in with a translate and grow on hover with a scale. Doing both with `transform` makes one rule overwrite the other, so they use the separate `translate` and `scale` properties (Chromium supports them), which also transition independently.
60. **Scratch Electron scripts must live inside the repo to run.** A script in the scratchpad can't `require('electron')` (no `node_modules` there). Write it in the scratchpad, `cp` it into `tests/e2e/.out/` (git-ignored), run it there with `env -u ELECTRON_RUN_AS_NODE npx electron`, then delete the copy. Pass the scratchpad as a Windows path (`pwd -W`) for the output. On the Mac, pass plain POSIX paths, and a copy of a suite or of `capture-board.js` must change `require('./mac-harness')` to `require('../mac-harness')` and keep `quiet()` before `require(APP_MAIN)` (#77).
61. **Checking hover-revealed controls in tests.** Read the state class (`.is-near`) and the computed `pointer-events`, not `opacity`: opacity is mid-transition when read, and off-screen windows may not advance transitions. The suite's `click()` sends a `mouseMove` first, so a control revealed on pointer proximity is already clickable when the press arrives.
62. **A gradient border on a rounded box.** `border-image` ignores `border-radius`, so the frame uses a transparent border with the gradient as the last background layer clipped to `border-box`, and the real backgrounds clipped to `padding-box`. Every theme rule that sets the element's `background` must repeat that layer (`body.theme-deep .stage` does).
63. **Faint edges vanish at 100% scale.** The first four frame candidates (hairlines at 8–13% white, a vignette) looked identical in screenshots. Their styles had applied (checked with `getComputedStyle`), they were simply too faint to read as a border on the owner's 1× screen. Judge edges on 1× full-window shots plus 2× corner crops, and when variants look the same, check the computed styles before assuming the injection failed. A frame that "organises" needs roughly 30–40% opacity on the dark canvas. (The owner's Mac is a 2× Retina screen, where the same edges read stronger; see #81.)
64. **When a reading is corrected, check what's already built.** "A slight border to it" was first read as the arrow's border; the owner meant the board frame. The frame was added and the arrow ring kept only because it matches; say so in the report so the owner can ask for it back.

## Added in the macOS edition session (seventh)

These come from building the Mac edition of 1.16.0 on the Mac (branch `masos`, 2026-09-29). It was built from scratch: the discarded 1.17.0 attempt in `stash@{0}` was not used, and nothing here comes from it.

65. **Fence every Mac difference, so Windows stays exactly the same.** The owner wants the Windows app kept as it is. Every Mac change sits behind `IS_MAC` (`process.platform === 'darwin'` in main-process code, `api.platform === 'darwin'` in `app.js`, `MAC` in `voice.js`), a `body.is-mac` CSS selector, a `data-mac` / `data-mac-title` attribute (applied only by Mac code), or the `mac` / `dmg` build sections. Helpers exist on both platforms but change nothing on Windows: `kb('Ctrl+Z')` returns `'Ctrl+Z'`, and `modKey(e)` / `multiKey(e)` return `e.ctrlKey || e.metaKey`. Mac-only Electron modules load only on a Mac: `screenshot.js` requires `systemPreferences` behind `IS_MAC` (its comment says loading it on Windows sets up a hidden window for colour broadcasts). A change meant for both platforms can be tested only on the machine you're on, so say which one was tested.
66. **Control+click is a right-click on a Mac.** Chromium on macOS turns Control+left-click into a context-menu click (the features check "Control+click on a card opens its editor" relies on it). So on a Mac:
    - multi-select is ⌘-click (`multiKey`), and the board's `pointerdown` ignores Control+left-click, leaving it to the `contextmenu` listener, which edits;
    - the app's shortcuts are ⌘ without ⌃ (`modKey`), so ⌃K, ⌃F, ⌃N and ⌃M stay the text-editing keys they are in any Mac text field;
    - the suites send `MOD` (`'meta'`) wherever the 1.16 harness sent `'control'`.
67. **A Mac selects the word under a right-click before `contextmenu` fires.** 1.16's rule "text is selected, so leave the native Copy menu" would then show Copy instead of the editor. On a Mac a capturing `pointerdown` listener stores the selection as the button goes down (`selectionAtPress`), `contextmenu` reads that instead, and after opening an editor the Mac's word selection is cleared (`removeAllRanges()`). Covered by the "real right-click on the Served text" check.
68. **On a Mac the menu bar owns the ⌘ keys, so choose them carefully.**
    - Window › Minimize is a plain item with no accelerator: a `minimize` role would bring its default ⌘M, which is Dictate in the page.
    - Edit › Undo (⌘Z) and Redo (⇧⌘Z) are custom items that send `app:command` `'undo'` / `'redo'`. The page decides: the field's own undo while typing (`document.execCommand`), nothing while Settings, Help or the lightbox is open, otherwise the board's history. While the window is hidden or minimised they do nothing, because ⌘Z would otherwise change the board out of sight.
    - Settings… (⌘,) doesn't repaint Settings when it is already open; repainting would wipe what's being typed.
    - The focused-card keys ignore ⌘, ⌃ and ⌥ on a Mac (only ⌘⌫ deletes, as in the Finder), so ⌘H reaches the menu and hides the app instead of toggling the highlight. Tests send such keys as DOM events: a real ⌘H that the page leaves alone would reach the menu and hide the test app.
69. **⌥⌘R is taken, so the Mac's default hotkey is ⌃⌥R.** ⌥⌘R is VS Code's "Reveal in Finder"; ⌃⌥R is the same physical keys as Ctrl+Alt+R on the PC (`DEFAULT_SETTINGS.hotkey = IS_MAC ? 'Control+Alt+R' : 'CommandOrControl+Alt+R'`, used only when the settings file has no `hotkey`). On a Mac the hotkey recorder records ⌃ as `Control` and ⌘ as `Command`, names punctuation from `e.code` (Option changes `e.key`: ⌥, types ≤), and Settings shows accelerators as symbols in Apple's order (`'Control+Alt+R'` → ⌃⌥R).
70. **A Mac app outlives its window.**
    - The red button and ⌘W hide the window instead of closing it (`e.preventDefault(); win.hide()` unless `quitting`, which `before-quit` sets); ⌘Q quits. The global hotkey or a Dock click (`activate` → `summon()` when hidden) brings it back, and on a Mac `summon()` also calls `app.show()` and `app.focus({ steal: true })`, so Recaller comes to the front over another app.
    - "Hide Recaller after copying" (the `window:minimize` IPC) and the hotkey toggle call `app.hide()` instead of `minimize()`: focus goes straight back to the previous app, so the paste lands there.
    - `acceptFirstMouse` on the main window and the snip overlay: the click that brings Recaller forward also copies the card, and a snip started from another app gets its first drag. Untested with a real mouse.
    - The app runs for days, so the daily backup is checked every hour (after a flush).
    - The global snip's result and the menu commands wait for the page to finish loading (`sendWhenLoaded`), and a cancelled global snip calls `app.hide()` to hand focus back (never on `BUSY`, which would hide a snip in progress).
71. **⌘Q skips `window-all-closed`, and the page's last save arrives late.** On ⌘Q the page's final `beforeunload` save reaches main after the window's `close` flush, and `window-all-closed` never fires. On a Mac, main also flushes on the window's `closed` and in `will-quit`, and on `beforeunload` the page sends a draft save that is still waiting on `persistSoon`'s 400ms timer. The check reloads the page right after typing, standing in for ⌘Q; a real ⌘Q is untested.
72. **Hiding a full-screen window leaves a black Space.** On a Mac, closing the window and starting a snip both leave full screen first (`setFullScreen(false)`, then hide on `leave-full-screen`; the snip waits at most 2s), and a full-screen frame is never saved as the window's bounds. Full screen also removes the traffic lights, so main sends `fullscreen-on` / `-off` and `body.is-fullscreen` shrinks the top bar's left padding from 84px to 14px. `setVisibleOnAllWorkspaces` is avoided (it flickers the Dock). Full-screen Spaces, and snipping over another app's full-screen Space, are untested.
73. **Permissions come from macOS, not the page.**
    - **Screen Recording:** before a snip, `screenshot.capture()` checks `systemPreferences.getMediaAccessStatus('screen')`. If it isn't `granted`, it asks once through `desktopCapturer.getSources` (which lists Recaller under Screen Recording and shows macOS's own prompt the first time) and returns code `PERMISSION`. The composer shows the message with an Open System Settings button (`app:open-privacy` → `Privacy_ScreenCapture`); a global-hotkey snip shows a 12s toast with Open Settings. After allowing it, Recaller must be quit and reopened.
    - **Microphone:** the app needs `NSMicrophoneUsageDescription` in its `Info.plist`; without it macOS kills the app when it opens the microphone. A blocked microphone gives the Mac's own `DENIED` text and an Open System Settings button (`Privacy_Microphone`).
    - No session has seen any of these prompts. The owner first ran the packaged app late on 2026-09-29, and how its prompts went isn't recorded yet.
74. **Signing without a Developer ID.** `identity: "-"` makes electron-builder 26 sign ad hoc (log: `identityName=- identityHash=none`) and skip notarization. Apple Silicon needs at least that, and Gatekeeper still rejects the app (`spctl` says "rejected", as expected). A dmg built on this Mac has no quarantine attribute and opens straight away; a downloaded or AirDropped copy needs System Settings › Privacy & Security › Open Anyway once (Control-click › Open no longer works on macOS 15 and later). The ad-hoc signature changes with every build, so macOS may ask for the microphone, Screen Recording and the "Recaller Safe Storage" keychain item again after each update. A Developer ID ($99 a year) would fix that (open in `09`).
75. **electron-builder on Apple Silicon.** A target named on the command line takes the host's arch, so `electron-builder --win nsis` (`npm run dist`) on this Mac would build an arm64 Windows app that the owner's x64 PC can't run. `npm run dist:win` pins `--x64` (check `archs=x64` in the log). `npm run pack` (`--dir`) on the Mac builds `dist/mac-arm64/Recaller.app`, not `win-unpacked`. The packaged `package.json` loses `scripts`, `build` and `devDependencies`, so compare `src/` and `build/icon.png` byte for byte and read only the version from the packaged `package.json` (`06`, "Checking a Mac build").
76. **`icon:mac`: the offscreen render came back empty.** The plan was an offscreen window (`webPreferences: { offscreen: true }`), but its `paint` frame was empty on the Mac. `make-icon.js --mac` uses a hidden window instead (`show: false`, transparent, `enableLargerThanScreen` so that a 1024px page fits the 982pt screen), captures it with `capturePage` (a Retina screen captures at 2×, 2048px) and scales that to 1024. It hides the Dock icon first, and it exits with code 1 ("icon:mac: no usable capture") rather than leave no file, because electron-builder would then quietly use the Windows icon for the Mac app (per the code comment). Check the result with `sips` on the built `icon.icns` (1024 × 1024).
77. **The 1.16 test harness was Windows-only, hence `tests/e2e/mac-harness.js`.** The seventh session's read-only audit found that on a Mac the committed suites would leave a 200px or 60px strip and a Dock icon on screen, send Control+clicks that act as right-clicks, snip the real screen (which needs Screen Recording permission), and in `MODE=real` throw on the unset `process.env.APPDATA` (an error dialog). The fix, inert on Windows:
    - `macRect()` puts each window past the outer edge of all displays, away from the cursor, with 2px on screen (macOS stops drawing a window wholly off screen, and `capturePage` and animations stop with it);
    - `quiet()`, called before `require(APP_MAIN)`, hides the Dock icon, makes windows ignore the real mouse (`sendInputEvent` still works), stubs `Menu.prototype.popup`, `shell.openExternal` and `shell.openPath`, makes `app.focus` / `app.show` do nothing, and counts `app.hide` calls (`macState.hides`);
    - `MOD` / `MOD_KEY` send ⌘; the real snip is skipped with a `SKIP` line; `MODE=real` reads `app.getPath('appData')` and stops cleanly if nothing is there.
    - Rule: never run the suites on a Mac from a branch without `mac-harness.js` (`main`, `v1`).
78. **The fake microphone needs the audio sandbox off on a Mac.** The sandboxed audio service can't read the `--use-file-for-fake-audio-capture` WAV, so `features.e2e.js` adds `AudioServiceSandbox` to `disable-features` on a Mac (`'CalculateNativeWinOcclusion,AudioServiceSandbox'`). With that, every dictation check passes on the Mac.
79. **Inside the suites the app is "Electron".** Electron is started on a `.js` file, so `app.name` is "Electron" (the menu check sees `["Electron","Edit","Window","Help"]`) and `app.getVersion()` is 44.4.5, even when `APP_MAIN` points at a packaged `app.asar`; the version-stamp check reads "1.2.0 → 44.4.5". Check a packaged build's version in its `Info.plist` or its asar's `package.json`. Run from source, the menu bar also says "Electron", and the Dock shows the Mac icon only because main sets `build/icon-mac.png` in dev (Electron's own icon without that file). The packaged app's bundle name is Recaller (in its `Info.plist`; not yet seen on screen).
80. **The bundled fonts have no Mac key symbols.** The seventh session's audit parsed all 10 bundled woff2 files: none has ⌘ ⇧ ⌥ ⌃ ↩ (nor ✓ and ↔), and Sora also lacks ↑ ↓. On a Mac `body.is-mac kbd` uses the system font (`-apple-system, BlinkMacSystemFont`), which draws them like the macOS menus, and the UI fonts fall back to the system font after Geist.
81. **Retina is 2×; the suites are 1×.** The Mac's screen is 3024×1964 px at 2× (1512×982pt; Electron's display bounds are in points). Every script forces `force-device-scale-factor=1`, so suite screenshots show the Mac at 1×; use `SCALE=2 npm run capture` to see what the owner sees (added in the seventh session, not run yet). At 2× the 1.5px borders draw at full weight: the arrow ring and the composer ring look slightly heavier than on the 1× PC, and the board frame's edge reads stronger. A Mac look review is open (`09`).
82. **zsh on the Mac.**
    - `pwd -W` doesn't exist ("bad option: -W"); use `$PWD`. Env vars go inline.
    - `"$c:src/…"` is read as a `:s` modifier and silently breaks; write `"${c}:src/…"`.
    - A word that starts with `=` triggers EQUALS expansion (`echo ====` fails with "=== not found").
    - In an interactive zsh a `!` inside double quotes is history expansion, so put `node -e` one-liners in single quotes.
    - `git stash show -p stash@{0} -- <paths>` fails with "Too many revisions specified" on git 2.50.1; `git diff 'stash@{0}^1' 'stash@{0}' -- <paths>` works (only if the owner asks about the stash).
    - `APPDATA` and `LOCALAPPDATA` are unset, so Windows recipes built on them read `undefined/…`. Code uses `app.getPath('appData')`; recipes use the Mac paths in `06`.
83. **Killing a stuck test Electron on a Mac:** match its full path, `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`. List with `pgrep -fl "$PWD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"`, then `pkill -f` with the same path. Never kill by name (`pkill Electron`, `killall Electron`), and never touch an installed `/Applications/Recaller.app`. This is the Mac form of #48's rule.
84. **"The app window kept crashing" wasn't Recaller.** Mid-session the owner reported crashes. Nothing from the session had launched: no Recaller or Electron process had run, and the session's agents had only read files and run `node --check`. The crash reports in `~/Library/Logs/DiagnosticReports/` (named after the crashed program, for example `Tracer-2026-09-29-200211.ips`) came from programs outside the session: a Tracer app in a temp folder, `repro_bigsur` and a copied `python3`, all started from VS Code. The work was stopped anyway as a precaution, and the owner answered "okay its fine, just lets finish this up". Check processes and crash reports before assuming, and say plainly what ran (as #41).
85. **Status lines go stale between sessions.** The seventh session began with a read-only audit of about 1,310 claims in `ai_memory` against the code and git. It found about 49 high or medium mismatches (none refuted), mostly Windows-only wording and stale status: "1.16.0 is uncommitted" after the owner had committed it, and "main has 1.5.0" when `main` held 1.6.0 and then 1.16.0. Check git and the installed version at every session start (`13`), date every status line, and write platform-specific steps for both machines.
