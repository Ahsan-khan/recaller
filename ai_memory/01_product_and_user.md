# 01: Product and user

## The product in one paragraph

Recaller keeps prompts and notes that the owner reuses when working with AI tools such as Claude, ChatGPT and Claude Code. Speed of reuse matters most: one click copies a prompt, Ctrl+click copies several at once, and a global shortcut shows or hides the app from anywhere. Prompts are organised per project, with each project as a column on a single board. Inside each column a prompt moves through three stages: new → **Augmented** (joined into one note) → **Used** (the final text that everything is added to). The owner can dictate prompts by voice (OpenAI speech-to-text), attach screenshots, highlight prompts to revisit, and undo anything.

## The owner

- **Name and git identity:** "AKhan" (git user.name). Email on file: m.ahsan.k94@gmail.com. Use it only to identify the owner.
- **Machine:** Windows 11 Home (10.0.26200).
  - Display: a single ultrawide monitor, 5120×1392, at 100% scaling.
  - Tools: VS Code with the Claude Code extension; Node 24.19, npm 11.17, Python 3.12, Git Bash and PowerShell.
- **Other work:** in the same workspace (`C:\Users\User\Documents\iresine`), a Wildfire reinforcement-learning project (`ReinforcementLearning/`), plus `ComputerVision/`, `website/` and `data/`. Two prompt files sit next to Recaller: `Dev Prompts.txt` and `Longterm Prompts.txt`. An import for them was offered but never requested (see `09`).
- **How they communicate:** often by voice dictation. Messages can be fragmented, contain typos, or put the key point in an odd order ("The swap to used and augmented. The used represents. The augmented."). Read for intent. Restate your interpretation in the reply and invite correction. When a request is ambiguous and structural, pick the most coherent reading, build it, and say clearly what you assumed. The owner will correct you, as happened in round 8.
- **What they value** (in their own words where possible): "robust and fast", "sexy UI", "not like excel", "more modern green", "see differences in the sectors and columns", "more deeper color", "clear and sharp, cool and modern" fonts, and updates where "my notes and every single thing is the exact same".

## Settled taste and preferences (do not undo these)

- **Theme:** deep green is the default look: a dark forest canvas with solid, deep-coloured column headers. The owner explicitly said they liked it when they thought it had changed. The light "Soft" theme remains optional in Settings.
- **Density:** slim and compact, with about 268px columns and actions placed in headers or bars rather than extra rows. They complained that 340px columns wasted space.
- **Distinctness:** neighbouring columns get clearly different hues (emerald, sky, sun, orchid, lime, blossom, teal, bark). The stages look different too: new prompts are white cards, Augmented is an indigo tray, and Used is a deep-green block.
- **Typography:** sharp and modern. The UI uses Geist, and numbers and labels use Geist Mono.
  - Column titles use Sora by default, with a live picker offering Sora, Space Grotesk, Inter Display, Manrope, Geist and Sora Caps.
  - They rejected tight negative letter-spacing, small grey labels, and a text-shadow on white titles; all looked "not clear".
  - Headings stay at 15px or larger and bold.
- **Layout:** nothing may overlap. They reported a "Copy all" button overlapping text, and a long column name hidden behind header buttons.
- **The New prompt button** must be clearly visible and easy to reach, and not sit next to the column name. It is now a full-width bar under the header.
- **Data safety is paramount.** Every update must keep everything identical: notes, drafts, images, colours, layout, scroll positions, window position and settings.

## Every request, in order, and what was built

The owner's words are paraphrased closely; full detail is in `08_changelog.md`.

1. **Initial brief → v1.0.0.**
   - The request: a simple "ticketing" desktop app called **recaller** for pre-pasting future prompts and notes.
     - Click a note to copy it; a mic button for voice-to-text using OpenAI.
     - Robust and fast; a desktop app.
     - Organised per project on one page: projects as columns in a sexy UI, notes as rows but "not like excel".
     - A "new prompt" button offering typing or voice; fast copy.
     - Hold the mouse and swipe left to delete.
     - Click, hold and drag a note down into a section called **Used**.
     - Colour scheme: nature, light green, monstera.
   - What was built: an Electron app with all of the above, plus search, undo toasts, settings with an encrypted API key, a global show/hide hotkey, an installer, and a generated monstera icon.
