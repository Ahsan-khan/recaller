# 01: Product and user

## The product in one paragraph

Recaller keeps prompts and notes that the owner reuses when working with AI tools such as Claude, ChatGPT and Claude Code. Speed of reuse matters most: one click copies a prompt, Ctrl+click (⌘-click on a Mac) copies several at once, and a global shortcut shows or hides the app from anywhere. Prompts are organised per project, with each project as a column on a single board. Inside each column a prompt moves through three stages, named like a kitchen since 1.8: **Cooking** (new prompts) → **Cooked** (joined into one note; Combined in 1.6–1.7, Augmented before) → **Served** (the final text that everything is added to; Final in 1.6–1.7, Used before). The owner can dictate prompts by voice (OpenAI speech-to-text), attach screenshots, highlight prompts to revisit, and undo anything.

It is a Windows app first (1.17.0, with optional accounts and sync, is the current version). Since the seventh session there is also a **Mac edition of the same version**, a second download (`Recaller-1.17.0-arm64.dmg` next to `Recaller Setup 1.17.0.exe`; first made as 1.16.0), built on branch `masos`. `masos` was merged into `main` on 2026-10-06 (PR #2), and the Windows installer is on GitHub as the release `v1.17.0`.

## The owner

- **Name and git identity:** "AKhan" is the git user.name on the PC; every version commit from 1.5.0 to 1.16 carries it. On the Mac, git's identity is "Ahsan-khan <ahsan.k@live.com>", so commits made there carry a different name. Email on file: m.ahsan.k94@gmail.com. Use it only to identify the owner. The privacy contact for accounts is ahsan@ponders.ai.
- **Machines:** development has happened on two computers since 2026-09-28, when the repo was first cloned on the Mac. The Windows PC is still the main install.
  - **Windows PC:** Windows 11 Home (10.0.26200).
    - Display: a single ultrawide monitor, 5120×1392, at 100% scaling.
    - Tools: VS Code with the Claude Code extension; Node 24.19, npm 11.17, Python 3.12, Git Bash and PowerShell.
    - Repo: `C:\Users\User\Documents\recaller`.
  - **MacBook Pro:** macOS 26.5.1 (Darwin 25.5.0), Apple M5 Pro (arm64).
    - Display: the built-in Retina screen only, 3024×1964 pixels at 2× (1512×982 points).
    - Tools: VS Code, whose terminal also sets `ELECTRON_RUN_AS_NODE=1`, as on the PC; Node 24.21.0 and npm 11.19.0 in `/usr/local/bin`; Python 3.13 (from python.org); git 2.50.1 (Apple Git-155); zsh; Rosetta. There is no Homebrew, `gh`, PowerShell or Wine.
    - Repo: `/Users/ahsan/Documents/GitHub/recaller` (origin https://github.com/Ahsan-khan/recaller.git). The GitHub credentials live in GitHub Desktop, and the owner fetches, pulls and pushes themselves.
- **Other work:** on the PC, in the same workspace (`C:\Users\User\Documents\iresine`), a Wildfire reinforcement-learning project (`ReinforcementLearning/`), plus `ComputerVision/`, `website/` and `data/`. Two prompt files sit next to Recaller: `Dev Prompts.txt` and `Longterm Prompts.txt`. An import for them was offered but never requested (see `09`).
- **How they communicate:** often by voice dictation. Messages can be fragmented, contain typos, or put the key point in an odd order ("The swap to used and augmented. The used represents. The augmented."). Read for intent. Restate your interpretation in the reply and invite correction. When a request is ambiguous and structural, pick the most coherent reading, build it, and say clearly what you assumed. The owner will correct you, as happened in round 8.
- **What they value** (in their own words where possible): "robust and fast", "sexy UI", "not like excel", "more modern green", "see differences in the sectors and columns", "more deeper color", "clear and sharp, cool and modern" fonts, and updates where "my notes and every single thing is the exact same".

## Settled taste and preferences (do not undo these)

- **Theme:** deep green is the default look: a dark forest canvas with solid, deep-coloured column headers. The owner explicitly said they liked it when they thought it had changed. The light "Soft" theme remains optional in Settings.
- **Density:** slim and compact, with about 268px columns and actions placed in headers or bars rather than extra rows. They complained that 340px columns wasted space. Since 1.6 they can resize individual columns, and a slim top-bar ↔ button puts them all back to this default.
- **Distinctness:** neighbouring columns get clearly different hues (emerald, sky, sun, orchid, lime, blossom, teal, bark, then ten more since 1.6). The stages look different too: Cooking is white cards on the column's neutral surface, Cooked is a light blue section (1.13; pickable), and Served is a light sage section (1.10). They asked for more stage contrast twice (rounds 7 and 9), so don't make the stages alike, but keep them light (rounds 10–16).
- **Muted, "adult" colour, not bright:** in round 10 they rejected the bright violet Combined as "weird", "girly" and "too much brightness", and asked for "modern and adult". They like the dark green background. Keep stage and UI accents low in saturation; the only saturated colour is the column headers they picked.
- **Typography:** sharp and modern. The UI uses Geist, including the stage labels and the highlight chips. Geist Mono is only for small figures: card meta and times, stage stats, Notes part numbers, the recording timer and key caps. On a Mac the system font follows Geist in the fallback lists, and key caps use the system font, because the bundled fonts have no ⌘ ⇧ ⌥ ⌃ ↩ symbols.
  - Column titles use Instrument Sans by default (since 1.6; Sora before), with a live picker offering Instrument Sans, Plus Jakarta Sans, Onest, Sora, Space Grotesk, Inter Display, Manrope, Geist and Sora Caps. They have asked for a sharper, cleaner title font three times, so title-font taste isn't settled yet.
  - They rejected tight negative letter-spacing, small grey section labels, and a text-shadow on white titles; all looked "not clear". Section and stage labels have been dark ink since. Small meta text (card times, stage footers, part numbers, key caps, Settings help lines) still uses the muted grey-green `--ink-3` (#718d7d).
  - Column titles stay at 15px or larger and bold, with little tracking: 0em for the default Instrument Sans, -0.005 to -0.015em for the other options. The exception is the Sora Caps option: 12.5px capitals at +0.08em. The section headings in Settings and Help are small 12px capitals.
- **Layout:** nothing may overlap. They reported a "Copy all" button overlapping text, and a long column name hidden behind header buttons.
- **The New prompt button** must be clearly visible and easy to reach, and not sit next to the column name. Since 1.8 the bar under the Cooking header is split in equal halves, **New prompt | Dictate**, because the owner starts about half their prompts by voice.
- **Stage names are the owner's own:** Cooking → Cooked → Served (round 11). They have renamed the stages three times, so treat names as theirs to choose and keep the data names fixed.
- **Less chrome:** in round 9 they removed the Final counter, the Copy all button and the top-bar "+ Project" button. Clicking already copies, and the board's "+ New project" tile creates projects.
- **Order:** new prompts go at the **bottom** of a column (round 10), so a column reads top to bottom and flows into Cooked.
- **Size:** stage texts must start at a fixed, modest size and expand on demand (round 10); nothing should grow without limit by default.
- **Served is quiet (round 13):** the final stage "will always be served", so it's light (sage), not a deep block. Emphasis goes to what still needs doing (Cooking, Cooked).
- **Right-click is edit (round 13):** they expect right-click on any prompt or stage text to edit it. So the card hover bar needs no pencil (round 14).
- **Cooked colour (rounds 15–16):** they rejected violet ("girly"), then slate ("too ugly"), then brown/caramel ("looks like shit"). **No brown, no heavy dark bands.** Since 1.13 Cooked is a light section like Served, Ocean blue by default, with a picker (Ocean, Teal, Midnight, Graphite). Don't change its look again without showing options side by side.
- **The main action gets the emphasis (round 14):** "Move to Cooked" is ~90% of their clicks on a card, so it's the one filled, labelled button.
- **Save closes the editor (round 13):** after saving a prompt they want the buttons back, not an empty editor waiting.
- **Calm with many columns (round 12):** they find a wide board of columns "cluttered" and want it "open" without using more space. Keep per-column furniture (labels, buttons, empty stages) light and uniform; let the header colour and the content carry the weight.
- **Helpers stay out of the way (1.16):** the always-visible › scroll arrow was "kind of annoying". The ‹ › arrows now appear only when the pointer nears their edge of the board. Don't bring back always-on floating controls over the columns.
- **A framed board (1.16):** they wanted "a border to organize everything … very sleek, very modern … aesthetic" around the whole board space. The board is a rounded panel with a slim gradient emerald edge in a dark shell the colour of the top bar. Slim and crisp, not heavy.
- **Windows stays as it is; the Mac gets the same app (seventh session):** the owner asked to "keep the windows app as it is, but create another mac os app", "similar to how software is available online with two different files for windows and mac". So the Mac edition keeps the look and every feature, and takes on Mac habits only: ⌘ keys, Control-click as a right-click, the traffic lights, a menu bar, and a window that hides when closed. Every Mac difference is fenced, so the Windows app can't change by accident.
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
9. **"Brain dump everything".** This folder was written, and the test suites were moved into the repo at `tests/e2e/`.

Second session (2026-09-24), after the project moved to `C:\Users\User\Documents\recaller` (its own git repo, on GitHub):

10. **"Read every file in ai_memory; prepare yourself."** Every file was read, the repo state checked, and a baseline `npm test` run (101/101).
11. **Round 9 → v1.6.0.**
    - The request: fix the known issues; remove the counter next to Used and its Copy all button; try a new sharper, cleaner column-title font; be able to edit the Augmented and Used notes, "all" of them; rename Used → **Final** and Augmented → **Combined**; slightly more visual difference between the three stages; remove the + Project button from the top bar; resizable columns plus a slim top-bar button that resets every width to today's default; more column colours.
    - What was built: all of it. See `08` (1.6.0) for details and `10` (message 12) for how each item was read.
12. **Round 10 → v1.7.0.**
    - The request: the Combined colour is "weird", "girly" and too bright, so make it modern and adult (they like the background); new prompts at the bottom; a friendlier, more modern, easier UI overall; Final limited in size, expandable, initially fixed; and "what would it take for everyday users?"
    - What was built: slate Combined, quiet empty stages, bottom insertion plus a sort action, fixed-size Combined/Final with a Show more bar (and a fix for the bug that let them grow), a help panel, sectioned Settings. The everyday-user roadmap is in `09`. See `08` (1.7.0) and `10` (message 13).
13. **Round 11 → v1.8.0.**
    - The request: the mic should take half of the New prompt bar (they dictate about half their prompts); rename Final → Served and Combined → Cooked; add a section name for new prompts, "Cooking", like the other ones.
    - What was built: New prompt | Dictate in equal halves; the kitchen names everywhere; a Cooking header (label, count, fold arrow) above the prompts, with the count moved out of the column title. See `08` (1.8.0) and `10` (message 14).
14. **Round 12 → v1.9.0.**
    - The request: many columns look cluttered; make it feel less cluttered and open without taking more space.
    - What was built: one neutral surface for every column, a plain Cooking label, soft New prompt | Dictate pills, empty stages that show only their name, borderless cards, fainter dots. The column headers were deliberately left as they are. See `08` (1.9.0).
15. **Round 13 → v1.10.0.**
    - The request: tone Served down (lighter, not deep); right-click a prompt, the Cooked note or the Served note to edit it; after saving a typed or dictated note, close the text field and show the buttons again.
    - What was built: all three. See `08` (1.10.0) and `10` (message 16).
16. **Round 14 → v1.11.0.**
    - The request: drop Edit from a card's hover options (right-click edits) and make "Move to Cooked" stand out, since it's ~90% of their clicks.
    - What was built: the hover bar has only the highlighter and a filled "↓ Cooked" button. See `08` (1.11.0) and `10` (message 17).
17. **Round 15 → v1.12.0.**
    - The request: "Change cooked colors to something nicer. Current one is too ugly." (the slate)
    - What was built: six palettes compared side by side, Caramel made the default, and a Settings › Cooked colour picker. See `08` (1.12.0).
18. **Round 16 → v1.13.0.**
    - The request: "The cooked color is still too ugly. It looks like shit… Why did you pick brown?"
    - What was built: Cooked became a light section like Served (no dark band), Ocean blue by default; the picker now offers Ocean, Teal, Midnight and Graphite (browns removed). See `08` (1.13.0) and `10` (message 19).
19. **"Brain dump everything" (again).** This folder was audited and brought up to date for 1.13.0 before the session ended.

Third session (2026-09-24):

20. **Round 17 → v1.14.0.**
    - The request: pasting what was copied from Cooked didn't bring the screenshot taken in Cooking.
    - What was built: Cooked and Served show their prompts' pictures as tiles under the text; a tile click copies that picture. Text and picture stay two separate copies, because chat boxes drop the text when both are pasted at once. See `08` (1.14.0) and `11` #45.

Fourth session (2026-09-26); 1.14.0 was installed and committed as "1.14" by then:

21. **"Read everything here and learn every file", then Round 18 → v1.15.0.**
    - The request: "I should be able to delete something in cooked."
    - What was built: a trash button on every row of the Cooked (and Served) **Notes** list that deletes that one note, and a trash in the whole-text editor (right-click or pencil) that deletes the whole Cooked note (or Served text). Both undoable, no confirmation. See `08` (1.15.0) and `11` #46.
    - "then update files again and goodbye": this folder was brought up to date for 1.15.0 at the end of the session.

Fifth session (2026-09-26, later the same day); 1.15.0 was installed and committed as "1.15" by then:

22. **"Read everything in ai_memory and learn every file", then Round 19 → v1.16.0.**
    - The request (dictated): the right arrow for scrolling right "should not always be present. It's kind of annoying." And "add like a slight border to it … it kind of needs a border to organize everything … very sleek, very modern … aesthetic border."
    - What was built first: both ‹ › arrows stay hidden until the pointer comes within 96px of their edge of the board, then fade and slide in; they also hide while dragging or panning. "A slight border to it" was read as the arrow's border: a solid white disc with a slim deep-emerald ring. See `11` #47.
    - The owner then replied: "yes i meant the whole space not the arror i mean the board frame". So the board became a framed panel: rounded, inset 12px in a dark shell the colour of the top bar, with a 1px gradient emerald edge (bright at the top-left) and a faint glow. Eight edge styles were compared side by side first. The arrow ring was kept because it matches the frame. See `08` (1.16.0) and `11` #48.
    - "and update files … goodbye": this folder was brought up to date for 1.16.0 at the end of the session.

Sixth session (2026-09-28 to 2026-09-29, on a new MacBook Pro). It is known only in part, from the notes inside the discarded stash and from git. 1.16 had been committed and pushed on `v1` by then ("1.16" = `664212a`, 2026-09-26):

23. **"okay make it so i can install on macos as well" and "i want to be able to install on both btw" → a 1.17.0, discarded.**
    - What was built: a 1.17.0 with a Mac edition (a dmg and a Windows exe), tested on the Mac. It was never installed or opened. (The owner's words are in `10`, messages 28, 30 and 33.)
    - On 2026-09-29 (18:11–18:12), in a separate short session, the owner said "i made some changes to my project that i dont want to keep anymore" and "since my last push". Everything since the 1.16 push was stashed as `stash@{0}`. No reason was given.
    - The owner then merged `v1` into `main` (PR #1, `dd5a3b0`), pulled `main`, and created and published a new branch `masos` for the Mac app ("masos" is their spelling; keep it). A likely reading, unconfirmed: they wanted the Mac work kept apart from the Windows app.

Seventh session (2026-09-29, on the MacBook Pro, branch `masos`):

24. **"Read every file … and learn everything so we can proceed to build", then the Mac edition of 1.16.0.**
    - The owner's words are in `10`, messages 34 to 43.
    - All 14 files were read. A read-only audit then checked about 1,310 of their claims against the code and git. It found about 49 high or medium mismatches and about 59 low ones, none refuted: mostly Windows-only wording and stale status, plus some real code issues. This update corrected the docs; the code issues are listed in `09` (known issues), not fixed.
    - "okay so we currently have a windows app right?": yes. 1.16 builds only a Windows installer.
    - The request: "i want to create a similar mac os app. i want to keep the windows app as it is, but create another mac os app. it should be similar to how software is available online with two different files for windows and mac".
    - The owner's three answers: reuse the discarded 1.17.0 attempt? **"Start from scratch"**. Who downloads the Mac version? **"Just me for now"**, so an ad-hoc-signed Apple Silicon dmg, approved once in System Settings if macOS blocks it, with proper signing later. Run the Mac-safe test suites on this Mac? **"Yes, run them"**.
    - What was built: the Mac edition of 1.16.0 on `masos`, which the owner committed and pushed later that evening (the last two points below). It has ⌘ shortcuts and ⌘-click, Control-click to edit, the traffic lights in the top bar, a Mac menu bar, a window that hides when closed, ⌃⌥R to show or hide it, handling for the microphone and Screen Recording permissions, a Mac icon, `npm run dist:mac` → `dist/Recaller-1.16.0-arm64.dmg`, and Mac-safe test suites (12 + 21 + 139 on the Mac). The Windows app is unchanged. See `14_macos.md` for the whole Mac edition, `08` (1.16.0 for Mac) and `11` #49 onward.
    - "the app window kept crashing when you opened it": nothing of Recaller's had run or crashed; the crash reports came from other programs: Tracer, the owner's own separate `tracer` project (its 20:02 crash started from VS Code, the two at 20:14 opened through Launch Services), and `repro_bigsur` and a copied `python3`, both started from VS Code (see `10`, message 39). The work was stopped anyway as a precaution, then finished after "okay its fine, just lets finish this up".
    - The session never opened the built Mac app. At the very end (about 20:43 on 2026-09-29) the owner copied it into `/Applications` themselves, then opened the copy inside the mounted dmg, which was still the running one when the session ended. How it went isn't recorded yet.
    - Status checks while the docs were updated and after the summary ("whats happening", "now?", "now?", "anything running?", "all documentation updated?", "everything done running?"; `10`, message 41): each was answered with a fresh check. "all documentation updated?" led to a final sweep of this folder. At "everything done running?" nothing from the session was running; only the owner's own Recaller was open, still the copy inside the mounted dmg.
    - "check my latest pushes to github, everything looks good?" (`10`, message 42): the owner had committed the Mac edition on `masos` at 21:45 on 2026-09-29, as two commits both called "mac build", and pushed both. `16961eb` is the snapshot they had staged at 21:13; `9536853` holds the fixes made after that staging, mostly to the docs. A read-only check (`git log`, `git show --stat`, `git ls-remote origin`, and the pushed `src/` compared with the dmg's `app.asar`) found GitHub's `masos` at `9536853`, `main` and `v1` unchanged, and the pushed app code byte-identical to the tested dmg. It was all good except one thing: `16961eb` had also committed Finder's `.DS_Store` by accident.
    - "fix it" (`10`, message 43): `git rm --cached .DS_Store` took the file out of git (it stays on disk), and ".DS_Store" was added as the last line of `.gitignore`. The owner committed both as "fix" (`f86cf19`, 21:51:53) and pushed it. This update of the docs came after that commit and is left for the owner to commit and push. `masos` isn't merged into `main`; that's the owner's call (a pull request, after running the suites once on the PC).

Ninth session (2026-10-06, on the PC, branch `masos`). 1.17.0 had been committed and pushed by then ("huge" = `4370072`, 2026-10-01) and installed on the PC:

25. **"is everything in the folder on github?", then a GitHub Release and the merge.** (The owner's words are in `10`, messages 56 to 62.)
    - Yes: nothing was uncommitted, unpushed or stashed. Only the git-ignored `dist/`, `node_modules/` and `tests/e2e/.out/` stay on the PC. Asked why, and how to install on another PC: both are rebuilt (`npm install`, `npm run dist`), and a 112 MB installer is over GitHub's 100 MB file limit anyway.
    - "i want to easily install on another pc": the 1.17.0 Windows installer was published as the GitHub Release `v1.17.0` (`08`, 1.17.0 status). On another PC: sign in to GitHub, download `Recaller-Setup-1.17.0.exe` from the release, run it, then sign in to the account to bring the notes over. No Git, Node or `node_modules` is needed. The README's Install section now says so.
    - "okay merge masos to main": PR #2 merged `masos` into `main` (`9d30f1f`). The suites hadn't run on the PC first.
    - "yes" (to updating the changelog for the release): this folder and the README were brought up to date.

## Things the owner has not decided or confirmed

- **Separator:** whether they want a blank line or a single new line between joined notes. The default stays blank line; the setting exists.
- **Archiving Served:** whether a cleared Served text should be archived. ⋯ → Clear Served empties it (undoable until restart).
- **Cooked counter:** round 9 removed only the counter next to Final (now Served). Whether they want the "· n" next to Cooked gone too is unknown.
- **Cooked colour:** whether Ocean (1.13) finally pleases them. They have had it installed since the third session and haven't complained, but never said so.
- **Deleting in Cooked (1.15):** whether "something" meant one prompt (the row trash) or the whole Cooked note (the editor's trash); both were built. Whether the row trash is easy enough to find behind the **Notes** toggle is unconfirmed.
- **Board frame and arrows (1.16):** whether the frame's edge is the "sleek, modern, aesthetic" border they pictured (strength, the sheen, the 12px margin), whether they want the emerald ring on the arrows now that the frame exists, and whether the 96px arrow reveal zone feels right.
- **Calm board (1.9):** whether the board is calm enough with many columns (`09` question 9).
- **Pictures in Cooked and Served (1.14):** whether copying the text and then clicking the picture works where they paste (`09` question 12).
- **Title font:** Instrument Sans is the new default; whether it finally satisfies "sharp, clean, modern" is unconfirmed.
- **"All the colors are girly":** whether that included the project palette (pink Blossom, Orchid, Fuchsia), not just the Cooked (then Combined) colours.
- **Going public:** whether they want to pursue the everyday-user roadmap in `09`, and in what order.
- **Importing prompt files:** whether to import `Dev Prompts.txt` and `Longterm Prompts.txt`.
- **Signing and auto-update:** whether they want code signing or auto-update. Neither exists; the Mac edition is only ad-hoc signed.
- **The Mac look (seventh session):** the owner first opened the Mac edition at the very end of the session, and their verdict isn't recorded. Whether it looks right on the Retina screen: 1.5px borders draw at full weight at 2×, so the arrow ring and the composer ring look slightly heavier than on the 1× PC, and the frame edge reads stronger.
- **Developer ID signing for the Mac:** "Just me for now" meant ad-hoc signing. Whether they will want a Developer ID ($99 a year) and notarization to share the Mac app. It would also stop macOS asking for the microphone, Screen Recording and keychain permissions again after each update.
- **Intel Macs:** whether a universal build is needed. The dmg is for Apple Silicon only.
- **Moving data to the Mac:** whether to bring the PC's notes over (copy `recaller-data.json` and `images/` only; the saved API key can't move) or keep a separate board on each computer.
