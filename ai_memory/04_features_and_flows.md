# 04: Features and flows (all described in text)

Terms used below:
- **Card**: one prompt or note in the top stage.
- **Column**: a project.
- **Board**: the horizontally scrolling area that holds all columns.
- **Composer**: the text editor used for new prompts and edits.
- **Cooking** (1.8+; before that just "prompts"): the top stage (data field `notes`), one card per prompt.
- **Cooked** (Combined in 1.6–1.7, Augmented before 1.6): the middle stage (data field `used`), shown as ONE combined note.
- **Served** (Final in 1.6–1.7, Used before 1.6): the bottom stage (data field `combined`), the final combined text.

§29 describes 1.20 (minimized columns sync, columns and groups drag freely, the notepad). §28 describes 1.19 (the Eating strip redesign and the widget; 1.19.0 also had a Mac zoomed-out column drag, removed in 1.19.1). §27 describes what 1.18.0 added (Eating, the Claude Code format, Clear, minimized columns, groups, the top-bar +, live text while talking). §1–§24 describe the Windows app, 1.16.0, which is the owner's main install. The Mac edition of the same version (branch `masos`, merged into `main` on 2026-10-06) works the same way except where an "(on a Mac: …)" note says otherwise. §25 describes every Mac flow. §26 describes the accounts and sync of 1.17.0 (both platforms; released on 2026-10-06), briefly; the full design is `15_accounts_and_sync.md`.

## 1. Screen layout (top to bottom, left to right)

1. **Top bar** (48px, drag region for moving the window). The Windows minimise/maximise/close buttons are drawn over its right end in the theme's colours. (On a Mac: the traffic lights sit at its left end in macOS's own colours, and the brand starts after them; see §25.) From left to right it contains:
   - the brand: a monstera leaf mark and "Recaller";
   - the search box, showing a "Ctrl K" hint ("⌘K" on a Mac);
   - 1.18: a slim **+** (`#new-column`), a new project, like the board's "+ New project" tile and Ctrl+Shift+N (1.6 had removed a bigger + Project button; the owner asked for one back so a new column needs no scroll to the board's end);
   - the undo ↶ and redo ↷ buttons, disabled when there is nothing to undo or redo, with the action named in the tooltip;
   - the **↔ reset column widths** button (`#reset-widths`), disabled while no column is resized;
   - 1.17: the **cloud** sync indicator (`#sync-status`), hidden unless sync needs a look (§26);
   - the **?** help button (`#open-help`, 1.7): opens "How Recaller works";
   - the settings gear.

   The green **+ Project** button was removed in 1.6; new projects come from the "+ New project" tile or Ctrl+Shift+N (⇧⌘N on a Mac).
2. **Stage**: a dotted canvas (dark forest green in Deep theme) with faint monstera leaves, framed since 1.16: a rounded panel with a slim emerald edge (brighter at the top-left) and a faint glow, inset 12px from the window's sides and bottom in a dark margin the colour of the top bar. The **board** holds the columns side by side, plus a dashed "+ New project" tile at the end. Round ‹ › scroll buttons sit at the left and right edges (1.16: only while the pointer is near that edge, and only when there is more to scroll that way; see §16).
3. **Each column**, from top to bottom (its right edge is a resize handle, see §22):
   - **Header**, a solid colour in Deep theme. It holds a small leaf icon, the project name (wraps to two lines, then "…") and a ⋯ menu button. (The prompt count moved to the Cooking header in 1.8.)
   - **Cooking header** (1.8; a plain label since 1.9): "⌄ 🔥 COOKING · n" in the column's colour, no box (n = prompts; "m/n" while searching). Click it to fold the prompt cards away and back; that's saved as `project.notesCollapsed` (written only while folded). A new prompt, a prompt sent back or a prompt dropped in unfolds it for good. A search only shows the matches while it has terms: the fold isn't cleared, so Cooking folds again when the search is emptied.
   - **New prompt bar**: two equal halves (1.8), **(+) New text** (called New prompt until 1.18) and **(🎙) Dictate**: soft white pills with the icon in the column's colour, no outline until hover (1.9). Dictate is as big as New prompt because the owner starts about half their prompts by voice. With an unsaved draft the left half reads **Draft** and its + gets an amber dot. In narrow columns (bar under 244px) it reads **New**. The bar is hidden while the composer is open, and the composer takes its place.
   - **Scroll area**:
     - **Prompt cards**, oldest at the top: since 1.7 new prompts are added at the bottom. "Nothing cooking yet. Click New prompt or Dictate." is shown when there are none. Hovering a card shows two buttons top-right: the highlighter and a filled **↓ Cooked** (1.11).
     - **Cooked block** (1.13: a light section in the Cooked palette, Ocean blue by default, with the label "COOKED · n" and a collapse arrow; no dark band). Inside is one near-white **Cooked note** with the combined text, 6 lines tall with a fade when longer, and a slim **Show more** bar under it. Its footer shows "n prompts · w words", a **Notes** toggle and a pencil (edit). Under the note is a full-width **↓ Move to Served** bar in the palette's accent. When empty, only its faint name shows ("⌄ COOKED", 60% opacity); while a card is being dragged it becomes a dashed drop zone with "Move prompts here and they join into one note".
     - **Served block** (1.10: a light sage section with a deep-green label, shown only when Cooked or Served has content). Its header reads "SERVED" with a collapse arrow; there is no counter and no Copy all button (both removed in 1.6). Inside is a near-white box with the final text, 6 lines tall with a fade and a **Show more** bar when longer, then the footer "n notes · w words", a **Notes** toggle and a pencil (edit). When empty, only its faint name shows; while dragging it becomes a dashed drop zone saying "Move the Cooked note down to add it here".
4. **Floating elements:**
   - toasts (bottom centre);
   - the Ctrl+click selection bar (⌘-click on a Mac; bottom centre; toasts move up above it);
   - menus;
   - the settings dialog;
   - the image lightbox;
   - the full-screen snip overlay (a separate window).

## 2. Startup flow

1. Main process:
   1. Pins `userData` (`%APPDATA%\Recaller` on Windows, `~/Library/Application Support/Recaller` on a Mac, or `RECALLER_DATA_DIR` when set).
   2. Registers the image scheme.
   3. Takes the single-instance lock (a second launch just focuses the running window).
   4. Loads settings (making a `.bak` copy).
   5. Runs `protectData()`: an `upgrade` backup if the version changed, and a `daily` backup if one is due. Both are skipped while no data file exists yet.
   6. On a Mac only: starts the hourly daily-backup check, and installs the menu bar and the About panel (§25). On Windows the app has no menu bar.
   7. Sets permissions, the image protocol, IPC and global hotkeys.
   8. Creates the window at the saved bounds and theme colours, and shows it when ready (on a Mac, with the traffic lights at 16, 16).
2. The renderer loads the data file. (On a Mac it first marks the page `is-mac` and swaps in the Mac key labels, before anything is drawn.)
   - With no file, it seeds a "Welcome" project containing ten tip cards (copying, swipe-delete, dragging, dictating, screenshots, Ctrl+click, the three stages, highlighting, resizing, shortcuts) and saves it at once. On a Mac the tips name Mac keys (⌘V, ⌘Z, "Hold ⌘", ⌘K, ⌘N, ⌘M, ⇧⌘S).
   - The same Welcome board is saved at once when neither `recaller-data.json` nor its `.bak` can be read or parsed, or when the load itself fails. Main writes it about 250ms later, over the unreadable file, so the old notes then live only in `backups/`. (The startup image clean-up then keeps only the images a backup still refers to.) A file that parses but has no projects list also shows the Welcome board. It is saved at once if the file has no version or one below 2, otherwise on the first change.
   - Otherwise it normalises the file. It writes it back at once only if the file has no version or a version below 2 (`DATA_VERSION`); a current file isn't written until something changes.
   - It then applies the theme, density, title font and Cooked colour, renders, restores scroll positions and the last-used column, fades in, and asks main to clean up unreferenced images.

## 3. Projects (columns)

- **Create:**
  - Trigger: the "+ New project" tile at the end of the board, the empty-board button, or Ctrl+Shift+N (⇧⌘N on a Mac). (The top-bar **+ Project** button was removed in 1.6.)
  - It creates "New project" with the next unused palette colour, scrolls it into view, and opens an inline rename field. Enter saves, Esc cancels, and clicking away saves.
  - Undoable.
- **Rename:** double-click the name, or ⋯ → Rename. Undoable.
- **Recolour:** ⋯ menu → one of 18 swatches. Undoable.
- **Reorder:** drag a column by its header. A tilted ghost and a dashed placeholder show the position, and the board auto-scrolls near the edges. ⋯ → Move left / Move right also works. Undoable.
- **Delete:** ⋯ → Delete project. It happens immediately, with an Undo toast (9s). Undoable.
- **⋯ menu, full list:** New from screenshot, Rename, 18 colour swatches (two rows of nine), Move left, Move right, Reset width (enabled when the column is resized), Sort prompts oldest first (enabled when there are 2+ prompts not already in date order), Clear Cooked (n), Clear Served (n), Delete project.
- **Sort prompts oldest first (1.7):** reorders the column's prompts by `createdAt`, ascending. It's for columns saved before 1.7, when new prompts went to the top. Toast "Prompts sorted oldest first · Undo"; undoable ("Sort prompts").
- **Clear Cooked / Clear Served:** empties that stage (data `used` / `combined`) with an Undo toast ("Cleared Cooked" / "Cleared Served", 7s). Undoable. An open editor on that stage is closed first.
- **Current project:** the last column the user pressed the mouse in. It is remembered across restarts and is the target of Ctrl+N, Ctrl+M and Ctrl+Shift+S (⌘N, ⌘M and ⇧⌘S on a Mac).

## 4. New prompt flow

1. Click **New prompt** (or press Ctrl+N for the current column; ⌘N on a Mac), or **Dictate** to start speaking straight away. The composer opens in place of the bar with any saved draft restored, and the cursor goes to the end.
2. Type, dictate (see §12), paste or drop images, or take a screenshot (see §13).
3. **Save** with Ctrl+Enter (⌘↩ on a Mac) or the Save button. Since 1.10 **saving closes the editor** and the New prompt | Dictate buttons come back.
   - The note is added at the **bottom** of the prompts (since 1.7; it used to be the top), the column scrolls it into view, and the draft is cleared. Undoable, labelled "New note".
   - (Before 1.10 the composer stayed open and empty for the next prompt.)
   - Saving with no text and no images shakes the composer instead.
4. **Close** with × or Esc. The text is kept as a draft, and the New prompt half reads **Draft** with an amber dot. If recording is on, the first Esc only stops recording.
5. Clicking anywhere outside an *empty*, idle composer closes it. It closes on pointer release, so the layout doesn't shift mid-click.
6. Only one composer or editor is open at a time. Opening another one closes the first:
   - a new-prompt composer keeps its text and images as that column's draft;
   - an open card editor or Cooked/Served editor is closed **without saving** and without a toast.

   Ctrl+N (even pressed inside an editor) and undo/redo close an open card or stage editor the same way. If a composer that closes was dictating, the recording stops and phrases not yet transcribed are dropped.

## 5. Copying

- **Click a card**: copies its exact text.
  - Feedback: a green ripple at the click point, and a "✓ Copied" chip on the card for 1.3s.
  - The copy count ("copied n×") goes up.
  - If "Minimize Recaller after copying" is on, the window minimises after 260ms. (On a Mac the switch reads "Hide Recaller after copying", and Recaller hides instead; §25.) This applies to plain copies of a card, a card picture, the Cooked note, the Served text and a stage picture, not to Ctrl+click copies or the lightbox's Copy image.
