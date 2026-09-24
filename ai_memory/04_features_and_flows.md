# 04: Features and flows (all described in text)

Terms used below:
- **Card**: one prompt or note in the top stage.
- **Column**: a project.
- **Board**: the horizontally scrolling area that holds all columns.
- **Composer**: the text editor used for new prompts and edits.
- **Combined** (called Augmented before 1.6): the middle stage (data field `used`), shown as ONE combined note.
- **Final** (called Used before 1.6): the bottom stage (data field `combined`), the final combined text.

## 1. Screen layout (top to bottom, left to right)

1. **Top bar** (48px, drag region for moving the window). The Windows minimise/maximise/close buttons are drawn over its right end in the theme's colours. From left to right it contains:
   - the brand: a monstera leaf mark and "Recaller";
   - the search box, showing a "Ctrl K" hint;
   - the undo ↶ and redo ↷ buttons, disabled when there is nothing to undo or redo, with the action named in the tooltip;
   - the **↔ reset column widths** button (`#reset-widths`), disabled while no column is resized;
   - the settings gear.

   The green **+ Project** button was removed in 1.6; new projects come from the "+ New project" tile or Ctrl+Shift+N.
2. **Stage**: a dotted canvas (dark forest green in Deep theme) with faint monstera leaves. The **board** holds the columns side by side, plus a dashed "+ New project" tile at the end. Round ‹ › scroll buttons appear at the left and right edges when there is more to scroll.
3. **Each column**, from top to bottom (its right edge is a resize handle, see §22):
   - **Header**, a solid colour in Deep theme. It holds a small leaf icon, the project name (wraps to two lines, then "…"), a count of prompts, and a ⋯ menu button.
   - **New prompt bar**: a full-width white button "(+) New prompt" plus a separate mic button. It shows a "Draft" badge when unsaved text exists. It is hidden while the composer is open, and the composer takes its place.
   - **Scroll area**:
     - **Prompt cards**, newest first. "No prompts yet" is shown when there are none.
     - **Combined block** (indigo, with a solid indigo header band reading "COMBINED · n" and a collapse arrow). Inside is one lavender **Combined note** with the combined text (clamped to 8 lines, with "Show all"). Its footer shows "n prompts · w words", a **Notes** toggle and a pencil (edit). Under the note is a full-width indigo **↓ Move to Final** bar. When the block is empty it says "Move prompts here and they join into one note".
     - **Final block** (deep green, shown only when Combined or Final has content). Its header reads "FINAL" with a collapse arrow; there is no counter and no Copy all button (both removed in 1.6). Inside is a mint box with the combined final text, the footer "n notes · w words", a **Notes** toggle, a pencil (edit), and "Show all" when the text is long. When it is empty it says "Move the Combined note down to add it here".
4. **Floating elements:**
   - toasts (bottom centre);
   - the Ctrl+click selection bar (bottom centre; toasts move up above it);
   - menus;
   - the settings dialog;
   - the image lightbox;
   - the full-screen snip overlay (a separate window).

## 2. Startup flow

1. Main process:
   1. Pins `userData`.
   2. Registers the image scheme.
   3. Takes the single-instance lock (a second launch just focuses the running window).
   4. Loads settings (making a `.bak` copy).
   5. Runs `protectData()`: an `upgrade` backup if the version changed, and a `daily` backup if one is due.
   6. Sets permissions, the image protocol, IPC and global hotkeys.
   7. Creates the window at the saved bounds and theme colours, and shows it when ready.
2. The renderer loads the data file:
   - With no file, it seeds a "Welcome" project containing seven tip cards.
   - Otherwise it normalises the file without writing it.
   - It then applies the theme, density and title font, renders, restores scroll positions and the last-used column, fades in, and asks main to clean up unreferenced images.

## 3. Projects (columns)

- **Create:**
  - Trigger: **+ Project** in the top bar, the "+ New project" tile, the empty-board button, or Ctrl+Shift+N.
  - It creates "New project" with the next unused palette colour, scrolls it into view, and opens an inline rename field. Enter saves, Esc cancels, and clicking away saves.
  - Undoable.
