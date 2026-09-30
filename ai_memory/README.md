# Recaller: project memory (start here)

This folder is the complete handoff for **Recaller**. It lets any person, AI agent or LLM continue development without the original conversation. Everything here is plain text, and every user flow is described in words.

Status as of **2026-09-29**, seventh session (on the owner's Mac):
- **Windows 1.16.0 is committed and merged.**
  - It is committed on `v1` as "1.16" (`664212a`), together with the fifth session's `ai_memory`, and merged into `main` (`dd5a3b0`, PR #1).
  - Its installer (`dist\Recaller Setup 1.16.0.exe`) was built and tested on the PC in the fifth session.
  - The PC had 1.15.0 installed then. Whether 1.16.0 has been installed since isn't recorded.
- **The Mac edition of 1.16.0 was built and verified** on branch `masos` in this session. It is **uncommitted** there.
  - The build is `dist/Recaller-1.16.0-arm64.dmg`, ad-hoc signed and not notarized.
  - The session itself never opened the packaged app.
  - **Late update:** from about 20:43 on 2026-09-29, while this handoff was being written, the owner opened it from the mounted dmg and then copied Recaller.app (1.16.0) into `/Applications`. That first run created `~/Library/Application Support/Recaller`, which now holds their real Mac notes. Nothing about how it went is recorded (Gatekeeper, the permission and keychain prompts, the keys, the look), so ask. Where these files call a Mac behaviour untested or "not tried by a person", read it as "not verified by a session and not reported by the owner yet" (see `14`).
- **Tests:**
  - Windows: 12 + 21 + 134, run on the PC in the fifth session, plus 9 on a copy of the real data.
  - Mac: 12 + 21 + 139, from source and against the packaged app's `app.asar` (loaded in the development Electron). The 3 real screen-snip checks are skipped there, and 8 Mac checks are added.
- **Discarded:** the sixth session's 1.17.0 Mac attempt. It is kept as `stash@{0}` and was not used.
- **Releases:** the owner installs, commits and pushes new versions themselves.

## What Recaller is

Recaller is a desktop app for Windows and macOS (Electron 44, vanilla JavaScript, no bundler) for storing reusable AI prompts and notes. The Mac edition is the same app with Mac keys and habits: ⌘ instead of Ctrl, a menu bar, and a window that hides when closed (see `14`).

- **Columns:** each project is a column on one horizontally scrolling board, and prompts are cards inside it.
- **Copying:** click a card to copy it, or Ctrl+click several (⌘-click on a Mac) to copy them all at once.
- **Input:** you can dictate prompts with OpenAI speech-to-text (text streams in as you speak) and attach screenshots.
- **Stages:** every column has three stages, top to bottom (kitchen names since 1.8):
  1. **Cooking**: new prompts, individual cards, added with **New prompt** or **Dictate** (equal halves of one bar).
  2. **Cooked** (Combined in 1.6–1.7, Augmented before): the prompts moved down, joined automatically into one note.
  3. **Served** (Final in 1.6–1.7, Used before): the final text. Moving the Cooked note down adds its text to the end of Served.
- **Visual style:** a deep forest-green "monstera" nature theme with a slim, dense, calm layout. The board sits in a rounded frame with a slim emerald edge, inset in a dark shell the colour of the top bar (1.16). Inside: every column the same light surface under its own coloured header, white prompt cards, a light blue Cooked section (colour pickable) and a light sage Served section. Columns can be resized by dragging their edge; a top-bar button resets them. A top-bar **?** opens a one-page guide.
- **Everyday use in one breath:** type or dictate a prompt (New prompt | Dictate), click a card to copy it, hover it and click **↓ Cooked** to gather it, move the Cooked note to Served, click Served to copy the finished text, and right-click anything to edit it (Control-click works too on a Mac). Swipe a card left to delete it; inside Cooked or Served, open **Notes** and use a row's trash.

## Reading order

| File | What it contains |
| --- | --- |
| `01_product_and_user.md` | Who the user is and how they communicate. Every request they made, in order, and what was built. Their taste, preferences and rejections |
| `02_architecture.md` | Processes, every source file and its job, the full IPC contract, the security model, the renderer design, and the startup and shutdown sequences |
| `03_data_model.md` | Every field on disk, the stage naming trap, settings, images, backups, and the rules that keep updates from changing user data |
| `04_features_and_flows.md` | Every feature as a step-by-step text flow: copy, multi-copy, swipe, drag, stages, voice, screenshots, undo, search, settings, backups, and all keyboard shortcuts |
| `05_design_system.md` | Colours, themes, fonts, sizes, stage colours, palettes and design rules learned from user feedback |
| `06_build_test_release.md` | How to run, build, test and release. What the end-to-end suites check and how they work |
| `07_gotchas_and_lessons.md` | Every pitfall hit so far: symptom, cause and fix |
| `08_changelog.md` | Versions 1.0.0 to 1.16.0 (with the 1.16.0 Mac edition and the discarded 1.17.0) and what changed in each |
| `09_backlog_and_open_questions.md` | The roadmap for making Recaller usable by everyone, known issues, untested areas, ideas the user may want, technical debt and suggested next steps |
| `10_user_messages_verbatim.md` | Every message the owner sent, word for word, with notes on how each was interpreted |
| `11_decision_log.md` | Why each major choice was made (Electron, vanilla JS, voice design, undo, storage, fonts, …) and when to revisit it |
| `12_dev_recipes.md` | Step-by-step recipes for common changes: settings, card actions, stage actions, data fields, undo, IPC, shortcuts, colours, fonts, voice, tests |
| `13_ai_agent_playbook.md` | For AI agents: the session-start checklist, the per-request workflow that worked, tool and environment tips, how the owner likes answers, and a glossary |
| `14_macos.md` | The macOS edition: the one-codebase rule, everything that differs on a Mac and how each difference works in code, building and installing the dmg, Mac-safe testing, Mac gotchas, moving notes between the PC and the Mac, and what is still open |

AI agents should read `13` first, then continue with the order above. Read `14` before any Mac work.

## Golden rules (read before changing anything)

1. **Updates must leave user data exactly the same.** The user explicitly required this.
   - Never rewrite the data file on startup.
   - Never drop fields you don't recognise.
   - Never "migrate" a user's choices, such as colours or density.
   - Run the update-safety suite before shipping (see `03` and `06`).
2. **The data names and screen names of the stages differ.** Data `notes` is the stage the UI calls **Cooking**, `used` is **Cooked**, and `combined` is **Served**. The UI names have changed three times (see `03`); the data names never do. Do not rename the data fields; existing users' files depend on them.
3. **The data folder is pinned** in `src/main.js` to `path.join(app.getPath('appData'), 'Recaller')`.
   - That is `%APPDATA%\Recaller` on Windows and `~/Library/Application Support/Recaller` on a Mac.
   - Never change `productName`, `appId` or that path.
   - `npm start` without `RECALLER_DATA_DIR` opens that real folder, on either computer.
4. **Launching Electron:** the owner's VS Code terminal sets `ELECTRON_RUN_AS_NODE=1`, on the PC and on the Mac, and that makes Electron start as plain Node. Use the `npm` scripts, which already handle it, or prefix direct commands with `env -u ELECTRON_RUN_AS_NODE`.
5. **Don't bother the user while testing.**
   - **Where test windows go:** they open without focus (`showInactive`), as a thin sliver past the far edge of the screen, away from the pointer. The sliver is 200 px (features, update-safety) or 60 px (multi-copy, capture-board) on the PC, and 2 px on a Mac. Never put a test window over the owner's work.
   - **Focus:** on the PC, the features suite's real screen snip is the one step that takes focus: it focuses its overlay, then Recaller. On a Mac that snip is skipped, and `tests/e2e/mac-harness.js` hides the Dock icon and stops the test app from taking focus (see `14`).
   - **The clipboard:** the suites overwrite it.
   - **Syntax first:** run `node --check` on any test file before launching it, because a syntax error pops up an Electron error dialog on their screen.
6. **Design taste is settled** (details and history in `01` and `05`):
   - deep green theme by default;
   - slim columns (resizable, with a reset back to the default);
   - clearly different colours for neighbouring columns and for each stage;
   - bold, readable headings (Instrument Sans by default since 1.6);
   - calm and uniform per-column furniture; colour lives in the headers;
   - stages are **light sections**: Cooked in a clean blue (Ocean by default, pickable), Served in pale sage;
   - **for Cooked and the other stages: never brown, never violet/pink, no heavy dark header bands.** All three were rejected for Cooked. This doesn't cover the 18 column colours, which include violet, pink and stone ones. User data stores their ids, so never remove or rename one (rule 1);
   - new prompts at the bottom; stage texts start at a fixed size; one filled main action per card (↓ Cooked);
   - no overlapping UI;
   - no text shadows on titles;
   - helpers that aren't needed right now stay out of sight (the ‹ › board arrows appear only when the pointer nears their edge, 1.16);
   - the board is framed: a rounded panel with a slim, sleek emerald edge (1.16). Keep the frame's edge slim; it's there to organise, not to shout.
   - When the owner rejects a look twice, show options side by side and add a picker instead of guessing again.
7. **Commits:** don't commit or push unless the owner asks. The owner commits each version themselves (see `06`). On the Mac the git credentials live in GitHub Desktop, and the owner fetches, pulls and pushes themselves.
8. **The Mac edition is fenced; Windows stays identical** (see `14`).
   - Gate every Mac difference:
     - `IS_MAC` in JavaScript;
     - `body.is-mac` in CSS;
     - `data-mac` / `data-mac-title` in HTML;
     - the `mac` / `dmg` sections of the build.
   - On Windows every line must behave exactly as before: the same strings, handlers and timing, and the same files written. Helpers such as `kb()` return their input unchanged there.
   - On a Mac, never run the real screen snip: it asks for Screen Recording and captures the owner's screen.
   - Don't run `MODE=real` on a Mac without the owner's OK either: since their first run (late on 2026-09-29) the Mac data folder holds their real notes.

## Where things are

- **Two computers:**
  - a Windows 11 PC with a 5120×1392 ultrawide at 100%;
  - a MacBook Pro (Apple M5 Pro, arm64, macOS 26.5.1) with one Retina screen at 2× (1512×982 points).
- **Project root:** each computer has a clone of https://github.com/Ahsan-khan/recaller (remote `origin`).
  - PC: `C:\Users\User\Documents\recaller\` (moved out of `Documents\iresine\recaller` on 2026-09-24).
  - Mac: `/Users/ahsan/Documents/GitHub/recaller`.
- **Branches:**
  - `main` holds 1.16.0, through the PR #1 merge of `v1` (`dd5a3b0`, 2026-09-29). Its tree is identical to `664212a`. Before that merge it was `296fd32` "initial commits" (1.6.0), whose parent `3876950` is 1.5.0.
  - `v1` is the Windows working branch. The owner commits each version there with a short message and pushes: "1.8", "1.9", … "1.12" = `290c74d`, "1.13" = `0f7ceea`, "1.14" = `8776a32`, "1.15" = `7f101e6`, "1.16" = `664212a`.
  - `masos` is the Mac edition. The owner created it from `main` (`dd5a3b0`) on 2026-09-29 and published it. The Mac work is uncommitted in its working tree, including three new untracked files: `build/icon-mac.png`, `tests/e2e/mac-harness.js` and `ai_memory/14_macos.md`. Finder's untracked `.DS_Store` in the repo root should not be committed.
  - `stash@{0}` ("On v1: Discarded changes since 1.16 push (1.17.0 macOS work) — 2026-09-29") is the sixth session's discarded Mac attempt. The Mac edition was built without it: the build never read, applied or popped it. Leave it alone unless the owner asks.
- **Source:** `src/`.
- **Tests:** `tests/e2e/`. Run them with `npm test`; on a Mac, read `14` first.
- **Build output** (`dist/`, git-ignored):
  - PC: `dist\Recaller Setup <version>.exe`, from `npm run dist`.
  - Mac: `dist/Recaller-1.16.0-arm64.dmg` and `dist/mac-arm64/Recaller.app`, from `npm run dist:mac`.
  - The Mac clone's `dist/` has no Windows installer. `npm run dist:win` builds one there, with x64 pinned.
  - `dist/_discarded-1.17.0/` on the Mac holds the discarded 1.17.0 builds (exe, dmg, `win-unpacked/`, `mac-arm64/`), moved aside and kept. Never hand them out, install them or test against them.
- **Installed app:**
  - PC: `%LOCALAPPDATA%\Programs\recaller\`. It had 1.15.0 at the end of the fifth session; unknown since.
  - Mac: `/Applications/Recaller.app`: 1.16.0, copied there by the owner late on 2026-09-29.
- **User data:** the notes file, the settings file, `images/` and `backups/`.
  - PC: `%APPDATA%\Recaller\`.
  - Mac: `~/Library/Application Support/Recaller/`, created by the owner's first run late on 2026-09-29.
- **User-facing docs:** `README.md` in the project root.
- **Earlier Claude Code notes:** Claude Code kept short notes about this project and the user's taste. This folder is the full version of those notes.
  - PC: `C:\Users\User\.claude\projects\c--Users-User-Documents-iresine\memory\` (files `recaller-app.md`, `ui-taste-dense-distinct.md`) and, since the move, `C:\Users\User\.claude\projects\c--Users-User-Documents-recaller\memory\`.
  - Mac: `~/.claude/projects/-Users-ahsan-Documents-GitHub-recaller/memory/` (`MEMORY.md`, `macos-dev-environment.md`).
- **GitHub CLI:**
  - PC: `gh` isn't on PATH; call `C:\Program Files\GitHub CLI\gh.exe`.
  - Mac: there is no `gh` and no Homebrew. The credentials live in GitHub Desktop; don't fetch, pull or push.
