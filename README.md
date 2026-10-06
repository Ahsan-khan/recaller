# Recaller

A desktop board for prompts and notes you want to reuse. Each project is a column with three stages, top to bottom:

1. **Cooking**: new prompts, one card each. Type one with **New prompt** or speak one with **Dictate**.
2. **Cooked**: the prompts you move down, automatically joined into one note.
3. **Served**: the final text. Each time you move the Cooked note down, its text is added to the end of Served.

Click any note, the Cooked note or the Served text to copy it. You can also dictate new prompts with your voice. New to it? Click **?** in the top bar (or press `F1`) for a one-page guide.

Recaller is a Windows app, and there is also a Mac edition of the same version for Apple Silicon Macs: a separate download, like software that comes as one file for Windows and one for Mac. Everything below is written for Windows; see [Recaller on a Mac](#recaller-on-a-mac) for what's different there.

## Install

The easy way, on any Windows PC: open the [latest release](https://github.com/Ahsan-khan/recaller/releases/latest) (the repo is private, so sign in to GitHub first), download `Recaller-Setup-1.17.0.exe` and run it. Nothing else is needed: no Git, Node or build. Then sign in to your account in Settings › Account & sync to bring your notes over.

To build the installer yourself:

```
npm install
npm run dist
```

This builds `dist/Recaller Setup 1.17.0.exe`. It needs `src/cloud/project.json`, which isn't in git: copy it from the computer that has it, or build without accounts with `RECALLER_NO_CLOUD=1`. Run the installer to install Recaller. It adds a desktop and Start menu shortcut. The installer is unsigned, so Windows SmartScreen may warn on first run. Choose **More info → Run anyway**.

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

## Accounts, sync and privacy

New in 1.17.0. An account is optional. Without one, Recaller works exactly as before: nothing is uploaded, and the only network traffic is voice recordings, sent to OpenAI with your own key.

### What an account gives

- Your board is kept in your own Recaller account on Google Cloud, and on every computer where you sign in. A Windows PC and a Mac can share one board.
- A change on one computer reaches the others within about a minute while Recaller is in front, and at once when you bring Recaller up (`Ctrl+Alt+R`, ⌃⌥R on a Mac) or click into it.
- It all happens by itself: your changes upload a few seconds after you make them, and there's nothing to press. **Sync now** in Settings only skips the wait.
- A new or replaced computer gets the whole board back by signing in.
- Each computer still keeps a full copy of the board, so Recaller works offline and never waits for the network. Only a picture added on another computer comes as a preview at first: its full size comes down when you open or copy it.

Everything is in **Settings → Account & sync**, just above **Your data**.

### Create an account and verify your email

1. Click **Create account**, type your email and a password of at least 8 characters, and click **Create account**. **What's stored and where** shows the privacy note (below) before you agree.
2. Recaller sends you an email. Open the link in it, then come back and click **I've verified**. Recaller also checks by itself for 10 minutes, and whenever you come back to it. Nothing is uploaded until your email is verified.
   - The email can take a minute, and the first one may land in Spam (or Junk). If it isn't in your inbox, look there.
   - **Send again** works once a minute. **Use a different email** deletes the account you just made if you do this within a few minutes; otherwise a later clean-up removes it.
3. Once the email is verified, Recaller uploads this PC's board:
   - a board that is still only the Welcome project goes up without a question;
   - a board of your own asks first: **Upload this board?** Click **Upload this board**, or **Not now** to decide later.
4. A big board shows its progress ("Uploading your board… 120 of 340 notes"), then "Your board is in your account now."

If it says "New accounts are paused right now", try again later.

### Sign in on a second computer

1. Click **Sign in** and use the same email and password.
2. What happens next depends on the two boards:
   - **This computer has only the Welcome board, or nothing:** it shows your account's board straight away.
   - **Your account is empty:** **Upload this board?**, as above.
   - **Both have a board:** Recaller asks, under **Your account already has a board**:
     - **Combine both** keeps everything from both. This computer's projects are added after your account's, and nothing is deleted.
     - **Use my account's board** replaces this computer's board with your account's.
     - **Not now** leaves it until you choose.
3. Before it changes anything here, Recaller saves this computer's board as a **Before sync** backup (Settings → Backups).

To bring your PC's notes to your Mac: create the account on the PC and click **Upload this board**, then sign in on the Mac and click **Combine both** (or **Use my account's board** if you don't want the Mac's own notes).

### What syncs and what stays on each computer

| Syncs between your computers | Stays on each computer |
| --- | --- |
| Projects: name, colour and column order | Column widths, folded stages and scroll positions |
| Notes in Cooking, Cooked and Served: text, pictures, order, highlights and copy counts | **Column width** (Compact, Slim, Roomy), **Column title font**, **Cooked colour** and **Colour** (Deep or Soft) |
| **Join notes with** | Unsaved drafts in New prompt |
| | Shortcuts, voice settings and **Minimize Recaller after copying** (**Hide Recaller after copying** on a Mac) |
| | Your OpenAI API key and your local backups, which are never uploaded |

Each computer also uploads its own view, drafts and those settings as a backup. That backup is never copied onto another computer.

### Offline

- Recaller works the same offline. Changes stay on this computer and upload when it's back online. The status line says "Offline · changes upload when you're back online".
- Quitting with changes still waiting gives them a moment to upload, except when the computer is logging out, restarting or shutting down. Anything left goes up the next time Recaller starts.
- A note larger than about 900 KB, or a picture over 32 MB, stays on this computer only. The status line says so.

### When two computers change the same note

- **Both changed its text:** both versions are kept. Your account's version stays in place. This computer's version becomes a copy right after it, highlighted **Check again** and tagged **Other version**, and a toast says so. Keep the one you want and delete the other. Saving the copy from its editor removes the tag.
- **One deleted it and the other edited it:** the edit wins, and the note is kept. A project deleted on the other computer is kept too when it had changes or an unsaved draft here.
- **Moves and highlights:** the computer that syncs last wins.
- **While you work:** changes from the other computer wait while an editor is open, while you drag, and while an Undo toast is showing ("Changes from your Mac will appear when you close the editor."). When they arrive, the Undo history is cleared, so Undo never takes back the other computer's work.
- **Sync now** in Settings looks for changes at once.

### Deleted notes

- A note or project you delete is kept in your account for 30 days, then erased. Recaller has no view of those yet; in the app, Undo and **Settings → Backups** are the ways back. A deleted note's pictures, and a small record that it was deleted (no text), stay in your account until the account is deleted.
- If many notes would disappear without a delete you made (for example, a notes file replaced by hand), Recaller asks first: **Delete n notes everywhere?** **Keep them in my account** brings them back here; **Delete them everywhere** goes ahead.
- **Restoring a backup while signed in** deletes nothing from your account: notes in the backup are added back, and notes that are only in your account stay.

### The cloud icon in the top bar

It stays hidden while all is well. Click it to open Settings at **Account & sync**.

| Icon | Means |
| --- | --- |
| Cloud, slowly fading in and out | A sync is taking more than a moment |
| Cloud with a slash | Offline, with changes waiting or for over a minute |
| Plain cloud | Changes from another computer are waiting for your editor to close |
| Cloud with an amber dot | Something to do: verify your email, choose how to sync this board, sign in again, update Recaller, or the account can't sync |
| Cloud with an alert sign | Sync paused. Click it for the reason; **Retry** is there when it helps |

Settings shows the same as a status line under your email, such as "Synced · 2m ago" or "3 changes waiting to upload". **Also signed in on** lists your other computers.

### Signing out

1. Click **Sign out**. Recaller first tries to upload anything still waiting.
2. It asks "Sign out of you@example.com? Your board stays on this PC unless you remove it." If changes are still waiting, it says how many and that they stay on this PC; **Keep syncing** or **Sign out anyway**.
3. **Also remove this board, its pictures and its backups from this PC** is for a shared computer. It removes your notes, pictures and backups from this PC and leaves the Welcome board; your account keeps everything. Your settings and OpenAI key stay. It works only once everything here is in your account, so with changes waiting it asks you to wait and offers **Sync now**. If this PC also kept copies of a notes file it once couldn't read, Recaller names them first, and you tick the box again to remove them too.
4. Without that box, before it signs out, Recaller saves on this PC the full size of pictures your other computers added. They come to this PC as previews, and their full size comes down only when you open one. While signing out, Recaller fetches the rest for up to 20 seconds ("Saving full-size pictures to this PC… 3 of 12"). If some are left, for example offline, it says so: "Signed out. 4 full-size pictures stay in your account, and this PC keeps their previews. Signing in again brings them here." Until then this PC shows and copies their previews.

Signing in again later with the same account carries on without a question. Notes you deleted while signed out may come back then.

### Changing your password

- **Change password** emails you a link to set a new password. **Forgot password?** on the sign-in form does the same when you can't sign in.
- After a link goes out, **Change password** and **Send link** wait a minute before you can ask for another; the button counts down. Recaller sends at most one link a minute to the same email.
- After the change, each computer says "You're signed out on this PC because your password changed or your sign-in expired." Sign in again there. Your notes stay, and changes made meanwhile upload after you sign in. **Stop syncing** signs out instead.
- After 5 wrong passwords in 10 minutes, sign-in waits 30 seconds.

### Deleting your account

1. Click **Delete account…**, type your password and the word DELETE, then click **Delete account**.
2. First, Recaller saves on this PC the full size of every picture it has only as a preview (pictures your other computers added), so this PC's copy of the board is complete ("Saving full-size pictures to this PC… 3 of 12"). If one can't be saved, nothing is deleted: "Nothing was deleted: not every full-size picture could be saved to this PC first. Check your connection, then try again."
3. Then it deletes your pictures, then your notes, then the account itself from Google Cloud, showing its progress.
4. This PC keeps its own copy of the board. Your other computers keep theirs but stop syncing. They say "This account was deleted. Your notes here are safe." and offer **Use without an account**.
5. If it stops partway (Recaller closed, or the network went away), it shows "Finishing account deletion…" and asks for your password again.
6. Google's backups of the deleted data expire within 7 days.

### Where your sign-in is kept

- **Windows:** encrypted on this PC (Windows DPAPI), in the `sync` folder of `%APPDATA%\Recaller`.
- **On a Mac:** in the same folder, protected by your Mac's keychain. macOS may ask about "Recaller Safe Storage"; choose **Always Allow**.
- If the computer can't store it securely, the sign-in lasts until Recaller closes, and Settings says so.
- Your password goes only to Google's sign-in service, and Recaller never stores it. The `sync` folder isn't part of your backups.

### What's stored and where (the privacy note)

This is the note shown under **What's stored and where** when you create an account (version 2026-10-01):

- **Your account:** your email address and your password, kept by Google Identity Platform (the password only as a secure hash).
- **Your board:** every project and note in Cooking, Cooked and Served, their order, highlights, copy counts and the "Join notes with" setting, and the pictures in your notes. Notes and projects you delete are kept for 30 days so they can be recovered, then erased; only a small record that each was deleted, with no text, stays until the account is deleted. Pictures stay in your account until the account is deleted, even after the note or draft that held them is gone.
- **Each computer's own things,** as a backup that is never copied onto another computer: its name ("Mac" or "Windows PC"), platform, Recaller version and last sync time, its unsaved drafts and their pictures, its view (column widths, folded sections, scroll positions, density, title font, Cooked colour), and these settings: colour theme, voice model, language, vocabulary hint, the two shortcuts, and "hide after copying".
- **Never uploaded:** your OpenAI API key and your local backups. Voice recordings go from your computer straight to OpenAI with your own key.
- **Where:** Google Cloud (Firebase), in the United States (South Carolina). Google encrypts it in transit and at rest, but it is **not end-to-end encrypted**: the person who runs Recaller's Google Cloud project can technically read it, and only looks at it to fix a problem you report.
- Your data isn't sold, shared, or used for ads or AI training.
- **Deleting:** Settings › Account & sync › Delete account removes your account, board and pictures from Google Cloud straight away. Google's backups of the database and of deleted pictures expire within 7 days, and Google finishes erasing sign-in records within 180 days.
- **Contact:** ahsan@ponders.ai

## Recaller on a Mac

The Mac edition is the same Recaller 1.17.0 with Mac keys, the traffic lights and a menu bar. It's for Apple Silicon Macs (M1 or newer) with macOS 13 or later. It's new: the install steps, the permission prompts and the keychain prompt below haven't been confirmed yet.

### Install on a Mac

```
npm install
npm run dist:mac
```

This builds `dist/Recaller-1.17.0-arm64.dmg`. Open it, drag **Recaller** onto **Applications**, then eject the "Recaller 1.17.0" disk (the eject button beside it in Finder's sidebar) and open Recaller from Applications. Don't open Recaller from the disk image's window: that copy runs from the disk image, which then can't be ejected. If you already did, quit it (⌘Q), eject the disk and open Recaller from Applications; your notes are the same either way.

- **A copy built on your own Mac** opens straight away.
- **A downloaded or AirDropped copy** is blocked the first time, because it isn't signed with an Apple Developer ID: macOS says it can't verify the developer. Close that message, open **System Settings › Privacy & Security**, and click **Open Anyway** next to the note about Recaller. You only do this once. (On macOS 15 and later, Control-click › Open no longer gets past this.)
- **Updating:** quit Recaller first (⌘Q; closing its window only hides it), then drag the new Recaller onto Applications and replace the old one. Your notes stay, and the backup before an update is made as on Windows. Because this build isn't signed with a Developer ID, macOS may treat each update as a new app and ask for the microphone, Screen Recording and keychain permissions again.
- **Uninstalling:** quit Recaller and move it from Applications to the Bin. Your notes stay in `~/Library/Application Support/Recaller`, and so does the "Recaller Safe Storage" keychain item if there is one, until you remove them.

### Permissions

- **Microphone:** the first time you dictate, macOS asks whether Recaller may use the microphone. If it's blocked, Recaller says so and offers **Open System Settings**: under **Privacy & Security › Microphone**, turn Recaller on (or off and on again after an update), then try again.
- **Screen Recording:** your first screenshot makes macOS ask for Screen Recording permission, and Recaller shows a message with **Open System Settings**. Under **Privacy & Security › Screen & System Audio Recording**, turn Recaller on (or off and on again after an update), then quit Recaller (⌘Q) and open it again.
- **Keychain:** saving your OpenAI key, or signing in to your Recaller account, may bring up a keychain prompt about "Recaller Safe Storage". Choose **Always Allow**. If you refuse it for the sign-in, the sign-in lasts only until Recaller quits. Because this build isn't signed with a Developer ID, the prompt may come back after an update.

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

Everything lives in `~/Library/Application Support/Recaller` (in Finder, **Go › Go to Folder…**): `recaller-data.json`, `recaller-settings.json`, `images/` and `backups/`, plus `sync/` once you sign in to an account. **Settings → Open data folder** opens it. Backups and **Restore** work as on Windows.

Without an account, the Mac and the PC each keep their own board. The easy way to share one board is an account: see [Accounts, sync and privacy](#accounts-sync-and-privacy). To copy the PC's notes over by hand instead (not tried yet):

1. Open Recaller on the Mac once, so it creates its folder, then quit it with ⌘Q.
2. Copy `recaller-data.json` and the `images` folder from `%APPDATA%\Recaller` on the PC into the Mac's folder, replacing the ones there. This replaces any notes you made on the Mac; they survive only if one of its backups holds them (**Settings → Backups**).
3. Don't copy `recaller-settings.json`. The PC's saved API key is encrypted for Windows and can't be read on a Mac, so enter your key again in Settings.
4. Open Recaller and check that every project and note is there. Keep the PC's copy until you have. After that the two boards don't sync, unless you sign in to the same account on both.

## Development

- **Full handoff** (architecture, data model, every flow, design system, build and release, pitfalls, backlog): see [`ai_memory/`](ai_memory/README.md).
- **Tests:** `npm test` runs the unit tests in `tests/unit/` (plain Node, no windows), then the end-to-end suites in [`tests/e2e/`](tests/e2e/README.md): 12 + 21 + 134 checks on Windows, the same three suites again with accounts on and nobody signed in (`npm run test:accounts-on`, which fails if the app sends any request), and 43 for accounts and sync. On a Mac they keep out of your way (tiny off-screen windows, no Dock icon) and run 12 + 21 + 139 (twice) + 43: the real screenshot's 3 checks are skipped and 8 Mac checks added. The accounts and sync suite talks only to a local mock of Google Cloud and never touches the keychain. The suites use the real clipboard on both.
- **Builds:** `npm run dist` makes the Windows installer on the PC, `npm run dist:win` makes it from a Mac, and `npm run dist:mac` makes the Mac dmg. Each first checks the app's cloud settings (`src/cloud/project.json`, written by `npm run cloud:config`); `RECALLER_NO_CLOUD=1` builds without accounts. `npm run icon` (on the PC) and `npm run icon:mac` (on the Mac) redraw the Windows and Mac icons.
- **Cloud:** the Google Cloud project behind accounts is described in Terraform in [`infra/`](infra/README.md). The design is in [`ai_memory/15_accounts_and_sync.md`](ai_memory/15_accounts_and_sync.md).
- **Mac details:** how the Mac edition differs and how it's built and tested is in [`ai_memory/14_macos.md`](ai_memory/14_macos.md).
- **Branches:** 1.17.0, with accounts, is built for both Windows and Mac from the `masos` branch; `main` and `v1` hold the Windows 1.16.0 until `masos` is merged.
