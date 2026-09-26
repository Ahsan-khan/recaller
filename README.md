# Recaller

A desktop board for prompts and notes you want to reuse. Each project is a column with three stages, top to bottom:

1. **Cooking**: new prompts, one card each. Type one with **New prompt** or speak one with **Dictate**.
2. **Cooked**: the prompts you move down, automatically joined into one note.
3. **Served**: the final text. Each time you move the Cooked note down, its text is added to the end of Served.

Click any note, the Cooked note or the Served text to copy it. You can also dictate new prompts with your voice. New to it? Click **?** in the top bar (or press `F1`) for a one-page guide.

## Install

```
npm install
npm run dist
```

This builds `dist/Recaller Setup 1.16.0.exe`. Run it to install Recaller. It adds a desktop and Start menu shortcut. The installer is unsigned, so Windows SmartScreen may warn on first run. Choose **More info → Run anyway**.

To run from source instead, use `npm start`.

## Updating

Run the new installer over the old one. Everything carries over as-is: projects, notes, Cooked and Served, drafts, images, colours, column widths, collapsed sections, scroll position, window size and position, your API key and shortcuts.

- **Data location:** all of it lives in `%APPDATA%\Recaller`, which the installer and uninstaller never touch. The app pins that folder explicitly, so a future version can't look anywhere else.
- **Backup before update:** the first time a new version starts, before it reads anything, it copies your data and settings into `%APPDATA%\Recaller\backups`.
- **Daily backups:** it also keeps a copy per day. **Settings → Backups** lists them, and **Restore** puts one back. What you had just before a restore is backed up first too.
- **No rewrites on startup:** starting up never rewrites your notes file. When Recaller saves, it keeps any fields it doesn't recognize, such as ones written by a newer version, so going back a version is safe too.

## Using it

