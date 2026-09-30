# 03: Data model, storage and update safety

The Windows app (1.16.0 on `main` and `v1`) and the Mac edition of 1.16.0 (uncommitted on branch `masos`) read and write exactly the same files. Mac-only behaviour is marked **On a Mac**.

## Where data lives

User data lives in one folder per computer:

- **Windows:** `%APPDATA%\Recaller\` (for example `C:\Users\User\AppData\Roaming\Recaller\`).
- **On a Mac:** `~/Library/Application Support/Recaller/` (for the owner, `/Users/ahsan/Library/Application Support/Recaller/`). It was created late on 2026-09-29 by the owner's first run of the packaged app, and now holds their real Mac notes.

How that folder is chosen and used:

- Both come from the same line in `src/main.js`: `app.setPath('userData', path.join(app.getPath('appData'), 'Recaller'))`. Electron's `appData` is `%APPDATA%` on Windows and `~/Library/Application Support` on a Mac.
- It can be overridden with the `RECALLER_DATA_DIR` env var, which is what the tests use. The value is `path.resolve()`d against Electron's working directory (the repo root under the npm scripts), so give an absolute path.
- Installing and uninstalling never touch it. On Windows, `nsis.deleteAppDataOnUninstall` is `false`. A Mac has no uninstaller: deleting `Recaller.app` leaves the folder in place.
- Settings › Open data folder opens it with `shell.openPath`: in Explorer on Windows, in Finder on a Mac.
- A run from source without `RECALLER_DATA_DIR` uses the real folder and writes to it at startup (see `12`, "Before any change").

Paths below are relative to that folder (Windows shows them with `\`):

| Path | Contents |
| --- | --- |
| `recaller-data.json` | All projects, notes, stages, drafts and UI preferences (written by the renderer via main) |
| `recaller-data.json.bak` | Copy of the last good data file, made on every `data:load`, which is every page load: each start, the reload after a restore (so it then holds the restored file) and a DevTools reload |
| `recaller-data.json.tmp` | Short-lived file used by atomic writes (write the tmp file, then rename it over the real one) |
| `recaller-settings.json` | App settings owned by main: API key, model, hotkeys, theme, window bounds, lastVersion |
| `recaller-settings.json.bak` | Last good settings, copied once per app start (only when the main file was readable) |
| `images/<id>.png` | Full-size image attachments (PNG). `id` is 32 lowercase hex characters |
| `images/<id>.t.png` | Thumbnail, at most 640px wide (PNG). Written for every image; for one 640px wide or less it is the same as the full image |
| `backups/<timestamp>_<kind>/` | Backups (see below) |
| Chromium profile files (`Local State`, caches, …) | Electron's own. On Windows, **`Local State` holds the encryption key** `safeStorage` uses for the API key (DPAPI); if it is lost, the saved key can't be decrypted and the user must paste it again. **On a Mac** that key is kept in the login keychain instead (Electron's macOS backend for `safeStorage`; for the packaged app the item should be "Recaller Safe Storage"), not in `Local State`. Untested: the suites never touch the keychain, and the owner's first run isn't reported yet |

The installed program lives separately: `%LOCALAPPDATA%\Programs\recaller\` on Windows, and `/Applications/Recaller.app` on a Mac, dragged there from the dmg (the owner copied 1.16.0 there late on 2026-09-29).

### Moving notes between the PC and the Mac

Nobody has done this yet; these points come from the code. The step-by-step version is in `14_macos.md`, section 7.

- `recaller-data.json` and `images/` are platform-neutral: images are referenced by id, never by path, and both editions use the same format (`DATA_VERSION` 2). Copy them into the other computer's data folder while Recaller is quit there (on a Mac, quit with ⌘Q: the red button only hides the window, and the running app would save over the copied file).
- Leave `recaller-settings.json` behind:
  - its `{ enc }` API key can't be decrypted on the other computer (DPAPI on the PC, the Keychain on the Mac). Main logs `[settings] could not decrypt API key:` and falls back to `OPENAI_API_KEY`, while Settings still offers Remove (the key source stays `'saved'`). Paste the key again;
  - its `bounds` belong to the other screen; they fall back to 1280×820 when they don't overlap a display;
  - its `hotkey` would carry `'CommandOrControl+Alt+R'`, which a Mac registers as ⌥⌘R instead of its own default ⌃⌥R.
- With the data file in place before the first start, `protectData()` makes an `upgrade` backup of it straight away (there is no `lastVersion` yet), a useful safety copy. The owner's Mac had its first start late on 2026-09-29, so a file copied in now gets only the next daily backup, when one is due.
- Copying replaces the target's own `recaller-data.json`. Since that first run the Mac has a board of its own, so anything made there survives only if one of its `backups/` holds it.
- If the copied data file turns out to be unreadable, the app treats it as a first run and writes the Welcome board over it (invariant 1's known hole). Keep the source copy until the notes show up.

## `recaller-data.json` schema (DATA_VERSION = 2)

Both editions read and write exactly this; the Mac edition added no fields.

```
{
  "version": 2,                       // max(2, whatever the file had); never lowered
  "prefs": {                          // renderer-owned UI preferences
    "density": "slim",                // "compact" | "slim" | "roomy" (unknown values kept, drawn as slim)
    "cookedColor": "ocean",           // 1.13+: "ocean" | "teal" | "midnight" | "graphite" (absent or unknown → ocean).
                                      //   1.12 had caramel/espresso/petrol/graphite/terracotta/slate; old values draw as ocean.
                                      //   Only written when picked in Settings
    "titleFont": "instrument",        // "instrument" | "jakarta" | "onest" | "sora" | "space" | "inter" | "manrope" | "geist" | "caps"
                                      //   (absent → instrument since 1.6; it was sora before, so an absent value now draws differently by design)
    "joiner": "blank",                // "blank" (\n\n) | "line" (\n) — separator for Cooked, Served and Ctrl+click copies
                                      //   (⌘-click on a Mac) (absent → blank)
    "colWidths": { "<project id>": 330 }, // 1.6+: columns the user resized, in px (200–900). Absent → Settings density width.
                                      //   Only written when the user resizes; the top-bar reset deletes the whole key.
    "lastProjectId": "<project id>",  // column last worked in; Ctrl+N / Ctrl+M (⌘N / ⌘M on a Mac) target it.
                                      //   Saved through the 400ms persistSoon(), like draft typing
    "scroll": { "board": 240, "cols": { "<project id>": 120 } }  // only saved when the USER scrolls
  },
  "projects": [ Project, ... ],       // array order = column order on the board
  ...any unknown top-level keys are preserved
}
```

### Project

```
{
  "id": "uuid",
  "name": "Wildfire RL",
  "color": "monstera",        // palette id, see below. Unknown ids are KEPT and drawn with the first palette colour
  "notesCollapsed": true,     // optional (1.8): Cooking folded away. Only present while folded
  "usedCollapsed": false,     // Cooked section collapsed (data name "used"; see the naming trap below)
  "augCollapsed": false,      // Served section collapsed
  "usedExpanded": true,       // optional, NOT READ since 1.7 (was: Combined note shows all lines). Kept as-is in the file
  "augExpanded": true,        // optional, NOT READ since 1.7 (was: Final text shows all lines). Kept as-is in the file
  "draft": "",                // unsaved text in the New prompt editor
  "draftImages": [Image],     // unsaved images in the New prompt editor
  "createdAt": 1758690000000,
  "notes":    [Note, ...],    // stage 1: NEW PROMPTS (cards). Since 1.7 new ones are appended at the end (bottom);
                              //   before 1.7 they went to index 0, so older columns may be newest-first
  "used":     [Note, ...],    // stage 2: shown as "COOKED" — displayed as ONE combined note; appended in order added
  "combined": [Note, ...],    // stage 3: shown as "SERVED" — the final text; Cooked notes are appended at the end
  ...unknown keys preserved
}
```

### Note

```
{
  "id": "uuid",
  "text": "exact prompt text (trimmed at save)",
  "images": [Image, ...],     // attachments, shown as thumbnails on the card
  "createdAt": ms, "updatedAt": ms,
  "copied": 3,                // times copied (click, Ctrl+click or ⌘-click on a Mac, search-Enter, keyboard)
  "lastCopiedAt": ms,
  "usedAt": ms,               // when it entered Cooked or Served (0 for notes that never did)
  "highlight": "amber",       // optional: "amber" (Check again) | "rose" (Important) | "sky" (Idea) | "lime" (Ready)
  "expanded": true,           // optional: card shows all lines instead of the clamp
  ...unknown keys preserved
}
```

### Image

```
{ "id": "<32 hex>", "w": 1920, "h": 1080, ...unknown keys preserved }
```

It is displayed via `recaller-img://img/<id>.t.png` (thumbnail) and `recaller-img://img/<id>.png` (full size).

