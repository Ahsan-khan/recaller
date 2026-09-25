# 08: Changelog

Dates are 2026-09-23 and 2026-09-24. Versions 1.0.0 to 1.5.0 were built in one long session; 1.6.0 in a second session on 2026-09-24. Versions refer to `package.json` and the installer `dist/Recaller Setup <version>.exe`.

## 1.0.0 (first build)

- **Platform:** Electron app with vanilla JavaScript and no bundler; NSIS installer with desktop and Start-menu shortcuts; generated monstera icon.
- **Layout:** projects as columns on one horizontal board, and prompts as cards.
- **Projects:** create, rename (double-click), recolour, reorder (drag the header or use the menu), delete with Undo.
- **Notes:**
  - Click to copy, with a ripple and a "Copied" chip; copy counts are kept.
  - Swipe left to delete, with an Undo toast.
  - Hold and drag into a **Used** section (collapsible) or to another project; the Used section was a list of cards.
  - Card editing, keyboard shortcuts, and search with highlighting (Enter copies the top match).
- **Voice:** OpenAI transcription (the default was gpt-transcribe) with a single request after stopping recording, and Retry on failure. The API key is encrypted with DPAPI.
- **Other:**
  - Global show/hide hotkey Ctrl+Alt+R.
  - Drafts kept when the composer closes.
  - Optional "minimise after copying".
  - Window bounds remembered; single-instance lock.
  - Atomic data writes with a `.bak` copy.
- **Look:** a light "monstera" theme with the Fraunces serif for titles and wide 340px columns.

## 1.1.0

- **Screenshots:** a region-snip overlay (drag an area, click for the whole screen, Esc to cancel).
  - Images can also be pasted or dropped.
  - Image storage in `images\` with the `recaller-img://` protocol, thumbnails, a lightbox, and click-to-copy images.
- **Undo/redo:** snapshot-based (Ctrl+Z / Ctrl+Y and toolbar buttons). Toast Undo became the same history.
- **Voice:** live phrase-by-phrase dictation.
  - Voice-activity segmentation with overlapping recorders.
  - Streamed transcription.
  - The previous text is sent as context.
  - A red Stop pill with timer and level bars.
  - Save during recording finishes, then saves.
  - Retry and Discard on errors.
  - Silent segments skipped.
- **Look:** a modern emerald redesign.
  - Dotted canvas; distinct palette per column; tinted headers.
  - A separate Used tray colour.
  - The `+` and mic moved into column headers.
- **Navigation:** horizontal scroll arrows, wheel-to-horizontal, drag-to-pan and middle-drag pan.
- **Slim columns (268px),** with a Compact/Slim/Roomy setting.
- **Global "screenshot to note" hotkey** (off by default).
- **Data format:** v2 (`images`, `draftImages`, `prefs.density`). v1 projects were recoloured once (this step was removed in 1.3.0).

## 1.2.0

- **Augmented section** under Used: all Used notes joined into one text with a blank line between them, plus "Copy all". (Its meaning changed in 1.4.0 and 1.5.0.)
- **Deep theme,** the new default: a dark forest canvas, solid colour headers and a dark top bar matched to the Windows title bar. Soft theme remains optional.
- **Ctrl+click multi-copy** with numbered badges and a selection bar ("Move to Used", "Clear").
- **Palette** changed to spread-out hues: emerald, sky, sun, orchid, lime, blossom, teal, bark.

## 1.3.0

- **Update safety:**
  - Loading is lossless (unknown fields kept, user choices never rewritten).
  - No write on startup; the userData path is pinned.
  - Settings get a `.bak` copy; `deleteAppDataOnUninstall: false`.
  - `lastVersion` recorded, with an automatic **upgrade backup** before a new version runs and **daily backups**.
  - Settings → Backups offers list, back up now and restore; restore saves a "before restore" backup first.
  - Image cleanup respects backups.
- **Remembered state:** scroll positions, expanded cards, the last-used column.
- **Fonts:** switched to Geist (UI) and Geist Mono (numbers and labels).
  - Column headings became larger and bolder with neutral tracking; section labels became darker.
  - Then: a column-title font picker (Sora, the default; Space Grotesk; Inter Display; Manrope; Geist; Sora Caps), and the text-shadow was removed.
