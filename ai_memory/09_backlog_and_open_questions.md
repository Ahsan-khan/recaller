# 09: Backlog, known issues and open questions

## Fixed in 1.6.0 (the five known issues from 1.5.0)

1. **"Clear used" cleared the wrong stage.** The ⋯ menu now has **Clear Combined (n)** (data `used`) and **Clear Final (n)** (data `combined`), both undoable with a toast. Clearing archives nothing; see open question 2.
2. **The card "move back" button was never shown.** `.act-back` and its handler were removed.
3. **Leftover dead code from 1.4.0.** The swipe-to-Used path (`g.toFinal`, `swipe-add`), `addToFinal()`, the `is-used` card class and its CSS, and `drag-ghost.is-used` were removed. (A prompt dropped straight onto Final still works; that goes through `dragEnd`.)
4. **Search skipped the combined texts.** Terms are now highlighted inside the Combined note, the Final text and their Notes rows, and a text containing every term opens up while searching: to its full length in 1.6, and since 1.7 only as far as Show more opens it (at most min(56vh, 480px), scrolling inside). Those texts are still not *filtered*, and Enter still copies the top prompt card.
5. **Mixed order inside Augmented.** Parts can now be reordered with ↑ / ↓ in the Notes list. The stored order of older notes was not changed automatically (update safety); the owner can reorder them.

## Making Recaller work for everyone (asked in round 10, 2026-09-24)

The owner asked what it would take for everyday users, not just them. The answer given, in priority order:

