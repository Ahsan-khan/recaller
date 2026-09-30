# Recaller

A desktop board for prompts and notes you want to reuse. Each project is a column with three stages, top to bottom:

1. **Cooking**: new prompts, one card each. Type one with **New prompt** or speak one with **Dictate**.
2. **Cooked**: the prompts you move down, automatically joined into one note.
3. **Served**: the final text. Each time you move the Cooked note down, its text is added to the end of Served.

Click any note, the Cooked note or the Served text to copy it. You can also dictate new prompts with your voice. New to it? Click **?** in the top bar (or press `F1`) for a one-page guide.

Recaller is a Windows app, and there is also a Mac edition of the same version for Apple Silicon Macs: a separate download, like software that comes as one file for Windows and one for Mac. Everything below is written for Windows; see [Recaller on a Mac](#recaller-on-a-mac) for what's different there.

## Install

```
npm install
npm run dist
```

This builds `dist/Recaller Setup 1.16.0.exe`. Run it to install Recaller. It adds a desktop and Start menu shortcut. The installer is unsigned, so Windows SmartScreen may warn on first run. Choose **More info → Run anyway**.

To run from source instead, use `npm start`.

On a Mac, build the Windows installer with `npm run dist:win` instead: it builds for x64, while plain `npm run dist` on an Apple Silicon Mac would make an arm64 Windows app. (`dist:win` hasn't been tried yet.)

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
| `Ctrl+,` | Settings |
| `Ctrl+Alt+R` | Show or hide Recaller from any app (change it in Settings) |
| `F1` or `?` | How Recaller works: stages, handy moves and shortcuts |
| `Enter` / `E` / `U` / `H` / `Del` | On a focused card: copy, edit, add to Cooked, highlight, delete |

In Settings you can also set a **Screenshot to note** shortcut that works from any app. It's off by default.

## Voice

Voice uses OpenAI speech-to-text. Add your API key in **Settings** (gear icon). The key is encrypted with Windows DPAPI (on a Mac, with a key kept in your keychain) and never reaches the page itself. If no key is saved, Recaller uses the `OPENAI_API_KEY` environment variable.

Recording splits your speech at natural pauses. Each phrase is sent and streamed back while you keep talking, and silent stretches are never sent. The default model is `gpt-transcribe`. Pick `gpt-4o-mini-transcribe` for the lowest latency and cost. `whisper-1` works too, but it can't stream, so text appears one phrase at a time. The optional **Vocabulary hint** helps with names and jargon.

## Data

Notes are stored in `%APPDATA%\Recaller\recaller-data.json`, and images in `%APPDATA%\Recaller\images\`. Every save writes a temp file and then renames it into place, so a crash can't leave a half-written file. At each launch, Recaller copies the last good file to `recaller-data.json.bak` and removes image files that no note uses any more. **Settings → Open data folder** opens that folder. On a Mac the same files live in `~/Library/Application Support/Recaller`.

## Recaller on a Mac

The Mac edition is the same Recaller 1.16.0 with Mac keys, the traffic lights and a menu bar. It's for Apple Silicon Macs (M1 or newer) with macOS 13 or later. It's new: the install steps, the permission prompts and the keychain prompt below haven't been confirmed yet.

### Install on a Mac

```
npm install
npm run dist:mac
```

This builds `dist/Recaller-1.16.0-arm64.dmg`. Open it, drag **Recaller** onto **Applications**, then eject the "Recaller 1.16.0" disk (the eject button beside it in Finder's sidebar) and open Recaller from Applications. Don't open Recaller from the disk image's window: that copy runs from the disk image, which then can't be ejected. If you already did, quit it (⌘Q), eject the disk and open Recaller from Applications; your notes are the same either way.

- **A copy built on your own Mac** opens straight away.
- **A downloaded or AirDropped copy** is blocked the first time, because it isn't signed with an Apple Developer ID: macOS says it can't verify the developer. Close that message, open **System Settings › Privacy & Security**, and click **Open Anyway** next to the note about Recaller. You only do this once. (On macOS 15 and later, Control-click › Open no longer gets past this.)
- **Updating:** quit Recaller first (⌘Q; closing its window only hides it), then drag the new Recaller onto Applications and replace the old one. Your notes stay, and the backup before an update is made as on Windows. Because this build isn't signed with a Developer ID, macOS may treat each update as a new app and ask for the microphone, Screen Recording and keychain permissions again.
- **Uninstalling:** quit Recaller and move it from Applications to the Bin. Your notes stay in `~/Library/Application Support/Recaller`, and so does the "Recaller Safe Storage" keychain item if there is one, until you remove them.

### Permissions

- **Microphone:** the first time you dictate, macOS asks whether Recaller may use the microphone. If it's blocked, Recaller says so and offers **Open System Settings**: under **Privacy & Security › Microphone**, turn Recaller on (or off and on again after an update), then try again.
- **Screen Recording:** your first screenshot makes macOS ask for Screen Recording permission, and Recaller shows a message with **Open System Settings**. Under **Privacy & Security › Screen & System Audio Recording**, turn Recaller on (or off and on again after an update), then quit Recaller (⌘Q) and open it again.
- **Keychain:** saving your OpenAI key may bring up a keychain prompt about "Recaller Safe Storage". Choose **Always Allow**.

### Keys and clicks

⌘ does what Ctrl does on Windows, and the tooltips and the help panel show the Mac keys. Control-click is a right-click, as everywhere on a Mac, so it edits. The Control keys (⌃A, ⌃E, ⌃K and the rest) keep their usual text-editing jobs in text fields.

| Keys | Does |
| --- | --- |
| Click | Copy a note |
| ⌘-click | Copy several notes at once, in click order (Ctrl+click on Windows) |
| Right-click or Control-click | Edit a prompt, the Cooked note or the Served text |
| `⌘K` | Search. `↩` copies the top matching card |
| `⌘N` | New prompt in the current project |
| `⌘M` | Start or stop dictation |
| `⇧⌘S` | Add a screenshot to the note you're writing (or start a new one) |
| `⌘↩` | Save (during dictation, it finishes transcribing first) |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⇧⌘N` | New project |
| `⌘,` | Settings |
| `⌃⌥R` | Show or hide Recaller from any app. That's Control+Option+R, the same keys as Ctrl+Alt+R on a PC (change it in Settings) |
| `?` | How Recaller works |
| `↩` / `E` / `U` / `H` / `⌫` | On a focused card: copy, edit, add to Cooked, highlight, delete. `⌘⌫` deletes too |
| `⌘H` / `⌘W` / `⌘Q` | Hide Recaller / close its window (Recaller keeps running) / quit |

### Window and menus

- The traffic lights sit at the top left of the top bar, with the Recaller logo just after them.
- Closing the window (the red button or ⌘W) only hides it. Recaller keeps running so that ⌃⌥R works from any app; ⌃⌥R or a click on its Dock icon brings the window back. ⌘Q quits.
- When Recaller is in front, ⌃⌥R hides it and the app you were using gets the focus back, so a paste lands there. **Settings → Hide Recaller after copying** does the same after each copy.
- A click on a card while another app is in front copies it straight away; you don't have to click Recaller first.
- The menu bar has **Recaller** (About, Settings… ⌘,, Services, Hide ⌘H, Hide Others, Show All, Quit ⌘Q), **Edit** (Undo, Redo, Cut, Copy, Paste, Paste and Match Style, Select All), **Window** (Minimize, Zoom, Close Window, Bring All to Front) and **Help** (How Recaller Works). Window › Minimize has no ⌘M, because ⌘M is Dictate. Edit › Undo undoes your typing while you're in a text field, and the last board change otherwise.
- Full screen (the green button) works, and the top bar then uses the space the traffic lights leave. Closing the window or starting a screenshot leaves full screen first.

### Your data on a Mac

Everything lives in `~/Library/Application Support/Recaller` (in Finder, **Go › Go to Folder…**): `recaller-data.json`, `recaller-settings.json`, `images/` and `backups/`. **Settings → Open data folder** opens it. Backups and **Restore** work as on Windows.

The Mac and the PC each keep their own board. To bring the PC's notes over (not tried yet):

1. Open Recaller on the Mac once, so it creates its folder, then quit it with ⌘Q.
2. Copy `recaller-data.json` and the `images` folder from `%APPDATA%\Recaller` on the PC into the Mac's folder, replacing the ones there. This replaces any notes you made on the Mac; they survive only if one of its backups holds them (**Settings → Backups**).
3. Don't copy `recaller-settings.json`. The PC's saved API key is encrypted for Windows and can't be read on a Mac, so enter your key again in Settings.
4. Open Recaller and check that every project and note is there. Keep the PC's copy until you have. After that the two boards don't sync.

## Development

- **Full handoff** (architecture, data model, every flow, design system, build and release, pitfalls, backlog): see [`ai_memory/`](ai_memory/README.md).
- **Tests:** `npm test` runs the end-to-end suites in [`tests/e2e/`](tests/e2e/README.md): 12 + 21 + 134 checks on Windows. On a Mac they keep out of your way (tiny off-screen windows, no Dock icon) and run 12 + 21 + 139: the real screenshot's 3 checks are skipped and 8 Mac checks added. They use the real clipboard on both.
- **Builds:** `npm run dist` makes the Windows installer on the PC, `npm run dist:win` makes it from a Mac, and `npm run dist:mac` makes the Mac dmg. `npm run icon` (on the PC) and `npm run icon:mac` (on the Mac) redraw the Windows and Mac icons.
- **Mac details:** how the Mac edition differs and how it's built and tested is in [`ai_memory/14_macos.md`](ai_memory/14_macos.md).
- **Branches:** the Mac edition lives on the `masos` branch; `main` and `v1` hold the Windows 1.16.0.
