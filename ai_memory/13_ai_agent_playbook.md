# 13: Playbook for AI agents continuing this project

## Session start (about 5 minutes)

1. Read `README.md`, then `03_data_model.md`, then `04_features_and_flows.md` in this folder. Skim `09` for open issues and `10` for how the owner phrases things.
2. **Installed version:** from the repo root, `node -e "const a=require('@electron/asar');console.log(JSON.parse(a.extractFile(process.env.LOCALAPPDATA+'/Programs/recaller/resources/app.asar','package.json')).version)"` (writes nothing; `npx @electron/asar` failed in the fourth session, see `07` #55). In the fourth session 1.14.0 was installed and 1.15.0 was built (not yet installed or seen by the owner); the owner installs new versions themselves.
3. **Git state:** `git -C C:\Users\User\Documents\recaller status -sb` and `git log --oneline -5`. The owner commits each version on branch `v1` ("1.8" … "1.14"); `main` has 1.5.0. In the fourth session the 1.15.0 work was uncommitted. Don't commit or push unless asked.
4. **Tests:** `npm install` if needed, then `npm test`. Expect 12 + 21 + 130 passing (about 5 minutes; run it in the background and grep the log). A single failure that passes on re-run is usually timing or the owner's mouse (see `06`).
5. **Ask first about the last change.** The owner hadn't seen 1.15.0 when the session ended: a trash on every row of the Cooked/Served **Notes** list, and a trash in the whole-text editor (right-click the Cooked note). Ask whether that's the delete they meant and whether they found it (`09` questions 11–12). They also never said whether the 1.14 picture tiles (copied separately from the text) work where they paste (`11` #45).

## The per-request workflow that worked

1. **Understand.** Messages are often dictated and fragmented (see `10`). Separate them into numbered items. For ambiguous structural requests, choose the most coherent interpretation and state it plainly at the top of your reply, inviting correction. Ask a question first only if a wrong guess would be expensive.
2. **Check constraints:**
   - update safety (`03`);
   - the stage naming trap (`notes` = Cooking, `used` = Cooked, `combined` = Served since 1.8; Combined/Final in 1.6–1.7, Augmented/Used before);
   - design taste (`05`);
   - known issues (`09`).
3. **Implement** in small, exact edits.
   - For small edits the exact-string edit tool is fine and keeps line endings. For big multi-part edits, write a Python patch script to a file with the file-writing tool (not a heredoc). Have it assert that each old string matches exactly once, keep the file's line endings (app.js, styles.css and the suites are LF; index.html is CRLF), then run it. Inline heredocs in Git Bash fail with very long scripts ("unexpected EOF") and mangle backslashes and `\'` escapes. `node --check` catches most of the JS damage before anything runs.
   - Run `node --check` on every edited JS file.
4. **Look at it.**
   - `npm run capture`, or the `shot()` screenshots from the suites in `tests/e2e/.out/`, then view the PNGs.
   - For wider boards or variants, copy `tests/e2e/capture-board.js` into the scratchpad and change the seed (many columns, hover a card with `sendInputEvent({ type: 'mouseMove' })`, toggle a body class per option). Use the same off-screen `show` override. In the copy, point `SCRATCH` and `APP_MAIN` at env vars (Windows paths via `pwd -W`) and run it with `env -u ELECTRON_RUN_AS_NODE npx electron <file>`. Hover things in the first column; the right edge is covered by the › arrow (`07` #56). For pure design comparisons, render a standalone HTML page in an offscreen-rendering window (see `07` #46) and combine crops into one sheet.
   - Fix overlaps, truncation and contrast before moving on.
   - Never open the screenshots from the real screen-snip test, which captures the owner's actual screen.
5. **Test.**
   - Add checks for every new behaviour to `features.e2e.js`.
   - Run the suites on source.
   - If a check fails, decide whether it is a test bug or an app bug before changing anything, and say which in your reply.
6. **Release** (see the checklist in `06`):
   - bump the version as its own step and confirm it (never chained behind `&&`);
   - update `README.md`, `ai_memory/08_changelog.md` and any other affected `ai_memory` file;
   - build and confirm the log names the new version, then run the suites against the packaged `app.asar` (Windows path via `$(pwd -W)`), including `MODE=real`;
   - delete `tests/e2e/.out/data-real`.
7. **Report to the owner:**
   - Keep it short and friendly.
   - Give one bullet or line per item they asked for: what changed and how to use it.
   - Give the installer path (`dist\Recaller Setup X.Y.Z.exe`) and remind them it installs over the old version with notes kept and a backup made.
   - Embed one or two screenshot paths.
   - Be honest about anything untested for real (for example, real OpenAI and microphone use).
   - Name any interpretation you want them to confirm.

## Tool and environment tips (Claude Code on this Windows machine)

- **Shells:** the Bash tool is Git Bash (POSIX), and a PowerShell tool also exists. Use forward slashes in Bash.
- **Launching Electron:** always through the npm scripts or `env -u ELECTRON_RUN_AS_NODE`.
- **Test output:** redirect long test output to a log file and grep it for `PASS|FAIL|passed|HARNESS`. Piping straight into `grep` or `tail` sometimes cut runs short. Long runs go in the background; a Monitor with an `until` loop on the log reports each suite's "n/n passed" line.
- **If a test window ever shows an "App threw an error" dialog:** stop the run and kill only `node_modules\electron\dist\electron.exe` processes (PowerShell `Get-Process electron | Where-Object Path -eq …`), never the installed `Recaller.exe`.
- **Viewing screenshots:** the file-reading tool can show PNG screenshots, which is how visuals were checked.
- **The owner is often using the installed Recaller while you work.** Their data file may change during your test runs; that is not your bug. The single-instance lock is per data folder, so tests with their own `RECALLER_DATA_DIR` run alongside the installed app without conflict.
- **Privacy:**
  - Never print the owner's note text or API key.
  - The real-data test prints counts only.
  - Delete any copies of their data after testing.
- **Outward-facing actions need permission.** Don't make paid API calls with the owner's key, run the installer on their system, or commit or push without asking. They install new versions themselves.
- **Owner's screen:** single 5120×1392 at 100% scale. Test windows go off-screen at the far edge, away from the cursor, and are never focused.

## How the owner likes to be answered

- They want working results, not questions. They correct misreadings directly and without fuss.
- They respond well to visual proof (screenshots) and clear "how to use it" steps.
- On taste (fonts, colours), after two rejected attempts, show the options side by side and add a picker. Cooked's colour was rejected three times (violet, slate, brown). They swear when frustrated ("it literally looks like shit"); answer the actual question ("why brown?") honestly and briefly, own the mistake, fix it properly, and don't over-apologise.
- They often paste dictated text as the whole message; treat it as their request.
- Sessions often have the shape "read ai_memory, build X, update the files, goodbye" (fourth session). Then there's no one to answer questions: pick the most coherent reading, build it with a sensible companion (e.g. the same control on Served), test and release it, record the interpretation as an open question in `09`, and bring every affected file here up to date before ending.
- Their visual taste in one line: dark green canvas, calm and light UI furniture, clear distinct stages, one obvious main action, no brown/violet/pink, nothing bright or heavy, nothing overlapping.
- They care most about speed of reuse (copying), the stage workflow, and never losing data.

## Glossary

- **Board:** the horizontally scrolling area holding the columns.
- **Column / project:** one project, holding the three stages.
- **Card / prompt / note:** one item in the top stage.
- **Stage:** one of the three sections of a column: **Cooking** (data `notes`, the prompt cards), **Cooked** (data `used`, one combined note; "Combined" in 1.6–1.7, "Augmented" before), **Served** (data `combined`, the final text; "Final" in 1.6–1.7, "Used" before).
- **Part:** one of the notes inside Cooked or Served, listed under **Notes**; it can be reordered, edited alone, sent back or deleted (1.15).
- **Stage editor:** the composer opened by a Cooked/Served pencil (whole text) or a part's ✎ (that part only).
- **Column width / resize handle:** the draggable right edge of a column; widths live in `prefs.colWidths`, and the top-bar ↔ button resets them.
- **Combined text:** notes joined with the separator (`joiner()`: blank line or new line). Both the Cooked note and the Served text are combined texts (`augmentedText()` / `finalText()`).
- **Composer:** the inline text editor used for new prompts and edits; it holds voice, screenshot, paste and drop.
- **Draft:** unsaved composer text and images, kept per project.
- **Anchor:** the note plain-clicked just before a Ctrl+click selection; it becomes item 1.
- **Selection:** the notes picked with Ctrl+click, in click order; the clipboard always holds all of them.
- **Checkpoint:** a saved undo snapshot, taken just before a change.
- **Snip:** a region screenshot taken through the overlay window.
- **Phrase / segment:** a piece of dictation between pauses, transcribed on its own.
- **Deep / Soft:** the two colour themes (Deep is the default).
- **Density:** column width preset (Compact, Slim, Roomy).
- **Upgrade backup:** the automatic copy made before a new version first runs.