**Must-have before handing it to anyone**
1. **Signed installer.** Without it Windows SmartScreen shows "unknown publisher", and most people stop there. Options: an OV code-signing certificate, or Azure Trusted Signing (cheaper, monthly).
2. **Auto-update** (electron-updater + GitHub Releases, since the repo is already there). People won't reinstall by hand, and fixes must reach them.
3. **Voice without an OpenAI key.** Almost nobody has an API key. Options: on-device transcription (whisper.cpp or Windows speech) as the free, private default with OpenAI as an optional upgrade; or a hosted proxy with accounts and billing (which costs money and needs abuse protection).
4. **Onboarding.** A short first-run tour on top of the Welcome project and the 1.7 help panel, and names/labels checked with 3–5 real users (Cooking/Cooked/Served are the owner's words).
5. **Getting data in and out.** Import from text/Markdown/clipboard and export a column or the Served text to `.md`/`.txt`.
6. **Feedback and crash reports** (opt-in), plus a privacy note. Anything paid also needs terms.

**Should-have**
7. **A macOS build: done for the owner's own use** in the seventh session (the Mac edition of 1.16.0 on branch `masos`, ad-hoc signed, Apple Silicon only; see `08`). **Still open for everyone else:** an Apple Developer ID and notarization, and possibly Intel Macs (see "The Mac edition" below). Many AI-tool users are on Mac.
8. **Accessibility:** keyboard alternatives for every drag and swipe (some exist: U, Delete), keyboard column resize, screen-reader labels, checked contrast.
9. **Light theme polish and "follow system theme".** Advanced voice settings behind an "Advanced" toggle.
10. **An in-app "What's new"** after updates.

**Later / decisions for the owner**
11. **Sync across devices / cloud backup:** big, and needs accounts. (The owner now has two computers; for now each has its own board.)
12. **Distribution:** a landing page, GitHub Releases, winget or the Microsoft Store (and a dmg download for the Mac).
13. **Business model:** free or paid, who pays for transcription, and support.

## The Mac edition: what's still open (seventh session)

The Mac edition of 1.16.0 was built for the owner's own use on branch `masos` and is uncommitted (see `14_macos.md` for the whole of it, `08` "1.16.0 for Mac", and `11` #49 onward). Still open:

1. **Signing and notarization for sharing.** The dmg is ad-hoc signed. That is enough on the owner's Mac, where a copy they download or AirDrop needs **Open Anyway** once, but sharing it properly needs an Apple Developer ID ($99 a year), the hardened runtime and notarization. An ad-hoc signature also changes with every build, so macOS may ask again for the microphone, for Screen Recording and for the "Recaller Safe Storage" keychain item after each update. A stable Developer ID signature would stop that. (Question 15.)
2. **Intel Macs.** The dmg is arm64 only; Intel Macs would need a universal (or x64) build. (Question 16.)
3. **Moving the PC's notes to the Mac.** Not done; the owner hasn't decided (question 17). If they want it: quit Recaller on the Mac (⌘Q; closing the window only hides it), then copy only `recaller-data.json` and `images/` from `%APPDATA%\Recaller` into `~/Library/Application Support/Recaller`. That replaces the board the Mac has had since the owner's first run (late on 2026-09-29), so check its backups first. Don't copy `recaller-settings.json`: its API key is DPAPI-encrypted and can't be decrypted on a Mac (enter the key again there), its saved hotkey `CommandOrControl+Alt+R` would mean ⌥⌘R on a Mac, and its window bounds come from the ultrawide.
4. **Whether to merge `masos` into `main`** (question 18). The Windows build from `masos` is meant to be identical to 1.16.0, but it hasn't been rebuilt, and the suites haven't been run on the PC from `masos`. Do both before shipping Windows from `masos`.
5. **A Mac look review** (question 14). Retina draws 1.5px borders at full weight, so the arrow ring and the composer ring look slightly heavier than on the 1× PC, and the frame edge reads stronger at 2×. Nothing was tuned for Retina.
6. **Full screen and snips.** Snipping over another app's full-screen Space is untested; `setVisibleOnAllWorkspaces` is avoided on purpose, because it flickers the Dock. A snip started while Recaller itself is in full screen first leaves full screen, and the window comes back windowed afterwards, not in full screen.
7. **Start at login** isn't built, on either computer.
8. **Not verified by a session, and not reported by the owner yet:** real key presses (the ⌘ shortcuts, ⌃⌥R, and whether ⌘Z reaches the page or the menu first), the real traffic lights, installing from the dmg, and the microphone, Screen Recording and keychain prompts. The suites only load the packaged `app.asar` in the development Electron; the owner first opened the packaged Recaller.app itself late on 2026-09-29 (from the dmg, then copied into `/Applications`), and how that went isn't recorded. `npm run dist:win` hasn't been run yet either.
9. **Small Mac rough edges:**
   - Run from source (`npm start`, the suites), the app menu is titled "Electron". The packaged app should say "Recaller"; that isn't confirmed yet.
   - The Mac draft flush on `beforeunload` checks `draftTimer`, which is never cleared after its save runs. So once any draft or column pick has been saved in a session, every unload sends one more save of the data in memory. That's harmless, but it's one more reason to quit Recaller before copying data files in.
   - The test harness's `macRect()` takes x from the outermost display but y from the pointer's display. With an external display at a different height, the 2px sliver could land on no display at all. It has only run on the built-in screen.

## Known issues and rough edges

1. **Internal names still say Augmented and used.** Functions `augmentedText()`, `copyAugmented()`, `moveAugmentedToFinal()`, `startAugGesture()`, CSS `.used*` / `.aug-*`, and flags like `usedCollapsed`. They're internal only; `STAGE_NAME` holds the screen names. Renaming CSS/JS is safe (not data), but it's churn; data field names must never change.
2. **The resize handle has no keyboard equivalent.** Widths can only be changed with the mouse (reset works from the menu and the top bar).
3. **`prefs.colWidths` keeps entries for deleted projects.** Deliberate: undoing a project delete brings its width back. The top-bar reset clears them all, but it only runs, and its button is only enabled, while some current project has a custom width. If only deleted projects' widths remain, the button is disabled and those entries stay in the file.
4. **Whole-text edit merges parts.** Saving a *changed* whole Cooked or Served text replaces its parts with one note (as in 1.5). Per-part editing (✎ in Notes) avoids that. Watch whether the owner expects the parts to survive a whole-text edit.
5. **Mixed prompt order in old columns.** Since 1.7 new prompts go to the bottom, but prompts saved earlier stay newest-first until the owner uses ⋯ → Sort prompts oldest first. It isn't done automatically (update safety; the owner may have ordered some by hand).
6. **`cardTarget()` has an unused `project` variable.** Trivial.
7. **The row trash hides behind the Notes toggle (1.15).** Deleting one prompt from Cooked takes Notes → hover → trash. The Notes list is closed at start and isn't remembered. If the owner doesn't find it, options: open the list by default when Cooked has 2+ notes, remember `augPartsOpen` per column, or make Delete work on a focused row. A hovered row at slim width keeps only ~60px of its text for the five buttons. See also item 14.
8. **Deleting a note from Cooked/Served isn't animated.** The row and the text just update (like ↑ / ↓). Cards animate out; stage parts don't.
9. **The board arrows are less discoverable (1.16).** They show only within 96px of the board's edge, so someone who never moves there won't see them. The wheel, drag-to-pan and the scrollbar still work, and README explains it. If the owner misses them, options: a faint edge hint (a thin gradient or a small notch) while the board overflows, or a wider zone.

Found by the seventh session's audit of the code. They are reported here and **not fixed**: the Mac edition was not allowed to change Windows behaviour.

10. **On Windows, the last keystrokes of a draft can be lost on close or quit.** Draft typing, and `prefs.lastProjectId`, are saved through `persistSoon()`, a 400ms debounce in the page. On Windows nothing sends a waiting save when the window closes or the app quits: the page's `beforeunload` only saves the scroll positions, and main's `flushData()` only writes what the page has already sent. The Mac edition fixes this on the Mac only (a `beforeunload` flush, plus main flushes on `closed` and `will-quit`). Also, `rememberProject()` runs only on a pointer press inside a column, so a column reached by keyboard, menu or search isn't remembered as the last one used.
11. **A failed restore silently drops every later edit.** `restoreBackup()` makes a before-restore backup, sets `restoring = true` and writes the backup's data with `writeJsonAtomic()`, with no try/catch around them. If the write throws, `restoring` stays true and the page isn't reloaded, so every later `data:save` is ignored and `flushData()` does nothing until the next `data:load` (a reload or a restart). The invoke also rejects instead of returning `{ ok: false }`, and the Restore button's handler has no try/catch, so no toast appears. (If the before-restore backup throws, `restoring` isn't set yet, but there's still no toast.)
12. **An unreadable data file can be overwritten by the Welcome board.** If `recaller-data.json` and its `.bak` both fail to parse, `loadData()` returns null. The page then builds the Welcome board and saves it, and main overwrites the unreadable file about 250ms later. If the file parses but `projects` isn't an array, `normalize()` returns null and the Welcome board is shown, and the first change overwrites the file (straight away if the file's `version` is missing or below 2). After that the only good copies are in `backups/` (Settings › Backups), so recovery advice should point there. This matters most when notes are copied between computers by hand. `normalize()` also drops notes whose text isn't a string, images with a bad id and projects that aren't objects, and replaces missing or duplicate ids.
13. **Ctrl+N (⌘N on a Mac) throws away an open edit.** Opening another editor (New prompt, Dictate, a right-click or pencil, E or F2, Ctrl+N) and undo/redo call `stopEditing()` or `closeStageEditors()`, which remove an open card editor or Cooked/Served editor without saving; only the new-prompt composer keeps its text, as a draft. The global Ctrl+K, F, N, M, comma, Shift+N and Shift+S keys have no "typing" guard (only Z and Y do), so Ctrl+N works even while typing in a card editor, and discards that edit along with any dictation running in it. On a Mac ⌃N is a text-editing key and no longer does this, but ⌘N still does.
14. **A press on a Cooked Notes row acts on the whole Cooked note.** The Notes list (`.aug-parts`) sits inside `.aug-note`, so pressing a row anywhere except its buttons starts the whole-note gesture (`startAugGesture`): a click copies all of Cooked, a left swipe moves the whole note to Served, and a drag moves it. A stray left swipe on a row sends everything to Served (undoable). A plain click on a Served row does nothing. No check covers it. It bears on item 7 and question 11.
15. **A second Esc (or ✕) while the composer shows "Writing…" drops dictation.** The first Esc stops listening. A second one closes the composer while phrases are still queued or streaming, and those are lost; only text already inserted survives, in the draft.
16. **The selection bar can be stale.** Clicking the Cooked note or the Served text overwrites the clipboard but leaves a Ctrl+click selection and its "n notes copied" bar in place. Only a card click (`copyNote`) clears the selection.
17. **"Minimize after copying" and multi-copy.** Ctrl+click copies (⌘-click on a Mac) never minimise or hide the window; only single copies do. With the setting on, a plain click minimises or hides the window, and the blur clears the Explorer-style anchor, so "a plain click, then Ctrl+clicks" never includes the first note.
18. **A Served text with only pictures copies nothing.** `copyFinal()` stops when the text is empty, while the Cooked note copies its first picture in that case.
19. **Settings can misstate the API key.** It says "Saved and encrypted on this PC" (on a Mac, "Saved in your Mac’s keychain") whenever the settings file holds any key object. That includes a `{ plain }` key (saved unencrypted when OS encryption was unavailable) and a key that can't be decrypted, such as a DPAPI key copied from the PC to a Mac. For a key that can't be decrypted, `getApiKey()` silently falls back to `OPENAI_API_KEY`.
20. **Backups contain the API key.** Every backup folder copies `recaller-settings.json`, including the saved key (in plain text if it was saved as `{ plain }`). Never share a backup folder. Restore writes back only the data file.
21. **Enter closes Settings.** Settings is a `<form method="dialog">`, so pressing Enter in the API key, Language or Vocabulary field closes it (the typed key is saved on close). Any new button in Settings needs `type="button"`.