- **Rename:** double-click the name, or ⋯ → Rename. Undoable.
- **Recolour:** ⋯ menu → one of eight swatches. Undoable.
- **Reorder:** drag a column by its header. A tilted ghost and a dashed placeholder show the position, and the board auto-scrolls near the edges. ⋯ → Move left / Move right also works. Undoable.
- **Delete:** ⋯ → Delete project. It happens immediately, with an Undo toast (9s). Undoable.
- **⋯ menu, full list:** New from screenshot, Rename, 18 colour swatches (two rows of nine), Move left, Move right, Reset width (enabled when the column is resized), Clear Combined (n), Clear Final (n), Delete project.
- **Clear Combined / Clear Final:** empties that stage (data `used` / `combined`) with an Undo toast ("Cleared Combined" / "Cleared Final", 7s). Undoable. An open editor on that stage is closed first.
- **Current project:** the last column the user pressed the mouse in. It is remembered across restarts and is the target of Ctrl+N, Ctrl+M and Ctrl+Shift+S.

## 4. New prompt flow

1. Click the **New prompt** bar (or press Ctrl+N for the current column). The composer opens in place of the bar with any saved draft restored, and the cursor goes to the end.
2. Type, dictate (see §12), paste or drop images, or take a screenshot (see §13).
3. **Save** with Ctrl+Enter or the Save button.
   - The note is added at the top of the prompts (undoable, labelled "New note"), and the draft is cleared.
   - The composer stays open and empty, ready for the next prompt.
   - Saving with no text and no images shakes the composer instead.
4. **Close** with × or Esc. The text is kept as a draft, and the bar shows a "Draft" badge. If recording is on, the first Esc only stops recording.
5. Clicking anywhere outside an *empty*, idle composer closes it. It closes on pointer release, so the layout doesn't shift mid-click.
6. Only one composer or editor is open at a time. Opening another saves the first one's draft and closes it.

## 5. Copying

- **Click a card**: copies its exact text.
  - Feedback: a green ripple at the click point, and a "✓ Copied" chip on the card for 1.3s.
  - The copy count ("copied n×") goes up.
  - If "Minimize Recaller after copying" is on, the window minimises after 260ms.
- **Click an image thumbnail on a card**: copies that image as PNG. The thumbnail shows "Image copied".
- **A card with only images, no text**: clicking copies the first image.
- **A slow click** (held longer than 240ms without moving) still copies. It briefly starts a drag, which is cancelled because nothing moved.
- **Keyboard:** focus a card (Tab or ↑/↓) and press Enter or Space.
- **Search:** type in search, then press Enter to copy the first matching prompt.
- **Combined note**: click it to copy the whole combined text. A "Copied" chip appears in its top-right corner.
- **Final text**: click the text to copy all of it. A "Copied" chip appears in the box's top-right corner and the block flashes. Clicking doesn't copy if the user is in the middle of selecting part of the text with the mouse. (The Copy all button was removed in 1.6.)
- **Clipboard writes** go through main and are serialised, so they can't finish out of order.

## 6. Ctrl+click multi-copy (Explorer-style selection)

1. Hold Ctrl and click prompt cards. Each Ctrl+click adds the card to the selection and **immediately** puts all selected texts on the clipboard.
   - The order is the click order, joined by the separator setting (blank line by default).
   - Selected cards get an accent ring and a numbered badge (1, 2, 3…) showing the paste order.
   - A bar at the bottom shows "n notes copied · Ctrl+click to add or remove" with **Move to Combined** and **Clear** buttons.
