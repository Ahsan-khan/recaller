# 08: Changelog

Newest first. Dates run from 2026-09-23 to 2026-10-20. Versions 1.0.0 to 1.5.0 were built in one long session; 1.6.0–1.13.0 in a second session on 2026-09-24; 1.14.0 in a third; 1.15.0 in a fourth on 2026-09-26; 1.16.0 in a fifth, the same day. A sixth session (2026-09-28 to 29, on the owner's new Mac) built a 1.17.0 that the owner discarded, a seventh (2026-09-29, on the Mac) built the Mac edition of 1.16.0, and an eighth (2026-09-30 to 10-01, on the Mac) built accounts and sync as a new 1.17.0. A ninth (2026-10-06, on the PC) published 1.17.0's Windows installer as a GitHub Release and merged `masos` into `main`. A tenth (2026-10-20, on a freshly set-up Mac) built 1.18.0 on a new branch, `v1.18`. Versions refer to `package.json` and the installers: `dist/Recaller Setup <version>.exe` for Windows and, for the Mac edition, `dist/Recaller-<version>-arm64.dmg`.

## 1.20.4: columns minimized before 1.20 now sync too (thirteenth session, on `main`, 2026-10-24)

- The owner: "minized columns should sync everywhere, so if i sync oncee computer it should other computer". 1.20.0 already synced new minimizes (`minimized`), but a column minimized under 1.18–1.19 kept the per-computer `localMinimized`, which never leaves that computer, so it stayed a strip there and open everywhere else.
- At start (`init()`), every project with `localMinimized: true` gets `minimized: true` instead (the old key is removed), counts as a content change (`contentSeq++`, label "Minimize column") and is saved, so it uploads. `isMinimized()` still reads the old key.
- **Tests:** features +1 (Windows 189 → 190): the seeded notepad project carries `localMinimized` and is saved as `minimized` at start. Unit 715, update-safety 21, sync 43, all pass.
- Both computers must run 1.20.x: 1.19 and older don't read `minimized`.
- **The Mac build (2026-10-24, on the Mac, from `main` = `56e0113` plus the 1.20.3 Mac docs):** `dist/Recaller-1.20.4-arm64.dmg`, ad-hoc signed (codesign valid), 52 app files byte-identical to the source. From source: unit 715/715, update-safety 21/21, features 195/195 (Mac: 194 + 1). The sync suite was stopped partway and nothing was run against the packaged app: the owner found the tests too long ("tests are too long"), the engine is unchanged, and the PC ran sync 43/43 on 1.20.4. The owner's Mac board had one column with `localMinimized` (and 1.20.3 installed), so 1.20.4's first start there converts and saves it (after the upgrade backup).

## 1.20.3: a thicker board scrollbar the Eating strip stays clear of, and stacks that scroll (twelfth session, branch `v1.20`, 2026-10-24)

- **Thicker scrollbar** ("make the horitizal bar a little thicker cause i move it around alot", then "make the horitizal scroller bar thcker and make sure it doesnt over lap with the eating", `10` messages 85 and 87): the board's horizontal scrollbar is 28 px tall (was 14; `--board-bar`), its thumb 20 px (was 6) and 24 px while hovered or held (was 7). Columns are 14 px shorter for it. (Built first at 24 px; the owner asked for "slightly" thicker again, message 88.)
- **The Mac build (2026-10-24, thirteenth session, on the Mac, from `main` = `258c13d`):** `dist/Recaller-1.20.3-arm64.dmg`, ad-hoc signed (codesign valid), 52 app files byte-identical to the source, cloud config inside. From source: unit 715/715, features 194/194 (after two runs whose dictation block failed on a fake-mic hang, `07` #105). Against the packaged `app.asar`: multi-copy 12/12, update-safety 21/21, features 194/194. Accounts-on, sync and `MODE=real` weren't run on the Mac.
- **The Eating strip sits above it:** its foot is `--board-bar` + 10 px above the board's bottom (was 16 px, which put the strip over the scrollbar's right end). The board's bottom padding (`--eating-room`, the strip's height + 26 px) still keeps every column above the strip. The widget has no board scrollbar, so it keeps its 8 px.
- **A tall stack of minimized columns scrolls** ("since the minimized columns stack i should be able to scroll vertically according to the size of the window", message 86): `.mini-stack` is at most the board's height (`max-height: 100%`) and scrolls by itself (a 6 px bar; the wheel over it scrolls it, through `SCROLLERS`; a press on its bar doesn't pan the board).
- **Tests:** features +2 (Windows 187 → 189, Mac 192 → 194): the board scrollbar is 28 px and the Eating strip (three columns eating) ends above it; a stack scrolls on its own and stays inside the board.
- The owner had already installed the first 1.20.2 build (stacked minimized columns, without this), so it ships as its own version.

## 1.20.2: minimized columns as a stack of readable rows (twelfth session, branch `v1.20`)

The owner: "the minized columns look odd when vertical and text is unreadable, what can we do to make it look better" (`10`, message 83). Three looks were rendered side by side on the same board (tidier vertical strips, small horizontal cards, a stack of rows); the owner picked **the stack** (message 84).