## Untested in real conditions

These were covered only by simulations: a fake microphone, a mock OpenAI server, a single display.

- **Real OpenAI calls with the owner's real API key.**
  - Streaming format: the event names come from OpenAI's docs, and there is a non-streaming fallback.
  - The `languages[]` field.
  - The `prompt` context.
  - Error responses (401 and 429 messages).
- **A real microphone** on the owner's hardware, and how well the adaptive voice detection cuts phrases for their voice and room. The owner confirmed in round 2 that transcription came out correct. On the Mac, the microphone has never been used for real.
- **Multi-monitor screenshots**, and displays scaled above 100%. The crop maths uses the display bounds and scale factor, but was only tested at 100%. On the Mac's 2× Retina screen the suites skip the real snip, so it is untested there too; its images would be stored at 2× (a whole-screen snip of 3024×1964).
- **Global hotkeys clashing** with the owner's other apps. Ctrl+Alt+R was chosen to avoid VS Code's Ctrl+Shift+Space. On the Mac, ⌃⌥R was chosen to avoid VS Code's ⌥⌘R (Reveal in Finder); clashes there are untested.
- **Column resizing with a real mouse** on the owner's ultrawide (the suite drives it with synthetic input).
- **macOS:** the Mac edition passes the Mac-safe suites, but only with synthetic input, the fake microphone and no real snip. The session never launched its packaged app; the owner's first run at the end of the seventh session isn't reported yet (see "The Mac edition" above).
- **Linux:** never built or run.

