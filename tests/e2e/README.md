# End-to-end tests

These suites drive the real Recaller app with synthetic mouse and keyboard input. Each one runs against a throwaway data folder, a mock OpenAI server and a fake microphone. Test windows stay off-screen and never take focus.

| Command | Suite | Checks |
| --- | --- | --- |
| `npm run test:features` | `features.e2e.js`: layout, copy, swipe, drag, stages, editing, reordering and deleting parts, clearing, pictures in Cooked and Served, highlight, Ctrl+click, live dictation, images, scrolling (and the board arrows showing only near their edge), the board frame, settings, column widths, snip, persistence | 134 |
| `npm run test:update` | `update-safety.e2e.js`: a new version must leave the user's data byte-for-byte unchanged, back it up and restore it | 21 (9 with `MODE=real`) |
| `npm run test:multicopy` | `multi-copy.e2e.js`: Ctrl+click as a real person does it | 12 |
| `npm test` | all three, in the order above | |
| `npm run capture` | `capture-board.js`: renders a sample board to `.out/*.png` for visual review | |

- **Test a packaged build:** set `APP_MAIN` to `dist\win-unpacked\resources\app.asar\src\main.js`.
- **Real data:** `MODE=real` runs the update-safety suite on a *copy* of `%APPDATA%\Recaller`. Delete `.out\data-real` afterwards.
- **Output:** everything goes to `.out/`, which is git-ignored.
- **Before running:** run `node --check <file>` on any suite you edit. A syntax error pops up an Electron error dialog on screen.

## On a Mac

The same commands work on a Mac. `mac-harness.js` keeps a run out of your way there, and does nothing on Windows.

- **Out of sight:** there's no Dock icon. Each test window sits just past the outer edge of your displays, with a 2 px sliver left on screen so macOS keeps drawing it, and your pointer passes through it. The app can't take focus or hide itself, and no native menu, System Settings or Finder window opens.
- **⌘ for Ctrl:** the suites send ⌘ wherever they send Ctrl on Windows (multi-select clicks, ⌘↩, ⌘Z, ⌘Y, ⌘N). Check names still say Ctrl.
- **Features suite:** it skips the real screen snip (3 checks, printed as `SKIP`), which would need Screen Recording permission and would capture your screen. It adds 8 Mac checks: the logo beside the traffic lights, ⌘ key names, Control+click, a real right-click, the menu bar, hide after copying, ⌘H, and a draft saved on quit. That makes 139 checks on a Mac. An `INFO` line prints the title-bar measurements, for tuning.
- **Test a packaged build:** set `APP_MAIN` to `dist/mac-arm64/Recaller.app/Contents/Resources/app.asar/src/main.js`.
- **Real data:** `MODE=real` copies `~/Library/Application Support/Recaller`. Delete `.out/data-real` afterwards.
- **Retina capture:** `SCALE=2 npm run capture` renders at 2×.
- **Clipboard:** the suites use the real clipboard, as on Windows.

Full details are in `../../ai_memory/06_build_test_release.md`.