`w` and `h` are the stored PNG's size in physical pixels, not CSS pixels. A snip on the owner's 2× Retina Mac is twice the size of the same area on the PC's 100% screen; a whole-screen snip there is 3024×1964.

### Project colour palette

The stored id is on the left. For historical reasons the ids don't match the display names. New projects take the first unused colour, in the order below.

| Stored id | Name | Hex |
| --- | --- | --- |
| monstera | Emerald | #0e9f6e |
| moss | Sky | #0284c7 |
| sun | Sun | #d97706 |
| orchid | Orchid | #9333ea |
| fern | Lime | #65a30d |
| clay | Blossom | #db2777 |
| eucalyptus | Teal | #0d9488 |
| sage | Bark | #78716c |
| indigo | Indigo | #4f46e5 |
| ember | Ember | #ea580c |
| lagoon | Lagoon | #0891b2 |
| ruby | Ruby | #dc2626 |
| forest | Forest | #15803d |
| fuchsia | Fuchsia | #c026d3 |
| slate | Slate | #475569 |
| mustard | Mustard | #a16207 |
| navy | Navy | #1e3a8a |
| wine | Wine | #9f1239 |

The last ten were added in 1.6. An older version shows them as Emerald (first palette colour) but keeps the stored id.

## The stage naming trap