## Ideas offered or likely wanted (not requested yet)

- **Import prompt files:** import `Dev Prompts.txt` and `Longterm Prompts.txt` (they were next to the old `iresine\recaller` folder, in `C:\Users\User\Documents\iresine` on the PC) as projects. This was offered at the end of 1.0.0; the owner didn't respond.
- **Export and share:** export a project or the Served text to `.md` or `.txt`.
- **Drag to reorder parts** inside the Notes lists (1.6 has ↑ / ↓ buttons).
- **Archive history:** keep a history of cleared Served texts ("sessions") instead of just clearing.
- **Auto-update** with electron-updater and a GitHub release feed (the repo is now on GitHub). Currently the owner runs each new installer by hand.
- **Code signing,** to remove the SmartScreen warning (and a Developer ID on the Mac; see "The Mac edition" above).
- **Tray icon** (a menu-bar icon on a Mac), or start with Windows (start at login on a Mac).
- **Keyword hints:** the gpt-transcribe `keywords` parameter could replace the prompt-based vocabulary hint (the docs mention a `keywords` array).
- **Pinned prompts:** pin or favourite prompts to the top of a column.
- **Search additions:** a search filter for highlighted prompts ("is:check").
- **Per-column width via keyboard** (e.g. Alt+← / Alt+→ on a focused column).

## Technical debt