- A minimized column is now a 184 × 40 px row in its header colour: leaf, the name across on one line (… when long; the full name in the tooltip), the Eating dot and the count. Minimized columns that sit next to each other on the board, or in a group's lane, share one slot as a stack of rows (`.mini-stack`, 6 px apart), so four minimized columns take one column's width instead of four strips. A lone minimized column is a stack of one.
- Nothing is stored: `render()` wraps each run of minimized columns in a stack (`stackMinimized()`, stacks reused by their first column's id). A row still opens with a click and drags like any column (out of its stack, before or after anything); the drag code treats a stack as one unit and a stacked column's container as the board or lane holding the stack. The gaps in a stack pan the board, like empty canvas.
- **Tests:** features +3 (Windows 184 → 187, Mac 189 → 192): two minimized columns side by side share one stack, as rows with the names across and whole; a row drags out of its stack, stays minimized, and the release doesn't open it; a click on a row opens it, and the stack goes when nothing is minimized. The 1.18 minimize check now expects a row (wider than 150 px, under 60 px tall, in a stack).

## 1.20.1: a ☰ menu for five top-bar buttons, a Notepad pill, and a pointer that stays visible over the notepad (twelfth session, branch `v1.20`)

The owner's words are `10`, message 82, after installing 1.20.0.

- **The pointer vanished over the notepad** ("my mouse disappears when i move on top of scraatch pad"). No CSS or code hides it; the PC's pointer scheme is "Windows Default", whose text I-beam is an inverting (XOR) pointer, and Chromium can fail to draw such a pointer over a layer floating above the page, which is where the notepad's big text area sits. The notepad's page (and Eaten's search field, in the same kind of drawer) now use their own I-beam, a dark-green SVG with a white edge (`cursor: url(data:…) 8 12, text`), drawn as an ordinary image. Not confirmed by the owner yet.
- **One menu** ("move how recaller works, settings, widget button, eaten, reset in one menu dropdown menu button"): the top bar keeps **Notepad**, **+**, undo / redo and the sync cloud, and a new **☰** (`#app-menu-btn`) opens a dropdown (`#app-menu`, styled as the app's other menus) with **Eaten** (with its count; only once something is eaten), **Widget: a small window on top** (in the widget: **Back to the full board**), **Reset column widths** (off while nothing is resized), then **How Recaller works** (F1) and **Settings** (Ctrl ,). The rows are the old buttons with their ids and handlers, so `#open-settings` and the rest still work from code. It is a menu like the column menus: a click away, Esc, or another menu closes it (`closeMenu()` hides it instead of removing it). In the widget it is the way back to the board, and help and settings are there too.
- **The Notepad pill** ("make the scratch pad button more visible and prominent"): the first thing in the top bar's right side, a 32 px pill with the page icon and the word **Notepad**, tinted emerald with a 45% emerald edge (Deep: mint on the dark bar), filled emerald while the notepad is open. In the widget it shows only its icon.
- Help, the Welcome tip and README name the menu instead of the old buttons.
- **Tests:** features +4 (Windows 180 → 184, Mac 185 → 189): the five buttons left the top bar for the menu; the notepad is a labelled, tinted pill; ☰ lists the rows and Esc or a click away closes it; the notepad's pointer is an image. Every check that clicked one of the moved buttons opens the menu first (`fromMenu()`). The dropdown has its own class, `.app-menu` (sharing the `.menu` look), so checks that read `.menu .menu-item` see only the menu that was just opened (the first run failed the Eating-menu check that way).
- **update-safety `MODE=real`:** the owner's real file now holds a notepad, which is never a column, so the "every project and note is on screen" check leaves `notepad` projects out (it failed 16/17 projects, 19/20 notes on the first 1.20.1 run: exactly the notepad and its page).
- **Built and tested (2026-10-23, on the PC):** `npm test` from source: unit 715/715, multi-copy 12/12, update-safety 21/21, features 184/184, the same three with accounts on (no request), sync 43/43. `dist\Recaller Setup 1.20.1.exe` (x64, cloud config inside, 52 app files byte-identical to the source) passed the same e2e suites against its packaged `app.asar`, and `MODE=real` 9/9 (the copy deleted). Not committed or installed; no Mac build.

## 1.20.0: minimized columns sync, columns and groups drag freely, and a notepad (twelfth session, branch `v1.20`)

Twelfth session, 2026-10-23, on the PC. The owner's words are `10`, messages 80 and 81. Details in `04` §29.

- **Minimize syncs.** ⋯ › Minimize column now writes `project.minimized` (an ordinary, synced project field), so the column is a strip on every computer. 1.18–1.19 wrote `localMinimized` (per computer); it is still read, nothing rewrites it at start, and it goes when the column is opened (or is replaced by `minimized` when it is minimized again). Not undoable, like Eating; it raises `contentSeq` and leaves a label ("Minimize column" / "Open column").
- **Columns and groups drag freely** (the owner: "once i added a column to a group i couldnt move the column or the group around"). In 1.18–1.19 a column inside a group could only be dragged among that group's columns (a lone member couldn't move at all), and a whole group moved only from its ⋯ menu.
  - A column dragged by its header can now be dropped anywhere: among the board's columns and groups, or into an open group's lane, which it then joins (a dashed slot shows inside the lane). Dropped on the board, it leaves its group. Toast "Added to “Lane” · Undo" / "Taken out of “Lane” · Undo"; undo labels "Move to group" / "Remove from group" (or "Reorder projects").
  - A whole group drags by its band (or its folded strip): a small ghost card with its leaves and name follows the pointer, and a dashed slot the group's size shows where it lands. Undo label "Move group". A plain click still folds or opens it; the click that ends a drag is ignored.
  - ⋯ › Move left / right on a group's first or last column now reads "Move left, out of “Lane”" and takes the column out, just beside the group (before: disabled).
  - During column and group drags the empty Cooked and Served sections no longer turn into card drop zones (`body.is-col-drag`); that hint is for card drags.
