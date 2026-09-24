# 13: Playbook for AI agents continuing this project

## Session start (about 5 minutes)

1. Read `README.md`, then `03_data_model.md`, then `04_features_and_flows.md` in this folder. Skim `09` for open issues and `10` for how the owner phrases things.
2. **Installed version:** in the scratchpad, `npx @electron/asar extract-file "%LOCALAPPDATA%\Programs\recaller\resources\app.asar" package.json`, then read `version` and delete the extracted file. When the 1.10.0 work ended, the source was 1.10.0 and its installer was built; the owner installs it themselves.
3. **Git state:** `git -C C:\Users\User\Documents\recaller status -sb`. The project is its own repo with remote `origin` on GitHub. 1.6.0 is committed on branch `v1` (commit `296fd32`, pushed); `main` has the 1.5.0 commit. Work since the last commit may be uncommitted on purpose; don't commit or push unless asked.
4. **Tests:** `npm install` if needed, then `npm test`. Expect 12 + 21 + 112 passing; a single drag or pan failure is usually the owner's mouse (see `06`).

## The per-request workflow that worked

1. **Understand.** Messages are often dictated and fragmented (see `10`). Separate them into numbered items. For ambiguous structural requests, choose the most coherent interpretation and state it plainly at the top of your reply, inviting correction. Ask a question first only if a wrong guess would be expensive.
2. **Check constraints:**
   - update safety (`03`);
   - the stage naming trap (`notes` = Cooking, `used` = Cooked, `combined` = Served since 1.8; Combined/Final in 1.6–1.7, Augmented/Used before);
   - design taste (`05`);
   - known issues (`09`).
3. **Implement** in small, exact edits.
   - For big multi-part edits, write a Python patch script to a file. Have it assert that each old string matches exactly once, then run it. Inline heredocs in Git Bash fail with very long scripts and mangle backslashes (Windows paths). Put the replacement pairs in their own `.py` file as raw strings (use triple single quotes when the text ends with a double quote).
   - Run `node --check` on every edited JS file.
4. **Look at it.**
   - `npm run capture`, or the `shot()` screenshots from the suites in `tests/e2e/.out/`, then view the PNGs.
   - Fix overlaps, truncation and contrast before moving on.
   - Never open the screenshots from the real screen-snip test, which captures the owner's actual screen.
5. **Test.**
   - Add checks for every new behaviour to `features.e2e.js`.
   - Run the suites on source.
   - If a check fails, decide whether it is a test bug or an app bug before changing anything, and say which in your reply.
6. **Release** (see the checklist in `06`):
   - bump the version;
   - update `README.md`, `ai_memory/08_changelog.md` and any other affected `ai_memory` file;
   - build, then run the suites against the packaged `app.asar`, including `MODE=real`;
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
- **Test output:** redirect long test output to a log file and grep it for `PASS|FAIL|passed|HARNESS`. Piping straight into `grep` or `tail` sometimes cut runs short.
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
- On taste (fonts, colours), after two rejected attempts, show the options side by side and add a picker.
- They care most about speed of reuse (copying), the stage workflow, and never losing data.

## Glossary

- **Board:** the horizontally scrolling area holding the columns.
- **Column / project:** one project, holding the three stages.
- **Card / prompt / note:** one item in the top stage.
- **Stage:** one of the three sections of a column: **Cooking** (data `notes`, the prompt cards), **Cooked** (data `used`, one combined note; "Combined" in 1.6–1.7, "Augmented" before), **Served** (data `combined`, the final text; "Final" in 1.6–1.7, "Used" before).
- **Part:** one of the notes inside Cooked or Served, listed under **Notes**; it can be reordered, edited alone or sent back.
- **Stage editor:** the composer opened by a Cooked/Served pencil (whole text) or a part's ✎ (that part only).
- **Column width / resize handle:** the draggable right edge of a column; widths live in `prefs.colWidths`, and the top-bar ↔ button resets them.
- **Combined note / combined text:** notes joined with the separator (`joiner()`: blank line or new line).
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