- **Click an image thumbnail on a card**: copies that image as PNG. The thumbnail shows "Image copied".
- **A card with only images, no text**: clicking copies the first image.
- **A slow click** (held longer than 240ms without moving) still copies. It briefly starts a drag, which is cancelled because nothing moved.
- **Keyboard:** focus a card (Tab or ↑/↓) and press Enter or Space.
- **Search:** type in search, then press Enter to copy the first matching prompt.
- **Cooked note**: click it to copy the whole combined text. A "Copied" chip appears in its top-right corner.
- **Served text**: click the text to copy all of it. A "Copied" chip appears in the box's top-right corner and the block flashes. Clicking doesn't copy if the user is in the middle of selecting part of the text with the mouse. (The Copy all button was removed in 1.6.) A Served stage with pictures but no text has no text to copy; click a picture instead.
- **Clipboard writes** go through main and are serialised, so they can't finish out of order.

## 6. Ctrl+click multi-copy (Explorer-style selection)

(On a Mac: hold ⌘ instead. Control+click is a right-click there and opens the editor; see §25.)

1. Hold Ctrl and click prompt cards. Each Ctrl+click adds the card to the selection and **immediately** puts all selected texts on the clipboard.
   - The order is the click order, joined by the separator setting (blank line by default).
   - Selected cards get an accent ring and a numbered badge (1, 2, 3…) showing the paste order.
   - A bar at the bottom shows "n notes copied · Ctrl+click to add or remove" (on a Mac, "⌘-click to add or remove") with **Move to Cooked** and **Clear** buttons.
