# Recaller: project memory (start here)

This folder is the complete handoff for **Recaller**. It lets any person, AI agent or LLM continue development without the original conversation. Everything here is plain text, and every user flow is described in words.

Status as of **2026-10-23**, twelfth session (on the PC):
- **PR #5 is merged:** `main` = `origin/main` = `26b3c8f` holds 1.19.1. The PC had 1.18.0 installed at the start.
- **First full test run on the PC since 1.17 (2026-10-23):** `npm test` from source: unit 714/714, multi-copy 12/12, update-safety 21/21, features 166/166, the same three with accounts on (no request), sync 43/43. Then `dist\Recaller Setup 1.19.1.exe` (x64, `npm run dist`, with the cloud config; its 52 app files byte-identical to the source) passed the same against its packaged `app.asar`, plus `MODE=real` 9/9 on a copy of the real notes (deleted afterwards). Handed to the owner to install; not committed (nothing in the code changed) and not released on GitHub.

Status as of **2026-10-21**, eleventh session (on the Mac):
- **1.19.1 is built and tested on branch `v1.19`** (pushed; pull request #5 into `main` waits for the owner to merge, because the session's permission check refused a merge without review). 1.19 redesigns the **Eating strip** (every eating column shows; chips wrap onto more rows, with a leaf badge, the time and a labelled Done; the board keeps exactly the strip's height free) and adds the **widget**: a top-bar button turns the window into a small always-on-top window showing one column, with a column picker (`04` §28, `08`). 1.19.0 also had a Mac zoomed-out column drag; the owner installed it, disliked it, and 1.19.1 is back to the normal drag. The owner's words are `10`, messages 69–75.
- **Tested on the Mac (2026-10-21), 1.19.1:** `npm test` from source: unit 714/714, multi-copy 12/12, update-safety 21/21, features 171/171 (166 on Windows), the same three with accounts on (no request), sync 43/43; the same e2e results against the packaged `dist/Recaller-1.19.1-arm64.dmg` (ad-hoc signed; codesign valid; 52 app files byte-identical to the source). `/Applications/Recaller.app` is 1.19.0 (installed by the owner); 1.19.1 isn't installed yet. No Windows build.
- `main` = `origin/main` = `aac6819`, PR #4's merge of `v1.18` (1.18.0 is committed and merged). `/Applications/Recaller.app` is 1.18.0.

Status as of **2026-10-20**, tenth session (on a freshly set-up Mac):
- **1.18.0 is built and tested, uncommitted, on a new branch `v1.18`** (made from `main` at `e096680` at the owner's request). It adds **Eating** (a Served switch plus a strip at the board's bottom right for prompts an agent is running), a **Claude Code format** for the Cooked note (a fixed template, off by default), **Clear** in the new-text editor, **minimized columns**, named **column groups**, a **+** in the top bar, "New prompt" → **New text**, shorter dictation phrases so text appears while talking, deeper Soft-theme headers, and, after a follow-up, **Done → Eaten** (finished rounds move from Served into an Eaten drawer, organised by day) and a Mac watchdog for a first load that stalls after an update (`04` §27, `08`). The owner installed it on this Mac on 2026-10-21 (the session copied the app into `/Applications`); its first start stayed green until a reload (`07` #101).
- **Built and tested (2026-10-21, on the Mac):** `dist/Recaller-1.18.0-arm64.dmg` (ad-hoc signed; codesign valid) and `dist/Recaller Setup 1.18.0.exe` (x64, by `npm run dist:win`), both with the cloud config; each package's 52 app files are byte-identical to the source. `npm test` passed from source and against the packaged Mac `app.asar` alike: unit 714/714, multi-copy 12/12, update-safety 21/21, features 157/157, the same three with accounts on (no request), sync 43/43. Not run on the PC; not committed, installed or released.
- **This Mac differs from the paths below:** home `/Users/ahsankhan`, repo `/Users/ahsankhan/Documents/GitHub/recaller`; Node 26, gcloud and Terraform from Homebrew (`/opt/homebrew/bin`); no `stash@{0}`; `/Applications/Recaller.app` was 1.17.0 at the start.

Status as of **2026-10-06**, ninth session (on the PC):
- **1.17.0 is committed, released and merged.** The owner committed and pushed it on `masos` on 2026-10-01 ("huge", `4370072`, then the docs, `f724f71`). On 2026-10-06 its Windows installer became the GitHub Release [`v1.17.0`](https://github.com/Ahsan-khan/recaller/releases/tag/v1.17.0) (tag on `f724f71`; its one asset, `Recaller-Setup-1.17.0.exe`, has the same SHA-256 as the PC's `dist/Recaller Setup 1.17.0.exe`), and PR #2 merged `masos` into `main` (`9d30f1f`, whose tree is identical to `f724f71`). The repo is private, so the download needs a GitHub sign-in. The PC has had 1.17.0 installed since 2026-10-01 (about 20:23). No suite has run on the PC yet. The cloud items under "Still open" below weren't rechecked in this session.

Status as of **2026-10-01**, eighth session (on the owner's Mac):
- **1.17.0, accounts and sync, is built, tested and live on Google Cloud, but not committed or released.** Optional email-and-password accounts and local-first sync of the board to Google Cloud (project `recaller-cloud`, us-east1), for Windows and Mac alike, from `masos`. The design, its status and where the code differs from it: `15_accounts_and_sync.md`.
  - **Tested** (the final gates on 2026-10-01, all passing, from source and packaged on the Mac): 702 unit tests in 20 files (`tests/unit/`, plain Node), 216 rules cases passing on Google's real rules engine (`npm run rules:test`, which deploys nothing), and the sync e2e suite 43/43 on the Mac, against a local mock of Google Cloud. The older suites stay at 12 + 21 + 139 on the Mac, and `npm run test:accounts-on` runs them again with accounts on and nobody signed in. Since the storage-overwrite fix (below): 714 unit tests, and all 219 rules cases (185 Firestore, 34 Storage) pass on Google's rules engine.
  - **Live since 2026-10-01:** the owner applied the deploy's plan, ran `auth-settings.sh` and `npm run rules:smoke`. The smoke test passed 43 of 45: the live Storage rules accepted an upload over an existing picture. The fix is in the repo (`15` section 0, item 34).
  - **Still open:** the next plan, saved for the owner (`infra/README.md`, "The next plan": the Storage rules fix, Firebase's auto-created key cut to the sign-in APIs, the budget's new alerts), then `rules:smoke` 45 of 45 and an email-link check; the email steps (the name "Recaller" and a sending domain of our own, `infra/README.md` "Email delivery"); the manual two-computer check; and the first run of any suite on the PC from `masos`.
  - **Git:** `masos` = `origin/masos` = `33f62ed` "done" (the owner's commit of the seventh session's last doc updates, 2026-09-29 22:04). Everything of 1.17.0 is uncommitted on top of it, including this folder's updates and the new `15`.
  - **Infra:** the project is Terraform in `infra/` (`infra/README.md`). The sync additions were applied on 2026-10-01; the next plan (`infra/terraform/prod/prod.tfplan`) waits for the owner.

Earlier status (2026-09-29, seventh session, on the owner's Mac):
- **Windows 1.16.0 is committed and merged.**
  - It is committed on `v1` as "1.16" (`664212a`), together with the fifth session's `ai_memory`, and merged into `main` (`dd5a3b0`, PR #1).
  - Its installer (`dist\Recaller Setup 1.16.0.exe`) was built and tested on the PC in the fifth session.
  - The PC had 1.15.0 installed then. Whether 1.16.0 has been installed since isn't recorded.
- **The Mac edition of 1.16.0 was built and verified** on branch `masos` in this session. The owner **committed and pushed** it there as "mac build" (`16961eb` + `9536853`, 21:45 on 2026-09-29). It is not merged into `main`.
  - The build is `dist/Recaller-1.16.0-arm64.dmg`, ad-hoc signed and not notarized. The pushed app code is byte-identical to the app inside it.
  - **`.DS_Store`:** Finder's file went into the first commit by accident. At the owner's "fix it" it was taken out of git (it stays on disk) and added to `.gitignore`; the owner committed and pushed that as "fix" (`f86cf19`). Details under "Where things are".
  - The session itself never opened the packaged app.
  - **Late update:** at about 20:43 on 2026-09-29, while this handoff was being written, the owner copied Recaller.app (1.16.0) into `/Applications` and, a few seconds later, opened the copy inside the mounted dmg, not the one in Applications. That first run created `~/Library/Application Support/Recaller`, which now holds their real Mac notes. When this session ended, the dmg copy was still the running Recaller and the "Recaller 1.16.0" disk was still mounted; the advice was to quit it with ⌘Q, eject the disk and open Recaller from Applications (`10`, message 41). Nothing else about the run is recorded (Gatekeeper, the permission and keychain prompts, the keys, the look), so ask. Where these files call a Mac behaviour untested or "not tried by a person", read it as "not verified by a session and not reported by the owner yet" (see `14`).
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
| `08_changelog.md` | Versions 1.0.0 to 1.18.0 (with the 1.16.0 Mac edition, the discarded first 1.17.0, the accounts-and-sync 1.17.0, released on 2026-10-06, and 1.18.0 on `v1.18`) and what changed in each |
| `09_backlog_and_open_questions.md` | The roadmap for making Recaller usable by everyone, known issues, untested areas, ideas the user may want, technical debt and suggested next steps |
| `10_user_messages_verbatim.md` | Every message the owner sent, word for word, with notes on how each was interpreted |
| `11_decision_log.md` | Why each major choice was made (Electron, vanilla JS, voice design, undo, storage, fonts, …) and when to revisit it |
| `12_dev_recipes.md` | Step-by-step recipes for common changes: settings, card actions, stage actions, data fields, undo, IPC, shortcuts, colours, fonts, voice, tests |
| `13_ai_agent_playbook.md` | For AI agents: the session-start checklist, the per-request workflow that worked, tool and environment tips, how the owner likes answers, and a glossary |
| `14_macos.md` | The macOS edition: the one-codebase rule, everything that differs on a Mac and how each difference works in code, building and installing the dmg, Mac-safe testing, Mac gotchas, moving notes between the PC and the Mac, and what is still open |
| `15_accounts_and_sync.md` | Accounts and sync (1.17.0): the status, section 0 "As built" (every place the code differs from the spec), then the full design: Google Cloud setup, client modules and IPC, the cloud data model and security rules, the sync algorithm, the UI strings, testing, and the risks and owner's answers |

AI agents should read `13` first, then continue with the order above. Read `14` before any Mac work, and `15` (its status and section 0 first) before any account, sync or `infra/` work.

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
9. **Accounts and sync never reach the real cloud from tests or agents, and never print a secret** (see `15`, `12` "Work on accounts and sync safely", `13`).
   - Tests use the local mock (`tests/mock-gcp/`); runs from source keep the sign-in in memory and never touch the keychain.
   - Terraform applies, `gcloud` changes, `rules:test`, `rules:smoke` and any run with `RECALLER_GCP_REAL=1` are the owner's, done only when they ask and are present.
   - Never print the cloud config (`project.json`), a token, Terraform state, a saved plan or `terraform output`.
   - Signed out, the app must stay exactly 1.16.0: no `sync/` folder, no network, no timers.

## Where things are

- **Two computers:**
  - a Windows 11 PC with a 5120×1392 ultrawide at 100%;
  - a MacBook Pro (Apple M5 Pro, arm64, macOS 26.5.1) with one Retina screen at 2× (1512×982 points).
- **Project root:** each computer has a clone of https://github.com/Ahsan-khan/recaller (remote `origin`).
  - PC: `C:\Users\User\Documents\recaller\` (moved out of `Documents\iresine\recaller` on 2026-09-24).
  - Mac: `/Users/ahsan/Documents/GitHub/recaller`.
- **Branches:**
  - `main` holds 1.17.0 since the PR #2 merge of `masos` (`9d30f1f`, 2026-10-06), whose tree is identical to `f724f71`. Before that it held 1.16.0, through the PR #1 merge of `v1` (`dd5a3b0`, 2026-09-29). Its tree is identical to `664212a`. Before that merge it was `296fd32` "initial commits" (1.6.0), whose parent `3876950` is 1.5.0.
  - `v1` is the Windows working branch. The owner commits each version there with a short message and pushes: "1.8", "1.9", … "1.12" = `290c74d`, "1.13" = `0f7ceea`, "1.14" = `8776a32`, "1.15" = `7f101e6`, "1.16" = `664212a`.
  - `masos` is the Mac edition. The owner created it from `main` (`dd5a3b0`) on 2026-09-29 and published it.
    - **Committed and pushed:** at 21:45 that evening the owner committed the Mac edition there as two commits, both "mac build": `16961eb` (the snapshot they had staged at about 21:13, which also took in Finder's `.DS_Store` by accident) and `9536853` (the fixes made after that staging, mostly docs). Both were pushed: a read-only check (`git ls-remote origin`) found GitHub's `masos` at `9536853`, and `main` and `v1` unchanged there. The pushed app code is byte-identical to the tested dmg (`14`, "Files").
    - **`.DS_Store` cleanup:** at the owner's "fix it", `git rm --cached .DS_Store` took Finder's file out of git (it stays on disk), and `.DS_Store` was added as a new last line of `.gitignore`. The owner committed both as "fix" (`f86cf19`, 21:51) and pushed it. The doc updates that recorded this followed as "done" (`33f62ed`, 22:04, pushed), so `masos` = `origin/masos` = `33f62ed`. 1.17.0 (accounts and sync) is uncommitted on top of it (2026-10-01).
    - **1.17.0 and the merge:** the owner committed 1.17.0 on top as "huge" (`4370072`, 2026-10-01) and the docs as `f724f71`, and pushed both. At their request PR #2 merged `masos` into `main` on 2026-10-06 (`9d30f1f`), before any suite had run on the PC. The tag `v1.17.0` carries the GitHub Release with the Windows installer.
  - `stash@{0}` ("On v1: Discarded changes since 1.16 push (1.17.0 macOS work) — 2026-09-29") is the sixth session's discarded Mac attempt. The Mac edition was built without it: the build never read, applied or popped it. Leave it alone unless the owner asks.
- **Source:** `src/`.
- **Tests:** `tests/e2e/`; since 1.17 also `tests/unit/`, `tests/mock-gcp/`, `tests/rules/` and `tests/support/`. Run them with `npm test`; on a Mac, read `14` first.
- **Build output** (`dist/`, git-ignored):
  - PC: `dist\Recaller Setup <version>.exe`, from `npm run dist`.
  - Mac: `dist/Recaller-<version>-arm64.dmg` (1.16.0 and 1.17.0 are there) and `dist/mac-arm64/Recaller.app`, from `npm run dist:mac`.
  - The Mac clone's `dist/` also holds the 1.17.0 Windows installer and `win-unpacked/`, built there by `npm run dist:win` (x64 pinned).
  - `dist/_discarded-1.17.0/` on the Mac holds the discarded 1.17.0 builds (exe, dmg, `win-unpacked/`, `mac-arm64/`), moved aside and kept. Never hand them out, install them or test against them.
- **Installed app:**
  - PC: `%LOCALAPPDATA%\Programs\recaller\`. It had 1.15.0 at the end of the fifth session; unknown since.
  - Mac: `/Applications/Recaller.app`: 1.16.0, copied there by the owner late on 2026-09-29.
- **User data:** the notes file, the settings file, `images/` and `backups/`; since 1.17, once someone signs in, also `sync/` (see `03`).
  - PC: `%APPDATA%\Recaller\`.
  - Mac: `~/Library/Application Support/Recaller/`, created by the owner's first run late on 2026-09-29.
- **Cloud (1.17):** Google Cloud project `recaller-cloud` (us-east1), described by Terraform in `infra/` with its runbook in `infra/README.md`. On the Mac, gcloud is at `~/google-cloud-sdk/bin/gcloud` and Terraform at `~/.local/bin/terraform`, both off the PATH, using the owner's gcloud login. The Terraform state is in `gs://recaller-cloud-tfstate`. The app's cloud config (`infra/gcp/project.json`, copied to `src/cloud/project.json` by `npm run cloud:config`) holds the API key and is git-ignored.
- **User-facing docs:** `README.md` in the project root (accounts are under "Accounts, sync and privacy").
- **Earlier Claude Code notes:** Claude Code kept short notes about this project and the user's taste. This folder is the full version of those notes.
  - PC: `C:\Users\User\.claude\projects\c--Users-User-Documents-iresine\memory\` (files `recaller-app.md`, `ui-taste-dense-distinct.md`) and, since the move, `C:\Users\User\.claude\projects\c--Users-User-Documents-recaller\memory\`.
  - Mac: `~/.claude/projects/-Users-ahsan-Documents-GitHub-recaller/memory/` (`MEMORY.md`, `macos-dev-environment.md`).
- **GitHub CLI:**
  - PC: `gh` isn't on PATH; call `C:\Program Files\GitHub CLI\gh.exe`.
  - Mac: there is no `gh` and no Homebrew. The credentials live in GitHub Desktop; don't fetch, pull or push.