2. **Round 2 → v1.1.0.**
   - The request:
     - Take a screenshot and add the image to a note.
     - Undo a delete or the last move.
     - Voice "transcribed correctly but didn't show up until I clicked save and then it saved".
     - A more modern green with visible differences between sectors and columns.
     - Easier left and right scrolling.
     - Columns too big; slim them down.
   - Diagnosis of the voice issue: the owner most likely pressed Save while it was still recording, which (by design) stops, transcribes and saves. The real need was to see text while speaking.
   - What was built:
     - a region-snip screenshot overlay, plus image paste and drop, thumbnails and click-to-copy for images;
     - full snapshot undo/redo;
     - live phrase-by-phrase streamed dictation;
     - an emerald redesign with distinct column colours and stage colours;
     - a dotted canvas, scroll arrows, wheel-to-horizontal and drag-to-pan;
     - slim 268px columns with a Compact/Slim/Roomy setting.
3. **Round 3 → v1.2.0.**
   - The request:
     - Once notes are in Used, add a section below it called **augmented** that combines all of them into one text: "exact same text, copied line by line with space between".
     - Make the colours deeper.
     - Ctrl+click multiple notes to copy them together with a blank line between.
   - What was built: an Augmented section (combined Used text), the Deep theme as default, and Ctrl+click multi-copy with order badges.
4. **Round 4 → v1.3.0.**
   - The request: updates must keep everything exactly the same, and the font should be more modern and sharp.
   - What was built:
     - lossless loading;
     - no rewrite on startup;
     - a pinned data folder;
     - automatic backups before every update and daily, with restore in Settings;
     - saved scroll positions and expanded states;
     - the Geist font.
   - Mid-turn messages:
     - "I liked the previous deep green": nothing had changed. The owner had most likely seen test windows running the Soft theme on their screen, which was a test-harness bug, since fixed.
     - "The column headings font is not clear": titles became bigger and bolder with neutral spacing, and section labels became darker.
5. **Round 5 → v1.3.0, rebuilt.**
   - The request: "Column name font still not clear and sharp, cool and modern enough."
   - What was built: ten candidates were rendered side by side. Sora became the default, a six-option title-font picker was added to Settings, and the text-shadow was removed.
6. **Round 6 → v1.3.1.**
   - The request: "When I hold Ctrl and click multiple notes it doesn't copy them together."
   - Root causes:
     - A note plain-clicked before the Ctrl+clicks was not included.
     - Stale selections could leak into a new one; Esc didn't clear them while the search box had focus.
   - What was built:
     - an Explorer-style anchor (a plain click followed by Ctrl+clicks includes the first note);
     - the selection clears when the window loses focus, on Esc anywhere, and on a click on empty canvas;
     - clipboard writes are serialised.
7. **Round 7 (dictated) → v1.4.0.**
   - The request:
     - Highlight a prompt in a colour so you can check it again.
     - Swap Used and Augmented: Augmented in the middle, Used as the final combined product. Swiping an Augmented note left should add it to Used instead of deleting it.
     - The New prompt button should be more visible and not next to the column name.
     - Allow editing the dictated text while it's still recording.
     - Use different contrast for Used, Augmented and new prompts.
     - Long column names are hidden behind the options buttons.
     - The Copy all button overlaps text.
   - What was built:
     - four highlight colours;
     - three stages with Augmented shown as individual cards (a misreading, corrected in round 8);
     - a full-width New prompt bar;
     - editing while recording;
     - indigo and deep-green stage colours;
     - two-line column names with only the ⋯ button in the header;
     - Copy all moved into the Used header.
8. **Round 8 → v1.5.0.**
   - The request: "In Augmented it should automatically combine the new prompts into one note with a new line between each. Then when you move this text down to Used, it combines with the Used text."
   - What was built:
     - Augmented became one combined note, with prompts appended in the order they were added;
     - a "Move to Used" button, swipe left and drag onto Used, all of which append the whole note to Used and empty Augmented;
     - a **Join notes with: Blank line (default) / New line** setting, because the owner's wording ("a new line") differed from earlier behaviour (blank line).
9. **Final: "brain dump everything".** This folder was written, and the test suites were moved into the repo at `tests/e2e/`.

## Things the owner has not decided or confirmed

- **Separator:** whether they want a blank line or a single new line between joined notes. The default stays blank line; the setting exists.
- **Clearing Used:** whether the final Used text should ever be cleared or archived. Today there is no "clear Used" action; see known issue #1 in `09`.
- **Importing prompt files:** whether to import `Dev Prompts.txt` and `Longterm Prompts.txt`.
- **Signing and auto-update:** whether they want code signing or auto-update. Both are currently absent.