The on-screen names changed three times; the data field names never did, so existing files load unchanged:

| Data field | 1.0–1.3 UI | 1.4–1.5 UI | 1.6–1.7 UI | 1.8+ UI | DOM / CSS classes |
| --- | --- | --- | --- | --- | --- |
| `notes` | prompts | prompts | prompts | **Cooking** | `.cook-head`, `.active-list`, `.card*` |
| `used` | Used (cards) | Augmented | Combined | **Cooked** | `.used`, `.used-head`, `.used-count`, and `.aug-*` for the note (`.aug-note`, `.aug-text`, `.aug-move`, `.aug-parts`) |
| `combined` | (none) | Used | Final | **Served** | `.final*` (`.final-text`, `.final-body`, `.final-parts`, `.final-edit`) |

- **Read the code this way:** `notes` = Cooking, `used` = Cooked, `combined` = Served. The internal JS/CSS names still follow older screen names (`aug*`, `final*`, `augmentedText()`, `finalText()`, `copyFinal()`). They're internal and harmless; the data field names must never change.
- **Flags:** `notesCollapsed` (1.8, only present while folded) belongs to Cooking. `usedCollapsed` and `usedExpanded` belong to Cooked; `augCollapsed` and `augExpanded` belong to Served. They followed screen *position*, not name.
- In `app.js`, `STAGE_NAME = { notes: 'Cooking', used: 'Cooked', combined: 'Served' }` gives the screen name for a data list.
- The menu's **Clear Cooked** empties `used`, and **Clear Served** empties `combined` (fixed in 1.6; before that "Clear used" emptied the wrong stage).

## `recaller-settings.json` schema (owned by main)