| Action | How |
| --- | --- |
| Copy a note | Click it. Click an image on the card to copy the image instead |
| Copy several notes at once | Hold `Ctrl` and click each note. The clipboard holds them all, in click order, with a blank line between each. Numbered badges show that order. A note you plain-clicked just before counts as the first one, like in File Explorer. `Ctrl`+click a note again to drop it. `Esc`, clicking empty space, or switching to another app starts a fresh selection. The bar at the bottom can also move the picked notes to Cooked |
| Delete a note | Hold the mouse on it and swipe left |
| Delete from Cooked or Served | Click **Notes** under the text, hover a note and click its trash to delete just that one. To delete the whole Cooked note (or Served text), right-click it and click the trash in the editor. Both are undoable |
| Undo anything | `Ctrl+Z`, the ↶ button in the top bar, or **Undo** on the toast. `Ctrl+Y` redoes |
| Add a prompt to Cooked | Hover it and click **↓ Cooked** (or press `U`), or drag it down onto **Cooked**. It joins the end of the Cooked note |
| Move the Cooked note into Served | Click **Move to Served**, swipe the note left, or drag it onto **Served**. Its text is added to the end of Served, and Cooked starts empty for the next batch |
| Edit Cooked or Served | The pencil in the footer edits the whole text (it's then saved as one note). **Notes** lists the separate notes inside: hover one to move it up ↑ or down ↓, edit just that one ✎, send it back ↩, or delete it with the trash |
| Read a long Cooked or Served text | Both start at a fixed height (6 lines). **Show more** under the text opens it up, and a very long text scrolls inside. They always start small again next time |
| Copy a combined text | Click the Cooked note or the Served text |
| Copy a screenshot from Cooked or Served | Screenshots follow their prompt down and show as small pictures under the text. Click one to copy it. The text and the pictures are copied separately (paste the text, then click the picture and paste again), because Claude, ChatGPT and most chat boxes keep only the picture when you paste both at once |
| Empty a stage | Project menu **⋯ → Clear Cooked** or **Clear Served** (undoable) |
| Blank line or new line | **Settings → Join notes with** sets how notes are joined in Cooked, Served and Ctrl+click copies |
| Highlight a note | Hover, click the highlighter and pick a colour: *Check again*, *Important*, *Idea* or *Ready*. Or focus a note and press `H` |
| Move to another project | Drag it onto another column |
| Reorder projects | Drag a column by its title |
| New prompt | Click **New prompt** under the column name to type one, or **Dictate** (the other half of the bar) to speak one. New prompts are added at the bottom of **Cooking**, just above Cooked. Saving closes the editor and the buttons come back |
| Fold a stage away | Click its name: **Cooking**, **Cooked** or **Served** |
| Put older prompts in date order | **⋯ → Sort prompts oldest first** (prompts saved before 1.7 were newest-first). Undoable |
| Dictate | Click the mic beside **New prompt**. Text appears phrase by phrase as you speak, and you can keep typing and editing while it listens. Click the red **Stop** pill when done |
| Add a screenshot | Click the camera in the editor, then drag over the area you want. Click once to capture the whole screen, or press `Esc` to cancel. You can also paste an image or drop an image file |
| View an image | Hover the thumbnail and click the expand icon |
| Edit | Right-click a prompt, the Cooked note or the Served text (or focus a prompt and press `E`). Right-click a row under **Notes** to edit just that part |
| Rename a project | Double-click its title |
| Scroll sideways | Mouse wheel over a header or empty space, drag the empty background, or move the pointer to the left or right edge of the board and click the ‹ › button that appears there (hold it to glide) |
| Resize a column | Drag its right edge. Double-click the edge (or **⋯ → Reset width**) for the default width again |
| Reset all column widths | The ↔ button in the top bar puts every column back to the default width. **Undo** on the toast brings your widths back |
| Default column width | **Settings → Column width**: Compact, Slim or Roomy |
| Column colour | **⋯** menu: 18 colours |
| Colours | **Settings → Colour**: Deep (dark forest canvas, solid headers) or Soft (light) |
| Cooked colour | **Settings → Cooked colour**: Ocean (default), Teal, Midnight or Graphite |
| Column title font | **Settings → Column title font**: Instrument Sans (default), Plus Jakarta Sans, Onest, Sora, Space Grotesk, Inter Display, Manrope, Geist or Sora Caps. Each is previewed on a real header and applies instantly |

### Shortcuts

| Keys | Does |
| --- | --- |
| `Ctrl+K` | Search. Matches are marked in cards and in the Cooked and Served texts. `Enter` copies the top matching card |
| `Ctrl+N` | New prompt in the current project |
| `Ctrl+M` | Start or stop dictation |
| `Ctrl+Shift+S` | Add a screenshot to the note you're writing (or start a new one) |
| `Ctrl+Enter` | Save (during dictation, it finishes transcribing first) |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+Shift+N` | New project (or the **+ New project** tile at the end of the board) |
| `Ctrl+Alt+R` | Show or hide Recaller from any app (change it in Settings) |
| `F1` or `?` | How Recaller works: stages, handy moves and shortcuts |
| `Enter` / `E` / `U` / `H` / `Del` | On a focused card: copy, edit, add to Cooked, highlight, delete |

In Settings you can also set a **Screenshot to note** shortcut that works from any app. It's off by default.

## Voice

Voice uses OpenAI speech-to-text. Add your API key in **Settings** (gear icon). The key is encrypted with Windows DPAPI and never reaches the page itself. If no key is saved, Recaller uses the `OPENAI_API_KEY` environment variable.

Recording splits your speech at natural pauses. Each phrase is sent and streamed back while you keep talking, and silent stretches are never sent. The default model is `gpt-transcribe`. Pick `gpt-4o-mini-transcribe` for the lowest latency and cost. `whisper-1` works too, but it can't stream, so text appears one phrase at a time. The optional **Vocabulary hint** helps with names and jargon.

## Data

Notes are stored in `%APPDATA%\Recaller\recaller-data.json`, and images in `%APPDATA%\Recaller\images\`. Every save writes a temp file and then renames it into place, so a crash can't leave a half-written file. At each launch, Recaller copies the last good file to `recaller-data.json.bak` and removes image files that no note uses any more. **Settings → Open data folder** opens that folder.

## Development

- **Full handoff** (architecture, data model, every flow, design system, build and release, pitfalls, backlog): see [`ai_memory/`](ai_memory/README.md).
- **Tests:** `npm test` runs the end-to-end suites in [`tests/e2e/`](tests/e2e/README.md).