- **`src/renderer/app.js` is about 3,580 lines in one file** (3,576 in 1.16, and 3,675 with the Mac edition on `masos`). It is organised by sections but monolithic. Splitting it into modules (views, gestures, composer, stages, settings) would help. Use classic scripts or a bundler; ES modules over `file://` were deliberately avoided.
- **The data and UI names for the stages differ** (`notes` = Cooking, `used` = Cooked, `combined` = Served). This is documented everywhere; a future migration could rename them, but only with a lossless, backed-up, tested migration, and only if the owner agrees.
- **No unit tests.** Only end-to-end suites exist. The e2e suites depend on timing, and the owner's real mouse moving over the test window can occasionally interfere; re-run before debugging.
- **The test runner can report a crash as a pass.** `scripts/run-electron.js` exits with `code ?? 0`, so a suite that dies from a signal (a crash or a kill) counts as a success to npm, and `npm test` goes on to the next suite. Always check the "n/n passed" line.
- **Two suites can hang.** `multi-copy.e2e.js` and `capture-board.js` have no `.catch` on `app.whenReady().then(…)`, so an exception leaves Electron running, with its window strip, until it's killed. `features` and `update-safety` print HARNESS FAIL and exit.
- **A mistyped MODE skips most update checks.** In `update-safety`, any MODE other than `real` seeds the synthetic data, but its 12 extra checks need `MODE === 'synthetic'` exactly, so `MODE=Real` reports 9/9.
- **The suites use the real clipboard,** on both computers. Copying something during a run loses it, and can fail a check.
- **Two platforms in one codebase.** Every Mac difference sits behind `IS_MAC` (main, renderer and screenshot code; `MAC` in `voice.js`), `body.is-mac` (CSS), the `data-mac` / `data-mac-title` attributes (HTML) or the Mac build sections, and must stay fenced (`11` #49). A change to Windows behaviour should be a deliberate Windows release.
- **The Soft theme gets less attention** than Deep, which is the default and what the owner uses.

## Open questions for the owner

1. Blank line or single new line between joined notes? (The default is blank line; the setting exists.)
2. Should clearing Served archive the text somewhere instead of deleting it (it's only undoable until restart)?
3. Import the two prompt `.txt` files?
4. Do they want auto-update or code signing? (For the Mac, see question 15.)
5. Is Instrument Sans the right column-title font? (Default since 1.6; eight alternatives are in Settings.)
6. Should the count next to "Cooked" go too? (1.6 removed only the counter on the last stage, now Served, as asked.)
7. "All the colors are girly": did that mean only the Combined colours (changed in 1.7), or also the project palette (Blossom pink, Orchid, Fuchsia)? If the palette, offer a muted set.
8. Which everyday-user items (above) to start with? The suggested first three are signing, auto-update and key-free voice.
9. Is the 1.9 calm board calm enough with many columns? If not, offer a "calm headers" option (dark neutral header with a coloured stripe) or a narrower Compact default. Ask; don't impose.
10. Which Cooked colour do they like? (Ocean is the default since 1.13; Teal, Midnight and Graphite are in Settings. Brown is out.)
11. Does the 1.15 delete match what they meant by "delete something in cooked": one prompt (Notes → trash) or the whole note (right-click → trash)? Is the row trash easy enough to find?
12. Does the 1.14 picture flow (copy the text, then click the picture and copy again) work where they paste?
13. The 1.16 board frame (answered: "a border to organize everything" meant the board frame, not the arrow): is the frame's edge right (strength, the bright top-left sheen, the 12px margin)? Should the arrows keep their emerald ring now that the frame exists? Is showing the arrows only near the edge (96px) right?
14. Does the Mac edition look and feel right on the Retina screen? The 1.5px rings and the frame edge read heavier at 2× than on the PC.
15. Should the Mac app get a Developer ID ($99 a year) and notarization, to share it and to stop macOS asking for permissions again after each update? ("Just me for now" was the answer for the first build.)
16. Are Intel Macs needed (a universal build)?
17. Move the PC's notes to the Mac, or keep a separate board on each computer?
18. Merge `masos` into `main`, and when?
19. Was 1.16.0 ever installed on the PC? (Unknown since the fifth session.)

## Suggested next steps for whoever continues

1. Read `README.md` → `03` → `04` in this folder, and `14` before any Mac work.
2. Run `npm install`, then `npm test`, and confirm everything is green: 12 + 21 + 134 checks on Windows, and 12 + 21 + 139 on a Mac (the real snip's 3 checks are skipped there and 8 Mac checks added). On the Mac the suites keep out of the way (2px windows, no Dock icon, no focus stealing, no microphone or screen recording), but they overwrite the clipboard. The owner approved running them on the Mac in the seventh session ("Yes, run them"). Run them on a Mac only from a branch that has `tests/e2e/mac-harness.js` (`masos`); on `main` or `v1` they are the Windows-only suites and would, among other things, snip the real screen.
3. Check what's installed. On the PC it's unknown since the fifth session: 1.15.0 was installed then, and 1.16 was committed later, so ask. On the Mac the owner opened the packaged 1.16.0 from the dmg and copied it into `/Applications` at the very end of the seventh session; that run created `~/Library/Application Support/Recaller`, which now holds their real notes. Ask how the first install, the permission prompts and the Mac look went (question 14), and whether the 1.16 frame and arrows are right (question 13). Questions 11 and 12 were never answered either.
4. Check git. `main` = `origin/main` = `dd5a3b0`, the PR #1 merge of `v1`, which holds 1.16.0. `v1` = `origin/v1` = `664212a` "1.16". `masos` (created and published by the owner from `main`) holds the Mac edition, uncommitted in the working tree. `stash@{0}` is the discarded 1.17.0 attempt: leave it alone. The owner commits versions themselves ("1.8" … "1.16") and pushes through GitHub Desktop; don't commit, fetch, pull or push unless asked.
5. Ask the owner the open questions above before building bigger features. The everyday-user roadmap at the top of this file is the biggest next step if they want to share Recaller.