- **The notepad** (the owner's answer: "One scratch page"). A page icon in the top bar (before Eaten), or Ctrl+J (⌘J), opens a drawer over the board's right side with one big text area. It saves as you type (500 ms after a pause, and on blur, close and unload), shows "Saved · n words", has **Copy**, and Esc or Ctrl+J closes it. It syncs: the page is the first note of a hidden project `{ name: 'Notepad', color: 'slate', notepad: true }`, which the board never draws (`isNotepad()`, `boardProjects()`, `setBoardOrder()` keep it out of the layout, the widget, the colour picking and every reorder, always last in `data.projects`). Undo of a board change leaves it alone (`applySnapshot()` carries the live notepad over). A change from the cloud waits while the page has focus or a save is pending. If two computers typed at once, the other version (a sync conflict copy) shows under the page in amber with **Add to the page** (appends it after a blank line) and **Delete** (with Undo). An older Recaller shows the notepad as an ordinary column named "Notepad".
- **Data:** `project.minimized` and `project.notepad` (both synced; additive). `DATA_VERSION` is still 2. Settings unchanged; no new IPC.
- **Tests:** features +14 checks (Windows 166 → 180, Mac 171 → 185): `minimized` saved and synced (`SyncApply.isLocalKey`), a group dragged by its band (ghost, slot, quiet drop zones), the release not folding it, a column into a group and out again, ⋯ › Move left out of a group, undo of all 7 steps, the notepad never a column, Ctrl+J with the page and the other version, saving as you type, Copy, Add to the page, Esc, and a board undo leaving it alone. The features seed gains a notepad project with a page and a conflict copy. Unit +1 (715): `minimized` and the notepad go into the sync model, `localMinimized` doesn't.
- **Built and tested (2026-10-23, on the PC):** `npm test` from source: unit 715/715, multi-copy 12/12, update-safety 21/21, features 180/180, the same three with accounts on (no request), sync 43/43. `dist\Recaller Setup 1.20.0.exe` (x64, `npm run dist`, cloud config inside; its 52 app files byte-identical to the source) passed the same e2e suites against its packaged `app.asar`, and `MODE=real` 9/9 (the copy deleted). Not run on a Mac; no dmg; not committed or installed.

## 1.19.1: back to the normal column drag on the Mac (eleventh session, branch `v1.19`)

- The owner installed 1.19.0 and disliked the zoomed-out drag ("it brings horizontal like mobile model, i don't like that at all, go back to normal drag", `10` message 75). It is removed: `beginColumnSort()`, `columnSortEnd()`, the `body.col-sorting` CSS and its 2 Mac checks are gone, and the Mac drags whole columns exactly as 1.18 did. Everything else in 1.19.0 stays. Features: Windows 166, Mac 171.
- **Built and tested on the PC (2026-10-23, twelfth session):** the first full PC run since 1.17. `npm test` from source and against the packaged `dist\Recaller Setup 1.19.1.exe` (x64, cloud config inside, 52 app files byte-identical to the source) alike: unit 714/714, multi-copy 12/12, update-safety 21/21, features 166/166, the same three with accounts on (no request), sync 43/43; `MODE=real` 9/9. No code change was needed.
- **Built and tested (2026-10-21, on the Mac):** `npm test` from source and against the packaged `dist/Recaller-1.19.1-arm64.dmg` alike: unit 714/714, multi-copy 12/12, update-safety 21/21, features 171/171, the same three with accounts on, sync 43/43; the package's 52 app files are byte-identical to the source.

## 1.19.0: the Eating strip shows everything, a zoomed-out column drag on the Mac, and a widget (eleventh session, branch `v1.19`, not committed)

Eleventh session, 2026-10-21, on the Mac. The owner's words are `10`, messages 69 to 71. Details in `04` §28.

- **Eating strip:** every eating column shows (the 1.18 strip hid all but two); chips wrap onto more rows, with a leaf badge, "eating · 12m", a labelled Done and a running sheen; a count on the label; the board keeps the strip's measured height free.
- **Mac: dragging a column zooms the board out** into slim strips, so a short move reaches any slot; it opens back up on release. Windows unchanged. (Removed in 1.19.1 at the owner's request.)
- **The widget** (both platforms): a top-bar button turns the window into a 360 × 640 always-on-top widget showing one column, with a column picker; the same button goes back to the board at its own size. Remembered per computer (`widget`, `widgetBounds`, `widgetProject` in the settings file). New IPC `window:widget`.
- **Built and tested (2026-10-21, on the Mac):** `npm test` from source: unit 714/714, multi-copy 12/12, update-safety 21/21, features 173/173, the same three with accounts on (no request), sync 43/43; `dist/Recaller-1.19.0-arm64.dmg` (52 app files byte-identical to the source) passed the same against its packaged `app.asar` (one multi-copy check failed once and passed on a re-run). Features: Windows 158 → 166, Mac 163 → 173. Not run on the PC; no Windows build; not committed or installed.
- **Data:** no data-file change. The settings file gains `widget`, `widgetBounds` and `widgetProject`, written only once the widget is used; none syncs (the device record's settings are an allow-list).

## 1.18.0: Eating, Claude Code format, groups and minimized columns (tenth session, branch `v1.18`, not committed)

Tenth session, 2026-10-20, on a freshly set-up Mac (Node 26 and the cloud tools from Homebrew). The owner's dictated request is `10`, message 63; their three answers are message 64. Built on a new branch, `v1.18`, made from `main` (`e096680`) at their "also make neew branch". Both platforms; no Mac fence was needed. Everything is in `04` §27.

- **Eating:** a switch on the Served header for "an agent is running this served prompt" (filled emerald with a pulsing dot and the minutes while on), a pulsing dot in the column's header, and a strip at the board's bottom right listing every eating column (its leaf in its colour, its name, the time, ×). Manual only. The board keeps room under the columns for the strip. `project.eating`, synced, not undoable.
- **Done → Eaten** (the follow-up, `10` message 68): while eating, ✓ on the strip or Eating › **Done** moves the Served text to **Eaten** as one round, empties Served and ends Eating (undoable, Eating included); Eating › **Stop eating, keep it in Served** stops without moving it. **Eaten** is a drawer from the top bar (a fork and knife with a count, shown once a round exists, or a column's ⋯ › Eaten from this column): rounds newest first under Today / Yesterday / dates, filter chips by column, search, the text (click to read it all), pictures (click to copy), and Copy, Serve again (back into the column's Served) and Delete (undoable). `data.localEaten`, per computer (never synced, not in the device record), in local backups, at most 300 rounds. The sync engine counts "Done eating" and "Serve as Claude Code" as labels that explain deleted notes.
- **Mac: a stalled first load reloads itself** after 12 s, at most twice: the first start of the installed 1.18.0 stayed empty green (`07` #101).
- **Format for Claude Code:** **>_** under the Cooked note wraps its prompts in a fixed template (no AI, the owner's answer): `<request>` (numbered), `<how_to_work>`, `<when_done>`. Off by default; click again for the original; serving it serves the formatted text as one note, and the format turns off once Cooked is empty. `project.cookedFormat`, synced, undoable.
- **Clear** in the new-text editor (an eraser): empties the text and pictures, keeps dictation listening and drops phrases spoken before it; "Text cleared · Undo".
- **Minimize a column** (⋯): a 46 px strip with the leaf, the vertical name and a count; a click opens it. `project.localMinimized`, per computer.
- **Groups** (⋯ › New group…, Move to group "…", Remove from "…"): a faint lane with a slim band (name, count, ⋯: rename, fold, move left / right, ungroup). A click on the name folds the group into a strip. `project.group` synced; folds in `prefs.foldedGroups`, per computer. Column drag and Move left / right stay within the column's group, or step past whole groups on the board.
- **New text:** the New prompt half of the bar is renamed, with its tooltips, the empty-column line, Help, the Welcome tip and README.
- **A + in the top bar** for a new project, before undo.
- **Text while talking:** a phrase closes after a 550 ms pause (was 700 ms), at a 100 ms dip after 5 s (was 150 ms after 20 s) and always at 9 s (was 45 s); the editor says **Listening…** while recording.
- **Soft theme:** column headers 24% of the column colour (were 15%), edge 34%.
- **Data:** only additions (`03`); `DATA_VERSION` is still 2. Older versions keep the new fields and ignore them.
- **Built and tested again after Done → Eaten (2026-10-21):** the same packages and checks as below, with features at 163/163 from source; the rebuilt packages match the source file for file. **First built and tested (2026-10-21, on the Mac):** `dist/Recaller-1.18.0-arm64.dmg` (ad-hoc signed; codesign valid) and `dist/Recaller Setup 1.18.0.exe` (x64, by `npm run dist:win`), both with the cloud config; each package's 52 app files are byte-identical to the source. `npm test` passed from source and against the packaged Mac `app.asar` alike: unit 714/714, multi-copy 12/12, update-safety 21/21, features 157/157, the same three with accounts on (no request), sync 43/43. Not run on the PC; not committed, installed or released.
- **Tests:** features +24 checks (Windows 134 → 158, Mac 139 → 163): the top-bar + (the old "no + Project button" check now expects it), New text, Listening…, Clear and its Undo, the Claude Code format, copy and serve, Eating on, the strip clear of every column, undo leaving Eating alone, × off, minimize and open, a group made, joined, folded, opened and undone, and the Soft header, and Done → Eaten (Done and its undo, the Eating menu, the drawer under Today, Copy, Serve again, Esc). The other suites are unchanged.
- **Found on this Mac before any change (2026-10-20):** a baseline run of 1.17.0 on a clean copy of `main` failed 4 dictation checks (135/139): the microphone hadn't started 0.7 s after the click, so the first phrase landed late. A scratch timing run then started the mic in 165 ms, and the next features run passed them all. So it was most likely a slow first audio start in that run, not a steady bug; keep an eye on it (`09`).

## 1.17.0: accounts and sync (released 2026-10-06 as GitHub Release `v1.17.0`; merged into `main`)

Eighth session, 2026-09-30 to 2026-10-01, on the MacBook Pro. The owner asked for accounts and for the board to be kept on Google Cloud, with "everything is stored" ("all the columns", the notes, "file names", "account info"; `15`, 1.3 maps each to where it lives). A design workflow wrote the spec (`15_accounts_and_sync.md`: three designs, a fact sheet from Google's docs, two judges, one synthesis), the owner answered its questions, and the implementation workflow built it package by package, with verify-and-fix rounds. One codebase, both platforms: Windows and Mac both get 1.17.0 from `masos` (the discarded 1.17.0 below was never installed, so the number is reused). `package.json` says 1.17.0 since the release builds (2026-10-01).

- **Status (2026-10-06):** released and merged.
  - **Committed:** the owner committed and pushed it on `masos` on 2026-10-01 as "huge" (`4370072`, 20:08), then the docs (`f724f71`, 20:19, "Docs: the owner's messages from the 1.17 session; drop imports.tf after the deploy").
  - **Installed on the PC:** the owner installed the Windows installer built on the Mac at about 20:23 the same evening. Checked on 2026-10-06: the installed `app.asar` says 1.17.0 and holds `cloud/project.json` and `sync/`. Whether they signed up and uploaded from the PC isn't recorded.
  - **Released on 2026-10-06** as the GitHub Release [`v1.17.0`](https://github.com/Ahsan-khan/recaller/releases/tag/v1.17.0), at the owner's wish to "easily install on another pc". It is the repo's first tag and release, on `f724f71`, with one asset, `Recaller-Setup-1.17.0.exe` (112,172,310 bytes; its SHA-256 matches the PC's `dist/Recaller Setup 1.17.0.exe`). The repo is private, so downloading it needs a GitHub sign-in. The dmg isn't attached: it is on the Mac.
  - **Merged into `main` on 2026-10-06** at the owner's "okay merge masos to main": PR #2, merge commit `9d30f1f`, whose tree is identical to `f724f71`. The suites still haven't run on the PC.
- **Status (2026-10-01):** built and tested in the working tree on `masos`, uncommitted. **Live on Google Cloud since 2026-10-01:** the owner applied the deploy's plan (about 17:54 UTC), ran `auth-settings.sh` and `npm run rules:smoke`. The smoke test passed 43 of 45: the live Storage rules accepted an upload over an existing picture. That is fixed in the repo (`15` section 0, item 34) and waits, with Firebase's auto-created key cut to the sign-in APIs and the budget's new alerts, in one saved plan for the owner (`infra/README.md`, "The next plan"); then `rules:smoke` must pass 45 of 45. Still to do after that: the email steps (the name "Recaller" and a sending domain of our own, `infra/README.md` "Email delivery"), the manual two-computer check, and the first run of the suites on the PC.
- **Signed out, nothing changes.** The app behaves exactly like 1.16.0: no `sync/` folder, no network, no timers, no quit delay. The one visible difference is a new Settings section, hidden in a build without cloud config.
- **Accounts** (Settings › Account & sync): email and password on Firebase Authentication with Identity Platform, project `recaller-cloud`. Sign-ups are open (the owner's answer); a Terraform variable pauses them. Email verification before any upload ("Check your email", I've verified, Send again, Use a different email); the panel says Recaller notices the verification by itself, and it, "Sent again" and both reset confirmations say to look in Spam. Password reset by email ("Change password", "Forgot password?"); after a change every computer asks to sign in again and keeps its notes. 8 or more characters, checked before any network call. 5 wrong passwords in 10 minutes lock sign-in for 30 s. Delete account (password plus "DELETE") first saves on this computer the full size of every picture it holds only as a preview, then erases the pictures, the notes and the account from Google Cloud; the computer keeps its board. A plain sign-out saves those full-size pictures too, for up to 20 s. "Send link" and "Change password" wait a minute between reset links, like "Send again".
- **Sync, local first:** the data file stays the source of truth, and each computer keeps a full board. What syncs: projects, notes in all stages with their order, highlights, copy counts and pictures, and "Join notes with". Per computer: column widths, folds, scroll, drafts, density, title font, Cooked colour, theme, shortcuts, voice settings; the OpenAI key and local backups are never uploaded. Each computer's view, drafts and allow-listed settings go up as a backup that is never applied elsewhere.
  - Pushes are fast-forward commits under a precondition; pulls read by revision; no clock orders anything. Polls every 60 s focused, 5 min visible, 30 min hidden, and at once on summon, focus, wake and Sync now. Nothing needs pressing: Sync now only skips the wait, and the signed-in help says so.
  - First sign-in: Upload this board / Combine both / Use my account's board / Not now, with a "Before sync" backup first. A pristine Welcome board never asks.
  - Conflicts keep both texts: the account's in place, this computer's as a copy marked Check again with an "Other version" tag. An edit beats a delete.
  - Deleted notes and projects stay 30 days in the account's trash. A push that would delete many notes with no delete to explain it asks first ("Delete n notes everywhere?").
  - Changes from another computer wait while an editor, drag, menu, dictation or Undo toast is open, and clear Undo when they land.
  - A restore while signed in deletes nothing from the account. An unreadable notes file is copied aside and the board restored from the account.
  - Offline works; quitting gives waiting changes up to 1.5 s, except while the computer logs out, restarts or shuts down (they upload at the next start).
- **UI:** the Account & sync section with inline panels (no stacked dialogs; Enter and Esc stay inside the form), the first-sync choice panels, a top-bar cloud indicator that shows only when sync needs a look, the "Other version" card tag, sync toasts, one Help line, the signed-in restore confirmation, and "Before sync" in the backups list. Every string has a "this PC" / "this Mac" form.
- **Security:** all network code in the main process through `net.fetch`; the page never sees a token, the API key or the config, and its CSP is unchanged. The refresh token is sealed with `safeStorage` (DPAPI, or the Mac keychain) or kept for the session only, never in plain text; runs from source never touch the keychain. Security rules: verified email, own `users/{uid}` only, rev-checked board commits, no hard deletes except during account deletion. No new dependency and no Firebase SDK.
- **Privacy note** "What's stored and where", version 2026-10-01, shown before sign-up and in the README; contact ahsan@ponders.ai. Not end-to-end encrypted, and it says so.
- **Infra:** the project is Terraform (`infra/`, adopted from the earlier setup script): `sync.tf` (index exemptions, the 30-day trash TTL, the one IAM grant), the sign-up switch, the real rules texts, and owner-run scripts (`auth-settings.sh`, `rules-test.js`, `rules-smoke.js`, `purge-unverified.js`). Firestore and the bucket are in us-east1. The budget stays 15 CAD (alerts only). Applied on 2026-10-01. Written later the same day, and waiting in the saved plan: Firebase's auto-created browser key, which the email links carry, brought into Terraform with only the two sign-in APIs; and the budget's alerts at 10 %, 50 %, 90 % and 100 %, plus one on the month's forecast.
- **Build:** `npm run cloud:config` writes the git-ignored `src/cloud/project.json`; every `dist*` and `pack` script checks it first (`RECALLER_NO_CLOUD=1` builds without accounts).
- **Tests** (counts as of the final gates on 2026-10-01): `npm run test:unit`, 702 tests in 20 files (plain Node, including crash injection and a three-computer fuzz test); an in-process Google Cloud mock with a twin of the rules; 216 rules cases passing on Google's real rules engine (`npm run rules:test`, which deploys nothing); `npm run test:sync`, 43/43 on the Mac. `npm test` now runs the unit tests, then multi-copy, update-safety and features, then the same three with accounts on and nobody signed in (`npm run test:accounts-on`, which fails on any request), then sync. The older suites stay at 12 + 21 + 139 on the Mac (they run with accounts off). Since the storage-overwrite fix: 714 unit tests pass, and all 219 rules cases (185 Firestore, 34 Storage) pass on Google's rules engine (2026-10-01).
- **Differences from the spec** (the head's `commits.<deviceId>`, the outgoing and ack markers, the restore hold, tombstone trimming after 30 days, the mass-delete record, the stricter remove-board rule, the 403 retry policy, the slow-link commit budget, notes held with their project and a project's deletion held for such a note, the full-size pictures saved before a sign-out or a deletion, one reset link a minute and more) are listed in `15`, section 0.

## 1.16.0 for Mac (branch `masos`; committed and pushed as "mac build", `16961eb` + `9536853`)

Seventh session, 2026-09-29, on the MacBook Pro. The owner asked for "a similar mac os app" while keeping "the windows app as it is", as "two different files for windows and mac", like software offered online. This is the same 1.16.0 app with Mac habits, built fresh as they asked ("Start from scratch"): nothing from the discarded 1.17.0 below was used. Every Mac difference is fenced (`IS_MAC` in the JavaScript, `body.is-mac` in the CSS, the `mac` and `dmg` build sections), so the Windows app behaves exactly as before and this branch still builds the identical Windows installer. The version stays 1.16.0, so the two downloads match: `Recaller Setup 1.16.0.exe` and `Recaller-1.16.0-arm64.dmg`. `main` and `v1` were not touched. The full description is in `14_macos.md`; the reasons are in `11` #49 onward.

- **Status:** committed and pushed on `masos`; merged into `main` with 1.17.0 on 2026-10-06 (PR #2).
  - The owner committed the work at 21:45 on 2026-09-29, as two commits both called "mac build", and pushed both: `16961eb`, the snapshot they had staged at 21:13, and `9536853`, the fixes made after that staging (mostly docs, plus the `icon:mac` capture check in `scripts/make-icon.js`, now made before any scaling, and a comment in `tests/e2e/mac-harness.js`). A read-only `git ls-remote origin` then showed GitHub's `masos` at `9536853`, with `main` and `v1` unchanged there.
  - Merged into `main` with 1.17.0 on 2026-10-06, at the owner's request, by PR #2 (`9d30f1f`). The suites hadn't run on the PC from `masos` first, as this note had advised.
  - `16961eb` also committed Finder's `.DS_Store` by accident. At the owner's "fix it", `git rm --cached .DS_Store` took it out of git (the file stays on disk) and ".DS_Store" was added to `.gitignore`. The owner committed both as "fix" (`f86cf19`, 21:51:53) and pushed it, so GitHub's `masos` is now `f86cf19`.
- **Keys and clicks:**
  - ⌘ instead of Ctrl for every app shortcut: ⌘K, ⌘N, ⌘M, ⌘↩, ⇧⌘S, ⌘Z and ⇧⌘Z, ⇧⌘N, ⌘, (`modKey()`). The ⌃ keys stay text-editing keys, so ⌃K, ⌃F and ⌃N no longer jump to search or open a composer on a Mac.
  - ⌘-click picks several cards to copy at once (`multiKey()`).
  - Control+click is a right-click on a Mac, so it edits. The board ignores Control+left-click in `pointerdown`, and the context click uses the selection read at the press, because a Mac selects the word under a right-click before `contextmenu` fires.
  - On a focused card, ⌘, ⌃ and ⌥ keys are left to the menus, so ⌘H hides the app instead of highlighting. ⌘⌫ deletes the card, as in the Finder.
  - Labels show Mac symbols: the search box's ⌘K, tooltips, the Help keys (with ? in place of F1), the Welcome tips and the "⌘-click" hints (`kb()`, plus `data-mac` / `data-mac-title` attributes in `index.html`).
  - Settings shows hotkeys as symbols (⌃⌥R). The recorder saves ⌃ as `Control` and ⌘ as `Command`, names punctuation from the physical key (Option changes the typed character), and asks for "at least one of ⌃, ⌥, ⇧ or ⌘".
- **Window:**
  - The traffic lights sit at (16, 16), centred in the 48px top bar, and the top bar starts after them (padding-left 84px, so the logo is at x 84). In full screen the lights are gone and the top bar takes that space back (`body.is-fullscreen`).
  - A click on a card while another app is in front copies it at once (`acceptFirstMouse`).
  - The red button and ⌘W hide the window, and ⌘Q quits. A Dock click brings the window back.
  - The global show/hide hotkey defaults to ⌃⌥R (`Control+Alt+R`), the same keys as Ctrl+Alt+R on the PC. The default applies only when no hotkey is saved yet. When Recaller is in front it hides the app (`app.hide()`), so the previous app gets the focus back and a paste lands there. **Hide Recaller after copying** (called "Minimize Recaller after copying" on Windows) hides the app the same way.
  - Closing the window or starting a snip while in full screen first leaves full screen, because hiding a full-screen window leaves an empty black Space. A full-screen frame isn't saved as the window size.
- **Menu bar:**
  - **Recaller:** About (name, version and "Your prompts and notes, one click away."), Settings… ⌘,, Services, Hide, Hide Others, Show All, Quit.
  - **Edit:** Undo ⌘Z, Redo ⇧⌘Z, Cut, Copy, Paste, Paste and Match Style, Select All. Undo and Redo go to the page (`app:command`): in a text field they undo the typing; elsewhere they step the board's history, except while Settings, Help or the lightbox is open. They do nothing while the window is hidden or minimised.
  - **Window:** Minimize (with no ⌘M, which stays Dictate), Zoom, Close Window ⌘W, Bring All to Front.
  - **Help:** How Recaller Works.
  - Settings… opens Settings, and leaves one that's already open alone.
- **Permissions:**
  - Microphone: `NSMicrophoneUsageDescription` in `Info.plist` ("Recaller listens only while you dictate a prompt, and sends the recording to OpenAI to turn it into text."). A blocked microphone gets a Mac message with an **Open System Settings** button.
  - Screen Recording: checked before each snip. Without it the snip stops with a message and **Open System Settings** (a toast with **Open Settings** for the global snip), and macOS shows its own prompt the first time.
  - A new IPC, `app:open-privacy` (`microphone` or `screen`), opens the matching System Settings pane.
  - The empty-capture error says "macOS returned an empty screen capture." on a Mac.
- **API key:** Electron's `safeStorage` encrypts it with a key kept in the Mac keychain. Settings says "Saved in your Mac’s keychain. Paste a new key to replace it."
- **Look:** unchanged. The system font follows Geist in the fallback lists (SF Mono and Menlo for mono), and key caps use the system font, which has ⌘ ⇧ ⌥ ⌃ ↩. There is no Retina tuning yet.
- **Reliability fixes (Mac only):**
  - A draft still waiting on its 400ms save is saved when the page unloads, so ⌘Q keeps the last keystrokes.
  - The main process also flushes on `will-quit` and on the window's `closed`, because ⌘Q never reaches `window-all-closed`.
  - The daily backup is checked every hour, because a Mac app runs for days.
  - A global snip is delivered only once the page has loaded (`sendWhenLoaded`), and a cancelled global snip hands the focus back.
  - Dev only: ⌘⌥I toggles DevTools, and the Dock shows `build/icon-mac.png`.
- **Build:**
  - `npm run dist:mac` makes `dist/Recaller-1.16.0-arm64.dmg`: Apple Silicon only, macOS 13 or later, ad-hoc signed (`identity: "-"`), no hardened runtime, not notarized.
  - `npm run dist:win` builds the Windows installer from a Mac with x64 pinned (a bare `--win nsis` on Apple Silicon makes an arm64 exe). It hasn't been run yet.
  - `npm run icon:mac` renders `build/icon-mac.png`: 1024px on Apple's icon grid (an 824px body, radius 185, a soft shadow) with the Windows icon's gradient and leaf. It renders in a hidden window, scales the 2× capture down to 1024px, and fails loudly rather than letting the Mac app fall back to the Windows icon.
  - `npm run dist`, `npm run pack`, the NSIS settings and `build/icon.png` are unchanged.
- **Tests:**
  - `tests/e2e/mac-harness.js` makes every suite Mac-safe and does nothing on Windows. Each test window is a 2px sliver past the outer screen edge, away from the pointer. There is no Dock icon, and the real mouse passes through the windows. No native menu, System Settings or Finder window can open. `app.focus` and `app.show` do nothing, `app.hide` is only counted, and ⌘ is sent wherever Windows sends Ctrl.
  - The features suite skips the real screen snip on a Mac (3 checks) and adds 8 Mac-only checks: the logo clears the traffic lights; key names use ⌘; Control+click edits without copying or selecting; a real right-click on the Served text edits; there are 4 menus, Minimize has no ⌘M, and Edit › Undo undoes typing, not the board; hide after copying hides the app; ⌘H leaves a highlight alone; a draft typed just before a reload is saved. It also disables `AudioServiceSandbox` so the fake microphone works.
  - Counts: Windows 12 + 21 + 134, unchanged. Mac 12 + 21 + 139 (134 − 3 + 8).
- **Verified on the Mac:**
  - From source: multi-copy 12/12, update-safety 21/21, features 139/139, with all 8 Mac checks passing and the real snip skipped. Measured: `env(titlebar-area-x)` 92px, top-bar padding-left 84px, `getWindowButtonPosition()` {x: 16, y: 16}, and the logo at x 84 with its centre at y 24.
  - Against the packaged `app.asar` (`APP_MAIN="$PWD/dist/mac-arm64/Recaller.app/Contents/Resources/app.asar/src/main.js"`): 12/12, 21/21 and 139/139 (`tests/e2e/.out/mac-pkg-all.log`).
  - The build: `dist/Recaller-1.16.0-arm64.dmg` (129 MB) and `dist/mac-arm64/Recaller.app`. codesign: `Signature=adhoc`, valid on disk, satisfies its Designated Requirement, arm64 only. electron-builder 26 signed it ad hoc (`identityName=- identityHash=none`) and skipped notarization. `spctl` says "rejected", as expected for an app that isn't notarized. `hdiutil verify` reports a VALID checksum. The dmg holds Recaller.app and an Applications link, and has no quarantine attribute, because it was built here, not downloaded.
  - `Info.plist`: `CFBundleIdentifier` com.akhan.recaller, `CFBundleShortVersionString` 1.16.0, `NSMicrophoneUsageDescription` set, `LSMinimumSystemVersion` 13.0, `LSApplicationCategoryType` productivity, `NSRequiresAquaSystemAppearance` false. The app's `icon.icns` is 1024px, made from the Mac icon.
  - The `app.asar` holds only `src`, `build/icon.png` and `package.json`, and its 15 source files are byte-identical to the tested working tree.
  - After the push (`10`, message 42): all 33 files under the pushed `src/` are byte-identical to the dmg's `app.asar`, and `build/icon-mac.png` is the same file. `package.json` differs only in the `scripts`, `build` and `devDependencies` fields, which electron-builder strips from the packaged copy.
- **Not done, or untested:**
  - The session never launched the packaged Recaller.app, because it would open a real window on the owner's screen; the suites load its `app.asar` in the development Electron. Its app menu should read "Recaller" (from source it reads "Electron").
  - At the very end (late on 2026-09-29) the owner copied it into `/Applications` themselves, then opened the copy inside the mounted dmg (still running from there at the end of the session). Nothing about that first run is recorded: real key presses, the real traffic lights, the app menu's name, and the microphone, Screen Recording and keychain prompts are all still unreported.
  - Intel Macs, and snipping over another app's full-screen Space.
  - The Windows exe wasn't rebuilt: Windows stays the 1.16.0 the owner has, and it can't be run on the Mac anyway.

## 1.17.0 (discarded, never released)

- The sixth session (2026-09-28 to 29, on the owner's new Mac) answered "okay make it so i can install on macos as well" and "i want to be able to install on both btw" with a 1.17.0 that added a Mac edition. A dmg and a Windows exe were built and tested; neither was installed or opened.
- On 2026-09-29 the owner discarded everything since the 1.16 push, in a separate short session ("i made some changes to my project that i dont want to keep anymore", "since my last push"). No reason was given. It is kept as `stash@{0}` ("On v1: Discarded changes since 1.16 push (1.17.0 macOS work) — 2026-09-29"), and its builds were moved to `dist/_discarded-1.17.0/` (git-ignored; nothing deleted).
- The number is reused by the accounts-and-sync 1.17.0 above: the owner agreed on 2026-09-30, since these builds were never installed anywhere (so no computer's `lastVersion` says 1.17.0, and the upgrade backup still runs).
- None of it is in the code. The Mac edition above was built from scratch, as the owner asked; the stash was not read, applied or popped for it. Leave the stash alone unless the owner asks. Never `git stash pop` it: it also changes `README.md` and all 14 `ai_memory` files, and would overwrite them with its 1.17.0 notes. Don't hand out or install the `_discarded-1.17.0` builds.

## 1.16.0 (Windows; committed as "1.16" and merged into `main`)

- **Status:** the owner committed and pushed it on `v1` as "1.16" (`664212a`, 2026-09-26), together with the fifth session's `ai_memory` update, and merged `v1` into `main` on 2026-09-29 (PR #1, merge commit `dd5a3b0`, whose tree is identical to `664212a`). This is still the current Windows version; the Mac edition above is the same version. Whether 1.16.0 was installed on the PC isn't recorded (1.15.0 was installed when the fifth session ended).
- **The board sits in a frame:** the owner asked for "a slight border … to organize everything … very sleek, very modern … aesthetic", and then clarified they meant the whole board space ("the board frame"), not the arrow. The board is now a rounded panel (radius 14px) inset from the window: 2px under the top bar and 12px from the left, right and bottom. The margin around it is the top bar's colour (`body` background = `--topbar`), so the top bar and the margin read as one dark shell holding the board. The frame edge is a 1px gradient: bright mint at the top-left corner (a soft sheen), settling to an even emerald all the way round (`--frame-edge`), plus a faint 3px emerald glow outside and a hairline highlight inside the top edge. The top bar's shadow was removed and its bottom border made transparent (it still takes 1px); the frame draws that edge now. In Soft theme the same frame is a deep-green hairline on a white shell. The board's scrollbar track is inset 12px so the thumb clears the rounded corners.
  - Eight edge styles were rendered side by side on a real board first (a plain hairline, a gradient sheen, a recessed vignette, a wider emerald hairline, then a mint hairline, an emerald glow, a stronger sheen and a double frame). The first four were too faint to read as a border at 100% scale; the shipped edge combines the even emerald of the glow with the sheen's bright corner.
  - The first build of 1.16.0 (never installed) had only the arrow changes below; the installer was rebuilt with the frame under the same version.
- **The ‹ › board arrows keep out of the way:** the owner found the › arrow "kind of annoying" because it was always there (on a wide board there is nearly always more to the right). Each arrow now stays hidden until the pointer comes within 96px of its edge of the board, then fades and slides in (0.2s). It hides again when the pointer moves away or leaves the board, and while dragging a card or panning the canvas. Keyboard focus (Tab) still shows it. The old rule still applies on top: no arrow when there's nothing more to scroll that way.
- **A matching ring on the arrows** (built first, when "a slight border to it" was read as the arrow's border; kept because it matches the frame): a solid white disc (a subtle white-to-mint gradient) with a slim deep-emerald ring (1.5px, drawn 1px at 100% scale), a faint white outer halo and a soft drop shadow, 38px (was 36px with a pale border that didn't show). On hover the ring turns bright emerald and the chevron deep emerald. A see-through frosted disc was tried and dropped: it turned muddy grey over the dark canvas.
- README's "Scroll sideways" row explains the arrows.
- **Tests:** features 134 checks (new: the board has a rounded frame with a gradient edge, inset from the window in a shell the colour of the top bar; the right arrow is out of sight mid-board; it appears near the right edge with a visible coloured ring; the left arrow appears only near the left edge while the right one leaves).
- Verified (with the frame): 12 + 21 + 134 on source and on the packaged build, 9/9 on a copy of the real data.

## 1.15.0

- **Delete inside Cooked:** the owner asked to be able to delete something in Cooked. Before, the only ways were ⋯ → Clear Cooked (everything) or Notes → ✎ → the editor's trash (one part, two steps deep).
  - Every row in the **Notes** list now has a **trash** button after ↑ ↓ ✎ ↩. It deletes just that note ("Note deleted · Undo"); the combined text updates at once. The button sits a little apart and turns red only on hover.
  - The **whole-text editor** (right-click the Cooked note, or its pencil) now has a trash button too, like the card editor. It deletes the whole Cooked note ("Cooked note deleted · Undo"); a prompt that arrived while the editor was open stays.
  - **Served** got the same two (row trash; "Served text deleted · Undo" from its editor), since the Notes rows and editors are shared.
  - All of it is undoable (Ctrl+Z, or Undo on the toast). Nothing asks for confirmation.
- Help panel ("Delete" and "Edit anything") and README explain it. The Notes button tooltip says "reorder, edit, send back or delete one".
- **Tests:** features 130 checks, 9 of them new (121 → 130): every Cooked row has a trash; a row fits its five buttons with room for text at slim width; the row trash deletes one note, and Ctrl+Z puts it back in place; the Cooked editor's trash deletes the whole note and leaves Served alone, and Ctrl+Z restores it with its parts; the Served row trash deletes one note, and Ctrl+Z restores it; deleting the last Cooked row leaves the other note. The Served Notes-list check now also expects the delete button.
- Verified: features 130/130 on source; 12 + 21 + 130 on the packaged build (the installer build needed one retry after the usual exit 127), 9/9 on a copy of the real data.

## 1.14.0

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
- **Cooking header:** the prompts get a stage header like the other two: "⌄ 🔥 COOKING · n", light in the column's colour. Clicking it folds the prompt cards away (saved as `project.notesCollapsed`, only while folded). A new prompt, a prompt sent back or a prompt dropped in unfolds it (they delete the flag). A search only shows the folded cards while it has terms; the flag stays, so Cooking folds again when the search is emptied. The prompt count moved here from the pill in the column title, which gives long names more room.
- **Empty Cooking text:** an empty prompt list now says "Nothing cooking yet. Click New prompt or Dictate." (1.7 said "No prompts yet. Click New prompt to add one.")
- **New prompt | Dictate:** the bar is split into two equal halves, **(+) New prompt** and **(🎙) Dictate**, instead of a wide button plus a small mic square, because the owner starts about half their prompts by voice. A draft shows as **Draft** with an amber dot. Narrow columns read **New**.
- **Tests:** features 107 checks (new: equal halves and full labels, the Cooking header and moved count, folding Cooking, a new prompt unfolding it; the stage-name checks now expect Cooked/Served).

## 1.7.0

- **Combined looks grown-up:** the bright violet band, lavender note and violet buttons became a muted slate-navy band (#47526b → #384259), a pale cool-grey block (#e6e9ef) and a near-white note. The owner called the violet "weird" and "girly"; the dark green canvas stays.
- **Quiet empty stages:** an empty Combined (and an empty Final) is now a dashed outline with its label, not a solid block. It fills in while you drag.
- **New prompts go to the bottom** of the prompt list (and a prompt sent back from Combined lands at the bottom too), so a column reads oldest → newest and flows down into Combined. Saving scrolls the new card into view. Existing columns keep their order; **⋯ → Sort prompts oldest first** lines them up (undoable).
- **Fixed-size Combined and Final:** both start at 6 lines with a fade. A slim full-width **Show more / Show less** bar under the text opens them to at most min(56vh, 480px), scrolling inside. A search whose terms all appear in one of these texts opens it the same way, and no further. The opened state is no longer saved, so they always start small (the old `usedExpanded` / `augExpanded` flags stay in the file but aren't read). The Notes lists are capped at 220px and scroll.
- **Friendlier:**
  - A **?** button in the top bar (also `F1`, or `?` when not typing) opens "How Recaller works": the three stages, handy moves and shortcuts (it shows the user's own show/hide key).
  - Settings is split into sections: Appearance, Voice, Shortcuts & behaviour, Your data.
  - The empty prompt list says "No prompts yet. Click New prompt to add one." (replaced in 1.8)
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
  - Search now also marks matches inside the Combined and Final texts, and opens a matching text up to its full length (since 1.7, only as far as Show more opens it).
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

## 1.4.0

- **Highlighting:** four colours (Check again, Important, Idea, Ready) from the card's hover menu, or H.
- **Stage swap:** the middle stage was labelled **Augmented** and a new bottom stage **Used** was added as the final combined text (data `combined`). At first, Augmented showed individual cards, and swiping one left added it to Used.
- **New prompt bar:** a full-width bar under each header, and the header keeps only ⋯. Long names wrap to two lines.
- **Editing while recording:** the textarea stays editable, and dictation follows the user's edits without moving the caret.
- **Stage colours:** new prompts white, Augmented indigo, Used deep green.
- **Copy all** moved into the Used header, and changes to "Copied" instead of showing a floating chip (the chip had overlapped text).
- **Scroll positions** are saved only when the user scrolls, so a clamped restore never overwrites them.

## 1.3.1

- **Ctrl+click fixes:**
  - The Explorer-style anchor (a plain click followed by Ctrl+clicks includes the first note).
  - The selection clears on window blur, Esc anywhere, or a click on empty canvas.
  - Clipboard writes are serialised.

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

## 1.2.0

- **Augmented section** under Used: all Used notes joined into one text with a blank line between them, plus "Copy all". (Its meaning changed in 1.4.0 and 1.5.0.)
- **Deep theme,** the new default: a dark forest canvas, solid colour headers and a dark top bar matched to the Windows title bar. Soft theme remains optional.
- **Ctrl+click multi-copy** with numbered badges and a selection bar ("Move to Used", "Clear").
- **Palette** changed to spread-out hues: emerald, sky, sun, orchid, lime, blossom, teal, bark.

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
