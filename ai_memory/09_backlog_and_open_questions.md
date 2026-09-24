# 09: Backlog, known issues and open questions

## Known issues (fix these first)

1. **"Clear used" clears the wrong stage.**
   - Where: the project ⋯ menu item "Clear used (N)", which calls `clearUsed()` in `src/renderer/app.js`.
   - What happens: it empties data `project.used`, which the UI now calls **Augmented**. Its toast says "Cleared N used".
   - What's missing: there is no way to clear the final **Used** text (data `project.combined`).
   - Suggested fix:
     - Rename the item to "Clear Augmented (N)".
     - Add "Clear Used (N)", which empties `project.combined`, with a checkpoint and an Undo toast.
     - Consider putting a small "Clear" action in the Used block's footer.
     - Add both to `tests/e2e/features.e2e.js`.
   - Ask the owner whether clearing Used should archive the text instead of deleting it.
2. **The card "move back" button is never shown.** The `.act-back` button (restore icon) on cards was only for when Augmented showed cards (1.4.0). Cards now only live in the prompts stage, so it is always hidden. It is harmless dead UI; remove it, or reuse it later.
3. **Leftover dead code from 1.4.0:**
   - `addToFinal()` is still used when a *prompt card* is dropped directly onto Used; that use is valid.
   - The `swipe-add` swipe path in `beginSwipe` and `swipeEnd` (`g.toFinal`) can no longer trigger, because no cards sit in Augmented.
   - The CSS for `.card-wrap.is-used` is unused.
   - Clean these up carefully.
4. **Search doesn't cover the Augmented and Used texts.** It only filters prompt cards; decide whether it should also highlight matches in the combined texts.
5. **The Augmented order mixes two conventions.** Notes moved into Augmented before 1.5.0 (by the old ✓ button) were put at the top, while newer ones are appended at the end. Existing combined notes may therefore read newest-first for older items. Parts can't be reordered yet, only sent back.

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
- **macOS and Linux:** never built or run. A minimal menu exists for macOS; the rest is Windows-focused.

## Ideas offered or likely wanted (not requested yet)

- **Import prompt files:** import `Dev Prompts.txt` and `Longterm Prompts.txt` (next to the `recaller` folder) as projects. This was offered at the end of 1.0.0; the owner didn't respond.
- **Export and share:** export a project or the Used text to `.md` or `.txt`.
- **Reorder in combined notes:** allow reordering parts inside Augmented and Used (drag within the Notes list).
- **Archive history:** keep a history of cleared Used texts ("sessions").
- **Auto-update** with electron-updater and a GitHub release feed. Currently the owner runs each new installer by hand.
- **Code signing,** to remove the SmartScreen warning.
- **Tray icon,** or start with Windows.
- **Keyword hints:** the gpt-transcribe `keywords` parameter could replace the prompt-based vocabulary hint (the docs mention a `keywords` array).
- **Pinned prompts:** pin or favourite prompts to the top of a column.
- **Search additions:** a search filter for highlighted prompts ("is:check").

## Technical debt

- **`src/renderer/app.js` is about 3,200 lines in one file.** It is organised by sections but monolithic. Splitting it into modules (views, gestures, composer, stages, settings) would help. Use classic scripts or a bundler; ES modules over `file://` were deliberately avoided.
- **The data and UI names for the stages differ** (`used` = Augmented, `combined` = Used). This is documented everywhere; a future migration could rename them, but only with a lossless, backed-up, tested migration, and only if the owner agrees.
- **No unit tests.** Only end-to-end suites exist. The e2e suites depend on timing, and the owner's real mouse moving over the test window can occasionally interfere; re-run before debugging.
- **The Soft theme gets less attention** than Deep, which is the default and what the owner uses.

## Open questions for the owner

1. Blank line or single new line between joined notes? (The default is blank line; the setting exists.)
2. Should Used be clearable or archivable, and does Augmented need a "Clear" too?
3. Import the two prompt `.txt` files?
4. Do they want auto-update or code signing?
5. Is Sora the right column-title font now? (It is the default; five alternatives are in Settings.)

## Suggested next steps for whoever continues

1. Read `README.md` → `03` → `04` in this folder.
2. Run `npm install`, then `npm test` and confirm everything is green: 12 + 20 + 69 checks.
3. Fix known issue #1 (clearing the wrong stage) with tests, then bump to 1.5.1 and follow the release checklist in `06`.
4. Ask the owner the open questions above before building bigger features.