2. Ctrl+clicking an already selected card removes it, and the clipboard is rewritten without it.
3. **Anchor rule:** if the user plain-clicked (copied) a card's text within the last two minutes and has done nothing else since, the first Ctrl+click also includes that card as number 1. Ctrl+clicking the anchor card itself doesn't add it twice. "Nothing else" means:
   - no other left- or middle-button press on the board (a right-click doesn't count);
   - no key other than Ctrl, Shift, Alt or Meta (the Windows key, ⌘ on a Mac);
   - the window hasn't lost focus.

   Copying a card's picture never sets the anchor. With "Minimize Recaller after copying" on, the anchor never survives, because minimising takes the focus away.
4. **The selection clears when:**
   - the user copies a single card: a plain click, Enter or Space on a focused card, Enter in search, or a click on a card's picture;
   - Esc is pressed. The exceptions: Esc inside a composer or the rename field belongs to that field; if a menu is open, the first Esc only closes it; and no keys reach the board while Settings, Help or the lightbox is open;
   - the user clicks empty canvas, or presses the middle button on the board and moves it less than 4px;
   - the window loses focus, typically when switching away to paste, so the next Ctrl+click starts fresh.

   Clicking the Cooked note or the Served text replaces the clipboard but leaves the selection and its bar in place.
5. **Image-only cards** can't be combined; a toast explains this.
6. **Move to Cooked** (in the bar) appends the selected prompts to Cooked in click order. Undoable. If none of them is still in Cooking, the toast says "Those notes are already in Cooked".
7. **Counts:** each newly selected card's copy count goes up by one.

## 7. Swipe left to delete (prompt cards only)

1. Press a card and move left (more horizontal than vertical by 1.2×, at least 7px). The card follows the pointer, and a red "trash" backdrop fades in behind it.
2. Release past 36% of the card's width, or flick fast (more than 0.8 px/ms and more than 50px): the card slides out, the gap collapses, it is deleted, and a "Note deleted · Undo" toast appears for 7s.
3. A shorter release springs the card back.
4. Other ways to delete: Delete or Backspace on a focused card (on a Mac: the delete key, fn+delete or ⌘⌫), or the trash button in the card editor. (Deleting inside Cooked and Served works differently: see §9, "The Notes list".)

## 8. Dragging cards

1. Press and hold for 240ms, or press and move in any direction other than a left swipe. The card lifts: a tilted ghost follows the pointer, and a dashed placeholder marks where it will land.
2. **Drop targets:**
   - **within the prompt list** (any column): reorder, with other cards animating out of the way. Undo label "Reorder" (no toast), or, into another column, "Move to \<project\>" with the toast "Moved to \<project\> · Undo".
   - **on the Cooked block**: the block gets a dashed outline, and dropping appends the prompt to the end of Cooked. In the card's own column: "Added to Cooked · Undo" (undo label "Add to Cooked"). In another column it counts as a move between projects: "Moved to \<project\> · Undo" (undo label "Move to \<project\>").
   - **on the Served block** (any column): appends the prompt directly to the end of the final text ("Added to Served · Undo"; undo label "Add to Served").

   Where a drop lands: the target column is the one nearest the pointer horizontally, even beside the columns. Within it, a pointer at or below the Served section's top (less 4px, while Served is shown) drops into Served, and at or below the Cooked section's top (less 6px) into Cooked. Anywhere higher goes into the prompt list, placed by the cards' midpoints.
3. **Auto-scroll:** the board scrolls sideways within 64px of its left or right edge. A column scrolls vertically within 64px of its top or bottom.
4. **Landing:** after the drop, the card glides from the ghost's position into place. When dropped into a stage, the ghost shrinks into that stage's header.
5. **Cancelling:** the drag is cancelled safely on a `pointercancel`, when the window loses focus (for example Alt+Tab mid-drag), or when a move arrives with no button pressed. A button release that the window does receive, even outside its bounds, ends the drag normally and drops on the last target (the nearest column).

## 9. The three stages

### Prompts → Cooked

- **Ways to move a prompt:** the filled **↓ Cooked** button on a card's hover bar (1.11: the main action, used ~90% of the time), U on a focused card, dragging onto the Cooked block, or Ctrl+click several (⌘-click on a Mac) and then "Move to Cooked".
- The prompt is **appended to the end** of the Cooked list, so the combined note reads in the order the prompts were added.
- The Cooked note shows all its prompts' exact texts joined by the separator.

### The Cooked note

- **Click:** copies the combined text. When the stage holds pictures, the chip says "Text copied" (the pictures are not included; see "Pictures in Cooked and Served" below). A Cooked note with pictures but no text copies its first picture.
- **Pictures (1.14):** every screenshot of the prompts in Cooked shows as a small 72×52 tile in a strip under the text. Click a tile to copy that picture ("Copied" on the tile, "Image copied" chip); the expand icon opens the lightbox. Swiping or dragging from a tile still moves the whole note.
- **Notes:** a toggle (looks pressed while open) that lists each part: number, first line, and on hover five buttons (see "The Notes list" below). The Cooked list sits inside the note, so pressing a row anywhere except its buttons acts on the whole note: a click copies all of Cooked, and a left swipe, or a drag onto Served, moves the whole note to Served.
- **Pencil (edit):** opens a composer in place of the note, holding the combined text and all the prompts' images. Saving a changed text replaces the parts that were in the editor with ONE new note (a new id, copy count 0, no highlight; undo label "Edit Cooked"). A prompt that arrived while the editor was open stays, after the new note. Saving it unchanged does nothing, so the parts stay separate. Cancel (× or Esc) leaves it untouched. Right-clicking the note opens the same editor (on a Mac, also Control+click or a two-finger click).
- **Deleting (1.15):** the editor's **trash** button (tooltip "Delete the whole cooked note") deletes the whole Cooked note: every prompt that was in it when the editor opened ("Cooked note deleted · Undo"; undo label "Delete Cooked note"). A prompt that landed in Cooked while the editor was open stays. To delete one prompt only, use the trash on its row in **Notes** (below). ⋯ → Clear Cooked still empties everything.
- **Show more / Show less** (the slim bar under the text, 1.7): the note starts 6 lines tall. Show more opens it to at most min(56vh, 480px), and a longer text scrolls inside. Not remembered: it always starts small (older versions saved this as `usedExpanded`, which is no longer read).

### Cooked → Served

The Cooked note has three ways down:
1. the **↓ Move to Served** bar;
2. **swipe it left** past 36%, with a green "Move to Served" backdrop (distance only: unlike a card, the Cooked note has no flick rule);
3. **drag it** onto the Served block.

All three **append every Cooked prompt to the end of Served**, in order, and empty Cooked for the next batch. The Served block flashes and a "Moved to Served · Undo" toast appears. Undoable ("Move to Served").

### Served (the final text)

- It shows the exact texts of every note moved there, in order, joined by the separator.
- **Click the text** to copy it all ("Text copied" when it has pictures). With pictures but no text there is nothing to copy (unlike Cooked, it doesn't fall back to the first picture).
- **Pictures (1.14):** the same strip of tiles as Cooked, under the text; click one to copy it.
- **Fixed size (1.7):** like Cooked, it starts 6 lines tall with a fade. **Show more** opens it to a capped, scrolling view for the session. The owner asked for this because a 24-note Served (with "Show all" saved on) filled the whole column. `augExpanded` is no longer read.
- **Pencil (edit):** like Cooked's: the whole Served text in a composer (placed under the Served header, the text box hidden meanwhile). A changed text is saved as ONE new note ("Edit Served"), with any note that arrived meanwhile kept after it; unchanged does nothing. Its trash (1.15) deletes the whole Served text ("Served text deleted · Undo").
- **Notes** lists the parts, with the same row buttons; ↩ sends one back to the end of Cooked ("Sent back to Cooked · Undo"), and the trash deletes one. A plain click on a Served row does nothing.
- **Clearing:** ⋯ → Clear Served (undoable).

### The Notes list (Cooked and Served)

Each row shows the part's number and first line. The list is capped at 220px and scrolls. The **Notes** toggle is closed at start (session-only, per column). Hovering (or focusing inside) a row shows five buttons:
- **↑ / ↓**: move the part up or down (disabled at the ends). The combined text follows the new order. Undoable ("Reorder").
- **✎**: edit just this part. The composer opens in the stage's editor spot with only that part's text and images; saving changes only that note (undo label "Edit note"), so the others stay separate. The composer's trash button deletes the part ("Note deleted · Undo").
- **↩**: in Cooked, send the prompt back to the bottom of Cooking ("Moved back to Cooking"; undo label "Move back"); in Served, send it back to the end of Cooked ("Sent back to Cooked").
- **Trash** (1.15, last, a little apart, red on hover): delete just this note from the stage ("Note deleted · Undo"; undo label "Delete note"). The combined text and the picture strip update at once. There is no confirmation; Ctrl+Z (⌘Z on a Mac) or the toast's Undo puts it back in its place.

Only one editor is open at a time anywhere. Opening a stage editor closes the new-prompt composer (its text kept as the draft) and any card editor (without saving). Opening a composer or card editor closes an open stage editor without saving. Undo and redo close an open card editor or stage editor, also without saving (§4, step 6).

### Separator

Settings → **Join notes with**: "Blank line" (`\n\n`, the default) or "New line" (`\n`). It applies to the Cooked note, the Served text and Ctrl+click copies. It takes effect immediately, since the texts are combined each time they are shown.

## 10. Highlighting

1. Hover a card and click the highlighter icon. A menu offers **Check again** (amber), **Important** (rose), **Idea** (sky) and **Ready** (lime), plus "No highlight".
2. A highlighted card gets a tinted background, a thicker coloured left bar and a label chip in its footer (for example "● Check again").
3. **Keyboard:** H on a focused card toggles amber. (On a Mac, plain H; ⌘H hides Recaller.)
4. Undoable ("Highlight" / "Remove highlight"). Stored in `note.highlight`.

## 11. Editing a card

1. **Right-click the card** (1.10), or press E or F2 on a focused card. (On a Mac: Control+click or a two-finger click is the right-click, and F2 needs fn under macOS's default keyboard setting; E needs nothing.) (The hover-bar pencil was removed in 1.11; the hover bar now has only the highlighter and **↓ Cooked**.) The card turns into a composer holding its text and images.
2. Save (Ctrl+Enter; ⌘↩ on a Mac) updates the text, images and updated time; this is undoable ("Edit note") only if something changed. Cancel (× or Esc) discards the edit. The trash button deletes the card. Opening any other composer or editor, Ctrl+N, or undo/redo also closes it without saving (§4, step 6).
3. While a card is being edited, it stays visible even if search would hide it.

## 12. Voice dictation (live, phrase by phrase)

**Starting.**
- Ways to start: **Dictate** (the right half of the New prompt bar), the mic inside any composer, or Ctrl+M (⌘M on a Mac; in a composer it toggles; otherwise it opens the current column's composer and starts).
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
6. **Stop** (click the pill, Ctrl+M or ⌘M on a Mac, or Esc): the last phrase is sent, and the composer shows "Writing…" until the queue is empty. A second Esc or × while "Writing…" shows closes the composer and drops the phrases still queued or streaming. Only text already inserted survives, as the draft of a new-prompt composer (a card or stage editor's cancel discards the edit).
7. **Save while recording or transcribing:** recording stops, transcription finishes ("Saving…" status), then the note is saved automatically.
8. **Errors:**
   - Network, 5xx and stream errors are retried once automatically; the partial text is cleared before the retry.
   - If a request still fails, an error row appears in the composer with **Retry** (reuses the recorded audio) and **Discard**.
   - Key problems (none set, or 401) show a **Settings** button instead.
   - A 429 shows OpenAI's quota message.
   - Microphone problems: "Microphone blocked. Allow it in Windows Settings › Privacy & security › Microphone.", "No microphone found.", "The microphone is in use by another app." (On a Mac the blocked message names System Settings and comes with an **Open System Settings** button; §25.)
   - "Didn't catch that" appears if nothing usable was recorded.

**Settings used:** model (default gpt-transcribe; gpt-4o-mini-transcribe is fastest; whisper-1 can't stream), language and vocabulary hint.

## 13. Screenshots and images

**Snip flow:**
1. Triggers: the camera button in a composer, Ctrl+Shift+S (⇧⌘S on a Mac), ⋯ → New from screenshot, or the optional global "Screenshot to note" shortcut. (On a Mac, macOS must allow Screen Recording first; without it Recaller shows a message instead of snipping; §25.)
2. If Recaller is on screen, it hides and waits 260ms (on a Mac, a full-screen Recaller first leaves full screen). It then captures the display under the mouse cursor at full resolution with `desktopCapturer`.
3. A frameless, always-on-top overlay covers that display. It shows the frozen screen dimmed (a JPEG copy; the crop comes from the original), with the hint "**Drag** to capture an area · **Click** for the whole screen · **Esc** to cancel".
4. Dragging draws a selection with an emerald outline and a pixel-size label.
   - Release to capture that area. A drag smaller than 6px either way counts as a click.
   - A click without dragging, or Enter, captures the whole screen.
   - Esc, right-click, or switching away cancels.
   - A 3-minute safety timeout also cancels.
   - Starting a second snip while one is open gives "A screenshot is already in progress."
5. The crop is taken from the original capture at full resolution, in physical pixels (a whole-screen snip on the Mac's 2× screen is 3024×1964). It is saved as a full PNG (`<id>.png`) plus a thumbnail (`<id>.t.png`, at most 640px wide, written even for a smaller image) in the `images` folder inside the data folder: `%APPDATA%\Recaller\images` on Windows, `~/Library/Application Support/Recaller/images` on a Mac.
6. Recaller reappears and the image is added to the composer's attachment row: 58×44 thumbnails with a × to remove, and a click opens the image large.
7. **Global shortcut variant:** the snip happens first (even while Recaller is minimised), then Recaller is brought up and the image is attached to the open composer, or to a new one in the current column. Errors show as a toast. (On a Mac the image waits until the page has loaded, and a cancelled global snip hides Recaller again if it wasn't on screen; §25.)

**Other ways to add images:**
- **Pasting** into a composer attaches images only when the clipboard has no plain text; otherwise the text is pasted normally.
- **Dropping image files** onto a composer attaches them.
- PNG and JPEG are sent as-is; other formats (webp, gif, …) are converted to PNG in the page first.

**Viewing and copying:**
- On a saved card, images show as thumbnails (one large, or a grid of three with "+N").
- Clicking a thumbnail copies that image.
- The expand icon on hover opens the **lightbox**: the full image, with **Copy image** and **Close**. Clicking the image or backdrop, or pressing Esc, closes it.

**Pictures in Cooked and Served (1.14):** a prompt's images move with it (they always did in the data; before 1.14 they were just not shown). Both stages show all their pictures, in note order, as a strip of small tiles under the text. The text and the pictures are copied **separately on purpose**: clicking the text copies only the text, and clicking a tile copies only that picture. Putting both on the clipboard at once was tested and rejected: Chromium hands a paste of text + image to the page as text plus an image file, and the Claude Code VS Code chat box (checked in its code), and very likely claude.ai and ChatGPT, attach the file and throw the text away. See `07` #54.

**Cleanup:** at startup, image files that no note, draft or backup references, and that are more than one hour old, are deleted.

## 14. Undo and redo

- **Undo:** Ctrl+Z (when not typing in a text field), the ↶ button, or **Undo** on a toast. **Redo:** Ctrl+Y or Ctrl+Shift+Z, the ↷ button, or **Redo** on the "Undone: …" toast. (On a Mac: ⌘Z and ⇧⌘Z, or Edit › Undo / Redo in the menu bar; in a text field those undo the typing instead; §25.)
- **Undoable actions**, by the label that the ↶/↷ tooltips (in lower case) and the "Undone: …" toast show:
  - notes: New note, Edit note, Delete note, Reorder (a card dragged within its list), Sort prompts;
  - moves: Move to Cooked (the ↓ Cooked button, U, or the selection bar's Move to Cooked), Add to Cooked (a card dragged onto its own column's Cooked), Move to \<project\> (a card dragged into another column, including onto its Cooked), Add to Served (a card dropped on Served), Move to Served (Cooked → Served), Move back (a Cooked part sent back to Cooking), Send back to Cooked (a Served part sent back);
  - the stages' parts: Reorder, Edit note (one part), Edit Cooked, Edit Served, Delete note (a part, from its row trash or its editor), Delete Cooked note / Delete Served text (the whole-text editor's trash, 1.15);
  - highlights: Highlight, Remove highlight;
  - projects: New project, Rename project, Delete project, Move project (⋯ → Move left/right), Reorder projects (dragging a column), Change color, Clear Cooked, Clear Served.
- **Not undoable through history, by design:** copies (and copy counts), collapsing and expanding, drafts, settings, theme and density changes, scrolling, column widths. (The "Column widths reset" toast has its own Undo.)
- Up to 80 steps, in memory only (lost on restart).
- Undo and redo close an open card editor or stage editor without saving it (§4, step 6).

## 15. Search

- **Opening it:** Ctrl+K or Ctrl+F (⌘K or ⌘F on a Mac) focuses the search box. The global show/hide hotkey also focuses it, unless the user is composing, editing, dictating or in a dialog.
- **Matching:** space-separated terms, all of which must appear, case-insensitive, in a prompt card's text. Matches are highlighted in green.
  - Columns show "matching/total" counts and "No matches" where nothing matches.
  - The Cooked and Served texts are never filtered, but every term is highlighted inside them (and in their Notes rows). When a combined text contains all the terms, it opens up to its full length while the search lasts.
- **Keys:** Enter copies the first matching prompt. ↓ moves focus to the first card. Esc clears the text, and a second Esc leaves the box.

## 16. Moving around the board horizontally

- ‹ › edge buttons: a click scrolls one column width smoothly; holding (more than 320ms) glides continuously.
  - **When they show (1.16):** an arrow appears only while the pointer is within 96px of its edge of the board (it fades and slides in), and only if there is more to scroll that way. Moving the pointer away, leaving the board, dragging a card or panning the canvas hides it again. Tabbing to it with the keyboard also shows it. Before 1.16 the › was always on screen whenever the board overflowed, which the owner found annoying.
  - **Look (1.16):** a 38px white disc with a slim deep-emerald ring and a faint outer halo; on hover the ring turns bright emerald, the chevron turns deep emerald, and it grows slightly.
- The mouse wheel over anything that can't scroll vertically (headers, gaps, short columns) scrolls the board sideways. Over something that scrolls itself (a column, an opened-up Cooked/Served text, a long Notes list, a textarea), the wheel scrolls that. Shift+wheel always scrolls sideways (Chromium's default).
- Dragging empty canvas pans the board. A press on empty canvas without moving clears any Ctrl+click selection.
- Holding the middle mouse button and dragging anywhere pans. (On a Mac trackpad there is no middle button: drag empty canvas instead. A two-finger sideways swipe scrolls the board; §25.)
- The bottom scrollbar is thick and easy to grab (1.20.3: a 28 px bar with a 20 px thumb, 24 px under the pointer; the Eating strip sits just above it).
- Board and column scroll positions are remembered across restarts, but only positions the user scrolled to.

## 17. Settings dialog (gear icon or Ctrl+,)

(On a Mac: ⌘, or Recaller › Settings… in the menu bar; the Mac differences are listed in §25.)

Since 1.7 the fields are grouped under section headings: **Appearance** (1–4), **Voice** (5–7), **Shortcuts & behaviour** (8–9), **Your data** (10). The dialog is a form: pressing Enter in the key, Language or Vocabulary field closes it. Fields, in order:
1. **Colour:** Deep or Soft. Applies instantly, including the Windows title bar. Stored in settings. (On a Mac only the window background follows; the traffic lights keep macOS's colours.)
2. **Column width:** Compact (236px), Slim (268px, the default) or Roomy (330px). Stored in `data.prefs.density`. This is the default width; columns the user resized keep their own width (§22).
3. **Join notes with:** Blank line or New line (`prefs.joiner`).
3b. **Cooked colour** (1.12; light since 1.13): four tiles, each a mini light "COOKED" note in its palette: Ocean (default), Teal, Midnight, Graphite. Applies instantly to everything Cooked-coloured. Stored in `prefs.cookedColor`.
4. **Column title font:** nine preview tiles in a 3×3 grid, each rendered on an emerald header ("Wildfire RL"): Instrument Sans (default since 1.6), Plus Jakarta Sans, Onest, Sora, Space Grotesk, Inter Display, Manrope, Geist, Sora Caps. Applies instantly. Stored in `prefs.titleFont` only when picked.
5. **OpenAI API key:** a password field showing "•••• last4" when a key is set, with a status line ("Saved and encrypted on this PC…", "Saved in your Mac’s keychain…" on a Mac, or "Using OPENAI_API_KEY from your environment…"). **Remove** is shown only for a saved key. A link points to platform.openai.com/api-keys. The key is saved when the field loses focus or the dialog closes.
6. **Transcription model:** gpt-transcribe (recommended), gpt-4o-mini-transcribe (fastest), gpt-4o-transcribe, or whisper-1 (no live text). **Language** is optional (for example `en`).
7. **Vocabulary hint:** words to spell correctly.
8. **Show/hide Recaller** and **Screenshot to note** global shortcuts. Click the field and press a key combination; Tab moves on.
   - A combination needs at least one modifier (Ctrl, Alt, Shift or the Windows key), unless it is a function key (F1–F12). Otherwise the status reads "Use at least one of Ctrl, Alt or Shift".
   - Ctrl is saved as `CommandOrControl` and the Windows key as `Super`; the field shows, for example, "Ctrl + Alt + R".
   - Backspace or Delete with no modifier clears it.
   - Status reads "Active everywhere", "Taken by another app — try another combo" (also shown when Electron rejects the combination), or "Off · Backspace clears".
   - (On a Mac the field shows symbols such as ⌃⌥R and records Control and ⌘ as pressed; §25.)
9. **Minimize Recaller after copying** (switch; "Hide Recaller after copying" on a Mac).
9b. **Account & sync** (1.17, a section just above **Your data**; it and its heading show only when accounts are enabled, see §26): create an account, sign in, the sync status and devices, Sync now, Sign out, Change password, Delete account. See §26.
10. **Backups:** a dropdown of backups ("Sep 24, 03:28 AM · Before update to 1.5.0 · 12 notes"), plus **Back up now**, **Restore** (with a confirmation) and a status line.

The footer holds **Open data folder** and **Done**. (On a Mac, Open data folder shows `~/Library/Application Support/Recaller` in the Finder.)

## 18. Backups and restore (user view)

- **Automatic backups:**
  - before every new version first runs (before it reads anything);
  - a daily one, made when the newest daily backup is 24 hours old or more. The Windows app checks this only at startup, so if Recaller stays open for days, the next daily backup waits for the next start. On a Mac the check also runs every hour, because a Mac app keeps running for days (§25).
- **Manual backups:** Settings → Back up now ("Nothing to back up yet" before any data exists).
- **Restore:**
  1. Pick a backup in the dropdown, click Restore and confirm.
  2. The current state is backed up first ("Before restore").
  3. The notes file is replaced and the window reloads.
  4. Settings (API key, shortcuts, theme) are not changed by a restore.
  5. 1.17, signed in: the confirmation reads "Bring back the board from {label}? You're signed in, so nothing is deleted from your account: notes in the backup are added back, and notes that are only in your account stay. What you have now is backed up first." The next sync is a restore merge (§26).
- **Before sync** (1.17, signed in only): made automatically before a first upload or first-sign-in choice, before "Use my account's board", and before an incoming change that removes many notes.

## 19. Global hotkeys (work in any app)

- **Ctrl+Alt+R** (default): if Recaller is focused and visible, it minimises; otherwise it is restored, shown and focused, with search focused (unless composing, editing, dictating or in a dialog).
  - The stored default is `CommandOrControl+Alt+R`. It applies only while the settings file has no `hotkey`, and Settings can change or clear it.
  - On a Mac the default is ⌃⌥R (`Control+Alt+R`), the same physical keys, and it hides Recaller instead of minimising it, handing focus back to the previous app (§25).
- **Screenshot to note** (off by default): see §13.

## 20. Keyboard reference

On a Mac, the Ctrl keys below are ⌘ keys (redo is shown as ⇧⌘Z, and F1 as ?), except the OS-wide Ctrl+Alt+R, which is ⌃⌥R. The full Mac table is in §25. On Windows the Windows key also counts as Ctrl in these checks. None of the app's own keys work while Settings, Help or the lightbox is open.

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
| Anywhere | F1, or ? when not typing | Help: "How Recaller works" |
| Settings, Help, lightbox | Esc | Close it |
| Composer | Ctrl+Enter | Save (during dictation: finish, then save) |
| Composer | Esc | Stop recording first; otherwise close (keeps draft) or cancel edit |
| Composer | Ctrl+M / Ctrl+Shift+S | Mic / screenshot |
| Focused card | Enter or Space | Copy |
| Focused card | E or F2 | Edit |
| Focused card | U | Move to Cooked |
| Focused card | H | Toggle amber highlight |
| Focused card | Delete / Backspace | Delete (with Undo) |
| Focused card | ↑ / ↓ | Move focus between cards (every card on the board, in order, across columns) |
| Search box | Enter / ↓ / Esc | Copy first match / focus first card / clear, then leave |
| Rename field | Enter / Esc | Save / cancel |
| Shortcut field (Settings) | any combo / Backspace or Delete | Set / clear |
| Snip overlay | drag / click / Enter / Esc / right-click | Area / whole screen / whole screen or current area / cancel / cancel |
| Column edge | drag / double-click | Resize / back to the default width |
| OS-wide | Ctrl+Alt+R (default) | Show/hide Recaller |
| Dev runs only (not packaged) | F12 / Ctrl+Shift+I | DevTools |

## 21. Toast messages (for reference)

- "Note deleted · Undo"
- "Added to Cooked · Undo"
- "Moved to Served · Undo"
- "Added to Served · Undo"
- "Moved to \<project\> · Undo" (a card dragged into another column)
- "Moved back to Cooking · Undo"
- "Sent back to Cooked · Undo"
- "Moved n to Cooked · Undo"
- "Deleted “Name” · Undo"
- "Cleared Cooked · Undo" / "Cleared Served · Undo"
- "Cooked note deleted · Undo" / "Served text deleted · Undo" (1.15, the whole-text editor's trash)
- "Column widths reset to default · Undo"
- "Prompts sorted oldest first · Undo"
- "Undone: X · Redo" / "Redone: X · Undo"
- "Nothing to undo"
- "Backup saved" / "Nothing to back up yet"
- "Restore failed." (or the error main returns)
- "Image copied"
- "Couldn't copy to the clipboard."
- "Could not save your changes." / "Couldn't save settings."
- "Image-only notes have no text to combine…"
- "Those notes are already in Cooked"
- "Nothing matches"
- A global snip's error, such as "Screenshot failed: …" or "A screenshot is already in progress." (a snip from a composer shows these in the composer instead)
- On a Mac only: the Screen Recording message with **Open Settings**, from the global snip key (§25)
- 1.17, signed in (7s each; ordinary incoming changes get no toast): "A note was changed on two computers. Both versions are kept; this PC's is marked Check again." (this Mac's on a Mac); "A note you deleted was changed on your Mac, so it was kept."; "“Name” was deleted on your Windows PC, but it had changes here, so it was kept." (or "…an unsaved draft here…"); "Your Mac deleted n notes. This PC's board was backed up first (Settings › Backups)."; "This PC's notes file couldn't be read, so your board was restored from your account. …"; "Combined: a projects from your account and b from this PC."; "This PC now shows your account's board. Its previous board is in Settings › Backups."; "Your board is in your account now."; "Signed out. Your board stays on this computer."; "Account deleted. Your board stays on this PC."

**Timing:** a toast lasts 3.2s unless it says otherwise: deletes and clears 7s, a deleted project 9s, the Mac Screen Recording toast 12s. Hovering a toast pauses its timer; moving off gives it 1.5s more. At most three toasts show at once, and a new undoable change dismisses the older Undo toasts (the column-width toast is not one of them).

## 21b. Right-click to edit (1.10)

- **On a prompt card:** opens the card editor (the same one as E / F2; the card's hover pencil was removed in 1.11).
- **On the Cooked note or the Served text:** opens that stage's whole-text editor (like its footer pencil).
- **On a row of a Notes list** (Cooked or Served): edits that part alone (like its ✎).
- **With text selected** (e.g. part of the Served text), the right-click is left alone, so the usual **Copy** menu appears.
- **In a text field or an editor**, the usual Cut/Copy/Paste menu appears.
- (On a Mac: Control+click and a two-finger click are right-clicks and edit the same way. The Mac selects the word under the pointer before the menu event, so Recaller reads the selection as the button goes down; §25.)

## 22. Column widths (1.6)

1. **Resize:** hover a column's right edge (the gap to its right) and a thin vertical line appears; the cursor becomes ↔. Drag to make the column wider or narrower (200–900px). While dragging, the line runs the full height.
2. **Snap:** passing within 6px of the default width snaps to it, and a column at the default width is stored as "not resized".
3. **Saved:** on release the width is saved in `data.prefs.colWidths[projectId]`. Nothing is written if the width didn't change (a plain click or double-click on the edge).
4. **Reset one column:** double-click its edge, or ⋯ → Reset width.
5. **Reset all:** the ↔ button in the top bar. Its tooltip reads "Reset the resized column to the default width" with one resized column, and "Reset all n resized columns to the default width" with more; it is disabled, with an explanatory tooltip, when nothing is resized. A toast "Column widths reset to default · Undo" offers to put the widths back.
6. **Default width** comes from Settings → Column width (Compact/Slim/Roomy); resized columns ignore it.
7. After any width change, the "Show more" buttons are measured again for that column.

## 23. Help panel (1.7)

The **?** in the top bar, `F1`, or `?` (when not typing) opens a dialog, "How Recaller works" (on a Mac also Help › How Recaller Works; the top-bar tooltip says "(?)" there):
- one line of intro;
- the three stages as cards (Cooking, Cooked, Served), each with a colour dot and one sentence (Cooked: "Hover a prompt and click ↓ Cooked (or drag it down)…");
- "Handy moves": Ctrl+click (⌘ on a Mac), "Delete" (swipe a card; in Cooked or Served the trash on a Notes row, or the editor's trash for the whole text; Ctrl+Z), "Edit anything" (right-click a prompt, the Cooked note or the Served text; right-click a Notes row for one part), folding a stage by clicking its name, highlight, resize, screenshots, and (1.17) "On every computer" about Account & sync, a last line that shows only when accounts are enabled (§26);
- "Shortcuts": a two-column list. The show/hide row shows the user's own global key, or "Off" with a pointer to Settings. (On a Mac the list shows ⌘K, ⌘N, ⌘M, ⌘↩, ⇧⌘S, ⌘Z / ⇧⌘Z, ⇧⌘N, ⌘, and ⌃⌥R, and ? instead of F1.)

Esc, ×, or **Got it** closes it. While it's open, the app's own shortcuts are ignored. Opening it closes Settings.

## 24. A typical session, start to finish (the owner's everyday loop)

1. Press **Ctrl+Alt+R** anywhere (⌃⌥R on a Mac); Recaller comes up with the search box focused.
2. In the right project column, click **Dictate** (or press Ctrl+M; ⌘M on a Mac) and speak a prompt; the words stream in. Click the red Stop pill, then **Save** (Ctrl+Enter; ⌘↩ on a Mac). The editor closes and the prompt appears at the bottom of **Cooking**.
3. Click the card to copy it and paste it into Claude/ChatGPT. Ctrl+click (⌘-click on a Mac) several cards to copy them together.
4. When a prompt is worth keeping in the working set, hover it and click **↓ Cooked**. Cooked shows every such prompt joined into one note; clicking it copies the whole combined text.
5. When that combined text is done, click **↓ Move to Served** (or swipe the Cooked note left). Its text is added to the end of **Served**, and Cooked empties for the next batch.
6. Click the Served text to copy the finished whole. **Show more** opens a long Served text for reading.
7. Anything wrong? Right-click (on a Mac, Control+click or a two-finger click) the prompt, the Cooked note, the Served text or a single Notes row to edit it. A prompt that shouldn't be in Cooked: open **Notes** and click its trash (or ↩ to send it back to Cooking). Ctrl+Z (⌘Z) undoes any step.
8. Press Ctrl+Alt+R again to minimise Recaller (on a Mac, ⌃⌥R hides it and the previous app gets focus back). Everything is saved as it happens. Backups are made before every update and daily (checked at startup; also hourly on a Mac).

## 25. On a Mac

The Mac edition of 1.16.0 is the same app, built from the same code on branch `masos`. The owner committed and pushed it there on 2026-09-29 as "mac build" (`16961eb` + `9536853`); it was merged into `main` with 1.17.0 on 2026-10-06 (PR #2), and `v1` still holds the Windows 1.16. Every Mac difference is fenced (`IS_MAC` in the JavaScript, `body.is-mac` in the CSS, the `mac` and `dmg` build sections), so the Windows app behaves exactly as before. The data format and folder layout are the same. The build is for Apple Silicon only (arm64), needs macOS 13 or later, is ad-hoc signed and is not notarized. This section describes what the user sees and does; `14_macos.md` has how each difference works in the code, the build, the tests and the open list.

**What has been checked:** the three e2e suites pass on this Mac, run from source and against the packaged app's `app.asar`: 12 + 21 + 139. On a Mac the features suite skips the 3 real-snip checks and adds 8 Mac checks. **What isn't verified yet:** the real keys (⌃⌥R included), the real traffic lights, and the real microphone, Screen Recording and keychain prompts. The session never launched the packaged `Recaller.app`. Late on 2026-09-29 the owner copied it into `/Applications` and then opened the copy inside the mounted dmg (still running from there at the end of the session), and nothing about that run is recorded. There is no Intel build, and snips over another app's full-screen Space are untested. Wherever this section says nobody has tried something, read it as "not verified by a session and not reported by the owner yet".

### Install and first run

1. Build `dist/Recaller-1.16.0-arm64.dmg` with `npm run dist:mac` (see `06` and `14` §4). Opening the dmg shows a window titled "Recaller 1.16.0" holding Recaller.app and an Applications link.
2. Drag Recaller onto Applications, then eject the "Recaller 1.16.0" disk (the eject button beside it in Finder's sidebar) and open Recaller from Applications. Don't open the Recaller in the dmg window: that copy runs from the disk image, and the disk can't be ejected while it runs. If that has happened, quit it (⌘Q), eject the disk and open Recaller from Applications; the notes are the same either way.
3. Gatekeeper:
   - a copy built on this Mac has no quarantine flag and opens straight away;
   - a downloaded or AirDropped copy is quarantined, and macOS says it can't verify the developer. Open System Settings › Privacy & Security and click **Open Anyway** once. On macOS 15 and later, Control-click › Open no longer gets past this.
4. **First launch:** with no data folder yet, `~/Library/Application Support/Recaller` is created and the **Welcome** project appears. Its ten tips name Mac keys (⌘V, ⌘Z, "Hold ⌘ and click several notes…", "⌘K search · ⌘N new prompt · ⌘M dictate · ⇧⌘S screenshot · ⌘Z undo"). The window opens at the default 1280×820 in the Deep theme, and ⌃⌥R is registered as the show/hide key. The first daily backup follows about an hour later, at the first hourly check.
5. **First dictation:** macOS asks for the microphone. Its prompt gives the reason from the app's Info.plist: "Recaller listens only while you dictate a prompt, and sends the recording to OpenAI to turn it into text." If it is refused, see "Permission messages" below.
6. **First screenshot:** macOS shows its Screen Recording prompt, and Recaller shows its own message (below). After turning Recaller on in System Settings, quit Recaller (⌘Q) and open it again.
7. **First API key:** saving it may bring a macOS keychain prompt for "Recaller Safe Storage". **Always Allow** stops it coming back.
8. **After installing a newer build:** an ad-hoc signature changes with every build, so macOS may ask for the microphone, Screen Recording and the keychain item again. If a switch in System Settings is on but the permission still fails, turn it off and on again (the messages say so).
9. **Notes from the PC** don't come across by themselves. Moving them (copy `recaller-data.json` and `images/` only; the settings file's API key is encrypted by Windows and can't be decrypted on a Mac) hasn't been done yet: see `14` §7 and `09`.

### Keys

On a Mac, ⌘ does what Ctrl does on the PC. Control-based keys are left to macOS: inside a text field ⌃K, ⌃F, ⌃N and the like keep their usual text-editing meanings, and Recaller ignores them. The one exception is the global show/hide key, ⌃⌥R, which uses the same physical keys as Ctrl+Alt+R on the PC. Labels and tooltips use the Mac symbols: ⌘ Command, ⇧ Shift, ⌥ Option, ⌃ Control, ↩ Return.

| Where | Mac | Windows | Action |
| --- | --- | --- | --- |
| Anywhere | ⌘K / ⌘F | Ctrl+K / Ctrl+F | Focus search |
| Anywhere | ⌘N | Ctrl+N | New prompt in the current column |
| Anywhere | ⇧⌘N | Ctrl+Shift+N | New project |
| Anywhere | ⌘M | Ctrl+M | Dictate (opens the composer and starts; in a composer, start/stop) |
| Anywhere | ⇧⌘S | Ctrl+Shift+S | Screenshot into the open composer (or a new one) |
| Anywhere | ⌘Z / ⇧⌘Z (⌘Y also redoes) | Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z | Undo / redo the board; in a text field, undo / redo the typing (through Edit › Undo / Redo) |
| Anywhere | ⌘, | Ctrl+, | Settings |
| Anywhere | Esc | Esc | Close menu; clear the ⌘-click selection |
| Anywhere | ? when not typing (F1 needs fn under the default keyboard setting) | F1, or ? when not typing | Help |
| Composer | ⌘↩ | Ctrl+Enter | Save (during dictation: finish, then save) |
| Composer | Esc | Esc | Stop recording first; otherwise close (keeps draft) or cancel edit |
| Composer | ⌘M / ⇧⌘S | Ctrl+M / Ctrl+Shift+S | Mic / screenshot |
| Focused card | ↩ or Space | Enter or Space | Copy |
| Focused card | E (or fn F2) | E or F2 | Edit |
| Focused card | U | U | Move to Cooked |
| Focused card | H | H | Toggle amber highlight |
| Focused card | delete (⌫), fn delete, or ⌘⌫ | Delete / Backspace | Delete (with Undo) |
| Focused card | ↑ / ↓ | ↑ / ↓ | Move focus between cards |
| Search box | ↩ / ↓ / Esc | Enter / ↓ / Esc | Copy first match / focus first card / clear, then leave |
| Rename field | ↩ / Esc | Enter / Esc | Save / cancel |
| Shortcut field | any combo / delete | any combo / Backspace or Delete | Set / clear |
| Snip overlay | drag / click / ↩ / Esc / right-click | the same | Area / whole screen / whole screen or current area / cancel / cancel |
| Column edge | drag / double-click | the same | Resize / back to the default width |
| Menu bar | ⌘H / ⌥⌘H / ⌘W / ⌘Q | (no menu bar) | Hide Recaller / Hide Others / Close Window (hides) / Quit |
| OS-wide | ⌃⌥R (default) | Ctrl+Alt+R | Show/hide Recaller |
| Dev runs only | ⌘⌥I (also ⌃⇧I, fn F12) | F12 / Ctrl+Shift+I | DevTools |

- On a focused card, a key held with ⌘, ⌃ or ⌥ is left to the menus, so ⌘H hides Recaller instead of highlighting. The only exception is ⌘⌫, which deletes the card, as in the Finder.
- ⌘C is the Edit menu's Copy, which copies selected text. To copy a card, click it or press ↩ or Space on it.
- As on Windows, none of the app's keys work while Settings, Help or the lightbox is open, and Esc closes them.
- The suites send only some of these, as synthetic key events: ⌘↩, ⌘Z, ⌘Y and ⌘N, plus ⌘H on a focused card. Nobody has pressed any of them on the real keyboard yet.

### ⌘-click multi-copy; Control-click edits

- **⌘-click** does everything Ctrl+click does on Windows (§6). Each ⌘-click adds a card and puts all selected texts on the clipboard in click order, with numbered badges and the bar "n notes copied · ⌘-click to add or remove" (**Move to Cooked**, **Clear**). The anchor rule is the same: a plain click and then a ⌘-click within two minutes makes the plain-clicked card number 1. Pressing ⌘, ⇧, ⌥ or ⌃ doesn't break the anchor.
- **Control+click is a right-click on a Mac, so it edits**, like a two-finger click on the trackpad:
  - on a prompt card it opens the card editor;
  - on the Cooked note or the Served text, the whole-text editor;
  - on a Notes row, that part's editor.

  It never copies, selects, drags or pans. The board ignores a left press with Control held (`pointerdown` returns at once), and the `contextmenu` listener opens the editor.
- **Why:** Chromium on a Mac turns a Control+left-click into a context-menu click. With the Windows code, a Control+click on a card would open its editor and also select and copy it.
- **Right-click over text:** the Mac selects the word under the pointer before the context-menu event arrives. So Recaller reads the selection as the button goes down (`selectionAtPress`). If text was already selected, the usual Copy menu appears, as on Windows. Otherwise the editor opens, and the word the Mac selected is deselected.
- The features suite checks both with synthetic clicks: a Control+click on a card opens its editor without copying or selecting, and a right-click on the Served text opens the Served editor rather than the Copy menu. A real trackpad hasn't been tried.

### The window

- **Traffic lights:** at the top-left, placed at (16, 16) so the three buttons sit centred in the 48px top bar (x 16–70). The brand starts at x 84. They keep macOS's own colours; the Colour setting only changes the window background. The top bar is still the drag region.
- **Red button, or ⌘W (Window › Close Window):** hides the window. The notes and settings are saved first, as on a Windows close. Recaller keeps running and ⌃⌥R still works. A click on the Dock icon, or ⌃⌥R, brings the window back with the search box focused.
- **Yellow button, or Window › Minimize:** the window goes into the Dock. It has no ⌘M, because ⌘M is Dictate. Clicking the window in the Dock, or ⌃⌥R, restores it.
- **Green button:** full screen, in its own Space.
  - The traffic lights are hidden there, so the top bar starts at 14px instead of 84px (`body.is-fullscreen`).
  - ⌘W in full screen first leaves full screen and then hides the window. Hiding a full-screen window would leave an empty black Space behind.
  - A snip started in full screen also leaves full screen first, and Recaller comes back afterwards as a normal window.
  - A full-screen frame is never saved as the window's size.
  - ⌃⌥R and hide-after-copying use `app.hide()` without leaving full screen. How that looks from a full-screen Space hasn't been tried.
- **⌘Q (Recaller › Quit Recaller):** quits for real. A draft being typed is saved at once (on `beforeunload`), and main writes the data when the window closes and again on `will-quit`.
- **Dock:** Recaller is a normal Dock app. It keeps running with its window closed, until ⌘Q. A click on its Dock icon while the window is hidden shows it again, like ⌃⌥R.
- **The first click lands:** the window accepts the first mouse click (`acceptFirstMouse`). A click on a card while another app is in front brings Recaller forward and copies the card in one go.
- The window's size and position are remembered, as on Windows.

### The global ⌃⌥R

- The default show/hide key is ⌃⌥R (Control+Option+R, stored as `Control+Alt+R`): the same physical keys as Ctrl+Alt+R on the PC. The Windows default, `CommandOrControl+Alt+R`, would mean ⌥⌘R on a Mac, and VS Code there uses ⌥⌘R for Reveal in Finder. The default applies only while the settings file has no `hotkey`.
- **Pressed while Recaller is visible, in front and not minimised:** Recaller hides (`app.hide()`, like ⌘H), and macOS gives focus straight back to the app that was in front before, so a paste lands there. (Windows minimises instead.)
- **Pressed at any other time:** Recaller un-hides, restores a minimised window, shows it, takes focus from the other app (`app.focus({ steal: true })`), and focuses the search box unless the user is composing, editing, dictating or in a dialog.
- The optional **Screenshot to note** key works as on Windows (§13), with the Mac additions under "Other Mac differences" below.
- Nobody has pressed it on the real keyboard yet.

### Hide after copying

- On a Mac the Settings switch reads **Hide Recaller after copying**. It is the same stored setting (`hideAfterCopy`).
- When it is on, 260ms after a plain copy, Recaller hides itself (`app.hide()`) instead of minimising. A plain copy means a card, a card's picture, the Cooked note, the Served text or a stage picture; ⌘-click copies and the lightbox's Copy image don't count. Focus goes back to the app that was in front before, ready for ⌘V. ⌃⌥R or the Dock icon brings Recaller back.
- Together with the first click landing, a click on a card while another app is in front copies it, and Recaller then steps aside again. This follows from the code; nobody has tried it by hand.
- The suite checks that a copy with the switch on calls `app.hide()` once and leaves the window un-minimised.

### The menu bar

The Mac edition has a full menu bar (the Windows app has none):
- **Recaller:**
  - About Recaller: the name, the version (1.16.0) and "Your prompts and notes, one click away.";
  - **Settings… ⌘,**: brings the window up and opens Settings. If Settings is already open, it is left alone, so nothing typed there is lost;
  - Services;
  - Hide Recaller ⌘H, Hide Others ⌥⌘H, Show All;
  - Quit Recaller ⌘Q.

  When run from source, macOS titles this menu "Electron"; the packaged app says Recaller.
- **Edit:**
  - **Undo ⌘Z** and **Redo ⇧⌘Z**. In a text field they undo or redo the typing; anywhere else they undo or redo the board, like ↶ and ↷. With Settings, Help or the lightbox open they do nothing (unless the cursor is in a text field there). They also do nothing while the window is hidden or minimised, so the board never changes out of sight;
  - the standard Cut ⌘X, Copy ⌘C, Paste ⌘V, Paste and Match Style ⌥⇧⌘V and Select All ⌘A.
- **Window:** Minimize (no key), Zoom, Close Window ⌘W (hides; see "The window"), Bring All to Front.
- **Help:** **How Recaller Works** brings the window up and opens the help panel (inside the app, ? does the same).
- The suite checks that there are 4 menus, that Window › Minimize has no ⌘M, and that Edit › Undo, while typing in a composer, undoes the typing and leaves the board's history alone. It clicks the menu item from code.

### Permission messages and their buttons

- **Microphone:** if macOS blocks the microphone when dictation starts, the composer shows "Microphone blocked. In System Settings › Privacy & Security › Microphone, turn Recaller on (or off and on again after an update), then try again." with an **Open System Settings** button. The button opens that pane (`Privacy_Microphone`) through the `app:open-privacy` IPC. The other microphone messages ("No microphone found.", "The microphone is in use by another app.") are the same as on Windows.
- **Screen Recording:** before every snip, Recaller checks macOS's Screen Recording permission. If it isn't granted:
  - Recaller makes one capture request to macOS. That lists Recaller in the Screen & System Audio Recording pane, and the first time it also brings up macOS's own prompt;
  - Recaller doesn't hide. It shows "Recaller needs permission to record the screen. In System Settings › Privacy & Security › Screen & System Audio Recording, turn Recaller on (or off and on again after an update), then quit and reopen Recaller.";
  - in a composer (the camera, ⇧⌘S, or ⋯ → New from screenshot) the message is an error row with **Open System Settings**;
  - from the global **Screenshot to note** key, Recaller comes up and shows the message as a toast with **Open Settings**, for 12 seconds;
  - both buttons open the Screen Recording pane (`Privacy_ScreenCapture`).
- If macOS still hands back an empty capture, the message is "Screenshot failed: macOS returned an empty screen capture."
- **Keychain:** saving the API key may bring macOS's own keychain prompt; Recaller shows nothing for it.
- **Gatekeeper:** a downloaded copy gets macOS's "can't verify the developer" message; see "Install and first run".
- Not verified by a session or reported by the owner yet: the real prompts, the panes opening, and whether a quit is always needed after allowing Screen Recording. The suites use a fake microphone, skip the real snip and stub `shell.openExternal`.

### Settings differences

- **Opening it:** the gear, ⌘, or Recaller › Settings….
- **Colour:** Deep or Soft change the window background as well, but the traffic lights keep macOS's colours.
- **Join notes with** reads "(Cooked, Served and ⌘-click copies)".
- **OpenAI API key:** the status reads "Saved in your Mac’s keychain. Paste a new key to replace it." The key is encrypted with Electron's `safeStorage`, whose own key lives in the login keychain as "Recaller Safe Storage"; the encrypted API key sits in `recaller-settings.json`, as on Windows. Saving may bring a keychain prompt ("Always Allow").
- **Shortcut fields:**
  - they show Mac symbols in Apple's order ⌃⌥⇧⌘ with no separators, for example ⌃⌥R; arrows show as ↑ ↓ ← →, Return as ↩ and Esc as ⎋;
  - Control is recorded as `Control` and ⌘ as `Command`, so a combination registers exactly as pressed;
  - punctuation is named from the physical key, because Option changes the typed character;
  - a key with no modifier (other than F1–F12) shows "Use at least one of ⌃, ⌥, ⇧ or ⌘";
  - delete (or fn delete) with no modifier clears the field. The statuses are the same as on Windows.
- **Hide Recaller after copying** replaces "Minimize Recaller after copying" (see above).
- **Open data folder** opens `~/Library/Application Support/Recaller` in the Finder.
- **Other labels:**
  - the Help panel's Shortcuts list shows ⌘K, ⌘N, ⌘M, ⌘↩, ⇧⌘S, ⌘Z / ⇧⌘Z, ⇧⌘N, ⌘, and ⌃⌥R, with ? in place of F1, and says "hold ⌘ and click cards";
  - the search box hint is ⌘K;
  - the tooltips read Settings (⌘,), How Recaller works (?), Undo … (⌘Z), Redo … (⇧⌘Z), Save (⌘↩), Dictate (⌘M), Add a screenshot (⇧⌘S), and New prompt / Resume draft (⌘N).

### Other Mac differences

- **Data folder:** `~/Library/Application Support/Recaller` (or `RECALLER_DATA_DIR`), holding the same files as on Windows: `recaller-data.json`, `recaller-settings.json`, `images/` and `backups/`.
- **Draft on quit:** a draft typed right before ⌘Q is saved at once, not after the usual 400ms. The suite checks this with a page reload.
- **Daily backup:** also checked every hour, after a save, because a Mac app runs for days without restarting (§18).
- **Global snip:**
  - its result waits until the page has loaded before it is attached;
  - a global snip cancelled while Recaller wasn't on screen hides Recaller again, so focus goes back to the app that was in front (never while a snip is still up).
- **Snip overlay:** it takes focus when it opens and accepts the first click, so Esc and the first drag work even when the snip started in another app. It doesn't use `setVisibleOnAllWorkspaces`, which flickers the Dock; snips over another app's full-screen Space are untested.
- **Trackpad:** there is no middle button, so pan by dragging empty canvas. A two-finger sideways swipe scrolls the board natively. An up-and-down swipe over headers or gaps scrolls it sideways, like a mouse wheel. A pinch is ignored. None of this has been tried by hand.
- **Look:** the same design, with Mac font fallbacks and key caps in the system font. See `05`, "macOS".
- **Dev runs:** ⌘⌥I toggles DevTools (unpackaged only), and a run from source shows `build/icon-mac.png` in the Dock.
- **Not built yet:** start at login, an Intel or universal build, and Developer ID signing and notarization (see `09`).

## 26. Accounts and sync (1.17.0)

Built and tested on `masos` (2026-10-01), live on Google Cloud since then, and released on 2026-10-06 (the Windows installer as GitHub Release `v1.17.0`; merged into `main`). Both platforms behave the same; "{HERE}" in the strings is "this PC" on Windows and "this Mac" on a Mac. This is the user's view in short; the full flows, strings and edge cases are in `15_accounts_and_sync.md` (5.9–5.16 and 6.2–6.5), and the user guide is README's "Accounts, sync and privacy".

- **Where:** Settings › **Account & sync**, a section just above **Your data**. Every panel opens inline in that section (no stacked dialogs). Enter submits the small form and Esc closes only the form, so neither closes Settings; password fields are cleared when Settings closes.
- **Only when accounts are enabled:** the section and its heading, the Help line (below) and the top-bar cloud show only then. Accounts are enabled when the app has a valid `src/cloud/project.json` (written by `npm run cloud:config`; a build packs it), or when a run from source is pointed at the local mock (`RECALLER_GCP_BASE`). A build made without a valid file has no accounts: `RECALLER_NO_CLOUD=1` is what lets such a build go ahead, and with a valid file that switch is ignored. A run with `RECALLER_DATA_DIR` set, as in the existing test suites, has no accounts either, unless it is a run from source that uses the mock or sets `RECALLER_GCP_REAL=1` (`15`, 3.3).
- **Signed out:** "Keep this board in your own Recaller account on Google Cloud, and on every computer where you sign in. Recaller works the same without an account." [Create account] [Sign in]. Nothing goes to the network.
- **Create an account:**
  1. Email, and a password of 8 or more characters (checked before any network call: "Use at least 8 characters."). "What's stored and where" opens the privacy note (version 2026-10-01).
  2. **Check your email:** "We sent a link to {email}. Open it, then come back to Recaller: it notices by itself. Not in your inbox? Look in Spam. …" [I've verified] [Send again] (60 s cooldown; "Sent again to {email}. Not in your inbox? Look in Spam.") [Use a different email] (deletes the new account if this is done within a few minutes of the sign-up; otherwise a later clean-up, `infra/scripts/purge-unverified.js`, removes it; either way this computer signs out). Recaller also checks by itself every 30 s for 10 minutes, and on focus. Nothing is uploaded until the email is verified.
  3. Verified: the first sync. A pristine Welcome board uploads without a question; a real board asks **Upload this board?** [Upload this board] [Not now].
- **Sign in on another computer:** the same form, with "Forgot password?". The first sync then depends on both boards:
  - this computer pristine or empty, the account has a board: it shows the account's board at once ("This PC now shows your account's board…");
  - the account empty: **Upload this board?**;
  - both have boards: **Your account already has a board** with both counts: [Combine both] (everything from both; this computer's projects after the account's; nothing deleted) [Use my account's board] (replaces this computer's board) and "Not now". A warning line appears when this computer last synced with another account.
  - Upload this board, Combine both and Use my account's board each make a "Before sync" backup first; Combine both and Use my account's board also clear Undo. Not now changes nothing, and the question waits in the section (the cloud shows an amber dot).
  - Owner's plan (`15`, owner's answers): sign up and Upload on the PC, then sign in and Combine both on the Mac.
- **Everyday sync:** it runs by itself, with nothing to press (the signed-in help says so: "Sync now only skips the wait"). Edits upload about 2 s after they are saved. Changes from another computer arrive at summon (Ctrl+Alt+R or ⌃⌥R), focus, wake and Sync now, and otherwise within 60 s while focused, 5 min while visible, 30 min while hidden. A change that would alter what you're working on waits while an editor, drag, menu, dictation or Undo toast is open ("Changes from your Mac will appear when you close the editor."), and clears Undo when it lands. Copy counts add up from both computers.
- **What syncs:** projects, notes in all stages with order, highlights, copy counts and pictures, and "Join notes with". Column widths, folds, scroll, drafts, density, title font, Cooked colour, theme, shortcuts, voice settings and the API key stay on each computer (`03`).
- **Conflicts:** both computers changed one text → both kept; the account's in place, this computer's as a copy right after it with the amber **Check again** highlight and an **Other version** tag (tooltip "Changed on two computers at once. This copy is the version from …"). Saving the copy from its editor removes the tag. An edit beats a delete; a move, highlight or copy never does, with one exception: a note held on this computer (moved into a project the account doesn't have yet, refused, or too large) isn't removed by a deletion from elsewhere, and goes up with its project. Other fields: the later pusher wins.
- **Deletes:** kept 30 days in the account's trash (no view in the app yet). If a push would delete 5 or more notes, or a project, and no undo label explains it (Delete note, Clear Cooked, Undo and so on), Recaller asks **Delete n notes everywhere?** [Keep them in my account] [Delete them everywhere].
- **Signed in, the status line** under the email reads, for example, "Synced · 2m ago", "Syncing…", "Uploading your board… d of t notes", "3 changes waiting to upload", "Offline · changes upload when you're back online", or "Sync paused · {reason}" with [Retry] for a refusal. Also: where the sign-in is kept ("Your sign-in is kept encrypted on this PC." / "…in your Mac's keychain."), "Also signed in on: your Mac · 5m ago", and [Sync now] [Sign out], "Change password", "Delete account…".
- **Top-bar cloud** (`#sync-status`): hidden while signed out, synced, pending online, syncing for under 1.5 s, or offline for under a minute with nothing waiting. Otherwise a slowly breathing cloud (syncing), a muted cloud-off (offline), a plain cloud (changes from another computer wait for an editor to close), a cloud with an amber dot (verify, choose, sign in again, update needed, account can't sync), or a cloud-alert with the dot (paused). Click opens Settings at the section.
- **Offline:** everything works; changes wait in the data file and upload when back online. Quitting with changes waiting gives them up to 1.5 s (not while the computer logs out, restarts or shuts down; on a Mac only within a minute of the system's notice, so a cancelled log out doesn't count), and the rest uploads at the next start.
- **Pictures from another computer** arrive as previews (thumbnails); the full size comes down when one is opened or copied. Where the full size isn't here (offline, or signed out since), the preview is shown and copied instead.
- **Sign out:** first tries to upload what waits (up to 10 s). Then "Sign out of {email}? Your board stays on {HERE} unless you remove it." or, with changes still waiting, "{n} changes haven't uploaded yet…" [Sign out anyway] [Keep syncing]. The checkbox "Also remove this board, its pictures and its backups from {HERE}" removes the data file, `images/`, `backups/` and the sync state, keeps the settings file, and reloads on the Welcome board ("Signed out. This board was removed from this computer; your account keeps it."). It is refused while anything exists only on this computer, and with changes waiting it says "Wait until everything is uploaded…" and offers [Sync now]. Kept copies of an unreadable notes file go too, but only after the panel names them ("This PC also holds 2 unreadable copies of an older notes file, which may have notes this board doesn't. To remove them with the board, tick the box again.") and the box is ticked again.
  - Without the checkbox, while signed in, the sign-out first saves here, for at most 20 s, the full size of every picture the board shows only as a preview ("Saving full-size pictures to {HERE}… 3 of 12"), so the board stays whole signed out. If some are left (offline, out of time, failed), the toast says "Signed out. 4 full-size pictures stay in your account, and {HERE} keeps their previews. Signing in again brings them here." ("1 full-size picture stays … keeps its preview … brings it here."); otherwise "Signed out. Your board stays on this computer."
- **Password:** "Change password" emails a reset link, as does "Forgot password?" › [Send link] on the sign-in form. After a link went out, both buttons wait 60 s and count down ("Send link (42 s)"), like [Send again]. Main also sends at most one link per email a minute; another request in that minute gets "Recaller can't send a reset link right now. Wait a while, then try again." After a change every computer shows "You're signed out on {HERE} because your password changed or your sign-in expired…" [Sign in] [Stop syncing], keeping its notes and uploading what changed meanwhile. Five wrong passwords in 10 minutes lock sign-in for 30 s.
- **Delete account:** "Delete your Recaller account?" with the counts, the password and "Type DELETE to confirm" [Delete account] (danger). Progress "Saving full-size pictures to {HERE}… d of t" first (the pictures this computer holds only as previews, saved before anything is deleted), then "Deleting pictures… d of t", "Deleting notes… d of t", "Deleting account…". If a picture can't be saved, nothing is deleted: "Nothing was deleted: not every full-size picture could be saved to {HERE} first. Check your connection, then try again." This computer keeps its board; other computers stop syncing and show "This account was deleted. Your notes here are safe." [Use without an account]. An interrupted deletion resumes as "Finishing account deletion…" and asks for the password again.
- **Restore while signed in:** nothing is deleted from the account (§18).
- **Other states:** "This account has been turned off." (disabled), "Your account was synced by a newer Recaller. Update Recaller on {HERE} to keep syncing." (newer schema), "This account is being deleted on another computer.", and **Your account's cloud board is missing** [Upload this board] [Sign out].
- **Help:** only when accounts are enabled (as for the section), the Help panel's Handy moves end with "On every computer: Settings › Account & sync keeps this board in your account. Column widths, folds, drafts and the look stay on each computer." (§23).
- **On a Mac:** the same flows. The sign-in is sealed with the "Recaller Safe Storage" keychain item, so the first sign-in (or the first after an ad-hoc-signed update) may bring a keychain prompt; refused, the sign-in lasts for the session only (`14`).

## 27. What 1.18.0 added (tenth session, 2026-10-20, branch `v1.18`)

The owner's words are in `10`, message 63. Both platforms; nothing here is fenced by `IS_MAC`.

- **New text.** The left half of the bar under Cooking reads **New text** (it said New prompt). Its tooltip, the empty-column line ("Nothing cooking yet. Click New text or Dictate."), Help, the Welcome tip and README follow. Narrow columns still read **New**.
- **The top-bar +** (`#new-column`), before undo: a new project, as the tile and Ctrl+Shift+N do. It goes at the end of the board, which scrolls there and opens the rename field.
- **Clear** (an eraser) in the new-text editor only, before ×: it empties the text and pictures. While dictating it keeps listening, and phrases spoken before the Clear are dropped (an `epoch` in `createComposer` makes a phrase still streaming in land nowhere). A toast "Text cleared · Undo" puts the text and pictures back (text cleared after it is kept, after a space).
- **Live text while talking.** `voice.js` closes a phrase after a 550 ms pause (was 700), and someone who talks without pausing gets a cut at the next 100 ms dip after 5 s (was 150 ms after 20 s) and always at 9 s (was 45 s), so text lands every few seconds. While recording, the editor's status says **Listening…** (or **Writing…** while a phrase is being transcribed).
- **Format for Claude Code** (**>_** in the Cooked footer, shown when Cooked has text; filled while on). The Cooked note is then shown and copied as a fixed template (no AI): "Complete the request below in this codebase.", the prompts inside `<request>` (numbered when there are several), a `<how_to_work>` list (read first, follow the style, pick a reading when ambiguous, stay focused, verify, don't commit, push or delete unless asked) and `<when_done>` (a one-line-per-item summary). The footer says "Claude Code" instead of the counts. Click again for the original. The parts stay separate underneath, so Notes, ✎ and the pencil edit the original prompts. **Move to Served** (button, swipe or drag) serves the formatted text as ONE note carrying all the pictures, and the format turns off. It also turns off whenever Cooked becomes empty (Clear Cooked, the editor's trash, the last row deleted or sent back, the last part dragged out). Undoable ("Format for Claude Code" / "Back to original"). Data: `project.cookedFormat = 'claude-code'`. The template is `CC_GUIDE` / `claudeCodeText()` in `app.js`.
- **Eating** (an agent is running the Served text):
  1. A switch on the Served header (**Eating**, a fork and knife), shown once Served has text, or while it is on. Off it is a quiet outline; on it is filled emerald with a pulsing dot and the time, "Eating · 7m" ("now" in the first minute, then minutes, then "1h 4m"; refreshed by the minute render).
  2. The column's header gets a small pulsing green dot before ⋯.
  3. The board's bottom right shows a strip, **EATING**, with one chip per eating column in board order: its leaf in its colour, its name, the time and ×. A click on a chip scrolls to the column (opening its group first if that is folded) and bumps its header; × turns Eating off. While the strip shows, the board keeps 58 px free under the columns (`body.has-eating`), so it never covers a card.
  4. Manual only (the owner's answer): nothing turns it on or off by itself, emptying Served included. Switching it on isn't undoable and isn't in the history; undo carries it over. Data: `project.eating` (the start time). It syncs, so the other computer shows it too.
  5. **Done → Eaten** (the owner's follow-up, `10` message 66: "after eating is done it should move elsewhere and organized"). While eating, the Served switch opens a menu: **Done: move it to Eaten** or **Stop eating, keep it in Served**; each strip chip has a ✓ (Done) instead of ×. Done (`finishEating()`) turns the Served text and its pictures into one **round** in `data.localEaten` (newest first, `{ id, project, name, color, text, images, parts, startedAt, doneAt }`), empties Served and ends Eating. Toast "“Name” is done · moved to Eaten · Undo". Undoable ("Done eating"): the history entry restores the board, the Eaten list and Eating itself (`restore: ['eating']` overrides the carry-over). With nothing served, Done just stops eating.
- **Eaten** (a drawer, `#eaten-panel`, over the board's right side; light in both themes):
  - opened by the fork and knife in the top bar (`#open-eaten`, shown once a round exists, with a count badge) or a column's ⋯ › **Eaten from this column (n)**, which opens it filtered to that column; × or Esc closes it (Esc in a filled search box clears it first). The Eating strip moves left of it while it's open.
  - Inside: a search box (text and column names), filter chips (All, then each column with rounds, in board order, with counts; shown with two or more columns), then the rounds grouped under Today, Yesterday and dates. Each round: its column's leaf and name (the live name; the saved one if the column is gone), the time it finished and "ate for 18m", the text clamped to 4 lines (a click opens it in place, up to 360px with scrolling), its pictures as thumbnails (a click copies one), "n notes · w words", and **Copy**, **Serve again** (appends it as one note to its column's Served and takes it out of Eaten; disabled once the column is deleted) and a trash (**Delete from Eaten**). Serve again and Delete are undoable.
  - Kept on this computer only: `localEaten` is a top-level key starting with `local`, so it never syncs and stays out of the device record; it is in the local backups (and `backups.imageIds()` keeps its pictures). At most 300 rounds (`EATEN_MAX`); the oldest drop off.
  - Sync: Done deletes the Served notes from the account like a Clear Served, and "Done eating" is one of the engine's labels that explain a deletion (no mass-delete question); so is "Serve as Claude Code", the label Move to Served takes when it serves a formatted Cooked note.
- **Minimize a column** (⋯ › Minimize column): a 46 px strip in the header's colour with the leaf, the name written vertically, the eating dot and a count (Cooking + Cooked). A click anywhere on it opens the column. Writing into it (Ctrl+N, Ctrl+M, a global snip) opens it first. Its open editors close when it is minimized. A minimized column takes no drops. Data: `project.localMinimized` (per computer, not undoable).
- **Groups:**
  - ⋯ › **New group…** puts the column in a new group named "Important" (then "Group 2", …) and opens the name for typing. Other columns' ⋯ menus offer **Move to group "…"** for every group, and **Remove from "…"** in a group. Joining moves the column to the end of the group in `data.projects`.
  - A group is a faint lane (`.col-group`) with a slim band: chevron, the name in small capitals, "· n", and ⋯ (Rename group, Fold / Open group, Move group left / right, Ungroup, which keeps the columns). Its columns sit side by side inside it, at the usual widths.
  - Click the name to fold the group into a 46 px strip (the name written vertically and one leaf per member in its colour); click the strip to open it. Folds are per computer, by name (`prefs.foldedGroups`).
  - A group stands where its first member is. Dragging a column reorders it within its own container: inside a group among the group's columns; on the board among the columns and whole groups. ⋯ › Move left / right work the same way. There is no dragging a column into a group (the menu does that) or dragging a whole group (its ⋯ moves it).
  - Undoable: Move to group, Remove from group, Rename group (renaming into another group's name merges them), Ungroup, Move group. Data: `project.group` (synced).
- **Mac: a stalled first load reloads itself.** If the page hasn't asked for the notes (`data:load`) 12 s after the window started loading, main reloads it, at most twice (`IS_MAC` only). Seen on 2026-10-21 right after installing 1.18.0 over 1.17.0: the window stayed empty green (`07` #101).
- **Soft theme:** column headers are 24% of the column colour on white (were 15%, `--accent-tint`), with a 34% edge, so columns stand out from the light canvas. The Deep theme is unchanged.

## 28. What 1.19 added (eleventh session, 2026-10-21, branch `v1.19`)

The owner's words are in `10`, messages 69 to 75. 1.19.1 is 1.19.0 without the Mac zoomed-out column drag.

- **The Eating strip, redesigned** (both platforms; the 1.18 strip hid every chip after the second):
  - Every eating column has a chip, in board order, and the strip **wraps onto more rows** (right-aligned) instead of scrolling sideways with a hidden scrollbar. It is at most the board's width less 32 px (less the drawer while Eaten is open).
  - The label reads **EATING** with a ringing dot and, with two or more, a count badge.
  - Each chip (40 px): a 28 px rounded badge in the column colour with a white leaf, the name (ellipsis at 260 px) over "eating · 12m" in mono, and a labelled **✓ Done** button. A slow sheen in the column colour runs along the chip's foot while it eats. A click on the chip shows the column (as before); Done moves the round to Eaten (as before).
  - The board keeps the strip's **measured** height free under the columns (`--eating-room`, set by `fitEatingRoom()` with a `ResizeObserver`), so a strip of two or three rows still never covers a card. 1.18 reserved a fixed 58 px.
- **Mac: a zoomed-out column drag, removed again in 1.19.1.** 1.19.0 turned every column into a 52 px strip while a column was dragged on a Mac. The owner disliked it ("it brings horizontal like mobile model, i don't like that at all, go back to normal drag", `10` message 75), so 1.19.1 drags whole columns on both platforms exactly as 1.18 did (§3, "Reorder").
- **The widget** (both platforms; the owner's answer: "Floating mini window", `10` message 70): the same window and page, made small and always on top, showing one column.
  1. **In:** the top-bar button before ? (a window-in-window glyph, `#widget-toggle`, tooltip "Widget: a small window that stays on top, with one column"). The window becomes 360 × 640 at the top right of its display (or the widget's last size and place), always on top (`'floating'`), minimum 300 × 360, not maximizable, and on a Mac not full-screenable. A full-screen Mac window leaves full screen first.
  2. **What it shows:** the column the widget last showed, else the current column, else the first; full width and height, never minimized (a minimized column opens in the widget). The top bar keeps only the column picker, undo, Eaten (when shown), the sync cloud (when shown) and the button back; brand, search, +, redo, ↔, ? and the gear hide. No resize handle, board arrows, background leaves or column drag.
  3. **The picker** (`#widget-pick`, the column's leaf, name and a chevron, tinted in its colour): a menu of every column in board order (eating ones say "· eating", the shown one is bold) and **New project**, which makes a column and shows it. Picking a column also makes it the current one (⌘N / Ctrl+N, ⌘M / Ctrl+M write there).
  4. **Eating in the widget:** the strip's chips shrink to badges (leaf and time; the name in the tooltip; the shown column ringed in its colour); a click shows that column in the widget. Done is on each column's own Served switch.
  4b. **Search:** the widget has no search box. ⌘K / Ctrl+K (and ⌘F / Ctrl+F) go back to the full board and focus search; the show/hide hotkey (⌃⌥R / Ctrl+Alt+R) brings the widget up without touching search.
  5. **Out:** the same button (now arrows out, "Back to the full board"): the window goes back to the board's own size and place (maximized if it was), not on top, and scrolls to the column the widget showed.
  6. **Remembered per computer** in the settings file, never synced: `widget` (on or off; Recaller starts as it was), `widgetBounds` (the widget's size and place, saved as it moves) and `widgetProject` (its column). While the widget is on, the board's own `bounds` aren't touched. All three keys are written only once the widget has been used.
  - Code: `setWidget()` / `widgetBounds()` / `applyWidgetWindow()` in `main.js`, IPC `window:widget` (`api.setWidget(on, projectId)`); in `app.js` `ui.widget`, `ui.widgetId`, `widgetProject()`, `paintWidget()`, `setWidget()`, `showInWidget()`, `openWidgetPicker()`, and `render()` drawing only that column; `body.is-widget` CSS in its own block before the macOS block.

## 29. What 1.20 added (twelfth session, 2026-10-23, branch `v1.20`)

The owner's words are in `10`, messages 80 and 81. Both platforms; nothing is fenced by `IS_MAC`.

- **Minimize syncs.** ⋯ › Minimize column sets `project.minimized`, a synced project field, so the other computer shows the strip too (after its next pull). Clicking the strip, or writing into the column (Ctrl+N, Ctrl+M, a global snip), opens it everywhere. Not undoable, like Eating. A column minimized by 1.18–1.19 (`localMinimized`) still shows as a strip on that computer and becomes synced the next time it is minimized; opening it removes both keys.
- **Dragging columns and groups.**
  1. **A column** (press its header and move): drop it anywhere. Over an open group's lane (more than 28 px inside its sides) its dashed slot moves into the lane, among the group's columns; on release it joins that group ("Added to “Lane” · Undo"). Dropped on the board (beside or between groups) it leaves its group ("Taken out of “Lane” · Undo"). Without a group change it is the old reorder ("Reorder projects", no toast). Once inside a lane the slot stays there until the pointer leaves the lane, so the lane growing and shrinking can't make it flicker. Folded groups and minimized columns are passed over like any column. A group whose last column is dragged out disappears.
  2. **A group** (press its band, the name and count, or its folded strip, and move; not its ⋯): a small card with the group's leaves, name and count follows the pointer, and a dashed slot the group's width and height shows where it lands among the board's columns and groups. On release the group's columns keep their order and move together ("Move group", undoable). A plain click on the band still folds or opens the group; the click that ends any column or group drag is ignored for 350 ms (`clickBlockedUntil`), so a release over a band or a minimized strip never folds or opens it.
  3. **⋯ › Move left / Move right** on a group's first or last column reads "Move left, out of “Lane”" (or right) and moves the column out, just beside the group.
  4. While a column or group is dragged, the empty Cooked and Served sections stay as they are (no "Move prompts here" drop zone); that hint shows only for card drags (`body.is-col-drag`).
  5. Not in the widget (it shows one column, and its drags are off as before).
- **The notepad.**
  1. **Open:** the page icon in the top bar (before the Eaten button; also in the widget) or Ctrl+J (⌘J on a Mac). A drawer slides in over the board's right side (420 px, or the window less 44 px; light in both themes, like Eaten, which it replaces if open). The cursor goes to the end of the page.
  2. **Type:** one big text area, 14 px, saved as you go: 500 ms after a pause (`saveNotepadNow()`), and at once on blur, on closing it and when the page unloads (on Windows too). The footer says "Saving…", then "Saved · n words", and "Ctrl J opens and closes it". The first letter typed into an empty notepad creates the hidden project.
  3. **Copy** in the header copies the whole page ("Notepad copied"; "The notepad is empty" when it is).
  4. **Close:** Esc, ×, Ctrl+J again, or the icon.
  5. **Sync:** the page is the first note of a hidden project `{ name: 'Notepad', color: 'slate', notepad: true }`, so it syncs like any note when signed in. While the page has focus, or a save is waiting, a change from the cloud waits (`notepadBusy()` in `syncBusy()`); it lands once you click away, and the page then shows it. Two computers typing at once give a conflict copy, which shows under the page in an amber box ("Changed on two computers at once, so both versions are kept. The other one:") with **Add to the page** (appends it after a blank line, then removes it) and **Delete** (with Undo on its toast). Any other note found in a notepad project (one added on an older Recaller, where the notepad is a column) shows there too, under "Also in the notepad:".
  6. **Undo:** the notepad has the text box's own undo (Ctrl+Z while typing). The board's undo never changes it: `applySnapshot()` keeps the live notepad.
  7. The board never draws it: `boardLayout()` skips it, and every reorder (`setBoardOrder()`), the widget's column and picker, colour picking for a new project, the current column and the empty-board check use `boardProjects()`. Search doesn't look in it.
- **Help** gains a Notepad line, the group drag in "Tidy the board", and Ctrl+J under Shortcuts.

### 1.20.1 (the same session)

- **The top bar** now holds, right of the search box: the **Notepad** pill (icon and word, tinted emerald; filled while open), **+**, undo and redo, the sync cloud (only when sync needs a look) and **☰**.
- **☰** opens a dropdown under it, right-aligned: **Eaten** with its count (shown once a round exists), **Widget: a small window on top** (in the widget: **Back to the full board**), **Reset column widths** (disabled while nothing is resized), a line, **How Recaller works** with F1 (? on a Mac), **Settings** with Ctrl , (⌘, on a Mac). A row does its job and closes the menu; a click elsewhere, Esc or opening another menu closes it too. Shortcuts are unchanged (F1, Ctrl+,, Ctrl+J). The Mac menu bar is unchanged.
- **Pointer:** over the notepad's page (and Eaten's search field) the pointer is Recaller's own dark I-beam with a white edge, because the system's inverting I-beam could vanish there.

### 1.20.2 (the same session)

- **Minimized columns are rows in a stack.** ⋯ › Minimize column turns the column into a 184 × 40 px row in its header colour: leaf, name across (one line, … when long, the full name in the tooltip), the Eating dot and its count (Cooking + Cooked). Minimized columns next to each other (on the board, or inside a group's lane) stack in one slot, 6 px apart; a lone one is a stack of one. A click on a row opens the column; a drag moves it like any column (out of the stack, anywhere on the board or into a group). Synced as before (`minimized`). 1.20.3: a stack is never taller than the board; with more rows than fit (a small window), it scrolls on its own (the wheel over it, or its thin bar).

### 1.20.6 (thirteenth session, 2026-10-24)

- **The Eating switch in Served never covers the word Served.** Both shrink before they touch (Served ends in "…" as a last resort). Below about 262 px of Served width the Served icon goes; below about 226 px the word "Eating" goes and the pill shows only the dot and the time ("● 2h 35m"). Container queries on `.final`.
- **The Eating strip** at the bottom right is dark (deep forest `#0a2219`, an emerald edge) in both themes; its chips (the column names) stay light as before. Its label and count are mint on the dark.
- **A stack of minimized columns** keeps 6 px of air between its scrollbar and its rows.
- **Zoom:** ☰ › **Zoom** with **−**, the percentage (click: back to 100%) and **+**. The row stays open while clicking. Steps 50–200%; `Ctrl +` / `Ctrl −` / `Ctrl 0` (⌘ on a Mac) and Ctrl + the wheel do the same, in the board and the widget. It is Chromium page zoom, so everything scales: columns, text, menus, the strip. Main owns it (`settings.zoom`, `applyZoom()`, `stepZoom()`); the caption buttons (Windows) grow with the top bar (`titleBarOverlay` height 48 × zoom), and on a Mac the traffic lights move down to stay centred and the top bar's left padding is divided by the zoom. The snip overlay (`overlay.html`) stays at 100%: Chromium keys a file page's zoom by its full URL.
