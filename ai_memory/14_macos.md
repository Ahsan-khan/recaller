# 14: The macOS edition

This file is the guide for anyone continuing Recaller on the Mac:
- what the Mac edition is;
- everything that differs from the Windows app, and how each difference works in the code;
- building and installing the dmg;
- testing on a Mac without disturbing the owner;
- what this work taught, moving notes between the two computers, and what is still open.

The rest of this folder describes the shared app. Read this file before changing anything for the Mac. Related: `08` ("1.16.0 for Mac"), `11` (why each Mac choice was made) and `09` (the open list).

**Status (seventh session, 2026-09-29):** the Mac edition of 1.16.0 is built and verified. The owner **committed and pushed** it on branch `masos` as "mac build" (`16961eb` + `9536853`). A follow-up commit, "fix" (`f86cf19`, also pushed), took Finder's `.DS_Store` back out of git (see "Files" below). It is not merged into `main`. The session itself never opened the packaged app.

**1.17.0 (eighth session, 2026-10-01):** accounts and sync are built and tested on `masos` (released on 2026-10-06 and merged into `main`; the Google Cloud side is live since 2026-10-01). They are the same on both platforms; what differs on a Mac (the keychain item for the sign-in, log out and shut down, the labels) is in section 9.

**Late update:** at about 20:43 on 2026-09-29, while this handoff was being written, the owner copied Recaller.app (1.16.0) into `/Applications` (20:43:22) and then opened the copy on the mounted dmg (20:43:25), not the one in Applications. That first run created `~/Library/Application Support/Recaller`, which now holds their real Mac notes. At the end of the session, that dmg copy was still the running Recaller. Nothing about how it went is recorded. So where this file says something is untested or not tried by a person, read "not verified by a session and not reported by the owner yet", and ask them.

**1.20 (twelfth session, 2026-10-23, built on the PC):** no Mac-only behaviour. The notepad's key is ⌘J (through `modKey`/`kb()`, with `data-mac` labels in Help and the drawer), and the new drags are the same on both platforms. Features should count 185 on a Mac (171 + 14), 189 with 1.20.1's ☰ menu, 192 with 1.20.2's stacked minimized columns, 194 with 1.20.3: confirmed on this Mac on 2026-10-24, from source and against the packaged 1.20.3 dmg's `app.asar` (`08`, 1.20.3), after the fake-mic hang in `07` #105. 1.20.4 counts 195 on this Mac (from source, 2026-10-24; `dist/Recaller-1.20.4-arm64.dmg`). The menu's key caps use `data-mac` (⌘, and ?); the Mac menu bar is unchanged.

**1.19 (eleventh session, 2026-10-21):** 1.19.0 added one Mac-only behaviour, a column drag that zoomed the board out into 52 px strips; the owner disliked it and 1.19.1 removed it, so there is no new Mac-only behaviour. The Eating strip redesign and the widget are the same on both platforms; on a Mac the widget leaves full screen first and isn't full-screenable while on, and the widget's picker sits after the traffic lights (84 px). Features counts 171 on this Mac (163 + 8).

**1.18.0 (tenth session, 2026-10-20):** Eating, the Claude Code format, Clear, minimized columns, groups and the top-bar + are the same on both platforms; nothing new is fenced. The + has a Mac tooltip (⇧⌘N). It was built and tested on a freshly set-up Mac (`/Users/ahsankhan`, macOS 26.6, Node 26 from Homebrew), where the features suite counts 163 (139 + 24). One Mac-only addition: a watchdog in `createWindow()` reloads a page that hasn't called `data:load` 12 s after loading began, at most twice, after the first start of the installed 1.18.0 stayed empty green (`07` #101).

## 1. What it is: one codebase, two downloads

### The request and the owner's answers

- The owner, seventh session: "i want to create a similar mac os app. i want to keep the windows app as it is, but create another mac os app. it should be similar to how software is available online with two different files for windows and mac"
- They answered three questions:
  - Reuse the discarded 1.17.0 attempt? **"Start from scratch"**.
  - Who downloads the Mac version? **"Just me for now"**. So it is an Apple Silicon dmg with an ad-hoc signature (no Developer ID), which they approve once in System Settings. Proper signing comes later.
  - Run the Mac-safe test suites on this Mac? **"Yes, run them"**.

### What was built

- **The Mac edition of 1.16.0.** It is the same app as the Windows 1.16.0: same look, same data format, same version. Only the keys and habits are Mac ones. The version was not bumped, so the two downloads match:
  - Windows: `Recaller Setup 1.16.0.exe`, built on the PC in the fifth session and not rebuilt;
  - Mac: `Recaller-1.16.0-arm64.dmg`, built on the Mac in this session, in `dist/`.
- **Branch `masos`.** "masos" is the owner's spelling; keep it.
  - The owner created it from `main` (`dd5a3b0`) on 2026-09-29 and published it (`origin/masos`).
  - The owner committed and pushed all the Mac work there late on 2026-09-29 (see "Files" below). The owner commits and pushes themselves.
  - `main` and `v1` hold the Windows 1.16.0 and were not touched.
- **One codebase.** masos reuses the Windows code and can still build the identical Windows installer.

### The fence rule (keep it)

Every Mac difference is gated, so the Windows app behaves exactly as before: the same strings, handlers and timing, and the same files written.

| Layer | The gate |
| --- | --- |
| Main process | `const IS_MAC = process.platform === 'darwin';` in `src/main.js` and `src/screenshot.js` |
| Renderer | `const IS_MAC = api.platform === 'darwin';` in `src/renderer/app.js`, and `const MAC = window.recaller?.platform === 'darwin';` in `voice.js`. The preload has exposed `platform` since 1.5.0 |
| CSS | `body.is-mac …` rules, all in one block at the end of `styles.css`. `app.js` adds the class only on a Mac |
| HTML | `data-mac="…"` replaces an element's text on a Mac, and `data-mac-title="…"` replaces its `title`. Only Mac-gated code reads them |
| Build | the `mac` and `dmg` sections of `package.json`, and the new scripts `dist:mac`, `dist:win` and `icon:mac` |
| Tests | `tests/e2e/mac-harness.js`, whose helpers do nothing on Windows |

- **Helpers** may exist on both platforms, but they change behaviour only when `IS_MAC` is true. For example, `kb('Ctrl+Z')` returns `'Ctrl+Z'` on Windows.
- **The two new preload functions,** `openPrivacy` and `onCommand`, exist on Windows too, but nothing calls them there.
- **Older darwin branches:** a few 1.16 lines already tested `process.platform === 'darwin'`. They were left alone:
  - `titleBarOverlay: true`;
  - `applyTheme()` skipping `setTitleBarOverlay`;
  - the menu branch;
  - `window-all-closed` not quitting.
- **Never changed:** the data format and field names, the data-folder pin, `productName`, `appId`, the NSIS config, `build/icon.png`, and the `dist` and `pack` scripts.
- **How Windows sameness was checked:**
  - A review checked that every change is gated or does nothing on Windows.
  - A pure-Node simulation mocked the `electron` module with the platform set to `win32`. It drove the 1.16 and the Mac-edition `main.js`, `preload.js` and `screenshot.js` through the same steps: startup, hotkeys, minimise, DevTools keys, the global snip, flushes, activate and quit.
  - The two logs were identical apart from stack-trace paths. The simulation ran before the reviewer fixes (listed in `10`, message 40), all of which are behind `IS_MAC`.
  - The suites have not yet been run on the PC with the masos code (section 8).

### Files

- **Changed:**
  - `package.json` and `scripts/make-icon.js`;
  - `src/main.js`, `src/preload.js` and `src/screenshot.js`;
  - `src/renderer/app.js`, `index.html`, `styles.css` and `voice.js`;
  - the four suites (`features.e2e.js`, `update-safety.e2e.js`, `multi-copy.e2e.js`, `capture-board.js`) and `tests/e2e/README.md`;
  - the docs: the root `README.md` and every file in `ai_memory/`.
- **New:** `build/icon-mac.png`, `tests/e2e/mac-harness.js` and this file, `ai_memory/14_macos.md`. All three went into the first "mac build" commit with the rest, and they belong with it:
  - the changed suites `require('./mac-harness')` and won't start without it, on Windows too;
  - `dist:mac` needs the icon;
  - the rest of `ai_memory` points here.