| Key | Default | Meaning |
| --- | --- | --- |
| `model` | `"gpt-transcribe"` | Transcription model. The UI offers gpt-transcribe, gpt-4o-mini-transcribe, gpt-4o-transcribe and whisper-1; any other string is kept and shown. An empty value resets to the default |
| `language` | `""` | Optional language hint such as `en` |
| `hint` | `""` | Optional vocabulary hint sent as part of the prompt |
| `hotkey` | `"CommandOrControl+Alt+R"` on Windows; `"Control+Alt+R"` **on a Mac** | Global show/hide shortcut (`""` = off). Both defaults are the same physical keys: on a Mac `CommandOrControl` means ⌘, so the Mac default names Control outright (⌃⌥R) |
| `shotHotkey` | `""` | Global "screenshot to note" shortcut (off by default) |
| `hideAfterCopy` | `false` | Minimise Recaller 260ms after copying. **On a Mac** it hides the app instead (`app.hide()`, focus returns to the previous app), and Settings labels it "Hide Recaller after copying" |
| `theme` | `"deep"` | `"deep"` or `"soft"`. Main also uses it for the window background, and on Windows for the title-bar colours |
| `apiKey` | `null` | `{ "enc": base64 }` (encrypted with `safeStorage`: DPAPI on Windows, the Keychain on a Mac) or `{ "plain": "sk-…" }` if encryption is unavailable. The key used is, in order: a decryptable `enc`, then `plain`, then the `OPENAI_API_KEY` env var. An `enc` from the other computer can't be decrypted |
| `bounds` | `null` | `{ x, y, width, height }` of the window (not maximised; **on a Mac** never a full-screen frame). Ignored unless it overlaps a display's work area by 80px across and 40px down |
| `maximized` | `false` | Whether the window was maximised |
| `lastVersion` | written at runtime | App version that last ran; a change triggers the pre-update backup |

- Unknown keys are preserved. The whole object (defaults included) is rewritten on the first run of each version, so a default added later never changes a value a user already has. On a Mac that first write stores `"Control+Alt+R"`; a file copied from the PC keeps its own `hotkey`.
- The file is also rewritten on every settings change, 400ms after every move or resize of the window, and on close.
- Every backup folder holds a copy of this file, API key blob included (see Backups).

## Backups (`src/backups.js`)

- **Folder name:** `<ISO time with ":" and "." replaced by "-">_<kind>`, for example `2026-09-24T03-28-52-000Z_upgrade`.
- **Contents:**
  - copies of `recaller-data.json` and `recaller-settings.json`. The settings copy holds the API key blob: `{ enc }`, or plain text if it was saved as `{ plain }`. Never print or share a backup's settings file;
  - `backup.json`: `{ kind, createdAt, appVersion, fromVersion?, toVersion?, restoredFrom?, projects, notes, unreadable? }`. `notes` counts all three stages. `unreadable: true` (with `projects` and `notes` 0) means the copied data file couldn't be parsed when the backup was made.
- **Listing:** `backups:list` returns each folder's `backup.json` plus its `id`, newest first. A folder without a readable `backup.json` is skipped, never deleted.
- **Kinds and how many are kept (oldest pruned):**
  - `upgrade`: made before a new version first runs (only when a data file exists); 30 kept.
  - `daily`: made at startup if the last one is more than 24h old; 10 kept. **On a Mac** the same check also runs every hour while the app is running (window shown or hidden), after flushing pending data, because a Mac app runs for days without restarting.
  - `manual`: Settings → Back up now (flushes first); 20 kept.
  - `before-restore`: made automatically before a restore; 10 kept.
- **Image cleanup** runs on every page load (`gcImages`). It deletes image files (`.png` and `.t.png`) older than 1 hour that neither the data nor any backup references, so restoring a backup never shows broken images. Images referenced only by backups that have since been pruned become collectable.
- **Restore** (Settings → Backups → Restore) replaces the data file only; settings are not restored. What the user had just before is saved as a `before-restore` backup first. The steps, and a known hole, are in `02` (`restoreBackup`).

## Persistence mechanics