2. Ctrl+clicking an already selected card removes it, and the clipboard is rewritten without it.
3. **Anchor rule:** if the user plain-clicked (copied) a card within the last two minutes and has done nothing else since, the first Ctrl+click also includes that card as number 1. "Nothing else" means no other pointer press on the board and no key other than Ctrl, Shift or Alt. Ctrl+clicking the anchor card itself doesn't add it twice.
4. **The selection clears when:**
   - the user plain-clicks a card (which copies just that card);
   - Esc is pressed anywhere;
   - the user clicks empty canvas;
   - the window loses focus, typically when switching away to paste, so the next Ctrl+click starts fresh.
5. **Image-only cards** can't be combined; a toast explains this.
6. **Move to Combined** (in the bar) appends the selected prompts to Combined in click order. Undoable.
7. **Counts:** each newly selected card's copy count goes up by one.

## 7. Swipe left to delete (prompt cards only)

1. Press a card and move left (more horizontal than vertical by 1.2×, at least 7px). The card follows the pointer, and a red "trash" backdrop fades in behind it.
2. Release past 36% of the card's width, or flick fast (more than 0.8 px/ms and more than 50px): the card slides out, the gap collapses, it is deleted, and a "Note deleted · Undo" toast appears for 7s.
3. A shorter release springs the card back.
4. Other ways to delete: Delete or Backspace on a focused card, or the trash button in the card editor.

## 8. Dragging cards

1. Press and hold for 240ms, or press and move in any direction other than a left swipe. The card lifts: a tilted ghost follows the pointer, and a dashed placeholder marks where it will land.
2. **Drop targets:**
   - **within the prompt list** (any column): reorder, with other cards animating out of the way. Undo label "Reorder", or "Move to \<project\>" across columns.
   - **on the Combined block** of any column: the block gets a dashed outline, and dropping appends the prompt to the end of Combined ("Added to Combined · Undo").
   - **on the Final block**: appends the prompt directly to the end of the final text ("Added to Final · Undo").
3. **Auto-scroll:** the board scrolls sideways within 64px of its left or right edge. A column scrolls vertically within 64px of its top or bottom.
4. **Landing:** after the drop, the card glides from the ghost's position into place. When dropped into a stage, the ghost shrinks into that stage's header.
5. **Cancelling:** if the mouse button is released outside the window, or a move arrives with no button pressed, the drag is cancelled safely.

## 9. The three stages

### Prompts → Combined

- **Ways to move a prompt:** the stack icon on a card's hover bar, U on a focused card, dragging onto the Combined block, or Ctrl+click several and then "Move to Combined".
- The prompt is **appended to the end** of the Combined list, so the combined note reads in the order the prompts were added.
- The Combined note shows all its prompts' exact texts joined by the separator.

### The Combined note

- **Click:** copies the combined text.
- **Notes:** a toggle (looks pressed while open) that lists each part: number, first line, and on hover four buttons (see "The Notes list" below).
- **Pencil (edit):** opens a composer in place of the note, holding the combined text and all the prompts' images. Saving a changed text replaces Combined with ONE note containing it (undo label "Edit Combined"). Saving it unchanged does nothing, so the parts stay separate. Cancel (× or Esc) leaves it untouched.
- **Show all / Show less:** expands the note (remembered per project).

### Combined → Final

The Combined note has three ways down:
1. the **↓ Move to Final** bar;
2. **swipe it left** past 36%, with a green "Move to Final" backdrop;
3. **drag it** onto the Final block.

All three **append every Combined prompt to the end of Final**, in order, and empty Combined for the next batch. The Final block flashes and a "Moved to Final · Undo" toast appears. Undoable ("Move to Final").

### Final (the final text)

- It shows the exact texts of every note moved there, in order, joined by the separator.
- **Click the text** to copy it all.
- **Pencil (edit):** like Combined's: the whole Final text in a composer (placed under the Final header, the text box hidden meanwhile). A changed text is saved as ONE note ("Edit Final"); unchanged does nothing.
- **Notes** lists the parts, with the same row buttons; ↩ sends one back to the end of Combined ("Sent back to Combined · Undo").
- **Clearing:** ⋯ → Clear Final (undoable).

### The Notes list (Combined and Final)

