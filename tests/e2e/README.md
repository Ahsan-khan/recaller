# End-to-end tests

These suites drive the real Recaller app with synthetic mouse and keyboard input. Each one runs against a throwaway data folder, a mock OpenAI server and a fake microphone. Test windows stay off-screen and never take focus.

| Command | Suite | Checks |
| --- | --- | --- |
| `npm run test:features` | `features.e2e.js`: layout, copy, swipe, drag, stages, editing and reordering parts, clearing, highlight, Ctrl+click, live dictation, images, scrolling, settings, column widths, snip, persistence | 112 |
| `npm run test:update` | `update-safety.e2e.js`: a new version must leave the user's data byte-for-byte unchanged, back it up and restore it | 21 (9 with `MODE=real`) |
| `npm run test:multicopy` | `multi-copy.e2e.js`: Ctrl+click as a real person does it | 12 |
| `npm test` | all three, in the order above | |
| `npm run capture` | `capture-board.js`: renders a sample board to `.out/*.png` for visual review | |

- **Test a packaged build:** set `APP_MAIN` to `dist\win-unpacked\resources\app.asar\src\main.js`.
- **Real data:** `MODE=real` runs the update-safety suite on a *copy* of `%APPDATA%\Recaller`. Delete `.out\data-real` afterwards.
- **Output:** everything goes to `.out/`, which is git-ignored.
- **Before running:** run `node --check <file>` on any suite you edit. A syntax error pops up an Electron error dialog on screen.

Full details are in `../../ai_memory/06_build_test_release.md`.