- **Committed and pushed:** at 21:45 on 2026-09-29 the owner committed the Mac edition on `masos` as two commits, both called "mac build":
  - `16961eb` (21:45:34): the snapshot they had staged at about 21:13. It also included Finder's `.DS_Store` by accident.
  - `9536853` (21:45:53): the fixes made after that staging: the docs, plus the stricter capture check in `scripts/make-icon.js` (section 4, "The icon") and a comment in `mac-harness.js`.
  - Both were pushed. A read-only check (`git ls-remote origin`) found GitHub's `masos` at `9536853`, with `main` (`dd5a3b0`) and `v1` (`664212a`) unchanged, and the working tree matched the pushed commit exactly.
  - The pushed app code is byte-identical to the tested dmg: all 33 files under `src/` match its `app.asar`, and `build/icon-mac.png` is the same file. The only `package.json` differences are the `scripts`, `build` and `devDependencies` fields, which electron-builder strips from the packaged copy.
  - `masos` was merged into `main` on 2026-10-06 (PR #2, `9d30f1f`), with 1.17.0, at the owner's request.
- **`.DS_Store` cleanup:** at the owner's "fix it", after they asked whether their pushes looked good:
  - `git rm --cached .DS_Store` took Finder's file out of git. It stays on disk.
  - `.DS_Store` was added as a new last line of `.gitignore`, so git and GitHub Desktop no longer offer it.
  - The owner committed both as "fix" (`f86cf19`, 21:51:53) and pushed it straight away, so `masos` = `origin/masos` = `f86cf19`.
  - The doc updates that record all this came after "fix" and aren't in it. The owner commits and pushes them.

### How it came about

- **The sixth session** (2026-09-28/29, on this Mac) built a 1.17.0 Mac attempt. The owner had asked "okay make it so i can install on macos as well" and "i want to be able to install on both btw". It was never installed.
- **On 2026-09-29 the owner discarded it,** with everything since the 1.16 push ("i made some changes to my project that i dont want to keep anymore", "since my last push"). No reason was given.
  - It is kept as `stash@{0}`: "On v1: Discarded changes since 1.16 push (1.17.0 macOS work) — 2026-09-29".
  - Its builds were moved to `dist/_discarded-1.17.0/` in this session.
- **The owner then** merged `v1` into `main` (PR #1), pulled `main` and created `masos`.
- **This session** built the Mac edition from scratch, as asked. The build never read, applied or popped the stash. (Only the read-only audit at the start of the session inspected it; the sixth session's history in `01` and `10` comes from its notes.)
  - Leave the stash alone unless the owner asks.
  - Never hand out, install or test the discarded builds.

### Rules for new Mac work

1. Gate it, and leave every Windows line behaving as it did. Don't refactor, reformat or "tidy" shared code.
2. **Key labels:** in `app.js`, wrap the Windows label in `kb()`; in `index.html`, add `data-mac` or `data-mac-title`.
3. **Modifier checks:** use `modKey(e)` for shortcuts and `multiKey(e)` for multi-select.
4. **Tests:** add a check inside the `if (IS_MAC)` block of `features.e2e.js`. The Windows count stays 134.
5. **Before finishing:** run `node --check` on every edited file, run the Mac-safe suites (section 5), and update this file.

## 2. Everything that differs on a Mac

### Keys

| Action | Windows | Mac |
| --- | --- | --- |
| Search | Ctrl+K or Ctrl+F | ⌘K or ⌘F |
| New prompt | Ctrl+N | ⌘N |
| New project | Ctrl+Shift+N | ⇧⌘N |
| Dictate (in an editor: start or stop) | Ctrl+M | ⌘M |
| Screenshot into a prompt | Ctrl+Shift+S | ⇧⌘S |
| Save in an editor | Ctrl+Enter | ⌘↩ |
| Undo / redo (not while typing) | Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z | ⌘Z / ⇧⌘Z or ⌘Y. Edit › Undo and Redo do the same, and in a text field they undo the typing |
| Settings | Ctrl+, | ⌘, or Recaller › Settings… |
| Help | F1, or ? when not typing | ? when not typing (F1 still works with fn), or Help › How Recaller Works |
| Copy several cards | Ctrl+click | ⌘-click |
| Edit a card, the Cooked note, the Served text or a Notes row | right-click | right-click or Control+click |
| Delete a focused card | Delete or Backspace | ⌫, fn+⌫ or ⌘⌫ |
| Show or hide Recaller from any app (default) | Ctrl+Alt+R (minimises when in front) | ⌃⌥R (hides the app when in front) |
| Hide / quit | minimise / close the window | ⌘H or ⌘W / ⌘Q |
| DevTools (run from source only) | F12, Ctrl+Shift+I | F12, ⌃⇧I, ⌘⌥I |

- **⌘ runs the app's shortcuts, and ⌃ doesn't.** ⌃K, ⌃F, ⌃N and ⌃M stay the Mac's text-editing keys inside fields; ⌃K, for example, deletes to the end of the line.
- **A focused card leaves ⌘, ⌃ and ⌥ keys to the menus.** So ⌘H hides the app instead of highlighting. Only ⌘⌫ acts: it deletes the card, as in the Finder. Plain keys work as on Windows:
  - Enter or Space copies;
  - E or F2 edits;
  - U adds to Cooked;
  - H highlights;
  - ⌫ deletes;
  - ↑ and ↓ move between cards.
- **The shortcut fields in Settings** behave the Mac way:
  - They record ⌃ as `Control` and ⌘ as `Command` (Windows: `CommandOrControl` and `Super`).
  - They name punctuation from the physical key, because Option changes the typed character.
  - They show a hotkey as symbols in Apple's order ⌃⌥⇧⌘, with no separators: `⌃⌥R`. Windows shows `Ctrl + Alt + R`.
  - Without a modifier they say "Use at least one of ⌃, ⌥, ⇧ or ⌘" (Windows: "Use at least one of Ctrl, Alt or Shift").

### Labels

On a Mac every key name the app shows uses Mac symbols:
- **Board:** the search box keycap reads `⌘K`, and the selection bar hint "⌘-click to add or remove".
- **Help:**
  - "Copy several at once: hold ⌘";
  - "⌘Z undoes anything";
  - the Shortcuts list (⌘K, ⌘N, ⌘M, ⌘↩, ⇧⌘S, ⌘Z / ⇧⌘Z, ⇧⌘N, ⌘, and the show/hide hotkey), with ? for the help itself instead of F1.
- **Tooltips:**
  - top bar: Settings (⌘,), How Recaller works (?), and Undo … (⌘Z) / Redo … (⇧⌘Z);
  - columns: New prompt and Resume draft (⌘N), and Dictate a new prompt (⌘M);
  - the composer (the inline editor): Add a screenshot (⇧⌘S), Save (⌘↩), and Dictate / Stop dictating (⌘M).
- **Settings:**
  - "(Cooked, Served and ⌘-click copies)" next to "Join notes with";
  - "Hide Recaller after copying", for the switch Windows calls "Minimize Recaller after copying";
  - the API key line: "Saved in your Mac’s keychain. Paste a new key to replace it." (Windows: "Saved and encrypted on this PC. …").
- **The Welcome board** made on a first run uses ⌘V, ⌘Z, "Hold ⌘" and the Mac shortcut tip. The board is data, so a Welcome board made on the PC keeps its Ctrl wording.

### Mouse

- **⌘-click** picks several cards (Ctrl+click on Windows).
- **Control+click** is a right-click on a Mac, so it edits, like a right-click. It never copies, selects, drags or pans.
- **Right-click on text:** a Mac selects the word under the pointer before the context-menu event fires.
  - Recaller reads the selection as the button goes down, so the editor still opens, and the word the Mac selected is cleared.
  - If text was already selected before the press, the usual Copy menu shows, as on Windows.
- **First click (`acceptFirstMouse`):** a click on a card while another app is in front both brings Recaller forward and copies the card. The snip overlay takes the first drag the same way.

### Window, traffic lights and top bar

- **Traffic lights:** the native buttons sit at (16, 16). They span x 16 to 70 and centre on y 24 of the 48 px top bar.
- **Top-bar padding:** the left padding is 84 px on a Mac (70 + 14; Windows 14 px), so the logo starts at x 84, 14 px after the lights.
- **Measured in this session's test run:**
  - `getWindowButtonPosition()` is `{x: 16, y: 16}`;
  - the logo is at x 84, with its centre at y 24;
  - `env(titlebar-area-x)` is 92px. Only the top bar's right-padding formula reads it (it gives 12 px); the left padding is a fixed 84 px.
- **No title-bar overlay:** there are no Windows caption buttons and no coloured overlay. On a Mac, `applyTheme()` recolours only the window background.
- **Fonts:**
  - UI text: Geist first, as on Windows, then the Apple system font (`-apple-system, BlinkMacSystemFont, system-ui`) where Windows falls back to Segoe UI;
  - mono: Geist Mono, then `ui-monospace, "SF Mono", Menlo`;
  - keycaps (`kbd`): the system font with 0.04em letter-spacing, because the bundled fonts have no ⌘ ⇧ ⌥ ⌃ ↩ glyphs.
- **Nothing else in the look changes.** A Retina review is still open (section 8).

### Closing, quitting and hiding

- **The red button, ⌘W or Window › Close Window** hides the window. Recaller keeps running: its Dock icon, menu bar and global hotkey stay. On Windows, closing quits.
- **⌘Q, Recaller › Quit or the Dock's Quit** quits, after saving everything.
- **Clicking the Dock icon** brings the hidden window back.
- **⌃⌥R**, the default show/hide hotkey, uses the same physical keys as Ctrl+Alt+R on the PC.
  - From any app, it brings Recaller to the front with search focused.
  - Pressed while Recaller is in front, it hides the app (`app.hide()`). macOS returns focus to the app you were in, so ⌘V pastes there. Windows minimises instead.
  - ⌥⌘R wasn't used because it is VS Code's Reveal in Finder.
  - The default applies only while the settings file has no `hotkey`. A key set in Settings wins.
- **⌘H** hides Recaller and **⌥⌘H** hides the other apps (standard menu roles).
- **Hide after copying** (the `hideAfterCopy` setting): after a copy by click or Enter, Recaller hides the app instead of minimising, so focus goes straight back to the previous app. A ⌘-click selection never hides, as Ctrl+click never minimises on Windows.

### The menu bar

Windows has no menu. On a Mac, Recaller has four menus:
- **Recaller:**
  - About Recaller (the panel shows "Recaller", the version and "Your prompts and notes, one click away.");
  - Settings… (⌘,);
  - Services;
  - Hide Recaller (⌘H), Hide Others (⌥⌘H) and Show All;
  - Quit Recaller (⌘Q).
- **Edit:** Undo (⌘Z) and Redo (⇧⌘Z), then Cut, Copy, Paste, Paste and Match Style, and Select All. Undo and Redo go to the page:
  - in a text field, they undo the typing;
  - elsewhere, they use the board's history;
  - with Settings, Help or the picture viewer open, they do nothing;
  - while the window is hidden or minimised, they do nothing, so the board never changes out of sight.
- **Window:**
  - Minimize, with no ⌘M, because ⌘M is Dictate;
  - Zoom;
  - Close Window (⌘W), which hides;
  - Bring All to Front.
- **Help:** How Recaller Works. It has no key, because the page already answers ?.
- **The first menu's name:** run from source, or in the test harness, it reads "Electron". The packaged app's bundle name is Recaller.

### Full screen

- Full screen hides the traffic lights, so the top bar's left padding drops to 14 px (`body.is-fullscreen`).
- **Closing in full screen** (red button or ⌘W) first leaves full screen, then hides. Hiding a full-screen window would leave an empty black Space behind.
- **A snip started in full screen** first leaves full screen, waiting up to 2 s, so it doesn't capture that black Space. Afterwards the window comes back as a normal window, not in full screen.
- A full-screen frame is never saved as the window's size.

### Permissions

**Microphone:**
- The app's `Info.plist` carries `NSMicrophoneUsageDescription`: "Recaller listens only while you dictate a prompt, and sends the recording to OpenAI to turn it into text." macOS ends an app that opens the microphone without one.
- The first dictation brings macOS's own prompt.
- If access is blocked, the composer shows "Microphone blocked. In System Settings › Privacy & Security › Microphone, turn Recaller on (or off and on again after an update), then try again." Its **Open System Settings** button opens that pane.
- Windows shows "Microphone blocked. Allow it in Windows Settings › Privacy & security › Microphone.", with no button.

**Screen Recording:**
- Before every snip, Recaller checks the permission. Without it, nothing is hidden or captured. Instead:
  - Recaller makes one tiny capture request. That lists Recaller under Screen & System Audio Recording, and the first time it brings macOS's own prompt.
  - Recaller shows "Recaller needs permission to record the screen. In System Settings › Privacy & Security › Screen & System Audio Recording, turn Recaller on (or off and on again after an update), then quit and reopen Recaller."
- Where the message appears:
  - from the composer's camera or ⇧⌘S: as an error with an **Open System Settings** button;
  - from the global screenshot hotkey: Recaller comes up with a toast that holds the same text and an **Open Settings** action, for 12 s.
- After turning it on, quit (⌘Q) and reopen Recaller, as the message says.
- An empty capture reads "Screenshot failed: macOS returned an empty screen capture." (Windows names Windows.)

### The API key and the keychain

- **Where it lives:** on a Mac, `safeStorage` keeps its encryption key in the login keychain, as the "Recaller Safe Storage" item. The encrypted API key itself is still stored in `recaller-settings.json` as `{ enc }`, as on Windows. On Windows the protecting key lives in Chromium's `Local State` file, under DPAPI.
- **Prompts:** saving the key may bring a keychain prompt; choose Always Allow. Each build has a new ad-hoc signature, so the prompt can come back after an update.
- **When it can't be decrypted** (on another computer, or after the keychain item is removed): `getApiKey()` falls back to `OPENAI_API_KEY` or to nothing, and the key must be pasted again.
- **Since 1.17** the same item also seals the account's sign-in (section 9).

### The data folder and the installed app

- **Data:** `~/Library/Application Support/Recaller/`. This is the same `path.join(app.getPath('appData'), 'Recaller')` pin that gives `%APPDATA%\Recaller` on Windows.
  - It holds the same kinds of files: `recaller-data.json`, `recaller-settings.json`, their `.bak` copies, `images/`, `backups/`, and Chromium's own files.
  - The owner's first run created it late on 2026-09-29, and it now holds their real notes.
  - **That first run made no backup.** It started with no data file, and `backups.create()` returns null without `recaller-data.json`, so `protectData()` made no `upgrade` or daily backup. It still stamped `lastVersion` 1.16.0, so the next start makes no `upgrade` backup either.
    - A `.bak` copy is made only when an existing file is read: the settings one at the next start, the data one at the next start or page reload.
    - At about 21:35 on 2026-09-29 the folder held only `recaller-data.json`, `recaller-settings.json` and Chromium's files: no `backups/`, `.bak` or `images/`.
    - The first backup will be the daily one, from the hourly check (the first at about 21:43, if the app keeps running) or from the next launch. Check that `backups/` exists before copying the PC's notes over (section 7).
  - Settings › Open data folder opens it in Finder, and Finder's Go › Go to Folder… reaches it too.
- **The installed app** is `/Applications/Recaller.app` (1.16.0, copied there by the owner late on 2026-09-29). To read its version: `plutil -extract CFBundleShortVersionString raw /Applications/Recaller.app/Contents/Info.plist`.

### Saving and backups (Mac-only safety)

- **Quitting:** a Mac app is usually quit with ⌘Q. That skips `window-all-closed`, and it can beat the composer's 400 ms draft timer. So on a Mac:
  - the page sends a waiting draft save on `beforeunload`;
  - main also flushes on the window's `closed` event and on `will-quit`.
- **Backups:** a Mac app often runs for days, so the daily backup is checked every hour. Windows checks at startup only.
- **Global snips:** a snip taken with the global hotkey waits for the page to finish loading before it is handed over. A cancelled one hands focus back to the app you were in, when Recaller wasn't on screen.

### Developer conveniences (run from source only)

- ⌘⌥I toggles DevTools. F12 and ⌃⇧I also work, as on Windows.
- The Dock shows `build/icon-mac.png` instead of Electron's icon.

## 3. How it works in code

### IPC and preload additions

- **`app:command`** (main → renderer, `send`). The payload is a name:
  - `'settings'` and `'help'` (menu items);
  - `'undo'` and `'redo'` (Edit menu);
  - `'fullscreen-on'` and `'fullscreen-off'`.
- **`app:open-privacy`** (renderer → main, `invoke`). The argument is `'microphone'` or `'screen'`. It returns `true`, or `false` for anything else. It is registered only on a Mac.
- **`src/preload.js`** adds:
  - `openPrivacy: (kind) => ipcRenderer.invoke('app:open-privacy', kind)`;
  - `onCommand(fn)`, which listens on `app:command` and returns an unsubscribe function, like `onSummoned`.
- **Error codes:**
  - the screenshot result gains `code: 'PERMISSION'` (Mac only);
  - dictation keeps the existing `'DENIED'`, with Mac text.

### `src/main.js`

- **Settings and state:**
  - `DEFAULT_SETTINGS.hotkey` is `IS_MAC ? 'Control+Alt+R' : 'CommandOrControl+Alt+R'`. `loadSettings()` merges saved settings over the defaults, so it only matters when the file has no `hotkey`.
  - `MAC_ICON` is `build/icon-mac.png`.
  - `let quitting = false`, plus `if (IS_MAC) app.on('before-quit', () => { quitting = true; })`. The listener is registered after the existing `before-quit` flush.
- **`rememberBounds()` and the `close` handler** skip `settings.bounds` while `IS_MAC && win.isFullScreen()`.
- **`createWindow()`:**
  - On a Mac, it spreads `{ trafficLightPosition: { x: 16, y: 16 }, acceptFirstMouse: true }` into the options.
  - `close (e)`: after the existing flush and bounds save, `if (IS_MAC && !quitting)` it calls `e.preventDefault()` and then either `win.hide()`, or, in full screen, `setFullScreen(false)` with the hide on `leave-full-screen`.
  - `closed`: `win = null`, then `flushData()` on a Mac.
  - Full screen, Mac only: on `enter-full-screen`, `leave-full-screen` and the page's `did-finish-load`, it sends `app:command` with `'fullscreen-on'` or `'fullscreen-off'`. It is guarded against a destroyed window. `did-finish-load` re-sends the current state after a reload.
  - `before-input-event` also toggles DevTools on `input.meta && input.alt && input.code === 'KeyI'` (⌘⌥I), unpackaged only. It uses `input.code` because Option changes `input.key`.
- **`summon()`:**
  - on a Mac, `app.show()` before `win.show()` (it undoes ⌘H or `app.hide()`);
  - then `app.focus({ steal: true })` before `win.focus()`, because the hotkey was pressed in another app;
  - then `app:summoned`, as before.
- **`toggleWindow()`:** when Recaller is visible, focused and not minimised, it calls `app.hide()` on a Mac and `win.minimize()` on Windows.
- **`screenshotFromAnywhere()`:**
  - After `screenshot.capture()`, `if (IS_MAC && result.code === 'CANCELLED' && !onScreen) app.hide()` hands focus back. It never runs on `'BUSY'`, where a snip is still open.
  - After `summon()`, a Mac delivers the result with `sendWhenLoaded('shot:captured', result)`. Windows keeps `win?.webContents.send(…)`.
- **`sendWhenLoaded(channel, payload)`** sends now, or once on `did-finish-load` while `webContents.isLoading()`. Without a window it does nothing.
- **`showForCommand()`:**
  - creates the window if there is none;
  - otherwise calls `app.show()`, restores it if minimised, then `win.show()` and `win.focus()`.
  - It is not `summon()`, because summon's `app:summoned` would move focus to search.
- **`macMenu()`** builds the four menus in section 2 with `Menu.buildFromTemplate`:
  - `command(name)` runs `showForCommand()`, then `sendWhenLoaded('app:command', name)`. Settings… and How Recaller Works use it.
  - `edit(name)` only sends `app:command`, and only while the window is visible and not minimised. Undo and Redo use it, and it never shows the window.
  - Undo and Redo carry `id: 'undo'` and `id: 'redo'`, so tests can find them with `getMenuItemById`.
- **IPC:**
  - `window:minimize` runs `IS_MAC ? app.hide() : win?.minimize()`. "Hide after copying" uses it.
  - `app:open-privacy` checks the kind with `typeof kind === 'string'` and `Object.hasOwn(PRIVACY_PANES, kind)`, where `PRIVACY_PANES = { microphone: 'Privacy_Microphone', screen: 'Privacy_ScreenCapture' }`. It then opens `x-apple.systempreferences:com.apple.preference.security?<pane>` with `shell.openExternal`.
- **`whenReady`:**
  - after `protectData()`, a Mac starts `setInterval(…, 60 * 60 * 1000)`, which runs `flushData()` and `backups.dailyIfDue()` and logs errors;
  - the existing darwin branch now calls `app.setAboutPanelOptions(…)` and `Menu.setApplicationMenu(macMenu())`, replacing 1.16's three-role menu;
  - it also calls `app.dock?.setIcon(MAC_ICON)` when `!app.isPackaged` and the file exists;
  - Windows keeps `Menu.setApplicationMenu(null)`.
- **`activate`** (a Dock click or reopening the app): with no window it calls `createWindow()`; on a Mac with a hidden window it calls `summon()`.
- **`will-quit`:** a Mac runs `flushData()` before `globalShortcut.unregisterAll()`.

### `src/screenshot.js`

- **`systemPreferences`** is required only on a Mac. On Windows, loading it sets up a hidden window for colour broadcasts.
- **`capture(mainWindow)`:**
  - The permission check sits after the BUSY check and before `busy = true`. When `systemPreferences.getMediaAccessStatus('screen') !== 'granted'`, it:
    - fires `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })` and ignores errors;
    - returns `{ ok: false, code: 'PERMISSION', error: SCREEN_PERMISSION }`.
  - If Recaller is on screen and in full screen, it awaits `leaveFullScreen(mainWindow)` before `hide()`. `leaveFullScreen(win)` resolves on `leave-full-screen` or after 2 s.
  - The empty-capture error names macOS on a Mac.
- **`pickRegion()`:** on a Mac, the overlay gets `acceptFirstMouse: true`, and `app.focus({ steal: true })` runs right before `overlay.focus()`. So Esc and the first drag work when the snip starts from another app. The overlay still cancels on blur.
- **`setVisibleOnAllWorkspaces` is deliberately not used.** It flickers the Dock while it switches the process type.

### `src/renderer/app.js`

- **Startup,** before the first render: on a Mac it adds `is-mac` to `<body>`, copies `data-mac` into `textContent` and copies `data-mac-title` into `title`.
- **`kb(label)`** turns a Windows key label into Mac symbols, and returns it unchanged on Windows.
  - `'Ctrl+Y'` becomes `⇧⌘Z`.
  - Otherwise it splits on `+`, puts the modifiers in Apple's order (Alt → ⌥, Shift → ⇧, Ctrl → ⌘), and turns `Enter` into `↩`.
  - For example: `kb('Ctrl+Shift+S')` → `⇧⌘S`, and `kb('Ctrl+Enter')` → `⌘↩`.
  - It is used in the seed tips, the undo/redo titles, the `col-mic` and `col-add` titles, and the composer's shot, save and mic titles.
- **`modKey(e)`** is `IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey || e.metaKey`. The global `keydown` and the composer's textarea `keydown` use it.
- **`multiKey(e)`** is `IS_MAC ? e.metaKey : e.ctrlKey || e.metaKey`. It is used for `ctrlOnCard` in the board `pointerdown` and for `multi` in `startCardGesture`.
- **Control+click:** the board `pointerdown` starts with `if (IS_MAC && e.ctrlKey && e.button === 0) return;`, and the `contextmenu` listener edits.
- **`selectionAtPress`:**
  - A capturing board `pointerdown`, registered only on a Mac, records `String(window.getSelection()).trim()` for a right button or a Control+left press.
  - On a Mac, `contextmenu` uses it instead of the live selection, then resets it.
  - Once it decides to edit, it calls `window.getSelection()?.removeAllRanges()`.
  - Windows still reads the live selection, exactly as before.
- **Focused-card `keydown`:** on a Mac with ⌘, ⌃ or ⌥ held, it returns early. The exception is ⌘⌫ or ⌘Delete, with ⌘ alone, which runs `deleteNote(id)`.
- **The draft save:** a Mac-only `beforeunload` listener clears `draftTimer` and calls `persist()` when a draft save is still waiting. `persistSoon()` itself is unchanged.
- **Hotkeys:**
  - `macAccel(a)`, with `MAC_MODS` and `MAC_KEYS`, formats accelerators the Mac way.
  - `prettyAccel(a)` is `IS_MAC ? macAccel(a) : <the 1.16 expression>`. Settings and `openHelp()` show the hotkey through it.
  - The recorder uses `Control`/`Command`, and `MAC_CODE_KEYS` for punctuation.
- **`paintSettings()`** shows the keychain wording for a saved key.
- **Permission actions:**
  - the composer's `screenshot()` shows `PERMISSION` with the action `{ label: 'Open System Settings', fn: () => api.openPrivacy('screen') }`;
  - `startVoice()` shows `DENIED` with `api.openPrivacy('microphone')`;
  - `api.onScreenshot` shows `PERMISSION` as `toast(result.error, { action: 'Open Settings', onAction: …, duration: 12000 })`.
- **`api.onCommand`** is registered only on a Mac, after `api.onSummoned`:
  - `fullscreen-on` / `fullscreen-off` toggle `body.is-fullscreen`;
  - `settings` calls `openSettings()`, unless Settings is already open (opening it again would repaint it and wipe what is being typed);
  - `help` calls `openHelp()`;
  - `undo` / `redo`: while typing in a field (`isTyping(document.activeElement)`), `document.execCommand(name)`, the field's own undo. With Settings, Help or the lightbox open, nothing. Otherwise `undo()` / `redo()`.

### `voice.js`, `index.html` and `styles.css`

- **`voice.js`:** `MAC` picks the Mac text for `DENIED`. The other errors are unchanged.
- **`index.html`** has attributes only; every Windows text is byte-identical:
  - `data-mac` on:
    - the search `kbd`;
    - `.sel-hint`;
    - the two Help-list `kbd`s;
    - every Shortcuts `kbd` (`#help-hotkey` gets `⌃⌥R`, and F1 gets `?`);
    - the Join-notes muted span;
    - the hide-after-copy switch label.
  - `data-mac-title` on `#open-help` and `#open-settings`.
- **`styles.css`:** the block at the end, `/* ---- macOS (body.is-mac, 1.16 Mac edition) */`:
  - `body.is-mac .topbar { padding-left: 84px; }` and `body.is-mac.is-fullscreen .topbar { padding-left: 14px; }`;
  - `--font-ui`, `--font-head` and `--font-mono` redefined on `body.is-mac`, where the `body.title-*` classes resolve `var(--font-head)`;
  - `body.is-mac kbd`, which uses the system font.
  - The right padding formula already gives 12 px on a Mac.

### Flows, step by step

1. **Quitting with ⌘Q.**
   1. The Quit role makes Electron emit `before-quit`. Main flushes pending data, then sets `quitting`.
   2. The window's `close` fires. Main flushes and saves the bounds; because `quitting` is set, the close goes ahead.
   3. The page unloads. Its `beforeunload` sends any draft save still waiting on the 400 ms timer.
   4. `closed` flushes again, which writes that draft.
   5. `will-quit` flushes once more and unregisters the global shortcuts.
2. **Closing with the red button or ⌘W.**
   1. `close` flushes and saves the bounds.
   2. The close is cancelled, and the window hides. In full screen it leaves full screen first.
   3. To bring it back: ⌃⌥R, the Dock icon, or Recaller › Settings… or Help › How Recaller Works.
3. **The show/hide hotkey from another app.**
   1. `toggleWindow()` finds Recaller not in front and calls `summon()`.
   2. `summon()` runs `app.show()`, `win.show()`, `app.focus({ steal: true })` and `win.focus()`, then sends `app:summoned`.
   3. The page focuses search, unless Settings, Help, an editor or dictation is open.
   4. Pressed again while Recaller is in front: `app.hide()`, and macOS brings back the previous app.
4. **Copy with "Hide Recaller after copying" on.**
   1. A plain click copies the card, the Cooked note, the Served text or a stage picture.
   2. 260 ms later the page calls `api.minimize()`, which sends `window:minimize`.
   3. Main calls `app.hide()`.
5. **Settings from the menu.**
   1. Recaller › Settings… runs `command('settings')`.
   2. `showForCommand()` brings the window up, and `sendWhenLoaded` sends `app:command` `'settings'`.
   3. The page opens Settings, unless it is already open.
   4. ⌘, pressed in the page is also caught by the page's own `keydown` (`modKey`). Whichever path gets the key, Settings opens once.
6. **Undo.**
   1. ⌘Z while not typing: the page's `keydown` calls `undo()`. If the Edit menu gets the key instead, its `'undo'` command reaches the same `undo()`.
   2. ⌘Z while typing: the page leaves the key alone. Edit › Undo sends `'undo'`, and the page runs `document.execCommand('undo')` in the field.
   3. While the window is hidden or minimised, Edit › Undo does nothing.
   4. The suites send ⌘Z to the page as synthetic key events and click Edit › Undo from code. How macOS routes a real ⌘Z press between the menu and the page is untested (section 8).
7. **A snip without Screen Recording permission.**
   1. The camera or ⇧⌘S calls `api.captureScreen()`, which invokes `shot:capture`, which calls `capture()`.
   2. `capture()` finds the permission missing. It makes one tiny capture request, so macOS lists Recaller (and, the first time, shows its prompt), then returns `PERMISSION`.
   3. The composer shows the message with Open System Settings, which calls `app:open-privacy` `'screen'` and opens the pane.
   4. Turn Recaller on, then quit and reopen it.
   5. With the global screenshot hotkey, Recaller comes up instead, with the message in a 12 s toast.
8. **Dictation with the microphone blocked.**
   1. Dictate calls `getUserMedia`, which fails with `NotAllowedError`.
   2. `voice.js` throws `VoiceError('DENIED', <Mac text>)`.
   3. The composer shows it with Open System Settings, which opens the Microphone pane.
9. **Full screen.**
   1. The green button makes the window emit `enter-full-screen`.
   2. Main sends `'fullscreen-on'`, and the page adds `body.is-fullscreen`. The top-bar padding becomes 14 px.
   3. Leaving full screen reverses it.
10. **Right-click or Control+click to edit.**
    1. The capturing `pointerdown` records the selection as it was before the press.
    2. The board `pointerdown` returns early for Control+click.
    3. `contextmenu` sees no earlier selection, so it opens the right editor and clears the word the Mac selected.

## 4. Build and install

### Build the Mac app

1. `npm install`, once.
2. If `build/icon-mac.png` is missing or the icon changed: `npm run icon:mac`.
3. `npm run dist:mac`, which runs `electron-builder --mac`.

**The output in `dist/`:**
- `Recaller-1.16.0-arm64.dmg`, about 129 MB, and its `.blockmap`;
- `mac-arm64/Recaller.app`;
- `latest-mac.yml`, `builder-debug.yml` and `.icon-icns/`.

`latest-mac.yml` and the app's `Resources/app-update.yml` do nothing, because Recaller has no auto-updater.

**The log lines that matter:**
- `packaging platform=darwin arch=arm64 electron=44.4.5`;
- `signing file=dist/mac-arm64/Recaller.app … identityName=- identityHash=none`;
- `skipped macOS notarization`;
- `building target=DMG arch=arm64 file=dist/Recaller-1.16.0-arm64.dmg`.

**The config** (`package.json` → `build`):
- **`mac.target`:** `dmg` for `arm64` only.
- **`mac.icon`:** `build/icon-mac.png`. electron-builder turns it into `icon.icns`.
- **`mac.category`:** `public.app-category.productivity`.
- **`mac.identity`:** `"-"`, an ad-hoc signature. Apple Silicon won't run unsigned code, and there is no Developer ID yet. electron-builder 26 signs ad hoc with this value and skips notarization.
- **`mac.hardenedRuntime`:** `false`. It is only needed for notarization.
- **`mac.darkModeSupport`:** `true`. It becomes `NSRequiresAquaSystemAppearance false` in the `Info.plist`.
- **`mac.extendInfo.NSMicrophoneUsageDescription`:** the text in section 2.
- **`dmg.title`:** `"Recaller ${version}"`, which is the mounted disk's name.
- **`files`** is unchanged: `src/**/*`, `build/icon.png` and `package.json`. The app doesn't need `build/icon-mac.png` at run time.

### What this session's build was checked for (all passed)

- **`codesign`:** Signature=adhoc, valid on disk, satisfies its Designated Requirement, arm64 only.
- **`Info.plist`:**
  - `CFBundleIdentifier` `com.akhan.recaller` and `CFBundleName` `Recaller`;
  - `CFBundleShortVersionString` `1.16.0`;
  - `LSMinimumSystemVersion` `13.0`, so macOS 13 or later;
  - `LSApplicationCategoryType` `public.app-category.productivity`;
  - `NSRequiresAquaSystemAppearance` `false`;
  - `NSMicrophoneUsageDescription` set.
- **The icon:** `icon.icns` is 1024 px, made from the Mac icon.
- **`app.asar`:** it holds only `src`, `build/icon.png` and `package.json`. Its 15 source files are byte-identical to the tested working tree.
- **`spctl`:** it says "rejected". That is expected for an app that isn't notarized.
- **`hdiutil verify`:** the checksum is VALID. The dmg holds `Recaller.app` and an Applications link. It has no quarantine attribute, because it was built here, not downloaded.
- **The suites against the packaged `app.asar`:** 12/12, 21/21 and 139/139 (section 5).
- **Not done by the session:** launching the packaged `Recaller.app`, which would open a real window on the owner's screen. The owner opened it themselves afterwards (see the late update at the top).

Read-only commands to repeat these checks:
```
codesign -dv --verbose=2 dist/mac-arm64/Recaller.app
codesign --verify --strict --verbose=2 dist/mac-arm64/Recaller.app
plutil -p dist/mac-arm64/Recaller.app/Contents/Info.plist
spctl -a -vv dist/mac-arm64/Recaller.app
hdiutil verify dist/Recaller-1.16.0-arm64.dmg
```

### Install on the Mac (the owner's steps)

1. Open `dist/Recaller-1.16.0-arm64.dmg`. A window shows Recaller and an Applications folder.
2. Drag Recaller onto Applications, then eject the "Recaller 1.16.0" disk.
3. Open Recaller from Applications, Spotlight or Launchpad.
   - **A copy built on this Mac** opens straight away.
   - **A downloaded, AirDropped or emailed copy** is quarantined, and macOS won't open it because it can't verify the developer. Go to System Settings › Privacy & Security, click **Open Anyway** for Recaller and confirm. That is needed once per copy. Control-click › Open no longer gets past this on macOS 15 and later.
4. **First uses:**
   - The first dictation brings macOS's microphone prompt, showing the usage text. Allow it.
   - The first snip brings Recaller's Screen Recording message and macOS's own prompt. Turn Recaller on under Screen & System Audio Recording, then quit (⌘Q) and reopen Recaller.
   - Saving the API key may bring a keychain prompt for "Recaller Safe Storage". Choose Always Allow.
   - Closing the window doesn't quit. ⌃⌥R or the Dock icon brings it back, and ⌘Q quits.
5. The global hotkey needs no permission; Electron's `globalShortcut` needs Accessibility only for media keys.

The owner went through the first steps late on 2026-09-29: they copied the app to Applications (20:43:22), then opened the copy on the mounted dmg (20:43:25), not the one in Applications. At the end of the session that dmg copy was still the running Recaller. How the steps and the prompts went isn't recorded yet.

### Updating and uninstalling

- **To update:**
  1. Quit Recaller with ⌘Q; closing the window only hides it.
  2. Open the new dmg, drag Recaller onto Applications and choose Replace.
  - Notes stay in `~/Library/Application Support/Recaller`. A new version number makes an `upgrade` backup on first start, as on Windows.
  - Every build has a new ad-hoc signature, so macOS may ask again for the microphone, Screen Recording and the keychain. The Screen Recording switch may need turning off and on.
- **To uninstall:** drag `/Applications/Recaller.app` to the Bin. The notes folder and the keychain item stay until removed by hand.

### The icon (`npm run icon:mac`)

- **What it writes:** `node scripts/run-electron.js scripts/make-icon.js --mac` writes only `build/icon-mac.png`.
- **The design:** 1024×1024 on Apple's icon grid.
  - An 824 px rounded-square body, inset 100 px, with a corner radius of 185.
  - The Windows icon's gradient (`#63ad72` to `#1f5530`), glow and leaf, scaled from 480 to 824.
  - A soft drop shadow: dy 12, blur 14 (`stdDeviation` 7), 28 % black.
- **How it renders:**
  1. It hides the Dock icon first (`app.dock?.hide()`).
  2. It renders in a hidden, transparent, frameless window with `enableLargerThanScreen`, because 1024 px is taller than the 982 pt screen.
  3. It captures the window with `capturePage`. On Retina the capture is 2× (2048 px), so it is scaled to 1024.
- **It fails loudly.** It checks the capture before any scaling. If the capture is empty, not square, or smaller than 1024 px, it prints `icon:mac: no usable capture` and exits with code 1, instead of quietly writing nothing or a stretched icon. Without the file, electron-builder would quietly use the Windows icon for the Mac app.
  - Only a capture that passes is scaled: a Retina 2048 px capture comes down to exactly 1024.
  - `icon:mac` was run again after this check was added, and the icon came out byte-identical to the one in the dmg.
- **Without `--mac`,** the script behaves exactly as before (512 px `build/icon.png`). Don't run plain `npm run icon` on the Mac:
  - it rewrites the tracked Windows icon from a Retina render, which may not match the PC's;
  - it flashes a Dock icon.

### The Windows installer from the Mac

- **`npm run dist:win`** runs `electron-builder --win nsis --x64` and writes `dist/Recaller Setup <version>.exe` and `dist/win-unpacked/`.
  - `--x64` matters. A bare `--win nsis` on Apple Silicon builds an arm64 Windows app (in `dist/win-arm64-unpacked/`), which the owner's x64 PC can't run.
  - `npm run dist` stays as it was, for the PC.
- **It was not run this session.** Windows stays at the 1.16.0 the owner already has, and an exe can't be run or tested on the Mac.
  - The x64 NSIS installer in `dist/_discarded-1.17.0/` shows that electron-builder can make one on this Mac without Wine.
  - Test any exe made on the Mac on the PC before handing it out.
- **`npm run pack`** (`electron-builder --dir`) builds for the current platform. On the Mac it writes `dist/mac-arm64/Recaller.app`, replacing the one from `dist:mac`, not `win-unpacked`.

## 5. Testing on a Mac

### What makes the suites Mac-safe

The same npm scripts work on both computers. `tests/e2e/mac-harness.js` exports `{ IS_MAC, MOD, MOD_KEY, macRect, quiet, macState }`, and every helper does nothing on Windows.

- **`MOD`** is `'meta'` on a Mac and `'control'` elsewhere: the app's shortcut and multi-select modifier.
- **`MOD_KEY`** is `'Meta'` or `'Control'`: the keyCode for holding it down.
- **`macRect(W, H)`** places a test window past the outer left or right edge of all displays, on the side away from the cursor.
  - It leaves 2 px on screen, at the top of the display that forms that outer edge (`edge.workArea.y`), so the sliver stays on a screen even when several displays are attached (section 8).
  - The 2 px matter: macOS stops drawing a window that is wholly off screen, and `capturePage` and animations stop with it.
- **`quiet()`** runs before `require(APP_MAIN)`, on a Mac only:
  - `app.dock?.hide()`, so there is no Dock icon;
  - `setIgnoreMouseEvents(true)` on every new window, so the owner's pointer passes through the sliver (`sendInputEvent` still works);
  - `Menu.prototype.popup`, `shell.openExternal` and `shell.openPath` stubbed, so no native menu, System Settings or Finder window opens;
  - `app.focus` and `app.show` turned into no-ops, and `app.hide` into a counter (`macState.hides`), so the test app can never take focus or hide itself.
- **All four scripts:**
  - place windows with `macRect(…)` on a Mac, leaving the Windows expressions untouched;
  - call `quiet()`;
  - send `MOD` wherever they sent Ctrl (multi-select clicks, ⌘↩, ⌘Z, ⌘Y, ⌘N); multi-copy holds `MOD_KEY` down;
  - print the HARNESS FAIL hint "(APP_MAIN must be a Windows path)" on Windows only.
  - Check names still say Ctrl.
- **`features.e2e.js`:**
  - adds `AudioServiceSandbox` to `disable-features` on a Mac, because the sandboxed audio service can't read the fake-mic WAV;
  - skips the real screen snip's 3 checks, printing `SKIP  real screen snip (3 checks): …`;
  - adds 8 Mac checks after the Sort check (listed below);
  - prints one `INFO` line with the title-bar measurements, for tuning.
- **`update-safety.e2e.js`:** `MODE=real` reads `path.join(app.getPath('appData'), 'Recaller')` on a Mac. If the data or settings file is missing, it prints `HARNESS FAIL: no … in …` and exits with code 1 before any window opens, with no dialog. Windows still reads `process.env.APPDATA`.
- **`capture-board.js`:** on a Mac, `SCALE=2 npm run capture` renders at Retina 2× (the default is 1×). Not run yet.

### The 8 Mac checks

Each check puts back what it changes. The reload comes last.
1. **The logo clears the traffic lights and is centred with them.** `brand.x ≥ lights.x + 54 + 8` and `|brand.cy − (lights.y + 8)| ≤ 3`, from `win.getWindowButtonPosition()`.
2. **Key names use ⌘:** the search `kbd` reads ⌘K, every Help `kbd` has ⌘ (or is ?), the Settings title has ⌘, and the Undo title has ⌘Z.
3. **Control+click on a card** (the real Control modifier) opens its editor, without copying or selecting.
4. **A real right-click on the Served text** (`sendInputEvent` with `button: 'right'`) opens the Served editor, not the Copy menu.
5. **The menu bar:** it has 4 menus; Window › Minimize has no accelerator and no role; and Edit › Undo, clicked with `getMenuItemById('undo').click()` while typing in an editor, undoes the typing and leaves the board's history alone.
6. **"Hide Recaller after copying"** makes a copy call `app.hide` once (`macState.hides`) instead of minimising, and the setting is switched off again.
7. **⌘H on a focused card** leaves its highlight alone. It is sent as a DOM `KeyboardEvent`, because a real ⌘H the page ignores would reach the menu.
8. **A draft typed right before a page reload** (a stand-in for ⌘Q) is saved.

### Results this session

- **From source:** multi-copy 12/12, update-safety 21/21 (synthetic), features 139/139.
- **Against the packaged app:** the same three suites, run with `APP_MAIN` at `dist/mac-arm64/Recaller.app/Contents/Resources/app.asar/src/main.js`: 12/12, 21/21, 139/139. The log is `tests/e2e/.out/mac-pkg-all.log`.
- **The counts:**
  - Mac: 12 + 21 + 139, where 139 = 134 − 3 skipped snip checks + 8 Mac checks;
  - Windows: 12 + 21 + 134 as before, because the Mac checks sit inside `if (IS_MAC)`.
- **The INFO line:** `env(titlebar-area-x) 92px, top bar padding-left 84px, getWindowButtonPosition() {"x":16,"y":16}`.

### How to run them safely

1. **Get the owner's OK.** They said "Yes, run them" on 2026-09-29. The suites still overwrite the clipboard, so tell the owner not to copy anything during a run.
2. **Check the session first:**
   - `xcode-select -p`, `which node git` and `git status -sb`. For Mac work you should be on `masos`.
   - `git stash list` should show `stash@{0}`. Leave it.
3. **Run `node --check`** on every edited suite. A syntax error pops up an Electron error dialog on the owner's screen.
4. **Run in the background with a log,** then grep it. The whole packaged run took about 2 minutes on this Mac (about 5 on the PC).
   ```
   npm test > tests/e2e/.out/mac-test.log 2>&1
   grep -E 'passed|FAIL|HARNESS|SKIP|INFO' tests/e2e/.out/mac-test.log
   ```
5. **Against the packaged app,** after `npm run dist:mac` (zsh sets inline env vars; there's no `pwd -W` here):
   ```
   APP_MAIN="$PWD/dist/mac-arm64/Recaller.app/Contents/Resources/app.asar/src/main.js" npm test > tests/e2e/.out/mac-pkg-all.log 2>&1
   ```
6. **Always look for the "n/n passed" lines.** `scripts/run-electron.js` exits with `code ?? 0`, so a suite killed by a signal can look like a success.
7. **If a run hangs:** `pgrep -fl "$PWD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"` finds the test Electron by its full path; kill it with `pkill -f` and the same path (`07` #83). Never `killall Electron`, because VS Code and other Electron apps are running. Multi-copy and capture-board have no `.catch`, so an exception leaves their Electron running.

### Never run on a Mac

- **The real screen snip.** Keep the features skip. Don't click `.shot-btn`, set a `shotHotkey` or call `desktopCapturer` in a scratch script. It asks for Screen Recording, and it would capture the owner's screen.
- **Anything that opens the real microphone,** such as `getUserMedia` without the fake-device flags, or `systemPreferences.askForMediaAccess`.
- **`MODE=real`, unless** real Mac data exists and the owner agrees.
  - Since the owner's first run (late on 2026-09-29) the Mac data folder holds their real notes, so a run would copy them. Without a data folder the suite just prints HARNESS FAIL.
  - A real run copies private notes and the encrypted key into `tests/e2e/.out/data-real`. Delete that folder afterwards.
- **`npm start` without `RECALLER_DATA_DIR`,** unless the owner wants the real folder (section 6).
- **The packaged `Recaller.app` or the dmg.** The owner opens them.
- **`APP_MAIN` pointing into `dist/_discarded-1.17.0/`.**

### What the tests can't see

- the traffic lights (macOS draws them outside the page);
- the real menu bar and real key presses;
- the Dock, app activation and focus (`app.focus`, `app.show` and `app.hide` are stubbed);
- permission prompts, the real snip and the real microphone.

A person has to check these once (section 8).

## 6. Mac gotchas learned this session

1. **Electron starts as plain Node from the VS Code terminal on the Mac too.**
   - Cause: the terminal sets `ELECTRON_RUN_AS_NODE=1`.
   - Fix: the npm scripts go through `scripts/run-electron.js`, which removes it. For a direct call, use `env -u ELECTRON_RUN_AS_NODE npx electron <file>`; macOS's `env` supports `-u`.
2. **zsh, not Git Bash or PowerShell.**
   - There's no `pwd -W`. `$(pwd -W)` comes out empty, `APP_MAIN` becomes `/dist/…`, and the suites stop with HARNESS FAIL. Use `$PWD`: Mac paths are plain POSIX paths, also inside the `.asar`.
   - Inline env vars work (`MODE=real npm run test:update`).
   - zsh expands an unquoted word that starts with `=` as a command path. `echo ======` fails with "===== not found"; quote it.
   - Every file in the Mac clone is LF, `index.html` included, and there's no `autocrlf`. Keep them LF.
3. **git 2.50 (Apple Git-155).**
   - `git stash show -p stash@{0} -- <path>` fails. `git diff stash@{0}^1 stash@{0} -- <path>` shows one file of a stash; the untracked part is in `stash@{0}^3`. Use it only if the owner asks: this session's build never used the stash.
   - The Mac memory note records that a bare `git` once opened Apple's Command Line Tools install dialog. `xcode-select -p` checks first.
4. **`npm start` without `RECALLER_DATA_DIR` uses the real `~/Library/Application Support/Recaller`.**
   - It creates the folder if needed, opens a normal, focused window, and registers ⌃⌥R.
   - At startup it copies the data and settings files to `.bak`. It makes an `upgrade` backup and stamps `lastVersion` when the version differs, makes a daily backup if one is due, and deletes unreferenced images older than an hour.
   - For a scratch run, and only with the owner's OK, since it opens a real window: `RECALLER_DATA_DIR="$TMPDIR/recaller-dev" npm start` (see `12`, "Run from source on a Mac").
   - The installed Recaller (in `/Applications` since late on 2026-09-29) uses that folder too, and it now holds the owner's real notes. The single-instance lock is per data folder, so while it runs, a second copy only brings up the first.
5. **`npm run dist` on the Mac builds the wrong Windows installer.**
   - Cause: with no arch given, electron-builder uses the host's (arm64).
   - Fix: use `npm run dist:win`, which pins x64. `npm run pack` builds a Mac app, not `win-unpacked`.
6. **The offscreen `paint` frame came back empty.**
   - The planned icon renderer (an offscreen window's `paint` event) produced an empty frame on this Mac.
   - `icon:mac` now uses a hidden window and `capturePage`, scaled from 2× to 1024 (section 4).
7. **`capturePage` can't show the native traffic lights.**
   - Cause: macOS draws them outside the web contents.
   - Fix: check them by geometry, with `getWindowButtonPosition()` against the `.brand` rectangle, as Mac check 1 and the INFO line do.
8. **Ad-hoc signatures change with every build.**
   - macOS ties the microphone and Screen Recording permissions, and the keychain item's access, to the signature.
   - So after a rebuilt copy is installed, the prompts may repeat, or a Screen Recording switch that looks on may need turning off and on.
   - The permission messages say "(or off and on again after an update)". A Developer ID signature would end this.
9. **Tests must never trigger TCC** (macOS's privacy prompts: microphone, Screen Recording, System Settings).
   - The features suite skips the real snip on a Mac.
   - Dictation uses Chromium's fake audio device (with `AudioServiceSandbox` disabled).
   - `quiet()` stubs `shell.openExternal` and `shell.openPath`.
   - Keep it that way.
10. **Test logs say "Electron", not Recaller.** A suite loads `main.js` as a script.
    - So `app.name` is "Electron", and the first menu reads Electron; `npm start` shows Electron's bundle name there too.
    - `app.getVersion()` is 44.4.5, even for a packaged run, so the log never shows which build was tested.
11. **The "crashing window" wasn't Recaller.**
    - The owner said "the app window kept crashing when you opened it". No Recaller or Electron process had run.
    - The crash reports came from programs outside this session. A Tracer app (`/private/tmp/*/Tracer.app`, bundle `ai.ponders.tracer`) crashed three times on 2026-09-29: at 20:02, started from VS Code, and at 20:14:16 and 20:14:20, opened through Launch Services. Tracer is the owner's own separate project, in `/Users/ahsan/Documents/GitHub/tracer`. The other two, `repro_bigsur` and a copied `python3`, were started from VS Code.
    - Check which process crashed before assuming a test or the app did.
12. **Retina.** The screen is 1512×982 points at 2×, and window and display coordinates are in points.
    - The suites force a scale factor of 1, so their screenshots are 1×.
    - Pictures in notes are stored in physical pixels: a whole-screen snip is 3024×1964.

## 7. Moving notes between the PC and the Mac

- **With 1.17.0, use an account instead:** sign up on the PC and choose Upload this board, then sign in on the Mac and choose Combine both (section 9, and README's "Accounts, sync and privacy"). The hand copy below is for use without an account.
- **Both are 1.16.0 with the same data format,** so a data file from either computer opens on the other. Image ids are stored in the data, not paths.
- **Copy only `recaller-data.json` and the `images/` folder:**
  - PC: `%APPDATA%\Recaller\`;
  - Mac: `~/Library/Application Support/Recaller/`.
- **Don't copy `recaller-settings.json`:**
  - Its API key can't be decrypted on the other computer. On the PC it is protected by DPAPI through `Local State`; on the Mac, by the keychain.
  - Its saved window position suits the PC's ultrawide. Where it doesn't fit a display, the window opens at the default 1280×820.
  - Its hotkey `CommandOrControl+Alt+R` would be ⌥⌘R on the Mac (VS Code's Reveal in Finder), not ⌃⌥R.
  - So paste the API key again in Settings on the other computer. A copied settings file would show no usable key.
- **`backups/` isn't needed.** Each app makes its own backups.
- **Steps, PC to Mac:**
  1. On the Mac, quit Recaller with ⌘Q. Closing the window isn't enough: the running app saves on every change and at quit.
  2. Copy the two items into the Mac folder. Create it if Recaller has never run. Settings › Open data folder also opens it.
  3. Open Recaller and check that every project and note is there before relying on it.
  4. Keep the PC's copy until then. If the data file and its `.bak` can't be read, the app starts with the Welcome board and saves it over the file.
  - On first start with no Mac settings file, the app makes an `upgrade` backup and a daily backup of the copied data. The owner's Mac had its first start late on 2026-09-29, so a copy made now gets only the next daily backup, when one is due.
  - Copying replaces the Mac's own `recaller-data.json`. Since that first run the Mac has a board of its own, so anything made there survives only if one of its `backups/` holds it.
- **Mac to PC:** the same in reverse. On Windows, closing the window quits.
- **The two copies don't sync.** After copying they diverge, and nothing merges them. Copy in one direction, at one time.

## 8. Still open or untested

- **The owner's first run isn't reported yet.** The session never launched the packaged app; the owner opened it late on 2026-09-29, but nothing is recorded about:
  - the first install, Gatekeeper and Open Anyway;
  - the microphone, Screen Recording and keychain prompts;
  - Recaller's permission messages.
- **Real input is untested.** The suites use synthetic events, menu-item clicks and geometry, so these need a person:
  - real key presses: ⌘Z in a field and on the board, ⌘,, ⌘W, ⌘Q, ⌘H, and ⌃⌥R from another app;
  - the traffic lights;
  - the Dock;
  - whether a paste lands in the previous app after hide-after-copying.
- **Real dictation on the Mac** (a real microphone and real OpenAI) is untested.
- **Real snips on the Mac** are untested:
  - the Screen Recording flow;
  - snipping over another app's full-screen Space. `setVisibleOnAllWorkspaces` is avoided because it flickers the Dock.
- **Signing and notarization** for sharing need a Developer ID ($99 a year).
  - Notarization needs the hardened runtime. The microphone would then need the `com.apple.security.device.audio-input` entitlement.
  - Until then, the ad-hoc signature changes with every build, and prompts may repeat after updates.
- **Intel Macs** have no build. The dmg is arm64 only; they would need an x64 or universal build.
- **A Mac look review.** On Retina, 1.5 px borders draw at full weight: the arrow ring and the composer's ring look slightly heavier than on the 1× PC, and the frame edge reads stronger at 2×.
- **Start at login** is not built.
- **Whether to merge `masos` into `main`,** and how the two downloads are released together from then on.
- **Moving the PC's notes to the Mac** hasn't been done yet (section 7).
- **The masos code on Windows:**
  - The suites haven't been run on the PC, and the Windows exe wasn't rebuilt from masos.
  - Windows sameness rests on the gates, the review and the mocked-Electron comparison (section 1). Run the suites on the PC before shipping from masos.
- **`macRect` with several displays (fixed at the end of the session).** It used to take x from the outermost display but y from the cursor's display, so with an external display at a different height the 2 px sliver could land on no display. It now takes y from the display that forms the chosen outer edge. That was checked with simulated screens (one screen gives exactly the old placement); the suites have only run on the built-in screen.
- **After a snip taken in full screen,** the window comes back windowed, not in full screen.
- **Accounts and sync (1.17.0)** on a Mac: the keychain prompt for the sign-in, a real log out or shut down with changes waiting, and a real second computer are all untested (section 9; `09`, "Accounts and sync (1.17.0): what's still open").

## 9. Accounts and sync on a Mac (1.17.0)

Built and tested on this Mac (2026-10-01) and released on 2026-10-06, though the GitHub Release has only the Windows installer, not the dmg (the Google Cloud side is live since 2026-10-01). Accounts and sync are not a Mac difference: the same code runs on both platforms (`15_accounts_and_sync.md`). Only these things differ on a Mac.

- **Labels,** through `IS_MAC` in `account.js` and in `app.js`'s sync block: "this Mac" and "This Mac" wherever Windows says "this PC"; "Your sign-in is kept in your Mac’s keychain."; this computer's device name "Mac"; other computers called "your Windows PC" or "your other Mac".
- **The keychain item for the sign-in.** A packaged build seals the account's refresh token with `safeStorage`, which on a Mac uses the login keychain's **"Recaller Safe Storage"** item: the same item that protects the OpenAI key. The sealed token is kept as `{ enc }` in `~/Library/Application Support/Recaller/sync/account.json`; the keychain holds only the key that seals it.
  - The first sign-in may bring macOS's keychain prompt, unless saving the API key already did. The answer is Always Allow.
  - Refused, or when the keychain can't be used: the sign-in lasts until Recaller quits, nothing is written, and Settings says "This computer can't store your sign-in securely, so you'll sign in again next time you open Recaller."
  - Each ad-hoc-signed build looks new to macOS, so the prompt may come back after an update. Refused then, or with the item removed, the saved sign-in can't be unsealed: Recaller asks to sign in again ("You're signed out on this Mac because your password changed or your sign-in expired…"). The board stays, and changes made meanwhile upload after the sign-in. A Developer ID would stop the repeats (`09`).
  - Signing out deletes `sync/account.json`. The keychain item stays, because it also protects the OpenAI key.
  - Runs from source and every test keep the sign-in in memory and never touch the keychain; the sync suite turns `safeStorage` into tripwires. `RECALLER_TOKEN_STORE=secure` opts in from source and can raise the prompt: don't use it on the owner's Mac.
  - Untested: no session has seen the keychain prompt for the sign-in.
- **Logging out, restarting or shutting down.** macOS asks every app to quit. Signed in with changes not uploaded, Recaller normally holds a quit for up to 1.5 s to push them, but not then: powerMonitor's `shutdown` event (watched from the first sign-in on, never before) records when the notice came (`sessionEndingAt`), and a quit within 60 s of it goes through at once, because holding it up would make macOS report that Recaller cancelled the log out. A log out the person cancels stops counting after that minute, so a later quit gets its final push again. Changes not uploaded stay in the data file and go up at the next start. ⌘Q is not a log out and still gets the 1.5 s. Windows does the same on `session-end`. Checked with stand-ins by `facade.test.js` (the notice reaches main) and `quit.test.js` (the quit isn't held, and a cancelled log out stops counting after a minute); a real log out hasn't been tried.
- **A hidden window keeps syncing.** Closing the window only hides it (section 2), so sync goes on in the background: a head poll every 30 minutes while hidden, and a pull at once when ⌃⌥R or the Dock brings Recaller back. Waking from sleep and unlocking the screen (`resume`, `unlock-screen`) pull at once and refresh the sign-in.
- **The PC's board:** the owner's plan is to upload from the PC and choose **Combine both** on the Mac at its first sign-in. Section 7's hand copy is for use without an account.
- **The tests stay Mac-safe:** the sync suite adds no window, Dock icon, focus or prompt beyond what `mac-harness.js` already allows, and stubs `shell.openExternal` (the "Open" of a verification link) on both platforms.
