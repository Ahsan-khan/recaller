# 09: Backlog, known issues and open questions

## Fixed in 1.6.0 (the five known issues from 1.5.0)

1. **"Clear used" cleared the wrong stage.** The ⋯ menu now has **Clear Combined (n)** (data `used`) and **Clear Final (n)** (data `combined`), both undoable with a toast. Clearing archives nothing; see open question 2.
2. **The card "move back" button was never shown.** `.act-back` and its handler were removed.
3. **Leftover dead code from 1.4.0.** The swipe-to-Used path (`g.toFinal`, `swipe-add`), `addToFinal()`, the `is-used` card class and its CSS, and `drag-ghost.is-used` were removed. (A prompt dropped straight onto Final still works; that goes through `dragEnd`.)
4. **Search skipped the combined texts.** Terms are now highlighted inside the Combined note, the Final text and their Notes rows, and a text containing every term opens up to full length while searching. Those texts are still not *filtered*, and Enter still copies the top prompt card.
5. **Mixed order inside Augmented.** Parts can now be reordered with ↑ / ↓ in the Notes list. The stored order of older notes was not changed automatically (update safety); the owner can reorder them.

## Known issues and rough edges

1. **Internal names still say Augmented and used.** Functions `augmentedText()`, `copyAugmented()`, `moveAugmentedToFinal()`, `startAugGesture()`, CSS `.used*` / `.aug-*`, and flags like `usedCollapsed`. They're internal only; `STAGE_NAME` holds the screen names. Renaming CSS/JS is safe (not data), but it's churn; data field names must never change.
2. **The resize handle has no keyboard equivalent.** Widths can only be changed with the mouse (reset works from the menu and the top bar).
3. **`prefs.colWidths` keeps entries for deleted projects.** Deliberate: undoing a project delete brings its width back. The top-bar reset clears them all.
4. **Whole-text edit merges parts.** Saving a *changed* whole Combined or Final text replaces its parts with one note (as in 1.5). Per-part editing (✎ in Notes) avoids that. Watch whether the owner expects the parts to survive a whole-text edit.
5. **Empty Combined blocks are prominent.** Since 1.6 the Combined header is a solid indigo band even when empty. If the owner finds empty columns too loud, soften the band for `.used.is-empty`.
6. **`cardTarget()` has an unused `project` variable.** Trivial.

## Untested in real conditions

These were covered only by simulations: a fake microphone, a mock OpenAI server, a single display.

- **Real OpenAI calls with the owner's real API key.**
  - Streaming format: the event names come from OpenAI's docs, and there is a non-streaming fallback.
  - The `languages[]` field.
  - The `prompt` context.
  - Error responses (401 and 429 messages).
- **A real microphone** on the owner's hardware, and how well the adaptive voice detection cuts phrases for their voice and room. The owner confirmed in round 2 that transcription came out correct.
- **Multi-monitor screenshots**, and displays scaled above 100%. The crop maths uses the display bounds and scale factor, but was only tested at 100%.
- **Global hotkeys clashing** with the owner's other apps. Ctrl+Alt+R was chosen to avoid VS Code's Ctrl+Shift+Space.
- **Column resizing with a real mouse** on the owner's ultrawide (the suite drives it with synthetic input).
- **macOS and Linux:** never built or run. A minimal menu exists for macOS; the rest is Windows-focused.

## Ideas offered or likely wanted (not requested yet)

- **Import prompt files:** import `Dev Prompts.txt` and `Longterm Prompts.txt` (they were next to the old `iresine\recaller` folder, in `C:\Users\User\Documents\iresine`) as projects. This was offered at the end of 1.0.0; the owner didn't respond.
- **Export and share:** export a project or the Final text to `.md` or `.txt`.
- **Drag to reorder parts** inside the Notes lists (1.6 has ↑ / ↓ buttons).
- **Archive history:** keep a history of cleared Final texts ("sessions") instead of just clearing.
- **Auto-update** with electron-updater and a GitHub release feed (the repo is now on GitHub). Currently the owner runs each new installer by hand.
- **Code signing,** to remove the SmartScreen warning.
- **Tray icon,** or start with Windows.
- **Keyword hints:** the gpt-transcribe `keywords` parameter could replace the prompt-based vocabulary hint (the docs mention a `keywords` array).
- **Pinned prompts:** pin or favourite prompts to the top of a column.
- **Search additions:** a search filter for highlighted prompts ("is:check").
- **Per-column width via keyboard** (e.g. Alt+← / Alt+→ on a focused column).

## Technical debt

- **`src/renderer/app.js` is about 3,400 lines in one file.** It is organised by sections but monolithic. Splitting it into modules (views, gestures, composer, stages, settings) would help. Use classic scripts or a bundler; ES modules over `file://` were deliberately avoided.
- **The data and UI names for the stages differ** (`used` = Combined, `combined` = Final). This is documented everywhere; a future migration could rename them, but only with a lossless, backed-up, tested migration, and only if the owner agrees.
- **No unit tests.** Only end-to-end suites exist. The e2e suites depend on timing, and the owner's real mouse moving over the test window can occasionally interfere; re-run before debugging.
- **The Soft theme gets less attention** than Deep, which is the default and what the owner uses.

## Open questions for the owner

1. Blank line or single new line between joined notes? (The default is blank line; the setting exists.)
2. Should clearing Final archive the text somewhere instead of deleting it (it's only undoable until restart)?
3. Import the two prompt `.txt` files?
4. Do they want auto-update or code signing?
5. Is Instrument Sans the right column-title font? (Default since 1.6; eight alternatives are in Settings.)
6. Should the count next to "Combined" go too? (1.6 removed only the Final counter, as asked.)

## Suggested next steps for whoever continues

1. Read `README.md` → `03` → `04` in this folder.
2. Run `npm install`, then `npm test` and confirm everything is green: 12 + 21 + 96 checks.
3. Check which version the owner has installed (see `13`) and ask how 1.6.0 feels, especially the new stage colours, the title font and resizing.
4. Ask the owner the open questions above before building bigger features.