- **Every change** sends the whole data object from the renderer to main right away (`persist()`). Two things wait instead: draft typing and `prefs.lastProjectId` go through `persistSoon()`, a 400ms debounce that restarts on every call, so it fires only after a pause in typing.
- **Writing:** main's `scheduleDataWrite` is a trailing 250ms debounce (every save restarts it), then `flushData` writes atomically (`store.writeJsonAtomic`: `JSON.stringify(value, null, 2)` to `.tmp`, then rename). The rename is retried up to 4 more times on EPERM, EBUSY and EACCES, which Windows antivirus can cause, with synchronous waits of 25, 50, 75 and 100ms that block main. The retries are harmless on a Mac.
- **Final flushes (main):**
  - Windows: window `close`, `before-quit`, `window-all-closed` and `session-end` (shutdown or sign-out).
  - **On a Mac:** window `close` (the red button and ⌘W then only hide the window), `before-quit`, the window's `closed` event and `will-quit`. The last two exist because ⌘Q never reaches `window-all-closed` and the page's last save arrives after `close`. The hourly backup timer flushes too.
  - `data:load` also flushes first, so a reload never reads a stale file.
- **The page's last save:** on `beforeunload` the page saves scroll positions if the user scrolled (`saveScrollNow()`, which sends the whole data object).
  - **On a Mac** it also sends the save waiting in `persistSoon()`, so the last keystrokes of a draft and a just-changed `lastProjectId` survive ⌘Q. The features suite checks this with a page reload; nobody has pressed a real ⌘Q.
  - On Windows nothing flushes that timer. Draft text typed since the last pause of 400ms or more, and a just-changed `lastProjectId`, can be lost when the window closes, unless another save (such as the scroll save) carries them.
- **Reading:** falls back to `.bak` if the main file is unreadable. A read or parse error, or a falsy JSON value such as `null`, counts as unreadable.
- **Scroll positions** are saved only when the user caused the scroll: a wheel, pointerdown or keydown in the last 1.5 seconds. They are saved 700ms after scrolling stops, and on `beforeunload`. If a smaller window forces the browser to clamp a restored scroll position, that clamped value must never overwrite the saved one.

## Update-safety invariants (never break these)

1. **No rewrite on startup.** An up-to-date data file stays byte-for-byte identical when a new version starts. `init()` writes at once only when `!raw || !(Number(raw.version) >= DATA_VERSION)`: no file, neither the file nor its `.bak` readable, a failed `loadData` call, or a version that is missing or below 2. "Byte for byte" also depends on `writeJsonAtomic`'s exact `JSON.stringify(value, null, 2)` format; changing the serialiser would rewrite every file on its next save.
   - **Known hole:** an unreadable data file (with no readable `.bak`) is handled like a first run. The Welcome seed is written over it about 250ms later, and the same start's image cleanup, which now sees only the seed, deletes image files older than 1 hour that no backup references. The good copies are then only in `backups/` (Settings → Backups), so point any recovery there. A file that parses but has no `projects` array also gets the seed: it is written at once if its version is missing or below 2, otherwise by the first change. Don't widen this path.