Each row shows the part's number and first line. Hovering (or focusing inside) a row shows:
- **↑ / ↓**: move the part up or down (disabled at the ends). The combined text follows the new order. Undoable ("Reorder").
- **✎**: edit just this part. The composer opens in the stage's editor spot with only that part's text and images; saving changes only that note (undo label "Edit note"), so the others stay separate. The composer's trash button deletes the part ("Note deleted · Undo").
- **↩**: in Combined, send the prompt back to the top of the prompts ("Moved back to prompts"); in Final, send it back to the end of Combined ("Sent back to Combined").

Only one editor is open at a time anywhere: opening a stage editor closes the new-prompt composer and any card editor, and vice versa. Undo and redo close an open stage editor.

### Separator

Settings → **Join notes with**: "Blank line" (`\n\n`, the default) or "New line" (`\n`). It applies to the Combined note, the Final text and Ctrl+click copies. It takes effect immediately, since the texts are combined each time they are shown.

## 10. Highlighting

1. Hover a card and click the highlighter icon. A menu offers **Check again** (amber), **Important** (rose), **Idea** (sky) and **Ready** (lime), plus "No highlight".
2. A highlighted card gets a tinted background, a thicker coloured left bar and a label chip in its footer (for example "● Check again").
3. **Keyboard:** H on a focused card toggles amber.
4. Undoable ("Highlight" / "Remove highlight"). Stored in `note.highlight`.

## 11. Editing a card

1. Hover a card and click the pencil, or press E or F2 on a focused card. The card turns into a composer holding its text and images.
2. Save (Ctrl+Enter) updates the text, images and updated time; this is undoable ("Edit note") only if something changed. Cancel (× or Esc) discards the edit. The trash button deletes the card.
3. While a card is being edited, it stays visible even if search would hide it.

## 12. Voice dictation (live, phrase by phrase)

