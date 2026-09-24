# 03: Data model, storage and update safety

## Where data lives

User data lives in `%APPDATA%\Recaller\` (for example `C:\Users\User\AppData\Roaming\Recaller\`).

- This folder is pinned in `src/main.js` with `app.setPath('userData', path.join(app.getPath('appData'), 'Recaller'))`.
- It can be overridden with the `RECALLER_DATA_DIR` env var, which is what the tests use.
- The installer and uninstaller never touch it: `nsis.deleteAppDataOnUninstall` is `false`.

| Path | Contents |
| --- | --- |
| `recaller-data.json` | All projects, notes, stages, drafts and UI preferences (written by the renderer via main) |
| `recaller-data.json.bak` | Copy of the last good data file, made at every session start |
| `recaller-data.json.tmp` | Short-lived file used by atomic writes (write the tmp file, then rename it over the real one) |
| `recaller-settings.json` | App settings owned by main: API key, model, hotkeys, theme, window bounds, lastVersion |
| `recaller-settings.json.bak` | Last good settings, made at session start |
| `images\<id>.png` | Full-size image attachments (PNG). `id` is 32 lowercase hex characters |
| `images\<id>.t.png` | Thumbnail, at most 640px wide (PNG) |
| `backups\<timestamp>_<kind>\` | Backups (see below) |
| Chromium profile files (`Local State`, caches, …) | Electron's own. **`Local State` holds the encryption key** `safeStorage` uses for the API key; if it is lost, the saved key can't be decrypted and the user must paste it again |

The installed program lives separately in `%LOCALAPPDATA%\Programs\recaller\`.

## `recaller-data.json` schema (DATA_VERSION = 2)

```
{
  "version": 2,                       // max(2, whatever the file had); never lowered
  "prefs": {                          // renderer-owned UI preferences
    "density": "slim",                // "compact" | "slim" | "roomy" (unknown values kept, drawn as slim)
    "titleFont": "sora",              // "sora" | "space" | "inter" | "manrope" | "geist" | "caps" (absent → sora)
    "joiner": "blank",                // "blank" (\n\n) | "line" (\n) — separator for Augmented, Used and Ctrl+click copies (absent → blank)
    "lastProjectId": "<project id>",  // column last worked in; Ctrl+N / Ctrl+M target it
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
  "usedCollapsed": false,     // Augmented section collapsed (data name "used"; see the naming trap below)
  "augCollapsed": false,      // Used (final) section collapsed
  "usedExpanded": true,       // optional: Augmented note shows all lines (absent = clamped to 8 lines)
  "augExpanded": true,        // optional: Used text shows all lines
  "draft": "",                // unsaved text in the New prompt editor
  "draftImages": [Image],     // unsaved images in the New prompt editor
  "createdAt": 1758690000000,
  "notes":    [Note, ...],    // stage 1: NEW PROMPTS (cards). New ones are added at the top (index 0)
  "used":     [Note, ...],    // stage 2: shown as "AUGMENTED" — displayed as ONE combined note; appended in order added
  "combined": [Note, ...],    // stage 3: shown as "USED" — the final text; Augmented notes are appended at the end
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
  "copied": 3,                // times copied (click, Ctrl+click, search-Enter, keyboard)
  "lastCopiedAt": ms,
  "usedAt": ms,               // when it entered Augmented or Used
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

## The stage naming trap

In round 7, the owner asked to swap what the Used and Augmented sections mean. The data field names were deliberately kept so existing files load unchanged:

- **Data `used`** is the UI stage **"Augmented"**: the middle, indigo section, displayed as one combined note. The CSS and DOM classes also still say `used` (`.used`, `.used-head`, `.used-count`). The Augmented note's own parts use `.aug-*` classes (`.aug-note`, `.aug-text`, `.aug-move`, …).
- **Data `combined`** is the UI stage **"Used"**: the bottom, deep-green final text, with DOM classes `.final*`.
- **Flags:** `usedCollapsed` and `usedExpanded` belong to Augmented; `augCollapsed` and `augExpanded` belong to Used (final). They followed screen *position*, not name.
- **Known bug from this:** the project menu item "Clear used (N)" empties **Augmented** (data `used`). There is no way to clear the final Used text. See `09`, issue #1.

## `recaller-settings.json` schema (owned by main)

| Key | Default | Meaning |
| --- | --- | --- |
| `model` | `"gpt-transcribe"` | Transcription model. The UI offers gpt-transcribe, gpt-4o-mini-transcribe, gpt-4o-transcribe and whisper-1; any other string is kept and shown |
| `language` | `""` | Optional language hint such as `en` |
| `hint` | `""` | Optional vocabulary hint sent as part of the prompt |
| `hotkey` | `"CommandOrControl+Alt+R"` | Global show/hide shortcut (`""` = off) |
| `shotHotkey` | `""` | Global "screenshot to note" shortcut (off by default) |
| `hideAfterCopy` | `false` | Minimise Recaller 260ms after copying |
| `theme` | `"deep"` | `"deep"` or `"soft"`. Main also uses it for the Windows title-bar colours |
| `apiKey` | `null` | `{ "enc": base64 }` (DPAPI via safeStorage) or `{ "plain": "sk-…" }` if encryption is unavailable. If null, the `OPENAI_API_KEY` env var is used |
| `bounds` | `null` | `{ x, y, width, height }` of the window (not maximised), ignored if off-screen |
| `maximized` | `false` | Whether the window was maximised |
| `lastVersion` | written at runtime | App version that last ran; a change triggers the pre-update backup |

Unknown keys are preserved. The whole object (defaults included) is rewritten on the first run of each version, so a default added later never changes a value a user already has.

## Backups (`src/backups.js`)

- **Folder name:** `<ISO time with ":" and "." replaced by "-">_<kind>`, for example `2026-09-24T03-28-52-000Z_upgrade`.
- **Contents:** copies of `recaller-data.json` and `recaller-settings.json`, plus `backup.json`: `{ kind, createdAt, appVersion, fromVersion?, toVersion?, restoredFrom?, projects, notes }`. `notes` counts all three stages.
- **Kinds and how many are kept (oldest pruned):**
  - `upgrade`: made before a new version first runs; 30 kept.
  - `daily`: made at startup if the last one is more than 24h old; 10 kept.
  - `manual`: Settings → Back up now; 20 kept.
  - `before-restore`: made automatically before a restore; 10 kept.
- **Image cleanup** treats images referenced by any backup as in use, so restoring a backup never shows broken images.
- **Restore** (Settings → Backups → Restore) replaces the data file only; settings are not restored. What the user had just before is saved as a `before-restore` backup first.

## Persistence mechanics

- **Every change** sends the whole data object from the renderer to main right away (`persist()`). Typing in a draft is debounced by 400ms.
- **Writing:** main writes at most every 250ms, atomically (`store.writeJsonAtomic`: write `.tmp`, then rename). The rename is retried on EPERM, EBUSY and EACCES, which Windows antivirus can cause.
- **Final flushes:** on window close, `before-quit`, `window-all-closed` and Windows `session-end`. `data:load` also flushes first, so a reload never reads a stale file.
- **Reading:** falls back to `.bak` if the main file is unreadable.
- **Scroll positions** are saved only when the user caused the scroll: a wheel, pointerdown or keydown in the last 1.5 seconds. They are saved 700ms after scrolling stops, and on `beforeunload`. If a smaller window forces the browser to clamp a restored scroll position, that clamped value must never overwrite the saved one.

## Update-safety invariants (never break these)

1. **No rewrite on startup.** An up-to-date data file stays byte-for-byte identical when a new version starts. `init()` writes only when there was no file, or the file's version is below `DATA_VERSION`.
2. **Loading is lossless.** `normalize()` fixes only broken values (bad ids, non-string text, invalid image ids). It spreads the original object (`...n`, `...p`, `...raw`), so unknown fields survive. User choices (`color`, `density`, `titleFont`, `joiner`) are never rewritten; fallbacks happen only when drawing.
3. **The only allowed additions** when saving after an edit are new fields for new features. For example, 1.4 adds `combined: []` to each project on the first save. Never remove, rename or reinterpret existing fields.
4. **Downgrades are safe:** older versions (1.3.0 and later) also preserve unknown fields.
5. **The data folder path, `productName` and `appId` never change.**
6. **Settings defaults** only apply to keys the file doesn't have yet.
7. **A new version backs up first** (`protectData()` runs before the window opens).
8. **Undo is not persisted.** The history lives in memory and is lost on restart; this is by design.

## Version history of the data format

- **1.0.0 wrote `version: 1`**: projects with `notes` and `used`, and notes without `images`.
- **1.1.0 moved to `version: 2`**, adding `images`, `draftImages` and `prefs.density`. A v1 file was rewritten once on load. 1.1.0 also recoloured v1 projects to the new palette; that recolour step was **removed in 1.3.0** because the owner wants updates to change nothing.
- **1.2.0 added** `augCollapsed` and the theme setting (in settings).
- **1.3.0 added** backups, `lastVersion`, `prefs.scroll`, `prefs.lastProjectId`, `note.expanded`, `project.augExpanded` and `prefs.titleFont`.
- **1.4.0 added** `project.combined`, `note.highlight` and the stage swap (labels only; data unchanged).
- **1.5.0 added** `prefs.joiner` and `project.usedExpanded`. Augmented changed from a list of cards to one combined note (display only; the data is still a list of notes in `used`).
