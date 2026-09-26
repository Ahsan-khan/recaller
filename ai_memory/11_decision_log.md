# 11: Decision log (why things are the way they are)

Read this before reversing any of these choices. Each entry gives the decision, the reason, and what would justify revisiting it.

1. **Electron, not Tauri or a web app.**
   - Why: the owner asked for a desktop app. The machine had Node but no Rust toolchain. Electron has mature APIs for everything needed: `globalShortcut`, `desktopCapturer`, `safeStorage` (DPAPI), clipboard images, custom protocols and NSIS packaging.
   - Revisit if: install size (about 112MB) or memory use becomes a complaint.
2. **Vanilla JavaScript with no framework and no bundler; classic `<script>` tags.**
   - Why: fast startup, no build step, and nothing to break. ES modules over `file://` can hit CORS/origin problems in Chromium, so classic scripts sharing `window.ICONS`, `window.Voice` and `window.recaller` are used.
   - Cost: `app.js` is large (about 3,200 lines).
   - Revisit if: splitting it is needed; then add a bundler deliberately.
3. **Keyed DOM reconciliation (`syncChildren` plus the view maps) instead of re-rendering with innerHTML.**
   - Why: editors, focus, running animations and dictation must survive re-renders. A copy, a count change or a timer re-render must not destroy the open composer.
4. **Custom pointer-event gestures instead of HTML5 drag-and-drop.**
   - Why: one engine handles click-to-copy, press-and-hold, swipe-to-delete and drag, with thresholds, FLIP animations, auto-scroll and cancel-on-blur. HTML5 drag-and-drop can't do swipe, and styles poorly.
5. **All network traffic and the API key stay in the main process.**
   - Why: security. The renderer has `connect-src 'none'`, and the key is DPAPI-encrypted at rest and never sent to the page.
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
16. **Ctrl+click selection works like File Explorer.**
    - The anchor rule: a plain click just before Ctrl+clicks includes that note.
    - The selection clears on window blur, Esc, or a click on empty canvas.
    - Why: this matches how people actually use Ctrl+click, and it fixed the owner's "doesn't copy them together".
17. **Scroll positions are saved only when the user scrolled.** Why: a smaller window at startup clamps scroll, and saving that would silently change remembered state.
18. **Global show/hide hotkey is Ctrl+Alt+R.** Why: Ctrl+Shift+Space would steal VS Code's parameter-hints shortcut, and the owner lives in VS Code.
19. **Screenshots are a custom region snip, not Windows' Snipping Tool.**
    - Why: an integrated flow (hide, snip, attach, reappear) that is exact to the pixel and doesn't depend on another app.
    - Alternative ways in: pasting from any tool, including Win+Shift+S, also works.
20. **Tests are end-to-end suites driving the real app.**
    - Why: the value is in gestures, timing, IPC and persistence, which unit tests wouldn't catch.
    - How: they run off-screen with a mock OpenAI server and a fake microphone.
21. **No git commits unless the owner asks.** This follows the operating rules this project was built under. Since 2026-09-24 the project is its own repo on GitHub; new work stays uncommitted until the owner asks.
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
27. **Stage contrast by frame *and* paper.** In 1.5 all three stages had white inner boxes, so the Combined note looked like a prompt card. 1.6 gives each stage its own inner colour (white / lavender / mint) and a solid header band for Combined to match Final's dark band.
28. **Ten more palette colours, appended.** Existing ids are untouched and the first eight keep their order, so automatic colour assignment for the first eight projects is unchanged. All new colours are mid-to-dark so white header text stays readable.
29. **Combined recoloured to muted slate (1.7), not another hue.** The owner wanted "modern and adult" with less brightness. A desaturated slate-navy band and a pale cool-grey block read as serious, stay clearly different from the white prompts and the green Final, and don't compete with the saturated column headers.
30. **Empty stages are outlines.** A solid block in every column, even with nothing in it, made the board loud. Dashed outlines keep the drop target visible (and light up while dragging) without the weight.
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
43. **Cooked colour: a picker with a default, after two rejections (1.12).** Following lesson 40 (after two rejected taste attempts, show options and add a picker): Caramel is the default because it's warm, reads as "cooked", and differs clearly from the green canvas, the green Served and the white prompts. Petrol was the calm runner-up but too close to the rejected slate.
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
    - Not chosen: framing each column (the columns already have edges and shadows; more frames would add clutter, which the owner disliked in round 12).
    - Revisit if the owner finds it too bright or too faint: the strength is all in `--frame-edge` (and `--frame-glow`) in `styles.css`.