2. **Loading keeps what it doesn't understand, and repairs only malformed data.** `normalize()` spreads the original objects (`...raw`, `...p`, `...n`, and each image), so unknown fields survive. User choices as the UI writes them are never rewritten: any string `color` (unknown ids too), any string `density`, `titleFont`, `joiner`, `cookedColor` and `colWidths` (never touched), boolean collapsed flags and `notesCollapsed`. Their fallbacks happen only when drawing (e.g. an old `cookedColor: "caramel"` draws as ocean but stays in the file). What `normalize()` does change:
   - **Drops:** notes (in `notes`, `used` and `combined`) whose `text` isn't a string; projects that aren't objects; image entries (note `images` and `draftImages`) whose id fails `/^[a-f0-9]{32}$/`.
   - **Replaces:** missing, non-string or duplicate ids get new ones (ids must be unique across all projects and notes).
   - **Fills in or coerces:**
     - `name` becomes "Untitled" when blank or not a string;
     - `color` becomes `monstera` when empty or not a string;
     - `prefs.density` becomes `slim` when absent or not a string;
     - `draft` becomes `''` when not a string;
     - `images`, `draftImages`, `notes`, `used` and `combined` become `[]` when missing or not arrays;
     - `createdAt` becomes now, and `copied`, `lastCopiedAt` and `usedAt` become 0, whenever the value isn't a finite number (numeric strings are replaced too); `updatedAt` falls back to `createdAt`, then now;
     - image `w` / `h` become `Number()` or 0;
     - `usedCollapsed` and `augCollapsed` go through `Boolean()` (added as `false` when absent);
     - `version` becomes max(2, the file's).
   - **Gives up:** data that isn't an object with a `projects` array returns `null`, and the Welcome seed is shown (see invariant 1).

   An up-to-date file isn't rewritten at startup, so these repairs reach disk with the next save; the originals survive in `.bak` until the next page load, and in `backups/`. Filling in is also how files from older versions gain newer fields (see 3). The UI writes every field and never writes malformed values, so dropping and replacing only touch broken or hand-edited files. But a future format that broke these rules (a non-string `text`, a new image-id format) would lose items when someone goes back to 1.16.
3. **The only allowed additions** when saving after an edit are new fields for new features. For example, 1.4 adds `combined: []` to each project on the first save. Never remove, rename or reinterpret existing fields.
4. **Downgrades are safe:** older versions (1.3.0 and later) also preserve unknown fields.
5. **The data folder path, `productName` and `appId` never change.** The Mac edition keeps all three: the folder name `Recaller`, `productName` "Recaller" and `appId` `com.akhan.recaller`.
6. **Settings defaults** only apply to keys the file doesn't have yet. The Mac's own `hotkey` default follows the same rule.
7. **A new version backs up first** (`protectData()` runs before the window opens).
8. **Undo is not persisted.** The history lives in memory and is lost on restart; this is by design.

## Version history of the data format

- **1.0.0 wrote `version: 1`**: projects with `notes` and `used`, and notes without `images`.
- **1.1.0 moved to `version: 2`**, adding `images`, `draftImages` and `prefs.density`. A v1 file was rewritten once on load. 1.1.0 also recoloured v1 projects to the new palette; that recolour step was **removed in 1.3.0** because the owner wants updates to change nothing.
- **1.2.0 added** `augCollapsed` and the theme setting (in settings).
- **1.3.0 added** backups, `lastVersion`, `prefs.scroll`, `prefs.lastProjectId`, `note.expanded`, `project.augExpanded` and `prefs.titleFont`.
- **1.4.0 added** `project.combined`, `note.highlight` and the stage swap (labels only; data unchanged).
- **1.5.0 added** `prefs.joiner` and `project.usedExpanded`. Augmented changed from a list of cards to one combined note (display only; the data is still a list of notes in `used`).
- **1.6.0 added** `prefs.colWidths` (only when the user resizes a column), ten palette ids and three title-font ids. The default title font (when `prefs.titleFont` is absent) became `instrument`. Stage labels changed (Augmented → Combined, Used → Final); data unchanged. `DATA_VERSION` is still 2.
- **1.7.0** added no fields. New prompts are appended to `notes` instead of prepended. `usedExpanded` / `augExpanded` are no longer read (the stage texts always start at their fixed size); they're left in the file untouched.
- **1.8.0** added `project.notesCollapsed` (only while Cooking is folded). The stage labels changed again: prompts → Cooking, Combined → Cooked, Final → Served; data unchanged.
- **1.9.0–1.11.0** added no fields (look and interaction only).
- **1.12.0** added `prefs.cookedColor` (only when picked).
- **1.13.0** changed the allowed `cookedColor` values to ocean/teal/midnight/graphite. Stored 1.12 values are not rewritten; they draw as ocean.
- **1.14.0–1.16.0** added no fields (1.16 only changed the board arrows). 1.14 shows the images already stored on `used` / `combined` notes; 1.15 deletes notes from those lists (the same splice as deleting a card).
- **The 1.16.0 Mac edition** (branch `masos`, uncommitted, 2026-09-29) added no data fields and doesn't change the format. Its only settings difference is the default `hotkey` (`"Control+Alt+R"` on a Mac). It adds flushes (`closed`, `will-quit`, the page's `beforeunload` draft save) and the hourly daily-backup check, all on a Mac only.

`DATA_VERSION` has been 2 since 1.1.0. Every change since then was additive or display-only, so no migration code exists beyond the one-time v1 → v2 rewrite.
