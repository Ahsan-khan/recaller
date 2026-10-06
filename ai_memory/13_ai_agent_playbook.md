# 13: Playbook for AI agents continuing this project

## Session start (about 5 minutes)

1. Read `README.md`, then `03_data_model.md`, then `04_features_and_flows.md` in this folder. Skim `09` for open issues and `10` for how the owner phrases things. Before any Mac work, also read `14_macos.md`. **Check which machine you're on:** the environment names the platform (`win32` is the Windows PC, `darwin` the Mac). Paths, shells, keys and test counts differ, and the Mac has extra checks (below).
2. **Installed version:**
   - On the PC: from the repo root, `node -e "const a=require('@electron/asar');console.log(JSON.parse(a.extractFile(process.env.LOCALAPPDATA+'/Programs/recaller/resources/app.asar','package.json')).version)"` (writes nothing; `npx @electron/asar` failed in the fourth session, see `07` #55). In the fifth session 1.15.0 was installed and 1.16.0 was built but not installed; whether the owner installed 1.16.0 later is unknown. The owner installs new versions themselves.
   - On the Mac: `plutil -extract CFBundleShortVersionString raw /Applications/Recaller.app/Contents/Info.plist` (an error means it isn't installed). The PC one-liner doesn't work there: `LOCALAPPDATA` is unset, so it reads `undefined/Programs/…`. At the very end of the seventh session (about 20:43 on 2026-09-29) the owner copied the packaged 1.16.0 into `/Applications`, then opened the copy inside the mounted dmg. That dmg copy was still the running one when the session ended; the advice was to quit it, eject the disk and open Recaller from Applications.
3. **Git state:** `git -C <repo> status -sb`, `git log --oneline -5` and `git stash list`, where `<repo>` is `C:\Users\User\Documents\recaller` on the PC and `/Users/ahsan/Documents/GitHub/recaller` on the Mac. As of the seventh session (2026-09-29):
   - `v1` = `664212a` "1.16": the owner commits each version there ("1.8" … "1.16");
   - `main` = `dd5a3b0`, the merge of PR #1 from `v1`, so it holds 1.16.0 (the old "main has 1.5.0" was wrong);
   - `masos` = `origin/masos` = `33f62ed` "done" (as of 2026-10-01): the Mac edition, which the owner committed and pushed as "mac build" (`16961eb` + `9536853`), then "fix" (`f86cf19`, which took Finder's `.DS_Store` out of git and into `.gitignore`) and "done" (`33f62ed`, the seventh session's last doc updates). It isn't merged into `main`;
   - on top of `33f62ed`, the eighth session's 1.17.0 (accounts and sync) is **uncommitted** in the working tree: `git status` lists `src/cloud/`, `src/sync/`, `infra/`, `tests/unit/` and the rest as new, and about a dozen files as modified. Leave the commit to the owner, and check whether they committed it since;
   - `stash@{0}` is the discarded 1.17.0 Mac attempt (not the accounts work): leave it alone unless the owner asks.
   - Don't commit or push unless asked (details in `06`, "Git status").
4. **Tests:** `npm install` if needed, then `npm test`. Run it in the background and grep the log.
   - On the PC: expect 12 + 21 + 134 passing (about 5 minutes) on `main` and `v1`. With 1.17 on `masos`, `npm test` first runs the unit tests (714), then 12 + 21 + 134, the same three again with accounts on (`test:accounts-on`), and ends with the sync suite (43). Never run on the PC yet.
   - On the Mac, on `masos` (where `tests/e2e/mac-harness.js` exists): expect 12 + 21 + 139, with one `SKIP` line (the real snip) and one `INFO` line; with 1.17, the unit tests first (714), then the three suites, the same three again with accounts on (`test:accounts-on`), and 43 sync checks last. Never run the suites on a Mac from a branch without `mac-harness.js` (`main`, `v1`): those are Windows-only and would, among other things, snip the real screen.
   - The sync tests use only the local mock: none of them reaches Google or the keychain.
5. **Cloud state (1.17), read-only:**
   - `~/google-cloud-sdk/bin/gcloud config list` shows the owner's account and project `recaller-cloud` (gcloud and Terraform are off the PATH on the Mac; `infra/README.md`, "Before you start"). `gcloud auth application-default print-access-token >/dev/null && echo ADC ok` checks the login without printing the token.
   - `ls infra/terraform/prod/*.tfplan`: as of 2026-10-01 it lists `prod.tfplan`, the next plan saved for the owner (`infra/README.md`, "The next plan"). Once the owner has applied it and deleted it with `imports.tf`, it should list nothing. A saved plan holds the API key and the password-hash parameters in clear text (`07` #89): never print it; tell the owner, who applies or deletes it.
   - The live deploy happened on 2026-10-01 (`15`, status); that isn't in git, so read `15`'s status or ask whether the next plan was applied since. Before that apply, a masked plan shows the next plan's changes (`1 to import, 2 to add, 2 to change, 2 to destroy`); after it, and with `imports.tf` deleted, a plan must say "No changes". Run a plan only with the owner's OK, always through the mask in `infra/README.md`.
   - **Never print a key or a token:** not `src/cloud/project.json` or `infra/gcp/project.json`, not `terraform output -json` (only redirected into that file), not `terraform show` or `state show`, not a `print-access-token`, not an Identity Platform config. The safety classifier blocks most of these anyway (`07` #87).
   - A single failure that passes on re-run is usually timing, or the owner's mouse or clipboard (see `06`).
6. **Ask first about the last change.**
   - 1.17.0, accounts and sync: built and tested, the 1.17.0 packages made, and live on Google Cloud since 2026-10-01; not committed or released. Ask whether the owner applied the next plan and ran `rules:smoke` (45 of 45 expected), whether they did the email steps (the name "Recaller", the sending domain), and whether they committed the work (`09`, "Accounts and sync (1.17.0): what's still open").
   - The owner copied the Mac edition to `/Applications`, then opened the copy inside the mounted dmg, while the seventh session's docs were being written. Nothing about that first run is recorded. Check which copy is running (`ps -axo command | grep Recaller.app`). Ask how the first install went (the dmg, Open Anyway if the copy was downloaded, the microphone, Screen Recording and keychain prompts) and how it feels: the traffic lights and logo, the ⌘ shortcuts and ⌘-click, Control-click to edit, the ⌃⌥R hotkey, the red button hiding the window. Also ask whether they want `masos` merged into `main` (see `09`).
   - The owner hadn't seen 1.16.0 when the fifth session ended: the board now sits in a rounded frame with a slim emerald edge (the "border to organize everything" they asked for), and the ‹ › board arrows appear only when the pointer nears their edge. Ask whether they installed it on the PC, whether the frame looks right and whether the arrows behave as they wanted (`09` question 13). Still unanswered from earlier: whether the 1.15 trash in Cooked's Notes rows is the delete they meant (question 11), and whether the 1.14 picture tiles work where they paste (question 12).

### On the Mac: extra session-start checks

1. `xcode-select -p` prints `/Library/Developer/CommandLineTools`. Apple's `git` needs the Command Line Tools; if this fails, tell the owner rather than installing anything.
2. `which node npm git` gives `/usr/local/bin/node`, `/usr/local/bin/npm` and `/usr/bin/git` (Node 24.21.0, npm 11.19.0, git 2.50.1). There is no Homebrew, `gh` or PowerShell.
3. `git status -sb` starts with `## masos...origin/masos`: the Mac edition lives on the owner's branch `masos` (their spelling; keep it). The owner committed and pushed it on 2026-09-29: two "mac build" commits, `16961eb` and `9536853`, then "fix", `f86cf19`, which took Finder's `.DS_Store` out of git (the file stays on disk) and added it to `.gitignore`, then "done", `33f62ed` (22:04), the seventh session's last doc updates. On 2026-10-01 `masos` = `origin/masos` = `33f62ed`, with the eighth session's 1.17.0 uncommitted on top (new: `src/cloud/`, `src/sync/`, `src/renderer/account.js`, `sync-apply.js`, `infra/`, `scripts/cloud-config.js`, `tests/unit/`, `tests/mock-gcp/`, `tests/rules/`, `tests/support/`, `tests/e2e/sync.e2e.js`, `ai_memory/15_accounts_and_sync.md`; modified: about a dozen files). Leave them for the owner. `[ahead 1]` after `origin/masos` means a commit the owner hasn't pushed yet. `.DS_Store`, `project.json`, Terraform state and `*.tfplan` must never show up.
4. Don't fetch, pull or push: the GitHub credentials live in GitHub Desktop, and the owner does that themselves.
5. **Installed app and data:** `plutil -extract CFBundleShortVersionString raw /Applications/Recaller.app/Contents/Info.plist` (try `~/Applications` too). The data folder is `~/Library/Application Support/Recaller`. Both exist since the owner's first run at the end of the seventh session, and the folder holds their real notes. Read only flags and counts from the data, never note text.
6. `echo $ELECTRON_RUN_AS_NODE` prints 1 in the VS Code terminal here too: start Electron only through the npm scripts or `env -u ELECTRON_RUN_AS_NODE`.
7. `ls dist/` shows the accounts-and-sync 1.17.0 builds (`Recaller-1.17.0-arm64.dmg`, `Recaller Setup 1.17.0.exe`, `mac-arm64/`, `win-unpacked/`), the 1.16.0 dmg, and `_discarded-1.17.0/`, which must never be handed out, installed or tested. The discarded dmg has the same name as the current one, so check which folder you're in.
8. **Cloud tools:** `~/google-cloud-sdk/bin/gcloud` (587.0.0) and `~/.local/bin/terraform` (1.16.4), both installed without admin rights and off the PATH. Read-only checks only, as in step 5 above; applies, `auth-settings.sh` and the `rules:*` scripts are the owner's.

## The per-request workflow that worked

1. **Understand.** Messages are often dictated and fragmented (see `10`). Separate them into numbered items. For ambiguous structural requests, choose the most coherent interpretation and state it plainly at the top of your reply, inviting correction. Ask a question first only if a wrong guess would be expensive.
2. **Check constraints:**
   - update safety (`03`);
   - the stage naming trap (`notes` = Cooking, `used` = Cooked, `combined` = Served since 1.8; Combined/Final in 1.6–1.7, Augmented/Used before);
   - design taste (`05`);
   - known issues (`09`);
   - the platform fence: a Mac difference goes behind `IS_MAC` / `body.is-mac`, and the Windows strings and behaviour stay exactly as they are (`07` #65).
3. **Implement** in small, exact edits.
   - For small edits the exact-string edit tool is fine and keeps line endings. For big multi-part edits, write a Python patch script to a file with the file-writing tool (not a heredoc). Have it assert that each old string matches exactly once, keep the file's line endings, then run it. On the PC, `app.js`, `styles.css` and the suites are LF and `index.html` is CRLF in the working tree; on the Mac every file is LF, `index.html` included. Inline heredocs in Git Bash fail with very long scripts ("unexpected EOF") and mangle backslashes and `\'` escapes. `node --check` catches most of the JS damage before anything runs.
   - Run `node --check` on every edited JS file.
4. **Look at it.**
   - `npm run capture`, or the `shot()` screenshots from the suites in `tests/e2e/.out/`, then view the PNGs. On the Mac, `SCALE=2 npm run capture` shows what the Retina screen shows (the suites render at 1×); it was added in the seventh session but not run yet.
   - For wider boards or variants, copy `tests/e2e/capture-board.js` into the scratchpad and change the seed (many columns, hover a card with `sendInputEvent({ type: 'mouseMove' })`, toggle a body class per option). Use the same off-screen `show` override. In the copy, point `SCRATCH` and `APP_MAIN` at env vars (Windows paths via `pwd -W` on the PC; plain `$PWD` paths on the Mac) and run it with `env -u ELECTRON_RUN_AS_NODE npx electron <file>`. Hover things in the first column; near the right edge the › arrow shows up and covers things (`07` #56). A scratch script must be copied into `tests/e2e/.out/` to run, since the scratchpad has no `node_modules` (`07` #60); there its harness import becomes `require('../mac-harness')`, and `quiet()` must still run before `require(APP_MAIN)`. For pure design comparisons, render a standalone HTML page in an offscreen-rendering window (see `07` #46; on the Mac, check that the result isn't blank) and combine crops into one sheet.
   - Fix overlaps, truncation and contrast before moving on.
   - Never open the screenshots from the real screen-snip test, which captures the owner's actual screen.
5. **Test.**
   - Add checks for every new behaviour to `features.e2e.js`; Mac-only behaviour goes inside its `if (IS_MAC)` block.
   - Accounts and sync: unit tests in `tests/unit/` (with the mock and the peer), then `sync.e2e.js`; never the real cloud (`12`, "Work on accounts and sync safely").
   - Run the suites on source.
   - If a check fails, decide whether it is a test bug or an app bug before changing anything, and say which in your reply.
   - You can only run the platform you're on; say which one was tested.
6. **Release** (see the checklists in `06`):
   - bump the version as its own step and confirm it (never chained behind `&&`);
   - since 1.17: `npm run cloud:config` first (the builds stop without `src/cloud/project.json`), after the live deploy (`06`, "1.17.0 additions");
   - update `README.md`, `ai_memory/08_changelog.md` and any other affected `ai_memory` file;
   - on the PC: build and confirm the log names the new version, then run the suites against the packaged `app.asar` (Windows path via `$(pwd -W)`), including `MODE=real`;
   - on the Mac: `npm run dist:mac`, check the build (`06`, "Checking a Mac build"), then run the suites against `dist/mac-arm64/Recaller.app/Contents/Resources/app.asar` (a plain `$PWD` path);
   - delete `tests/e2e/.out/data-real`.
7. **Report to the owner:**
   - Keep it short and friendly.
   - Give one bullet or line per item they asked for: what changed and how to use it.
   - Give the installer path and how it installs:
     - PC: `dist\Recaller Setup X.Y.Z.exe`; it installs over the old version, with notes kept and a backup made.
     - Mac: `dist/Recaller-X.Y.Z-arm64.dmg`; drag Recaller to Applications (quit the running one with ⌘Q first when updating), with notes kept and a backup made. A downloaded copy needs Open Anyway once.
   - Embed one or two screenshot paths.
   - Be honest about anything untested for real (for example, real OpenAI and microphone use; on the Mac, real key presses, the permission and keychain prompts, and the first install).
   - Name any interpretation you want them to confirm.

## Tool and environment tips

### On the Windows PC

- **Shells:** the Bash tool is Git Bash (POSIX), and a PowerShell tool also exists. Use forward slashes in Bash.
- **Launching Electron:** always through the npm scripts or `env -u ELECTRON_RUN_AS_NODE`.
- **Test output:** redirect long test output to a log file and grep it for `PASS|FAIL|passed|HARNESS`. Piping straight into `grep` or `tail` sometimes cut runs short. Long runs go in the background; a Monitor with an `until` loop on the log reports each suite's "n/n passed" line.
- **If a test window ever shows an "App threw an error" dialog:** stop the run and kill only `node_modules\electron\dist\electron.exe` processes (PowerShell `Get-Process electron | Where-Object Path -eq …`), never the installed `Recaller.exe`.
- **The owner is often using the installed Recaller while you work.** Their data file may change during your test runs; that is not your bug. The single-instance lock is per data folder, so tests with their own `RECALLER_DATA_DIR` run alongside the installed app without conflict.
- **Owner's screen:** single 5120×1392 at 100% scale. Test windows keep a 200px or 60px strip at the far edge, away from the cursor, and are shown without focus (only the real snip step calls `focus()`).

### On the Mac (seventh session)

- **Shell:** the Bash tool runs zsh 5.9. Use POSIX paths and `$PWD`; `pwd -W` doesn't exist ("bad option: -W"). Env vars go inline (`APP_MAIN=… npm test`). The zsh quirks are in `07` #82; put `node -e` one-liners in single quotes.
- **Launching Electron:** as on the PC, only through the npm scripts or `env -u ELECTRON_RUN_AS_NODE`.
- **The tests are Mac-safe now** (on `masos`). `mac-harness.js` keeps every test window 2px past the screen edge, away from the cursor, with no Dock icon, no focus, no real mouse, no native menus, no System Settings or Finder, no microphone and no screen recording. They still overwrite the clipboard. The owner said "Yes, run them" in the seventh session.
- **Test output:** as on the PC, but grep for `PASS|FAIL|SKIP|INFO|passed|HARNESS`.
- **Killing a stuck test Electron:** by its full path only: list with `pgrep -fl "$PWD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"`, then `pkill -f` with the same path. Never by name (`pkill Electron`, `killall Electron`), and never `/Applications/Recaller.app` (`07` #83).
- **Never trigger TCC**, macOS's privacy prompts (Microphone, Screen Recording, Camera, Accessibility, Automation), and never a keychain prompt: no real snip or `desktopCapturer` call, no real microphone, no `screencapture` or `osascript`, no `npm start` on the real data folder, and never open the packaged app. The prompts land on the owner's screen, and macOS remembers the answers. The suites avoid all of this (a fake microphone, a skipped snip, and plain test keys that never reach the keychain).
- **Owner's screen:** one Retina display, 3024×1964 px at 2× (1512×982pt). The suites render at 1×, so judge the Mac look with `SCALE=2 npm run capture`.
- **Crash reports:** if the owner reports a crash, look in `~/Library/Logs/DiagnosticReports/` first; each file is named after the program that crashed (`07` #84).
- **Recaller is installed on the Mac** (since the end of the seventh session), so the PC's rule applies: the owner may be using it while you test, and the single-instance lock is per data folder.

### Both machines

- **Viewing screenshots:** the file-reading tool can show PNG screenshots, which is how visuals were checked.
- **Privacy:**
  - Never print the owner's note text or API key.
  - 1.17: never print the cloud config (`src/cloud/project.json`, `infra/gcp/project.json`), a sign-in token (`sync/account.json`), an access token, Terraform state, a saved plan or `terraform output`. Billing details stay as `infra/README.md` shows them.
  - The real-data test prints counts only.
  - Delete any copies of their data after testing.
- **Outward-facing actions need permission.** Don't make paid API calls with the owner's key, run the installer on their system, open the packaged Mac app, or commit or push without asking. They install new versions themselves. On the Mac, don't fetch, pull or push at all. Since 1.17 the same goes for Google Cloud: no `terraform apply` (or plan without the mask), no `gcloud` change, no `auth-settings.sh`, `rules:test`, `rules:smoke` or `purge-unverified.js`, and no run against the real project (`RECALLER_GCP_REAL=1`) unless the owner asks and is present.
- **The owner's two screens:** the PC's 5120×1392 ultrawide at 100%, and the Mac's Retina screen at 2×. A look judged on one should be checked on the other when it matters (edges and rings read stronger at 2×, `07` #81).

## How the owner likes to be answered

- They want working results, not questions. They correct misreadings directly and without fuss.
- They respond well to visual proof (screenshots) and clear "how to use it" steps.
- On taste (fonts, colours), after two rejected attempts, show the options side by side and add a picker. Cooked's colour was rejected three times (violet, slate, brown). They swear when frustrated ("it literally looks like shit"); answer the actual question ("why brown?") honestly and briefly, own the mistake, fix it properly, and don't over-apologise.
- They often paste dictated text as the whole message; treat it as their request.
- Sessions often have the shape "read ai_memory, build X, update the files, goodbye" (fourth, fifth and seventh sessions). Then there's no one to answer questions: pick the most coherent reading, build it with a sensible companion (e.g. the same control on Served), test and release it, record the interpretation as an open question in `09`, and bring every affected file here up to date before ending.
- **Two machines:** the Windows PC (their main install) and a MacBook (since the sixth session). Say which machine each step is for. On the Mac, use Mac words: ⌘K, ⌘-click, Control-click (a right-click), ⌃⌥R, ⌘Q, `~/Library/Application Support/Recaller`, System Settings › Privacy & Security.
- **Big new directions:** a few short multiple-choice questions before building worked well in the seventh session: reuse the discarded attempt ("Start from scratch"), who downloads it ("Just me for now"), and whether the tests may run on their Mac ("Yes, run them").
- **Long runs:** they ask "show me progress" and "whats happening now" while background work runs; post a short status line as you go.
- **Problems you didn't cause:** when they said "the app window kept crashing when you opened it", nothing from the session had launched. Check what actually ran, tell them plainly, and stop running work as a precaution (`07` #84).
- Their visual taste in one line: dark green canvas, calm and light UI furniture, clear distinct stages, one obvious main action, no brown/violet/pink, nothing bright or heavy, nothing overlapping, helpers that show only when needed (1.16 arrows), a framed board with a crisp, slim edge (1.16), crisp slim edges rather than blurry ones.
- They care most about speed of reuse (copying), the stage workflow, and never losing data.

## Glossary

- **Board:** the horizontally scrolling area holding the columns.
- **Board frame / stage:** the rounded, emerald-edged panel (`.stage`) holding the board, inset in the dark shell (1.16).
- **Board arrows / pan buttons:** the round ‹ › buttons at the board's left and right edges (`#pan-left` / `#pan-right`); since 1.16 they appear only when the pointer is near that edge.
- **Column / project:** one project, holding the three stages.
- **Card / prompt / note:** one item in the top stage.
- **Stage:** one of the three sections of a column: **Cooking** (data `notes`, the prompt cards), **Cooked** (data `used`, one combined note; "Combined" in 1.6–1.7, "Augmented" before), **Served** (data `combined`, the final text; "Final" in 1.6–1.7, "Used" before).
- **Part:** one of the notes inside Cooked or Served, listed under **Notes**; it can be reordered, edited alone, sent back or deleted (1.15).
- **Stage editor:** the composer opened by a Cooked/Served pencil (whole text) or a part's ✎ (that part only).
- **Column width / resize handle:** the draggable right edge of a column; widths live in `prefs.colWidths`, and the top-bar ↔ button resets them.
- **Combined text:** notes joined with the separator (`joiner()`: blank line or new line). Both the Cooked note and the Served text are combined texts (`augmentedText()` / `finalText()`).
- **Composer:** the inline text editor used for new prompts and edits; it holds voice, screenshot, paste and drop.
- **Draft:** unsaved composer text and images, kept per project.
- **Anchor:** the note plain-clicked just before a Ctrl+click selection (⌘-click on a Mac); it becomes item 1.
- **Selection:** the notes picked with Ctrl+click (⌘-click on a Mac), in click order; the clipboard always holds all of them.
- **Checkpoint:** a saved undo snapshot, taken just before a change.
- **Snip:** a region screenshot taken through the overlay window, saved as `<id>.png` plus a `<id>.t.png` thumbnail in the data folder's `images/`. On a Mac it needs the Screen Recording permission.
- **Phrase / segment:** a piece of dictation between pauses, transcribed on its own.
- **Deep / Soft:** the two colour themes (Deep is the default).
- **Density:** column width preset (Compact, Slim, Roomy).
- **Upgrade backup:** the automatic copy made before a new version first runs.
- **Mac edition:** the macOS build of 1.16.0 made in the seventh session on branch `masos`: the same app with Mac habits (⌘ keys, traffic lights, a menu bar, hide on close, the keychain), shipped as `Recaller-1.16.0-arm64.dmg` beside the Windows `Recaller Setup 1.16.0.exe`.
- **masos:** the git branch for the Mac edition, the owner's own spelling (keep it). They made it from `main` on 2026-09-29 and committed and pushed the Mac edition there that evening: "mac build" (`16961eb` + `9536853`), then "fix" (`f86cf19`), which took `.DS_Store` out of git, then "done" (`33f62ed`, docs). 1.17.0 (accounts and sync, both platforms) is built on it. It isn't merged into `main`; that's the owner's call, by a pull request once the suites have run on the PC.
- **IS_MAC:** the switch in front of every Mac difference: `process.platform === 'darwin'` in `main.js`, `screenshot.js` and `mac-harness.js`, and `api.platform === 'darwin'` in `app.js` (`MAC` in `voice.js`). On Windows everything behind it is skipped.
- **is-mac / is-fullscreen:** `<body>` classes. `app.js` adds `is-mac` at startup on a Mac only, together with the `data-mac` / `data-mac-title` swaps (the Mac text and tooltips in `index.html`), so every `body.is-mac` CSS rule leaves Windows alone. `is-fullscreen` follows the `fullscreen-on` / `-off` commands and gives the traffic lights' space back to the top bar.
- **kb():** the renderer helper that writes a Windows key label the Mac way: `kb('Ctrl+Shift+S')` → ⇧⌘S, `kb('Ctrl+Enter')` → ⌘↩, `kb('Ctrl+Y')` → ⇧⌘Z. On Windows it returns its input unchanged. Its siblings `modKey(e)` (the shortcut key: ⌘ without ⌃ on a Mac) and `multiKey(e)` (⌘ on a Mac) replace `e.ctrlKey || e.metaKey`.
- **mac-harness:** `tests/e2e/mac-harness.js`, with `IS_MAC`, `MOD`, `MOD_KEY`, `macRect()`, `quiet()` and `macState`. It keeps test runs out of the owner's way on a Mac and does nothing on Windows (see `06`).
- **Traffic lights:** the Mac window's red, yellow and green buttons, at (16, 16) in the 48px top bar; the logo starts at x 84. The red one hides the window rather than quitting.
- **TCC:** macOS's privacy permissions (Microphone, Screen Recording and others): the prompts and the switches in System Settings › Privacy & Security. Never trigger them from a test or a script.
- **Ad-hoc signature:** a code signature with no developer identity (`identity: "-"`). Apple Silicon runs it; Gatekeeper rejects a downloaded copy until Open Anyway; it changes with every build.
- **Account (1.17):** optional email-and-password sign-in on Firebase Authentication with Identity Platform, project `recaller-cloud`. Settings › Account & sync.
- **Head:** the account's document `users/{uid}`. Its `rev` goes up by exactly one with every board commit; `commits.<deviceId>` names each computer's last landed commit.
- **Shadow:** `sync/shadow.json`, the board as last synced on this computer; the base of every three-way merge.
- **Patch:** a change from the cloud, sent by main to the page (`sync:patch`); it counts only once the page's acknowledging save is on disk. A `stale` patch is merged again against the newer file.
- **Union / restore mode:** a merge in which nothing missing locally counts as deleted (after a restore, a `.bak`, an unreadable file, a downgrade). Resurrect rather than lose.
- **Tombstone / trash:** a deleted item keeps a minimal cloud document (`_sync.deleted`); a full copy goes to `trash/` for 30 days.
- **Conflict copy / "Other version":** this computer's version of a text both computers changed, placed right after the original, marked Check again and carrying `syncConflict`.
- **Device record:** `users/{uid}/devices/{deviceId}`, a backup of one computer's view, drafts and allow-listed settings, never applied to another computer.
- **Quarantine:** items (or pictures) the cloud refused or that are too large; they stay on this computer and the status line says so.
- **The mock / the peer:** `tests/mock-gcp/` (Google's services on 127.0.0.1, with a twin of the rules) and `tests/support/peer.js` (a headless second computer).
