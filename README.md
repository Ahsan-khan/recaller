# Recaller

A desktop board for prompts and notes you want to reuse. Each project is a column with three stages, top to bottom:

1. **New prompts**, one card each.
2. **Augmented**: the prompts you move down, automatically joined into one note.
3. **Used**: the final text. Each time you move the Augmented note down, its text is added to the end of Used.

Click any note, the Augmented note or the Used text to copy it. You can also dictate new prompts with your voice.

## Install

```
npm install
npm run dist
```

This builds `dist/Recaller Setup 1.5.0.exe`. Run it to install Recaller. It adds a desktop and Start menu shortcut. The installer is unsigned, so Windows SmartScreen may warn on first run. Choose **More info → Run anyway**.

To run from source instead, use `npm start`.

## Updating

Run the new installer over the old one. Everything carries over as-is: projects, notes, Used and Augmented, drafts, images, colours, column width, collapsed sections, scroll position, window size and position, your API key and shortcuts.

- **Data location:** all of it lives in `%APPDATA%\Recaller`, which the installer and uninstaller never touch. The app pins that folder explicitly, so a future version can't look anywhere else.
- **Backup before update:** the first time a new version starts, before it reads anything, it copies your data and settings into `%APPDATA%\Recaller\backups`.
- **Daily backups:** it also keeps a copy per day. **Settings → Backups** lists them, and **Restore** puts one back. What you had just before a restore is backed up first too.
- **No rewrites on startup:** starting up never rewrites your notes file. When Recaller saves, it keeps any fields it doesn't recognize, such as ones written by a newer version, so going back a version is safe too.

## Using it

| Action | How |
| --- | --- |
| Copy a note | Click it. Click an image on the card to copy the image instead |
| Copy several notes at once | Hold `Ctrl` and click each note. The clipboard holds them all, in click order, with a blank line between each. Numbered badges show that order. A note you plain-clicked just before counts as the first one, like in File Explorer. `Ctrl`+click a note again to drop it. `Esc`, clicking empty space, or switching to another app starts a fresh selection. The bar at the bottom can also move the picked notes to Used |
| Delete a note | Hold the mouse on it and swipe left |
| Undo anything | `Ctrl+Z`, the ↶ button in the top bar, or **Undo** on the toast. `Ctrl+Y` redoes |
| Add a prompt to Augmented | Drag it down onto **Augmented**, or hover and click the stack icon. It joins the end of the Augmented note |
| Move the Augmented note into Used | Click **Move to Used**, swipe the note left, or drag it onto **Used**. Its text is added to the end of Used, and Augmented starts empty for the next batch |
| Fix a batch | **Notes** under either combined note lists what's in it, and ↩ sends one back. The pencil edits the Augmented note's text directly |
| Copy a combined text | Click the Augmented note, or click **Copy all** on Used |
| Blank line or new line | **Settings → Join notes with** sets how notes are joined in Augmented, Used and Ctrl+click copies |
| Highlight a note | Hover, click the highlighter and pick a colour: *Check again*, *Important*, *Idea* or *Ready*. Or focus a note and press `H` |
| Move to another project | Drag it onto another column |
| Reorder projects | Drag a column by its title |
| New prompt | Click the **New prompt** bar under the column name, or the mic beside it to dictate |
| Dictate | Click the mic beside **New prompt**. Text appears phrase by phrase as you speak, and you can keep typing and editing while it listens. Click the red **Stop** pill when done |
| Add a screenshot | Click the camera in the editor, then drag over the area you want. Click once to capture the whole screen, or press `Esc` to cancel. You can also paste an image or drop an image file |
| View an image | Hover the thumbnail and click the expand icon |
| Edit | Hover, then click the pencil |
| Rename a project | Double-click its title |
| Scroll sideways | Mouse wheel over a header or empty space, the ‹ › buttons, or drag the empty background |
| Column width | **Settings → Column width**: Compact, Slim or Roomy |
| Colours | **Settings → Colour**: Deep (dark forest canvas, solid headers) or Soft (light) |
| Column title font | **Settings → Column title font**: Sora (default), Space Grotesk, Inter Display, Manrope, Geist or Sora Caps. Each is previewed on a real header and applies instantly |

### Shortcuts

| Keys | Does |
| --- | --- |
| `Ctrl+K` | Search. `Enter` copies the top match |
| `Ctrl+N` | New prompt in the current project |
| `Ctrl+M` | Start or stop dictation |
| `Ctrl+Shift+S` | Add a screenshot to the note you're writing (or start a new one) |
| `Ctrl+Enter` | Save (during dictation, it finishes transcribing first) |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+Shift+N` | New project |
| `Ctrl+Alt+R` | Show or hide Recaller from any app (change it in Settings) |
| `Enter` / `E` / `U` / `H` / `Del` | On a focused card: copy, edit, add to Augmented, highlight, delete |

In Settings you can also set a **Screenshot to note** shortcut that works from any app. It's off by default.

## Voice

Voice uses OpenAI speech-to-text. Add your API key in **Settings** (gear icon). The key is encrypted with Windows DPAPI and never reaches the page itself. If no key is saved, Recaller uses the `OPENAI_API_KEY` environment variable.

Recording splits your speech at natural pauses. Each phrase is sent and streamed back while you keep talking, and silent stretches are never sent. The default model is `gpt-transcribe`. Pick `gpt-4o-mini-transcribe` for the lowest latency and cost. `whisper-1` works too, but it can't stream, so text appears one phrase at a time. The optional **Vocabulary hint** helps with names and jargon.

## Data

Notes are stored in `%APPDATA%\Recaller\recaller-data.json`, and images in `%APPDATA%\Recaller\images\`. Every save writes a temp file and then renames it into place, so a crash can't leave a half-written file. At each launch, Recaller copies the last good file to `recaller-data.json.bak` and removes image files that no note uses any more. **Settings → Open data folder** opens that folder.

## Development

- **Full handoff** (architecture, data model, every flow, design system, build and release, pitfalls, backlog): see [`ai_memory/`](ai_memory/README.md).
- **Tests:** `npm test` runs the end-to-end suites in [`tests/e2e/`](tests/e2e/README.md).