- **Startup** no longer depends on animation frames.

## 1.3.1

- **Ctrl+click fixes:**
  - The Explorer-style anchor (a plain click followed by Ctrl+clicks includes the first note).
  - The selection clears on window blur, Esc anywhere, or a click on empty canvas.
  - Clipboard writes are serialised.

## 1.4.0

- **Highlighting:** four colours (Check again, Important, Idea, Ready) from the card's hover menu, or H.
- **Stage swap:** the middle stage was labelled **Augmented** and a new bottom stage **Used** was added as the final combined text (data `combined`). At first, Augmented showed individual cards, and swiping one left added it to Used.
- **New prompt bar:** a full-width bar under each header, and the header keeps only ⋯. Long names wrap to two lines.
- **Editing while recording:** the textarea stays editable, and dictation follows the user's edits without moving the caret.
- **Stage colours:** new prompts white, Augmented indigo, Used deep green.
- **Copy all** moved into the Used header, and changes to "Copied" instead of showing a floating chip (the chip had overlapped text).
- **Scroll positions** are saved only when the user scrolls, so a clamped restore never overwrites them.

## 1.14.0 (current)

- **Screenshots in Cooked and Served:** the owner found that pasting the copied Cooked text didn't bring the screenshot they had attached in Cooking. The images always moved with their prompts but were never shown or copied. Both stages now show every picture as a strip of small tiles under the text. Click a tile to copy that picture; the expand icon opens the lightbox.
- **The text is still copied on its own**, and its chip now says "Text copied" when the stage has pictures. Copying text and picture together was tested and rejected: the Claude Code VS Code chat box (and very likely claude.ai and ChatGPT) keeps only the picture and drops the text (`07` #54). A Cooked note with pictures but no text copies its first picture.
- Help panel and README explain it: click the text and paste, then click the picture and paste.
- **Tests:** features 121 checks (new: the Cooked strip shows the picture, the Cooked text copies without it, a tile copies the picture, the picture moves to Served, the Served tile and text copy separately, and undo puts it all back).

## 1.13.0

- **Cooked recoloured again, and restyled:** the owner said the caramel (brown) default "looks like shit". Cooked is now a **light section like Served**: a pale block, a coloured "COOKED" label with no dark header band, a white note, and one filled accent. The default is **Ocean** (#3a6fb5 on #e9f1fb).
- **Settings › Cooked colour** now offers Ocean, Teal, Midnight and Graphite. The browns (Caramel, Espresso, Terracotta) and the band palettes (Petrol, Slate) are gone. A stored old value (e.g. `caramel`) draws as Ocean; the stored value itself is left alone.
- **Tests:** the Cooked checks now expect a light section with no band, a blue accent by default, and 4 picker options (114 checks). The picker check now waits for the colour change instead of a fixed pause (it flaked once on the packaged build). The stage-contrast check compares the Cooked and Served label colours instead of requiring a band.
- Verified: 12 + 21 + 114 on source and on the packaged build, 9/9 on a copy of the real data.

## 1.12.0

- **Cooked colour picker:** the owner called the slate Cooked "too ugly" (after rejecting violet in 1.7). Six palettes were rendered side by side on a real board. **Caramel** (warm golden-brown, fitting "Cooked") is the new default, and **Settings › Cooked colour** offers Caramel, Espresso, Petrol, Graphite, Terracotta and Slate as live preview tiles. Stored in `prefs.cookedColor` only when picked.
- Every Cooked colour (band, block, note, Move to Served bar, the card's ↓ Cooked button, the help dot) now derives from one palette. The hard-coded slate shadows and tints became `color-mix()` of `--aug-bar`.
- **Tests:** features 114 checks (the band check is now "deep, muted, not violet"; new: the picker has 6 options, Caramel is the default, and a pick recolours and saves).

## 1.11.0

- **Card hover bar:** now just the highlighter and a filled slate **↓ Cooked** button (the owner moves prompts to Cooked ~90% of the time). The edit pencil was removed: right-click the card or press E / F2.
- Help panel and guide say "hover a prompt and click ↓ Cooked" instead of "the stack icon".
- **Tests:** features 113 checks (new: the hover bar has exactly the highlighter and a prominent ↓ Cooked).

## 1.10.0

- **Served is lighter:** a light sage section (#e4eee8, border #c6dccd) with a deep-green label and a near-white text box, instead of the solid deep-green block. The owner: "it will always be served", so it needs less emphasis. Cooked (slate band) is now the strongest stage.
- **Right-click to edit:** right-clicking a prompt card opens its editor. On the Cooked note or the Served text it opens the whole-text editor; on a row of a Notes list it edits that part alone. If text is selected, the normal Copy menu shows instead.
- **Saving a new prompt closes the editor** (typed or dictated, including Save during dictation) and the New prompt | Dictate buttons come back. Before, the editor stayed open and empty for the next prompt.
- **Help panel:** "Edit anything" mentions right-click.
- **Tests:** features 112 checks (new: save closes the editor; right-click edits all four targets; Esc after a right-click edit changes nothing; Served is light).

## 1.9.0

A calmer board with many columns, using no extra space (empty columns got shorter):

- **One calm surface for every column:** #eef2f0 in Deep (#f6f8f7 in Soft) instead of each column tinted by its colour. Colour stays in the header and the thin card bars.
- **Cooking is a plain label:** no box or border; it tints only on hover.
- **New prompt | Dictate are soft white pills:** no outline and no solid colour square. The icon is drawn in the column colour, and the outline and shadow appear on hover.
- **Empty Cooked and Served show only their faint name** (60% opacity): no dashed frame and no helper sentence at rest. While dragging they turn into a clear drop zone with the sentence.
- **Cards have no outline in Deep,** just a soft shadow. The canvas dot grid is half as strong.
- **Tests:** features 108 checks (new: one shared column background; empty Cooked shows no helper sentence at rest).

## 1.8.0

- **Kitchen stage names:** the three stages are now **Cooking** (new prompts) → **Cooked** (was Combined) → **Served** (was Final), in every label, tooltip, toast, menu item, undo label, the help panel, Settings and the welcome tips. The data names are unchanged (`notes`, `used`, `combined`).
- **Cooking header:** the prompts get a stage header like the other two: "⌄ 🔥 COOKING · n", light in the column's colour. Clicking it folds the prompt cards away (saved as `project.notesCollapsed`, only while folded). A search, a new prompt, a prompt sent back or a prompt dropped in unfold it. The prompt count moved here from the pill in the column title, which gives long names more room.
- **New prompt | Dictate:** the bar is split into two equal halves, **(+) New prompt** and **(🎙) Dictate**, instead of a wide button plus a small mic square, because the owner starts about half their prompts by voice. A draft shows as **Draft** with an amber dot. Narrow columns read **New**.
- **Tests:** features 107 checks (new: equal halves and full labels, the Cooking header and moved count, folding Cooking, a new prompt unfolding it; the stage-name checks now expect Cooked/Served).

## 1.7.0

- **Combined looks grown-up:** the bright violet band, lavender note and violet buttons became a muted slate-navy band (#47526b → #384259), a pale cool-grey block (#e6e9ef) and a near-white note. The owner called the violet "weird" and "girly"; the dark green canvas stays.
- **Quiet empty stages:** an empty Combined (and an empty Final) is now a dashed outline with its label, not a solid block. It fills in while you drag.
- **New prompts go to the bottom** of the prompt list (and a prompt sent back from Combined lands at the bottom too), so a column reads oldest → newest and flows down into Combined. Saving scrolls the new card into view. Existing columns keep their order; **⋯ → Sort prompts oldest first** lines them up (undoable).
- **Fixed-size Combined and Final:** both start at 6 lines with a fade. A slim full-width **Show more / Show less** bar under the text opens them to at most min(56vh, 480px), scrolling inside. The opened state is no longer saved, so they always start small (the old `usedExpanded` / `augExpanded` flags stay in the file but aren't read). The Notes lists are capped at 220px and scroll.
- **Friendlier:**
  - A **?** button in the top bar (also `F1`, or `?` when not typing) opens "How Recaller works": the three stages, handy moves and shortcuts (it shows the user's own show/hide key).
  - Settings is split into sections: Appearance, Voice, Shortcuts & behaviour, Your data.
  - The empty prompt list says "No prompts yet. Click New prompt to add one."
  - The Combined/Final footers have room for their word counts again.
- **Fixed a growing-text bug (present since 1.2):** once a Combined or Final text had fitted, its `fits` class lifted the height limit for good. So as notes were added it grew without limit, until the page was reloaded and re-measured. `fits` now only drops the fade.
- **Fixes:** the mouse wheel over an opened-up Combined/Final text (or a long Notes list) scrolls that text instead of the board; grabbing one of their scrollbars no longer starts a drag or a copy.
- **Tests:** features 103 checks (new: bottom insertion, fixed-size Final, quiet empty Combined, muted band, help panel, sorting).

## 1.6.0

- **Stages renamed on screen:** Augmented → **Combined**, Used → **Final**. The data names did not change (`used` = Combined, `combined` = Final). Every label, tooltip, toast, menu item and undo label follows.
- **Final:** the counter next to its title and the **Copy all** button were removed. Clicking the Final text still copies all of it, with a "Copied" chip.
- **Editing Combined and Final:**
  - The footer pencil edits the whole text of either stage (Final gained one). Saving an unchanged text now does nothing, so the separate notes are kept.
  - Each row in the **Notes** list has ↑ / ↓ (reorder), ✎ (edit just that note; the others stay separate; the editor's trash deletes it) and ↩ (send back up a stage). The buttons show on hover.
  - The toggle reads "Notes" in both states and looks pressed while open, so the word counts fit.
  - A prompt that lands in the stage while its whole-text editor is open is kept on save, after the edited note (in 1.5 it would have been overwritten).
- **Stage look, more distinct:** Combined is an indigo block with a solid header band and a lavender note; Final keeps its deep-green block, with a mint text box instead of white.
- **Column resizing:** drag a column's right edge (a line appears on hover). The width snaps to the default within 6px. Double-click the edge, or **⋯ → Reset width**, resets one column. A new ↔ button in the top bar resets every column (Undo on the toast restores them). Widths are stored in `prefs.colWidths`.
- **Top bar:** the green **+ Project** button was removed. The "+ New project" tile at the end of the board and Ctrl+Shift+N remain.
- **Column colours:** 10 more (Indigo, Ember, Lagoon, Ruby, Forest, Fuchsia, Slate, Mustard, Navy, Wine), 18 in all, shown in two rows in the ⋯ menu.
- **Column title font:** Instrument Sans is the new default (sharper and cleaner than Sora). Plus Jakarta Sans and Onest were added to the picker, now nine tiles. A title font the user picked explicitly is kept.
- **Known issues fixed:**
  - The old "Clear used" emptied the wrong stage. The menu now has **Clear Combined (n)** and **Clear Final (n)**, both undoable.
  - The dead card "move back" button, the swipe-to-Used path and its CSS were removed.
  - Search now also marks matches inside the Combined and Final texts, and opens a matching text up to its full length.
  - Parts inside Combined and Final can be reordered (the mixed-order issue from 1.4).
- **Welcome tips** (first run only) mention the new names and resizing.
- **Tests:** features now has 96 checks and update-safety 21 (a saved column width survives an update). Every suite refuses a missing `APP_MAIN` with a console message instead of an Electron error dialog.

## 1.5.0

- **Augmented is one combined note:** moved prompts are appended in order.
  - Click it to copy it.
  - **Notes** lists its prompts, each with ↩ back to prompts.
  - The pencil edits the combined text, which then becomes a single note.
- **Moving the Augmented note down:** the **↓ Move to Used** bar, a left swipe (green backdrop) or dragging onto Used. All of them append the whole note to the end of Used and empty Augmented.
- **Dropping a prompt** onto the Augmented tray appends it. The selection bar's "Move to Augmented" appends in click order.
- **Setting "Join notes with":** Blank line (the default) or New line. It applies to Augmented, Used and Ctrl+click copies.
- **Layout fixes:** the Move to Used button is full width under the note, so it never overlaps the label; stats stay on one line.
- **Tests** moved into the repo (`tests/e2e/`), with `npm test` scripts. This handoff folder `ai_memory/` was added.
