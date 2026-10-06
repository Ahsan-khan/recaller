# 11: Decision log (why things are the way they are)

Read this before reversing any of these choices. Each entry gives the decision, the reason, and what would justify revisiting it.

1. **Electron, not Tauri or a web app.**
   - Why: the owner asked for a desktop app. The machine had Node but no Rust toolchain. Electron has mature APIs for everything needed: `globalShortcut`, `desktopCapturer`, `safeStorage` (DPAPI on Windows; a key in the keychain on a Mac), clipboard images, custom protocols and NSIS packaging (and a dmg for the Mac edition, #56).
   - Revisit if: install size (about 112MB) or memory use becomes a complaint.
2. **Vanilla JavaScript with no framework and no bundler; classic `<script>` tags.**
   - Why: fast startup, no build step, and nothing to break. ES modules over `file://` can hit CORS/origin problems in Chromium, so classic scripts sharing `window.ICONS`, `window.Voice` and `window.recaller` are used.
   - Cost: `app.js` is large (3,576 lines in 1.16; 3,675 with the Mac edition on `masos`).
   - Revisit if: splitting it is needed; then add a bundler deliberately.
3. **Keyed DOM reconciliation (`syncChildren` plus the view maps) instead of re-rendering with innerHTML.**
   - Why: editors, focus, running animations and dictation must survive re-renders. A copy, a count change or a timer re-render must not destroy the open composer.
4. **Custom pointer-event gestures instead of HTML5 drag-and-drop.**
   - Why: one engine handles click-to-copy, press-and-hold, swipe-to-delete and drag, with thresholds, FLIP animations, auto-scroll and cancel-on-blur. HTML5 drag-and-drop can't do swipe, and styles poorly.
5. **All network traffic and the API key stay in the main process.**
   - Why: security. The renderer has `connect-src 'none'`, and the key is encrypted at rest (DPAPI on Windows; on a Mac with a key kept in the keychain) and never sent to the page.
6. **OpenAI `gpt-transcribe` as the default model, streamed.**
   - Why: OpenAI's docs recommended it for recorded speech (checked September 2026). Streaming makes text appear faster.
   - Alternatives: `gpt-4o-mini-transcribe` is offered as the fastest and cheapest; `whisper-1` is offered but cannot stream.
   - Sources: https://developers.openai.com/api/docs/models/gpt-transcribe, https://developers.openai.com/api/docs/guides/speech-to-text, https://developers.openai.com/api/docs/guides/transcription
7. **Phrase segmentation with local voice-activity detection, instead of the OpenAI Realtime (WebSocket) API.**
   - Why:
     - It gives near-live text with the plain, well-documented HTTP endpoint, which could be tested end to end with a mock server.
     - Each phrase is sent once, so it costs no more than one long request.
     - Silent phrases are never sent, which avoids invented text.
   - Revisit if: the owner wants word-by-word live captions while speaking.
8. **Snapshot undo (JSON of all projects before each change, up to 80 steps).**
   - Why: simple and robust for small data. Live fields (drafts, copy counts, collapsed state) are carried over, so undo only rewinds what the user did.
   - Revisit if: data grows very large (thousands of notes).
9. **Data in a JSON file in userData, not localStorage or IndexedDB.**
   - Why: inspectable, easy to back up and restore, atomic writes, and readable by future versions and by humans.
10. **Images as files served through the `recaller-img://` protocol, not base64 inside the JSON.**
    - Why: keeps the data file small and saves fast; thumbnails load fast; the CSP stays strict.
11. **Update safety as a hard rule.** This means lossless loading, no write on startup, a pinned data folder, backups before every version change plus daily, and restore in Settings.
    - Why: the owner explicitly required updates to change nothing.
    - Rule: do not relax it.
12. **Data names `used` and `combined` kept when the UI labels were swapped (1.4 and 1.5).**
    - Why: renaming fields would need a migration, which risks the owner's data. The mismatch is documented everywhere instead.
13. **Deep theme as default, Soft kept as an option.** The owner asked for deeper colour, then said they liked it.
14. **Fonts: Geist for the UI, Sora for column titles, plus a picker.** The owner rejected two title attempts. After a side-by-side comparison, Sora was chosen, and the picker hands the final taste decision to them. (Superseded for titles in 1.6 by #26: Instrument Sans.)
15. **Separator defaults to a blank line, with a "New line" setting.** The owner's wording varied: "copied line by line with space between" and "space new line in between" earlier, then "a new line between each text". A blank line was the established behaviour, so it stayed the default and the setting resolves the ambiguity.
16. **Ctrl+click selection works like File Explorer** (⌘-click on a Mac, #52).
    - The anchor rule: a plain click just before Ctrl+clicks includes that note.
    - The selection clears on window blur, Esc, or a click on empty canvas.
    - Why: this matches how people actually use Ctrl+click, and it fixed the owner's "doesn't copy them together".
17. **Scroll positions are saved only when the user scrolled.** Why: a smaller window at startup clamps scroll, and saving that would silently change remembered state.
18. **Global show/hide hotkey is Ctrl+Alt+R.** Why: Ctrl+Shift+Space would steal VS Code's parameter-hints shortcut, and the owner lives in VS Code. On a Mac the default is ⌃⌥R (#53).
19. **Screenshots are a custom region snip, not Windows' Snipping Tool.**
    - Why: an integrated flow (hide, snip, attach, reappear) that is exact to the pixel and doesn't depend on another app.
    - Alternative ways in: pasting from any tool, including Win+Shift+S, also works.
20. **Tests are end-to-end suites driving the real app.**
    - Why: the value is in gestures, timing, IPC and persistence, which unit tests wouldn't catch.
    - How: they run mostly off-screen without focus (a 200px or 60px strip stays visible on the PC), and the features suite adds a mock OpenAI server and a fake microphone. On a Mac the windows are 2px slivers with no Dock icon (#57).
21. **No git commits unless the owner asks.** This follows the operating rules this project was built under. Since 2026-09-24 the project is its own repo on GitHub; new work stays uncommitted until the owner asks. The owner commits and pushes each version themselves (on the Mac through GitHub Desktop). They committed and pushed the Mac edition on `masos` on 2026-09-29 as "mac build" (`16961eb` + `9536853`), and 1.17.0 there on 2026-10-01 ("huge"); at their request `masos` was merged into `main` on 2026-10-06 (PR #2). At their "fix it" the session took Finder's `.DS_Store` (committed by accident) out of git with `git rm --cached`, which leaves it on disk, and git-ignored it; the owner committed and pushed that as "fix" (`f86cf19`).
22. **Stage names changed on screen only (1.6: Augmented → Combined, Used → Final).**
    - Why: same reason as #12. The owner's files keep `used` and `combined`; `STAGE_NAME` maps them to screen names. The price is that data `combined` is the stage called Final.
23. **Column widths live in `prefs.colWidths`, not on each project.**
    - Why: widths are layout, not content. Keeping them out of `data.projects` means undo snapshots never rewind them, an undone project delete gets its width back for free, and "reset all" is one `delete`.
    - The reset toast has its own Undo closure instead of using the history stack.
    - A width within 6px of the default snaps to it and is stored as "not resized", so the default stays reachable by dragging.
24. **Reset-widths button is an icon in the top bar, not a text button.** The owner asked for it "in a slim way". It sits next to undo/redo, since it's a similar kind of action, and is disabled while nothing is resized.
25. **Whole-text edit still merges into one note; per-part edit keeps the others.**
    - Why: the owner asked to edit "all" of the notes in Combined and Final. The whole-text pencil (existing behaviour on Combined, new on Final) gives free editing. ✎ per part in the Notes lists edits one without touching the rest. Saving an unchanged whole text no longer merges anything.
26. **Instrument Sans as the column-title default (1.6).**
    - Why: the owner asked a third time for a sharper, cleaner title font. Following lesson 40 in `07`, candidates were rendered side by side on real headers at 1× scale. Instrument Sans read crispest and differs from Geist (the UI font), so it became the default and two runners-up joined the picker.
    - The owner had never picked a font (`prefs.titleFont` was absent), so changing the default reached them without touching their data. Anyone who picked Sora keeps Sora.
27. **Stage contrast by frame *and* paper.** In 1.5 all three stages had white inner boxes, so the Combined note looked like a prompt card. 1.6 gives each stage its own inner colour (white / lavender / mint) and a solid header band for Combined to match Final's dark band. (Superseded: Served lost its dark block and band in 1.10 (#39), and Cooked its band in 1.13 (#44); both are light sections now. The principle, that each stage looks clearly different, still holds.)
28. **Ten more palette colours, appended.** Existing ids are untouched and the first eight keep their order, so automatic colour assignment for the first eight projects is unchanged. All new colours are mid-to-dark so white header text stays readable.
29. **Combined recoloured to muted slate (1.7), not another hue.** The owner wanted "modern and adult" with less brightness. A desaturated slate-navy band and a pale cool-grey block read as serious, stay clearly different from the white prompts and the green Final, and don't compete with the saturated column headers. (Superseded: the owner called the slate "too ugly" in round 15. Caramel followed in 1.12 (#43), then Ocean blue in 1.13 (#44).)
30. **Empty stages are outlines.** A solid block in every column, even with nothing in it, made the board loud. Dashed outlines keep the drop target visible (and light up while dragging) without the weight. (Superseded in 1.9 by #38: an empty Cooked or Served shows only its faint name at rest, and its dashed border stays transparent until a drag starts. Don't bring back the at-rest outlines; the owner found the board cluttered.)
31. **New prompts at the bottom; old order untouched.** The owner asked for bottom insertion. Reversing existing columns automatically would rewrite data order the owner may have set by hand, so there's a one-click, undoable "Sort prompts oldest first" instead.
32. **Show more is session-only.** A saved "Show all" is what made a 24-note Final permanently huge. The stored flags are ignored, not deleted (update safety), and the opened-up view is capped with inner scrolling.
33. **A help panel, not a tour.** A single "How Recaller works" page (top-bar ?, F1) explains the stages and shortcuts at any time, with no first-run interruption. A guided first-run tour is on the everyday-user roadmap (`09`).
34. **Kitchen names are labels only (1.8).** Cooking / Cooked / Served replaced prompts / Combined / Final on screen. The data keeps `notes` / `used` / `combined`, and `STAGE_NAME` maps them, so a future rename is a string change.
35. **Cooking's header is light, not a solid band.** A solid band in the column colour directly under the solid column header would merge with it, so it's a tinted row with the same type, chevron and count as the other stage headers.
36. **The prompt count moved from the column title to the Cooking header.** Showing it twice was redundant, and the title gets more room (long names were a past complaint).
37. **New prompt | Dictate as equal halves.** The owner dictates about half the time, so the two ways in get equal targets. On narrow columns the text shortens ("New") rather than the Dictate button shrinking.
38. **Calm board by lightening repeated furniture, not by removing colour from headers (1.9).** With many columns, clutter comes from the same boxes repeated N times. Neutral column bodies, a plain Cooking label, borderless pills, borderless cards and name-only empty stages removed that without using space. The saturated headers stayed, because the owner chose distinct column colours. If it's still too busy, the next step would be a "calm headers" option (dark neutral header with a colour stripe), offered rather than imposed.
39. **Served is light, Cooked is the strongest stage (1.10).** The owner said Served "will always be served", so it shouldn't shout. Emphasis now follows what still needs attention.
40. **Right-click means edit (1.10), but not over a selection.** Right-click opens the same editor as the pencil (card, whole stage text, or one part from a Notes row). If text is selected, the page doesn't take the right-click, so the main process's native Copy menu still works.
41. **Saving closes the new-prompt editor (1.10).** The old "stay open for the next prompt" suited batch typing, but the owner wants the buttons back after each prompt. Dictate or New prompt is one click away.
42. **One filled primary action on the card hover bar (1.11).** The owner moves prompts to Cooked ~90% of the time, so that button is filled and labelled (↓ Cooked) and everything else is a quiet icon. Edit left the bar because right-click and E do it.
43. **Cooked colour: a picker with a default, after two rejections (1.12).** Following lesson 40 (after two rejected taste attempts, show options and add a picker): Caramel is the default because it's warm, reads as "cooked", and differs clearly from the green canvas, the green Served and the white prompts. Petrol was the calm runner-up but too close to the rejected slate. (Superseded in 1.13 by #44: the owner rejected the brown; Ocean is the default, and the browns are gone from the picker.)
44. **Cooked became a light section; brown and dark bands are out (1.13).** Three rejected Cooked looks (violet, slate, brown) all used a heavy dark header band on a tinted box, while Served was accepted once it went light. So the band went and Cooked uses Served's light language, with a clean blue (Ocean) that pairs with the green canvas. A metaphor ("cooked = brown") is not a reason to pick a colour; how it looks on screen is.
45. **Stage pictures are copied separately from the text (1.14).** The owner wanted the Cooked copy to bring its screenshot along. One clipboard write can hold text and one picture, but the Claude Code VS Code chat box (where the owner pastes) attaches the picture and silently drops the text, which would break the main job, copying text. So the pictures show as tiles under the Cooked/Served text and copy with a click: two pastes, but both always land. Revisit if a target app keeps both (a setting "copy the first picture with the text" would be a small change in `copyAugmented` / `copyFinal` plus an IPC that writes `text/plain` + `image/png` in one `ClipboardItem`).
46. **Deleting inside Cooked: a trash per Notes row, plus one in the whole-text editor (1.15).**
    - Why rows: the Cooked note is one text built from separate prompts, so "delete something" has to pick a prompt, and the Notes rows are where single parts already live (↑ ↓ ✎ ↩). The trash goes last, 3px apart, grey until hovered, so a stray click near ↩ is less likely.
    - Why the editor too: right-click means edit for this owner, and the card editor already had a trash. The whole-text editor now matches it, which covers "delete the whole Cooked note" without hunting in the ⋯ menu. It removes only the notes that were in the editor, the same rule `saveStageEdit()` uses.
    - Not chosen: a trash in the Cooked footer (at slim width it would squeeze out the "n prompts · w words" stats, which 1.6/1.7 fixed); swipe-to-delete on the Cooked note (swipe left already moves it to Served); a confirmation dialog (every other delete is instant with Undo).
    - Served got the same controls because the rows and editors are shared code, and one stage having a trash while the other doesn't would be odd.
    - Revisit if the owner can't find the row trash behind the closed **Notes** toggle (e.g. show the parts list open by default when Cooked has 2+ notes, or let Delete on a focused row work).
47. **The board arrows appear on approach, with a slim emerald ring (1.16).**
    - Why on approach: the owner found an always-visible › "kind of annoying". On a wide board it covered part of the last column almost all the time. Showing an arrow only when the pointer is within 96px of its edge keeps it there exactly when someone reaches for it; the wheel, drag-to-pan and the scrollbar cover everything else. The left arrow follows the same rule so the pair behaves alike. Hiding during drags and pans stops it flashing up while auto-scroll does the work.
    - Why this border (built when "a slight border to it" was read as the arrow's border; the owner meant the board frame, #48): three edges were rendered side by side on a real board (a dark hairline with a white gap, a slim emerald ring, a gradient hairline), plus a dark-glass disc and a tall pill. The emerald ring read crispest over both the white cards and the dark canvas, and it reuses the app's own accent, so it stays muted. The disc is opaque because a see-through one went grey on the canvas.
    - Not chosen: a fixed edge rail or gradient strip (more permanent chrome, the opposite of the request); a delay before showing (felt sluggish for a control you reach for on purpose).
    - Revisit if the owner can't find the arrows now, or wants the arrow ring plain again now that the frame carries the border.
48. **The board is a framed panel in a dark shell (1.16).**
    - Why: the owner wanted "a border to organize everything" around the whole board space, "very sleek, very modern, aesthetic". An inset rounded panel is the modern app-shell look: the top bar and a thin margin in its colour become one frame-holder, and the board reads as one organised surface instead of columns floating to the window edge.
    - Why this edge: eight styles were rendered side by side. Hairlines under ~15% opacity vanished on the owner's 1× screen; a double frame looked heavy; a pure gradient sheen faded to nothing on the far edges. The shipped edge keeps an even emerald (about 32–40%) all the way round, so the frame always reads, and adds a bright mint sheen only at the top-left for the "aesthetic" touch, plus a faint glow. Emerald is the app's own accent, so it stays muted.
    - Why the margin is the top-bar colour: it joins the top bar into one shell without adding a new colour, and costs only 12px on each side of an ultrawide screen.
    - The edge strength was judged on the PC's 1× ultrawide. At 2× on the Mac's Retina screen the edge reads stronger; no verdict on it there is recorded yet (`09`, question 14).
    - Not chosen: framing each column (the columns already have edges and shadows; more frames would add clutter, which the owner disliked in round 12).
    - Revisit if the owner finds it too bright or too faint: the strength is all in `--frame-edge` (and `--frame-glow`) in `styles.css`.

The Mac edition of 1.16.0 (seventh session, 2026-09-29, branch `masos`). The owner committed and pushed it as "mac build" (`16961eb` + `9536853`); it was merged into `main` with 1.17.0 on 2026-10-06 (PR #2). How each piece works is in `14_macos.md`; the lessons are in `07`.

49. **One codebase, two downloads, with every Mac difference fenced.**
    - What: the Mac edition reuses the Windows code. Each Mac difference sits behind `IS_MAC` (`process.platform === 'darwin'` in `main.js` and `screenshot.js`; `api.platform === 'darwin'` in `app.js`) or `voice.js`'s own `MAC` (`window.recaller?.platform === 'darwin'`), behind `body.is-mac` in the CSS, in `data-mac` / `data-mac-title` attributes that only Mac code applies, in the `mac` and `dmg` build sections and new npm scripts, or in `tests/e2e/mac-harness.js`, which does nothing on Windows. Helpers such as `kb()` return their input unchanged on Windows. The data format, the userData path, `productName`, `appId`, the NSIS settings, `build/icon.png` and the `dist` and `pack` scripts are unchanged.
    - Why: the owner asked to "keep the windows app as it is, but create another mac os app", as two downloads. One codebase keeps both apps in step, and the fencing keeps Windows exactly as it was, so `masos` can still build the identical Windows installer. The owner created `masos` themselves; `main` and `v1` were not touched.
    - Revisit if: the owner wants a Mac fix on Windows too (for example the draft flush, #60), which would be a deliberate Windows release, or decides to merge `masos` into `main` (`09`, question 18).
50. **The Mac edition is version 1.16.0, not 1.17.0.**
    - Why: it's the same app as the Windows 1.16.0, so the two downloads match (`Recaller Setup 1.16.0.exe` and `Recaller-1.16.0-arm64.dmg`) and Windows needs no rebuild. The discarded 1.17.0 Mac build was never installed.
    - Revisit if: the next change to either app ships; give both apps the new version. If a 1.17.0 build turns out to have been installed anywhere, go above 1.17.0 so the builds can be told apart.
51. **Built fresh; the discarded attempt left alone.**
    - Why: asked whether to reuse the discarded 1.17.0 attempt, the owner answered "Start from scratch". So `stash@{0}` was not read, applied or popped for the build, and the 1.17.0 builds were moved to `dist/_discarded-1.17.0/` (git-ignored; nothing deleted).
    - Revisit if: the owner asks to look at the stash. Even then, restore chosen files only: `git stash pop` would also overwrite `README.md` and every `ai_memory` file with its 1.17.0 notes.
52. **⌘ for Ctrl, and Control-click is a right-click, which edits.**
    - What: on a Mac the app's shortcuts need ⌘ without ⌃ (`modKey()`), and picking several cards is ⌘-click (`multiKey()`). The board's `pointerdown` ignores Control+left-click, so the `contextmenu` listener edits, and it uses the selection read at the press, because a Mac selects the word under a right-click first. A focused card leaves ⌘, ⌃ and ⌥ keys to the menus (⌘H hides the app), except ⌘⌫, which deletes, as in the Finder. Labels come from `kb()` ('Ctrl+Shift+S' → '⇧⌘S', 'Ctrl+Y' → '⇧⌘Z') and the `data-mac` attributes.
    - Why: ⌘ is the Mac's command key. Control-click is how a Mac right-clicks, and right-click means edit for this owner (#40). Mac text fields use ⌃ keys for editing (⌃K deletes to the end of the line, ⌃F moves forward, ⌃N moves down a line), and the Windows-style handlers would have taken them over; ⌃N even threw away an open edit.
    - Revisit if: the owner wants another way to multi-select on a Mac. Control-click can't be both a right-click and a multi-select.
53. **⌃⌥R is the Mac's default show/hide key.**
    - Why: Control and Option sit where Ctrl and Alt are on a PC keyboard, so the owner presses the same keys on both computers. The Windows default, `CommandOrControl+Alt+R`, would be ⌥⌘R on a Mac, which is VS Code's Reveal in Finder, and the owner lives in VS Code (#18).
    - The default applies only when no hotkey is saved yet, so a settings file copied from the PC would bring ⌥⌘R back.
    - Revisit if: ⌃⌥R clashes with something on the owner's Mac (untested).
54. **Closing hides the window; ⌘Q quits.**
    - What: the red button and ⌘W hide the window unless the app is quitting (`quitting`, set on `before-quit`). A Dock click, the hotkey or a menu command brings it back. The hotkey (when Recaller is in front) and "Hide Recaller after copying" call `app.hide()`. With `acceptFirstMouse`, the click that brings Recaller forward also copies the card.
    - Why: Mac apps keep running with their window closed, and Recaller's main way in is the global hotkey, which needs the app running. Keeping the window keeps the page with its drafts and scroll positions, and a global snip always has a page to go to. `app.hide()` hands the focus straight back to the previous app, so a paste lands there; minimising, as on Windows, would leave Recaller the active app.
    - Revisit if: the owner expects closing to quit, or wants a menu-bar icon.
55. **The Mac menu bar: ⌘M stays Dictate, and undo goes through the page.**
    - What: Recaller (About, Settings… ⌘,, Services, Hide, Hide Others, Show All, Quit), Edit (Undo, Redo, then the standard Cut, Copy, Paste, Paste and Match Style and Select All roles), Window (Minimize, Zoom, Close Window ⌘W, Bring All to Front) and Help (How Recaller Works). Commands reach the page over `app:command` (`settings`, `help`, `undo`, `redo`, `fullscreen-on`, `fullscreen-off`).
    - Why Minimize has no ⌘M: ⌘M is Dictate, like Ctrl+M on the PC, and the owner starts about half their prompts by voice (#37). A `role: 'minimize'` item would bring ⌘M with it, so Minimize is a plain item with no key.
    - Why undo goes through the page: the page knows whether a text field is focused (then it's the field's own undo, `document.execCommand`) or not (then it's the board's history), so it works whichever of the page and the menu gets ⌘Z first. It does nothing while the window is hidden or minimised, so ⌘Z can't change the board out of sight.
    - Why not `summon()` for menu commands: it moves focus to the search box. And Settings… leaves an open Settings alone, because repainting it would wipe what's being typed.
    - The standard Edit roles are what give text fields ⌘X, ⌘C, ⌘V and ⌘A on a Mac.
    - Revisit if: the owner wants ⌘M to minimise (Dictate would then need another Mac key), or a View menu.
56. **Ad-hoc signed, Apple Silicon only, not notarized.**
    - What: `identity: "-"` (an ad-hoc signature), `hardenedRuntime: false`, no notarization, an arm64 dmg for macOS 13 or later.
    - Why: the owner answered "Just me for now". Apple Silicon won't launch an app with a broken signature, so an ad-hoc signature is the minimum; it costs nothing, while a Developer ID costs $99 a year. electron-builder 26 did sign ad hoc with `identity: "-"`. The config keeps a Developer ID easy to add later.
    - Cost: a downloaded or AirDropped copy needs **Open Anyway** once (Control-click › Open no longer gets past Gatekeeper on macOS 15 and later). Each build's ad-hoc signature is different, so macOS may ask for the microphone, Screen Recording and the keychain item again after each update.
    - Revisit if: the app is to be shared, or the repeated prompts annoy the owner. Then: a Developer ID, the hardened runtime with the entitlements it needs (such as microphone access), and notarization. Intel Macs would need a universal build.
57. **The Mac-safe test harness.**
    - What: `tests/e2e/mac-harness.js` exports `IS_MAC`, `MOD`, `MOD_KEY`, `macRect()`, `quiet()` and `macState`, and every helper is inert on Windows. `macRect()` places a test window past the outer left or right edge of all displays, on the side away from the pointer, at the top of the display that forms that edge, with 2px left on screen. `quiet()` hides the Dock icon, makes every window ignore the real mouse, stubs `Menu.prototype.popup`, `shell.openExternal` and `shell.openPath`, turns `app.focus` and `app.show` into no-ops, and counts `app.hide` calls in `macState.hides`. The suites send ⌘ (`MOD`) where Windows sends Ctrl. Features skips the real snip on a Mac (3 checks), adds 8 Mac checks and disables `AudioServiceSandbox`.
    - Why: the committed harness was Windows-only. On the Mac it would have left a 200px or 60px strip of each test window on screen, with a Dock icon; its Ctrl+clicks would have been right-clicks; the real snip would have triggered a Screen Recording prompt and captured the owner's screen; and `MODE=real` crashed on the missing `APPDATA`. The owner agreed to runs with 2px windows, no Dock icon, no focus stealing and no microphone or screen recording ("Yes, run them"). The 2px stay on screen because macOS stops drawing a window that is wholly off screen, and `capturePage` and animations stop with it. The sandboxed audio service can't read the fake-microphone WAV.
    - Revisit if: a check needs real focus or a real hide (both are stubbed), or the real snip should be covered on a Mac (it needs Screen Recording permission, so check it by hand).
58. **Full screen is handled.**
    - What: full screen hides the traffic lights, so the top bar takes their space back (`body.is-fullscreen`, from `fullscreen-on` / `fullscreen-off` commands). Closing the window or starting a snip while in full screen leaves full screen first. A full-screen frame is never saved as the window size.
    - Why: found in review. Hiding a full-screen window leaves its Space behind as an empty black screen, and a snip would capture that. A full-screen frame isn't the window's own size.
    - Not chosen: `setVisibleOnAllWorkspaces` for the snip overlay, because it flickers the Dock.
    - Revisit if: the owner snips over another app's full-screen Space (untested).
59. **Permissions: explain them, and open the right pane.**
    - What: `NSMicrophoneUsageDescription` in `Info.plist` and a Mac message for a blocked microphone. Screen Recording is checked before each snip (`getMediaAccessStatus('screen')`); without it, one `desktopCapturer.getSources` call makes macOS list Recaller and show its own prompt the first time, and the snip returns `code: 'PERMISSION'` with a message. **Open System Settings** buttons call `app:open-privacy`, which accepts only `microphone` (`Privacy_Microphone`) and `screen` (`Privacy_ScreenCapture`).
    - Why: without the usage string, macOS kills the app when it opens the microphone. A clear message with a button beats a failed or empty capture. The messages say "turn Recaller on (or off and on again after an update)" because each ad-hoc build can look new to macOS (#56), and Screen Recording applies only after Recaller is quit and reopened.
    - Revisit if: the app gets a Developer ID; the "off and on again" advice may then be unnecessary.
60. **Reliability fixes on the Mac only.**
    - What: a draft still waiting on its 400ms save is saved on `beforeunload`; main flushes on `will-quit` and on the window's `closed`; the daily backup is checked every hour; a global snip is delivered only once the page has loaded (`sendWhenLoaded`); and a cancelled global snip hands the focus back with `app.hide()` (never on `BUSY`, which would hide a snip in progress).
    - Why: ⌘Q never reaches `window-all-closed`, and the page's last save arrives after the `close` flush. A Mac app runs for days without restarting. The same draft gap exists on Windows (`09`, known issue 10), but the owner asked to keep the Windows app as it is.
    - Revisit if: a Windows release is planned. The draft flush is a small fix there too, but it changes Windows behaviour, so ask first.
61. **The same look on the Mac, with system fonts only where needed.**
    - What: the only visual changes are the top-bar padding for the traffic lights (84px, or 14px in full screen), the system font after Geist in the fallback lists (SF Mono and Menlo for mono) and system-font key caps.
    - Why: the owner asked for "a similar mac os app", and their taste is settled (`01`, `05`). The bundled fonts have no ⌘ ⇧ ⌥ ⌃ ↩ glyphs, and the system font draws them the way the macOS menus do. Retina tuning waits until the owner has seen the app.
    - Revisit if: the Mac look review (`09`, question 14) finds the borders too heavy at 2×.
62. **A separate Mac icon on Apple's grid.**
    - What: `build/icon-mac.png`, 1024px: an 824px rounded body inset 100px (radius about 185) with a soft shadow on a transparent canvas, and the Windows icon's gradient, glow and leaf. `npm run icon:mac` renders it in a hidden window and scales the 2× capture down to 1024px. `build/icon.png` (Windows) is untouched.
    - Why: Mac app icons are drawn on Apple's grid, with a transparent margin and a shadow, so they sit at the same size as other apps' icons. An offscreen window's paint frame came back empty, hence the hidden window. The script fails loudly, because without the file electron-builder would quietly use the Windows icon.
    - Revisit if: the owner wants a different Mac icon.
63. **`npm run dist:win` pins x64.**
    - Why: on an Apple Silicon Mac, a bare `--win nsis` builds an arm64 Windows app, and the owner's PC is x64. `npm run dist` stays as it was for building on the PC. `dist:win` hasn't been run yet.

## Accounts and sync (1.17.0, eighth session)

The full reasoning is in `15_accounts_and_sync.md` (section 1.2 lists 20 design decisions, D1–D20, and section 0 the as-built differences). These are the ones to know before changing anything.

64. **Firebase on Google Cloud, called by raw REST from the main process.**
    - What: accounts on Firebase Authentication with Identity Platform (email and password), the board in Cloud Firestore, pictures in Cloud Storage for Firebase, all in the existing project `recaller-cloud` (us-east1, which can't change: the database's location is permanent). Every call is a REST request through Electron's `net.fetch` in main, with the fetch function injected so the code unit-tests under plain Node. No Firebase SDK and no server code of our own.
    - Why: keeps #5 (all network and secrets in main; the page has `connect-src 'none'` and never sees a token), adds no runtime dependency (#2), and allows a Node mock, since the Mac has no Java for Firebase's emulators. `net.fetch` follows system proxies and certificates. Firebase's free tiers cover the owner many times over (`15`, 2.3).
    - Cost: the Storage v0 REST API is documented only through the SDK's own code, so `storage.js` copies its protocol and the smoke test checks it. A per-user quota, an automatic spending cap and scheduled clean-ups would need a server.
    - Revisit if: the app is shared widely (a small Cloud Run service for quotas and clean-up), or Google changes the v0 Storage API.
65. **Local first: the data file stays the source of truth.**
    - What: each computer keeps its full board in `recaller-data.json`, as before. The sync engine never writes that file: it reads the board only as main wrote it, pushes only what is on disk, and changes from the cloud reach the board as patches that the page applies and saves. The shadow (the board as last synced) advances only once that save is on disk. Signed out, nothing runs at all.
    - Why: the owner's first rule is that their data is never changed or lost (`README` golden rule 1). Offline, a crash or a quit can then never lose a note, the update-safety invariants keep holding, and an account is optional.
    - Revisit if: never lightly. A cloud-first model would put every note behind the network.
66. **Terraform for the whole project, plus one script for what it can't express.**
    - What: `infra/terraform/bootstrap` (the state bucket) and `infra/terraform/prod` (everything else, one file per concern), adopted from the earlier setup script by import. The password policy and email enumeration protection, which the provider can't express, are set by `infra/scripts/auth-settings.sh`, which reads first and changes only what differs. Billing and people's access stay outside Terraform on purpose.
    - Why: one source of truth for every resource, reviewable plans, recoverable state (`gs://recaller-cloud-tfstate`, versioned, owners only), and no service account keys (the owner's gcloud login).
    - Cost: plans and state hold secrets, so plans are masked and saved plans deleted (`07` #89); a rules change re-creates the release (`07` #88).
    - Revisit if: the provider gains the two missing settings, or people other than the owner need access.
67. **The look stays on each computer; only "Join notes with" syncs.**
    - What: column widths, folds, scroll, density, title font, Cooked colour, theme, drafts, shortcuts and voice settings stay per computer. Each computer uploads them as a backup that is never applied elsewhere. `prefs.joiner` syncs because it changes what a copy contains.
    - Why: the PC's 5120×1392 ultrawide at 1× and the Mac's Retina screen at 2× want different widths and density, and the owner confirmed it (question Q3, 2026-09-30).
    - Revisit if: the owner wants the title font or Cooked colour to follow them.
68. **Sign-ups are open now.**
    - What: `signup_enabled = true`; anyone with the app can create an account. One Terraform variable pauses sign-ups; existing accounts keep working.
    - Why: the owner's answer (Q6): only they have the app today. Abuse limits are a verified email before any cloud access, Identity Platform's own limits, the rules' size caps, the client's lock-out and the budget alerts.
    - Revisit before: sharing the app with anyone. Then either pause sign-ups or add a hosted privacy and terms page (declined for 1.17 as an extra).
69. **Fast-forward commits counted by a revision, never by clocks.**
    - What: every push is one Firestore commit that raises the account head's `rev` by exactly one, under an `updateTime` precondition, and stamps its items with that rev; a pull reads the revisions it hasn't seen. Order within a list is a fractional key. The rules allow a board commit only together with that head bump, and board writes make no `get()` calls.
    - Why: no clock can be trusted across two computers, a commit is atomic, and a pull can then never miss a write. Access calls add up across a batch (20 per batched write), so a rule that read the head per item would refuse a big first upload.
    - Revisit if: real-time listening is needed (REST has no `listen`; the app polls instead, which is the main cost lever).
70. **Never lose text: conflicts keep both, and an edit beats a delete.**
    - What: when both computers changed a text, the account's version stays in place and this computer's becomes a copy right after it, marked Check again with an "Other version" tag. A deleted note that the other computer edited is kept. Other fields: the later pusher wins. After a restore, a `.bak`, an unreadable file or a downgrade the merge is a union, which never deletes. A first sign-in never uploads a real board without asking, and a push that would delete many notes for no visible reason asks first.
    - Why: the owner's data rule (#65), and a duplicate is easy to delete while a lost note is gone.
    - Cost: conflict copies can pile up, and a union can bring back notes deleted elsewhere (`09`).
71. **Tokens are sealed by the operating system, or not kept at all.**
    - What: the refresh token is sealed with `safeStorage` (DPAPI on Windows, the keychain on a Mac). If that isn't possible the sign-in lasts for the session. It is never written in plain text, and runs from source keep it in memory so no test or dev run touches the keychain.
    - Why: the same protection as the OpenAI key (#5), and the tests must never raise a keychain prompt on the owner's Mac.
    - Revisit if: the app gets a Developer ID (the keychain prompt then stops returning after each update).
72. **Test against an in-process mock, and test the rules three ways.**
    - What: `tests/mock-gcp/` imitates every Google endpoint the app uses, with a JavaScript twin of the rules; `tests/support/peer.js` is a headless second computer; the unit tests include crash injection and a three-computer fuzz test. The rules cases run against the twin, then the real rules engine through the Rules API (free, deploys nothing), then the deployed project (`rules:smoke`, owner-run).
    - Why: tests must never call paid services or touch the owner's data, the Mac can't run the emulators, and the twin plus the real engine keep each other honest.
73. **One version, 1.17.0, for both platforms, from `masos`.**
    - What: Windows and Mac both get accounts in 1.17.0, built from the one codebase on `masos`. The number of the discarded 1.17.0 is reused.
    - Why: the owner's answers (Q2, Q10); those builds were never installed, so no computer's `lastVersion` says 1.17.0 and the upgrade backup still runs. Accounts aren't a Mac difference, so they aren't fenced by `IS_MAC`; only their labels differ ("this PC" / "this Mac", the keychain line).

Decided in the last fix round (2026-10-01), after the final review.

74. **A change held here outlives a deletion elsewhere.**
    - What: a note whose version here the account hasn't seen and can't take yet (moved into a project the account doesn't have, refused, or too large) isn't removed by a deletion from the account, whether the other computer deleted the note or its column; it goes up as an undelete with its project. The other way round, a project's deletion waits while the account still has a live note in it that the push neither deletes nor moves out. (`15` section 0, items 10 and 28.)
    - Why: the deletion elsewhere removed the version the account had, in its old column, not this one, and removing it here would lose a change that only couldn't go up yet (#65, #70). A project deleted while the account still holds a note in it would be brought back by every other computer.
    - Cost: an exception to D10 (a move never beats a delete), so a note deleted on another computer can come back with its new column.
75. **Deleting the account first saves the full-size pictures, strictly, and doesn't pull.**
    - What: before anything is recorded or erased, the engine downloads every full size the board shows that this computer holds only as a preview (`completePictures`, strict). If one can't be saved, nothing is deleted and the deletion can be tried again. No pull runs first. (`15` section 0, items 31 and 32.)
    - Why: the panel promises "This Mac keeps its own copy of the board", and after the deletion nothing could fetch those pictures. A pull was declined because what it brings counts only once the page has saved it, and the page can hold a patch back indefinitely.
    - Cost: a note or picture another computer added since the last pull (one poll) isn't saved here; that computer keeps its own copy.
76. **Reads are halved only on a timeout.**
    - What: a page cut short by its deadline (`TIMEOUT`) is read again in pages half as big, down to one document. A dropped connection (`NETWORK`) fails the cycle as any request does (offline, a backoff) and starts again at the same size. A one-document read that keeps timing out is quiet once, then shows as paused from the second cycle; only a cycle that got through resets that count. (`15` section 0, item 9.)
    - Why: a dropped connection says nothing about a page's size, and smaller pages only make a link that loses answers read more of them. A document the link can never carry in time must show, not retry quietly for ever.
77. **A sign-out saves the full-size pictures for up to 20 s, and a preview stands in for the rest.**
    - What: a plain sign-out, signed in, downloads the board's missing full-size pictures for at most 20 s after the final push ("Saving full-size pictures to this Mac… 3 of 12"), and the toast names what stayed in the account. Where a full size isn't here, `images.js` shows and copies the thumbnail. (`15` section 0, items 29 and 30.)
    - Why: "Your board stays on this computer" must hold signed out, but a sign-out must never hang, so it has a time limit and says what's left. The fallback only matters for pictures from another computer; 1.16 data always has both files.
    - Cost: a sign-out can take up to 20 s longer. Removing the board saves nothing, since the board goes anyway.
78. **The privacy note names what the account really keeps.**
    - What: "Pictures stay in your account until the account is deleted, even after the note or draft that held them is gone", and each computer's platform, Recaller version and last sync time. The page, README and `15` (6.7) say the same words, and `privacy.test.js` checks them against each other and against a device record the engine writes. The version stays 2026-10-01.
    - Why: nothing erases a picture before the account goes (the rules allow it only during a deletion), and the device record holds those fields, so the note must say so.
79. **Firebase's auto-created "Browser key" is kept, in Terraform, with the sign-in APIs only.** (Changed on 2026-10-01, live once the plan saved that day is applied. It was first "left as it is for now", outside Terraform, until a real email showed which key the links carry.)
    - What: `google_apikeys_key.email_page` in `infra/terraform/prod/apikey.tf`, adopted by an import (`imports.tf`, deleted after the apply). Its API list is `email_page_key_services` in `locals.tf`: Identity Toolkit and Secure Token, down from the 27 Firebase gave it. It has `prevent_destroy`, and a precondition refuses an empty list. "Stop everything" can also cut it to the API Keys API, which breaks the email links until undone (`infra/README.md`).
    - Why: the email links carry this key, not the app key. The API metrics (Cloud Monitoring, request counts per credential) showed the owner's click on a verification link as its only use in 7 days (Identity Toolkit's SetAccountInfo), while every call the app makes used the app key. Restricting it fully, or deleting it, would break every verification and reset email; keeping only the sign-in APIs takes Firestore, Storage and the rest out of its reach. The owner step these docs had planned, comparing key values, wasn't needed (`07` #99).
    - Revisit if: an email link stops working after a change to the key, or Firebase creates another browser key.
80. **The budget also alerts early: at 10 % of 15 CAD, and on the month's forecast.** (2026-10-01, live once the plan saved that day is applied.)
    - What: the 15 CAD budget (amount unchanged, Q7) emails at 10 % (1.50 CAD), 50 %, 90 % and 100 % of actual spend (`budget_alert_thresholds` in `variables.tf`), and once when the month's forecast passes 100 % (`budget.tf`). Still alerts only: nothing is capped.
    - Why: normal spend is about 0.00 CAD, so 1.50 CAD of real spend is an early sign of abuse, and a forecast alert can come before the money is spent. Google's cost data can lag a day, so earlier is better.
    - Revisit when: the budget is raised for public sign-up (Q7); with many users, 10 % becomes ordinary spend.

## Release and merge (ninth session, 2026-10-06)

81. **Installers go out as GitHub Releases in the private repo.** (2026-10-06, at the owner's "i want to easily install on another pc".)
    - What: `v1.17.0`, the repo's first tag and release, on `f724f71`, with the Windows installer as its one asset, named `Recaller-Setup-1.17.0.exe` (no spaces). The dmg isn't attached (it is on the Mac). Recipe: `06`, release checklist, Windows step 11.
    - Why: `dist/` and `node_modules/` stay git-ignored (build output; 1.7 GB and 466 MB on the PC), and the 112 MB installer is over GitHub's 100 MB limit for a file in git, while a release asset can be up to 2 GB. Another PC then needs only a browser: no Git, Node or build.
    - Revisit when: the app goes to other people (the repo is private, so only the owner can download), or auto-update arrives (`09`).
82. **`masos` was merged into `main` before the suites ran on the PC.** (2026-10-06, the owner's "okay merge masos to main".)
    - What: PR #2, merge commit `9d30f1f`; `main`'s tree is identical to `masos` (`f724f71`). `v1` stays at 1.16.
    - Why: the owner asked for it. The docs had advised running the suites on the PC first; 1.17.0 was tested on the Mac, and its Windows installer has been installed on the PC since 2026-10-01.
    - Revisit if: a suite fails on the PC. Fix it on a branch and merge again.