**Starting.**
- Ways to start: the mic next to "New prompt", the mic inside any composer, or Ctrl+M (in a composer it toggles; otherwise it opens the current column's composer and starts).
- **If no API key is available**, an inline error "Voice needs an OpenAI API key" appears with an **Add key** button that opens Settings.
- The composer's mic becomes a red **Stop** pill showing a ■, a timer (m:ss) and four level bars that move with the voice.

**Recording (in `voice.js`):**
1. It opens the microphone (echo cancellation, noise suppression, auto gain, mono) and records webm/opus at 48 kbps.
2. Every 50ms a level meter measures loudness, computed as `min(1, RMS × 7)`. It tracks the room's noise floor: the floor follows quiet moments down immediately and creeps up slowly.
   - Speech threshold: `max(0.025, floor × 2.5 + 0.012)`.
   - Silence threshold: `max(0.015, floor × 1.6 + 0.006)`.
3. **A phrase is cut** when silence has lasted at least 700ms, the phrase contains at least 250ms of speech, and it is at least 1.5s long. A phrase is also cut if it is longer than 20s at the next 150ms dip, and always at 45s.
   - At a cut, a new MediaRecorder starts before the old one stops, so no audio is lost.
   - Each finished phrase is a complete webm file handed off in spoken order.
4. **Silent phrases are dropped**, because models tend to invent words for silence. The exception: the only recording of a session is always sent if it lasted at least 600ms, even when the meter heard nothing. The last phrase needs only 120ms of speech.
5. A whole session is capped at 15 minutes (it auto-stops).

**Transcribing (composer plus `transcribe.js`):**
1. Phrases queue up and are transcribed one at a time, in order, while recording continues.
2. **What is sent:** each request carries the phrase audio, the model, the language (as `languages[]` for gpt-transcribe) and a `prompt`. The prompt is the vocabulary hint plus the last 400 characters already dictated, so phrases read as one continuous text.
3. **Streaming:** for streaming-capable models the reply arrives as server-sent events, and text appears word by word at the dictation point. A thin animated line across the top of the composer shows that transcription is running.
4. **Where text goes:**
   - The dictation point is the cursor position when recording started (or the end of the text).
   - Each phrase is inserted there with a leading space if needed, and the point moves to the end of the inserted text.
   - After the session, a space is added if the dictated text runs into the following text.
5. **Editing while recording:** the textarea is never read-only. On every keystroke, the change is compared with the previous text (common prefix and suffix) to find where the user edited.
   - The dictation point and the region currently streaming in are shifted to match.
   - If the user edits inside the streaming text, that text becomes theirs, and the rest of the phrase continues after it.
   - The user's cursor is preserved: a cursor before the insertion stays put; a cursor at or after it moves along with the new words.
6. **Stop** (click the pill, Ctrl+M, or Esc): the last phrase is sent, and the composer shows "Writing…" until the queue is empty.
7. **Save while recording or transcribing:** recording stops, transcription finishes ("Saving…" status), then the note is saved automatically.
8. **Errors:**
   - Network, 5xx and stream errors are retried once automatically; the partial text is cleared before the retry.
   - If a request still fails, an error row appears in the composer with **Retry** (reuses the recorded audio) and **Discard**.
   - Key problems (none set, or 401) show a **Settings** button instead.
   - A 429 shows OpenAI's quota message.
   - Microphone problems: "Microphone blocked…" (Windows privacy setting), "No microphone found", "The microphone is in use by another app".
   - "Didn't catch that" appears if nothing usable was recorded.

**Settings used:** model (default gpt-transcribe; gpt-4o-mini-transcribe is fastest; whisper-1 can't stream), language and vocabulary hint.

## 13. Screenshots and images

**Snip flow:**
1. Triggers: the camera button in a composer, Ctrl+Shift+S, ⋯ → New from screenshot, or the optional global "Screenshot to note" shortcut.
2. Recaller hides and waits 260ms. It then captures the display under the mouse cursor at full resolution with `desktopCapturer`.
3. A frameless, always-on-top overlay covers that display. It shows the frozen screen dimmed, with the hint "**Drag** to capture an area · **Click** for the whole screen · **Esc** to cancel".
4. Dragging draws a selection with an emerald outline and a pixel-size label.
   - Release to capture that area.
   - A click without dragging, or Enter, captures the whole screen.
   - Esc, right-click, or switching away cancels.
   - A 3-minute safety timeout also cancels.
5. The crop is taken from the original capture at full resolution. It is saved as a full PNG plus a thumbnail (at most 640px wide) under `images\`.
6. Recaller reappears and the image is added to the composer's attachment row: 58×44 thumbnails with a × to remove, and a click opens the image large.
7. **Global shortcut variant:** the snip happens first (even while Recaller is minimised), then Recaller is brought up and the image is attached to the open composer, or to a new one in the current column.

**Other ways to add images:**
- **Pasting** into a composer attaches images only when the clipboard has no plain text; otherwise the text is pasted normally.
- **Dropping image files** onto a composer attaches them.
- PNG and JPEG are sent as-is; other formats (webp, gif, …) are converted to PNG in the page first.

**Viewing and copying:**
- On a saved card, images show as thumbnails (one large, or a grid of three with "+N").
- Clicking a thumbnail copies that image.
- The expand icon on hover opens the **lightbox**: the full image, with **Copy image** and **Close**. Clicking the image or backdrop, or pressing Esc, closes it.

**Cleanup:** at startup, image files that no note, draft or backup references, and that are more than one hour old, are deleted.

## 14. Undo and redo

- **Undo:** Ctrl+Z (when not typing in a text field), the ↶ button, or **Undo** on a toast. **Redo:** Ctrl+Y or Ctrl+Shift+Z, the ↷ button, or **Redo** on the "Undone: …" toast.
- **Undoable actions:**
  - notes: new note, edit note, delete note, reorder;
  - moving between projects, stages and parts: move to another project, Add to Combined, Move to Combined (selection), Move back to prompts, Add to Final (card dropped on Final), Move to Final (Combined → Final), Send back to Combined, Reorder (parts), Edit note (a part), Edit Combined, Edit Final, Delete note (a part);
  - highlights: highlight, remove highlight;
  - projects: new, rename, delete, reorder, move left/right, change colour, Clear Combined, Clear Final.
- **Not undoable through history, by design:** copies (and copy counts), collapsing and expanding, drafts, settings, theme and density changes, scrolling, column widths. (The "Column widths reset" toast has its own Undo.)
- Up to 80 steps, in memory only (lost on restart).

## 15. Search

- **Opening it:** Ctrl+K or Ctrl+F focuses the search box. The global show/hide hotkey also focuses it, unless the user is composing, editing, dictating or in a dialog.
- **Matching:** space-separated terms, all of which must appear, case-insensitive, in a prompt card's text. Matches are highlighted in green.
  - Columns show "matching/total" counts and "No matches" where nothing matches.
  - The Combined and Final texts are never filtered, but every term is highlighted inside them (and in their Notes rows). When a combined text contains all the terms, it opens up to its full length while the search lasts.
- **Keys:** Enter copies the first matching prompt. ↓ moves focus to the first card. Esc clears the text, and a second Esc leaves the box.

## 16. Moving around the board horizontally

- ‹ › edge buttons: a click scrolls one column width smoothly; holding (more than 320ms) glides continuously.
- The mouse wheel over anything that can't scroll vertically (headers, gaps, short columns) scrolls the board sideways. Over a scrollable column, the wheel scrolls that column. Shift+wheel always scrolls sideways (Chromium's default).
- Dragging empty canvas pans the board. A press on empty canvas without moving clears any Ctrl+click selection.
- Holding the middle mouse button and dragging anywhere pans.
- The bottom scrollbar is thick and easy to grab.
- Board and column scroll positions are remembered across restarts, but only positions the user scrolled to.

## 17. Settings dialog (gear icon or Ctrl+,)

Fields, in order:
1. **Colour:** Deep or Soft. Applies instantly, including the Windows title bar. Stored in settings.
2. **Column width:** Compact (236px), Slim (268px, the default) or Roomy (330px). Stored in `data.prefs.density`. This is the default width; columns the user resized keep their own width (§22).
3. **Join notes with:** Blank line or New line (`prefs.joiner`).
4. **Column title font:** nine preview tiles in a 3×3 grid, each rendered on an emerald header ("Wildfire RL"): Instrument Sans (default since 1.6), Plus Jakarta Sans, Onest, Sora, Space Grotesk, Inter Display, Manrope, Geist, Sora Caps. Applies instantly. Stored in `prefs.titleFont` only when picked.
5. **OpenAI API key:** a password field showing "•••• last4" when a key is set, with a status line ("Saved and encrypted on this PC…" or "Using OPENAI_API_KEY from your environment…"). **Remove** is shown only for a saved key. A link points to platform.openai.com/api-keys. The key is saved when the field loses focus or the dialog closes.
6. **Transcription model:** gpt-transcribe (recommended), gpt-4o-mini-transcribe (fastest), gpt-4o-transcribe, or whisper-1 (no live text). **Language** is optional (for example `en`).
7. **Vocabulary hint:** words to spell correctly.
8. **Show/hide Recaller** and **Screenshot to note** global shortcuts. Click the field and press a key combination.
   - A combination needs Ctrl, Alt or Shift, unless it is a function key. Backspace clears it.
   - Status reads "Active everywhere", "Taken by another app — try another combo", or "Off".
9. **Minimize Recaller after copying** (switch).
10. **Backups:** a dropdown of backups ("Sep 24, 03:28 AM · Before update to 1.5.0 · 12 notes"), plus **Back up now**, **Restore** (with a confirmation) and a status line.

The footer holds **Open data folder** and **Done**.

## 18. Backups and restore (user view)

- **Automatic backups:** made before every new version first runs (before it reads anything), and once a day.
- **Manual backups:** Settings → Back up now.
- **Restore:**
  1. Pick a backup in the dropdown, click Restore and confirm.
  2. The current state is backed up first ("Before restore").
  3. The notes file is replaced and the window reloads.
  4. Settings (API key, shortcuts, theme) are not changed by a restore.

## 19. Global hotkeys (work in any app)

- **Ctrl+Alt+R** (default): if Recaller is focused and visible, it minimises; otherwise it is restored, shown and focused, with search focused.
- **Screenshot to note** (off by default): see §13.

## 20. Keyboard reference

| Where | Keys | Action |
| --- | --- | --- |
| Anywhere | Ctrl+K / Ctrl+F | Focus search |
| Anywhere | Ctrl+N | New prompt in the current column |
| Anywhere | Ctrl+Shift+N | New project |
| Anywhere | Ctrl+M | Dictate (opens composer and starts; in a composer, start/stop) |
| Anywhere | Ctrl+Shift+S | Screenshot into the open composer (or a new one) |
| Anywhere (not typing) | Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z | Undo / redo |
| Anywhere | Ctrl+, | Settings |
| Anywhere | Esc | Close menu; clear Ctrl+click selection |
| Composer | Ctrl+Enter | Save (during dictation: finish, then save) |
| Composer | Esc | Stop recording first; otherwise close (keeps draft) or cancel edit |
| Composer | Ctrl+M / Ctrl+Shift+S | Mic / screenshot |
| Focused card | Enter or Space | Copy |
| Focused card | E or F2 | Edit |
| Focused card | U | Add to Combined |
| Focused card | H | Toggle amber highlight |
| Focused card | Delete / Backspace | Delete (with Undo) |
| Focused card | ↑ / ↓ | Move focus between cards |
| Search box | Enter / ↓ / Esc | Copy first match / focus first card / clear, then leave |
| Rename field | Enter / Esc | Save / cancel |
| Shortcut field (Settings) | any combo / Backspace | Set / clear |
| Snip overlay | drag / click / Enter / Esc / right-click | Area / whole screen / whole screen or current area / cancel / cancel |
| Column edge | drag / double-click | Resize / back to the default width |
| OS-wide | Ctrl+Alt+R (default) | Show/hide Recaller |

## 21. Toast messages (for reference)

- "Note deleted · Undo"
- "Added to Combined · Undo"
- "Moved to Final · Undo"
- "Added to Final · Undo"
- "Moved back to prompts · Undo"
- "Sent back to Combined · Undo"
- "Moved n to Combined · Undo"
- "Deleted “Name” · Undo"
- "Cleared Combined · Undo" / "Cleared Final · Undo"
- "Column widths reset to default · Undo"
- "Undone: X · Redo" / "Redone: X · Undo"
- "Nothing to undo"
- "Backup saved"
- "Image copied"
- "Couldn't copy to the clipboard."
- "Image-only notes have no text to combine…"
- "Nothing matches"

At most three toasts show at once. Hovering a toast pauses its timer.

## 22. Column widths (1.6)

1. **Resize:** hover a column's right edge (the gap to its right) and a thin vertical line appears; the cursor becomes ↔. Drag to make the column wider or narrower (200–900px). While dragging, the line runs the full height.
2. **Snap:** passing within 6px of the default width snaps to it, and a column at the default width is stored as "not resized".
3. **Saved:** on release the width is saved in `data.prefs.colWidths[projectId]`. Nothing is written if the width didn't change (a plain click or double-click on the edge).
4. **Reset one column:** double-click its edge, or ⋯ → Reset width.
5. **Reset all:** the ↔ button in the top bar (tooltip "Reset all n resized columns to the default width"; disabled with an explanatory tooltip when nothing is resized). A toast "Column widths reset to default · Undo" offers to put the widths back.
6. **Default width** comes from Settings → Column width (Compact/Slim/Roomy); resized columns ignore it.
7. After any width change, the "Show more" / "Show all" buttons are measured again for that column.
