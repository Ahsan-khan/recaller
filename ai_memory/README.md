# Recaller: project memory (start here)

This folder is the complete handoff for **Recaller**. It lets any person, AI agent or LLM continue development without the original conversation. Everything here is plain text, and every user flow is described in words.

Status as of **2026-09-24**: version **1.5.0** is built and installed on the owner's PC. Every automated test suite passes.

## What Recaller is

Recaller is a Windows desktop app (Electron 44, vanilla JavaScript, no bundler) for storing reusable AI prompts and notes.

- **Columns:** each project is a column on one horizontally scrolling board, and prompts are cards inside it.
- **Copying:** click a card to copy it, or Ctrl+click several to copy them all at once.
- **Input:** you can dictate prompts with OpenAI speech-to-text (text streams in as you speak) and attach screenshots.
- **Stages:** every column has three stages, top to bottom:
  1. **New prompts**: individual cards.
  2. **Augmented**: the prompts moved down, joined automatically into one note.
  3. **Used**: the final text. Moving the Augmented note down adds its text to the end of Used.
- **Visual style:** a deep forest-green "monstera" nature theme with a slim, dense layout.

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
| `08_changelog.md` | Versions 1.0.0 to 1.5.0 and what changed in each |
| `09_backlog_and_open_questions.md` | Known issues, untested areas, ideas the user may want, technical debt and suggested next steps |
| `10_user_messages_verbatim.md` | Every message the owner sent, word for word, with notes on how each was interpreted |
| `11_decision_log.md` | Why each major choice was made (Electron, vanilla JS, voice design, undo, storage, fonts, …) and when to revisit it |
| `12_dev_recipes.md` | Step-by-step recipes for common changes: settings, card actions, stage actions, data fields, undo, IPC, shortcuts, colours, fonts, voice, tests |
| `13_ai_agent_playbook.md` | For AI agents: the session-start checklist, the per-request workflow that worked, tool tips for this machine, how the owner likes answers, and a glossary |

AI agents should read `13` first, then continue with the order above.

## Golden rules (read before changing anything)

1. **Updates must leave user data exactly the same.** The user explicitly required this.
   - Never rewrite the data file on startup.
   - Never drop fields you don't recognise.
   - Never "migrate" a user's choices, such as colours or density.
   - Run the update-safety suite before shipping (see `03` and `06`).
2. **The data names and screen names of the stages differ.** Data `used` is the stage the UI calls **Augmented**. Data `combined` is the stage the UI calls **Used**. Do not rename the data fields; existing users' files depend on them.
3. **The data folder is pinned** to `%APPDATA%\Recaller` in `src/main.js`. Never change `productName`, `appId` or that path.
4. **Launching Electron:** from this owner's VS Code terminal, prefix commands with `env -u ELECTRON_RUN_AS_NODE`, or use the `npm` scripts, which already handle it. Otherwise Electron starts as plain Node.
5. **Don't bother the user while testing.**
   - Test windows must never be shown on the user's screen or steal focus.
   - Run `node --check` on any test file first, because a syntax error pops up an Electron error dialog on their screen.
6. **Design taste is settled:**
   - deep green theme by default;
   - slim columns;
   - clearly different colours for neighbouring columns and for each stage;
   - bold, readable headings;
   - no overlapping UI;
   - no text shadows on titles.
7. **Commits:** don't commit or push unless the owner asks. Nothing from this project has been committed to git yet (see `06`).

## Where things are

- **Source:** `C:\Users\User\Documents\iresine\recaller\src\`.
- **Tests:** `C:\Users\User\Documents\iresine\recaller\tests\e2e\`. Run them with `npm test`.
- **Installer output:** `C:\Users\User\Documents\iresine\recaller\dist\Recaller Setup <version>.exe`.
- **Installed app:** `%LOCALAPPDATA%\Programs\recaller\`.
- **User data:** `%APPDATA%\Recaller\`. It holds the notes file, the settings file, `images\` and `backups\`.
- **User-facing docs:** `C:\Users\User\Documents\iresine\recaller\README.md`.
- **Earlier Claude Code notes:** Claude Code kept short notes about this project and the user's taste in `C:\Users\User\.claude\projects\c--Users-User-Documents-iresine\memory\` (files `recaller-app.md`, `ui-taste-dense-distinct.md`). This folder is the full version of those notes.
