# 07: Gotchas and lessons learned

Each entry gives the symptom, the cause and the fix (or the rule to follow).

## Environment and tooling

1. **Electron starts as plain Node.**
   - Symptom: `app` is undefined, and you get "Cannot read properties of undefined (reading 'commandLine')".
   - Cause: `ELECTRON_RUN_AS_NODE=1` is inherited from the VS Code / Claude Code extension terminal.
   - Fix: use `scripts/run-electron.js` (all npm scripts do), or `env -u ELECTRON_RUN_AS_NODE`.
2. **Electron binary missing after `npm install`.**
   - Cause: Electron 44 downloads it lazily.
   - Fix: `node node_modules/electron/install.js`.
3. **electron-builder exits with 127 mid-build**, leaving `dist/win-unpacked.tmp(.lock)`.
   - Fix: delete `dist/win-unpacked*` and rebuild. It is a transient flake.
4. **Tool-call escaping when patching files with inline Python heredocs.**
   - Symptom: `\n` inside strings became real newlines, and a Windows path `\recaller` turned into a carriage return plus "ecaller" (it corrupted `README.md` once).
   - Symptom: very long inline heredocs made Git Bash fail with "unexpected EOF".
   - Fix: write patch scripts to a file first; use `chr(92)` for backslashes or raw strings; verify the output.
5. **Git Bash vs PowerShell:** both are available. npm scripts can't set env vars inline on Windows; use PowerShell `$env:X = '…'`.

## Electron 44 API changes

6. **The clipboard is async:** `clipboard.readText()` and `writeText()` return Promises, so `await` them.
   - Images are written with `clipboard.write([new ClipboardItem({ 'image/png': new Blob([png]) })])`.
   - Async writes can finish out of order, so main chains them with `inOrder()`. Without it, a burst of Ctrl+clicks could leave an older, shorter text on the clipboard.
7. **Per-window IPC for the overlay:** `webContents.ipc.handle/on` scopes channels to one window (the snip overlay).
8. **`safeStorage` depends on Chromium's `Local State` file** in userData, which holds the encryption key. If that file is lost or reset, the stored API key can't be decrypted. The app then shows "no key", and the user pastes it again. Never delete `Local State`.

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
19. **The drop target ran away:** inserting the placeholder above a collapsed header pushed the header down under the pointer. The user just follows it. Augmented is now a single drop zone, which avoids this.
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

27. **The capture must exclude Recaller:** hide the window, wait about 260ms for Windows to remove it from the screen, then capture.
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
    - Fix: override `win.show` so it moves off-screen and then calls `showInactive`.
35. **Off-screen windows draw no frames:** `requestAnimationFrame`, scroll events and wheel input stall. Force frames with `capturePage()`, and never make app correctness depend on rAF. The app's startup used to wait on rAF and could stay invisible while hidden; that was fixed.
36. **Synthetic wheel direction:** `sendInputEvent({ type: 'mouseWheel', deltaY: -120 })` corresponds to DOM `deltaY = +120`.
37. **Harness syntax errors** open an "App threw an error" dialog on the owner's screen. Always run `node --check` first.
38. **The real screen snip test** captures the owner's actual screen. Delete the images and never look at them.

## Working with this owner

39. **Dictated messages:** requests arrive dictated and fragmented. Interpret them, build, and state the interpretation plainly. Round 7's reading of the Augmented section was wrong, and the owner corrected it in round 8 without friction.
40. **Taste questions:** when they reject a design choice twice (fonts), stop guessing. Render the options side by side, pick the best as the default, and add a picker.
41. **Tell them about interference:** if the owner's own actions interfere with tests (using the installed app, moving the mouse), say so plainly rather than treating it as an app bug.
