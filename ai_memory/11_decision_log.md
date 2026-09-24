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
14. **Fonts: Geist for the UI, Sora for column titles, plus a picker.** The owner rejected two title attempts. After a side-by-side comparison, Sora was chosen, and the picker hands the final taste decision to them.
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
21. **No git commits unless the owner asks.** This follows the operating rules this project was built under. The tests and docs are in the repo folder, ready to commit whenever the owner wants.
