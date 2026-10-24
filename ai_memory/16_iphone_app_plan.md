# 16: Plan for the native iPhone app

Written 2026-10-24 (thirteenth session, on the Mac), at the owner's request ("i want proper app"). The owner is getting an Apple Developer account ($99 a year, Individual); until it is approved, everything runs in the iOS Simulator.

## Status (2026-10-24, same session, later): built and running in the Simulator

The owner said "start all phases make the app ui sleak". Built in `ios/` (how to build, test and run: `ios/README.md`). Nothing committed.

- **Works in the Simulator (iPhone 18 Pro, iOS 27.1) against the mock cloud:** sign-in, the account's board pulled down (a fresh install's Welcome board gives way without asking), pictures (thumbnails down, full size on open), the Eating badge, groups, highlights, Cooked and Served. Changes made on the phone reached a desktop peer within a second (`ios/core/dev-mock.js` prints them).
- **Tests:** `ios/core/test/board.test.js` 38/38; `ios/core/test/core.test.js` 2/2 (the bundle in a bare vm context with the bridge in Node, against the mock beside `peer.js`: sign-in, pull, phone edits reaching the desktop, unknown fields on projects and notes surviving, a labelled delete passing the mass-delete guard, a restart still signed in through the sealed token, and no network while signed out); Swift XCTest 37/37 (dictation logic) in the Simulator; the desktop's unit tests after the one-line `state.js` change (below).
- **Not tried yet:** the real cloud (needs the owner's own sign-in on the phone), real dictation (needs the owner's OpenAI key and a microphone), the camera, and tapping through the screens. The Simulator panel needs `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (the owner's password), so this session drove it by `simctl` launches and screenshots, with debug-only launch hooks (`RECALLER_DEV_SIGNIN`, `RECALLER_DEV_SHOW`).
- **One change outside `ios/`:** `src/sync/state.js` `NAMES` gained `ios: 'iPhone'`, so the phone's own device record is named "iPhone". The cloud still gets `platform: 'linux'` for it (`engine.js` maps unknown platforms; the rules allow only darwin/win32/linux), so desktops list it as the name "iPhone" but call its conflict copies "another computer". Adding `'ios'` to the rules and to `PLATFORMS`/`deviceName` on the desktop is the follow-up in "What's needed on Google Cloud".
- **As built, where it differs from the plan below:**
  - The phone's board edits live in JavaScript too (`ios/core/board.js`, ported from app.js with its undo labels), not in Swift: the screens only draw `view()` and send actions. That keeps rule 1 automatic.
  - `src/cloud/index.js` itself runs on the phone, behind a stand-in `electron` module (`ios/core/shims/electron.js`), so sign-in, sign-out, deletion and the choice panels behave exactly as on the desktop. Its `safeStorage` is AES-GCM under a key in the iOS Keychain (`keyStore: 'keychain'`).
  - The bundler is a small script of our own (`ios/core/build.js`, no esbuild), run by Xcode before each build.
  - The column switch is a row of chips (and a swipe on the column's header), not a swipe on the cards: cards swipe right to Cooked and left to delete, which a page swipe would fight.
  - Bundle ID `com.akhan.recaller.ios`, iOS 18 or later, iPhone only, portrait, dark (the Deep theme). The fonts are the desktop's woff2 files, which CoreText loads as they are.
  - The Welcome tips are the iPhone's own ten (the engine recognises an untouched Welcome by shape, not text).

## The goal

A real iPhone app (SwiftUI) that signs into the same Recaller account and shows and edits the same board as the PC and the Mac, synced through the existing Google Cloud project (`recaller-cloud`). It should feel like Recaller: the Deep green theme, the three stages, tap to copy, and dictation.

## The big decision: reuse the desktop's sync code, don't rewrite it

The sync engine (`src/sync/`, `src/cloud/`, about 5,000 lines) is what keeps the owner's notes safe across computers: three-way merges, conflict copies, tombstones and trash, lost-commit recovery, quarantine. It is covered by 715 unit tests, a fuzz test, 219 rules cases and 34 as-built fixes (`15`).

- **Chosen: run that same JavaScript inside the iPhone app** with Apple's built-in JavaScriptCore, behind a small Swift layer. The screens are written natively in SwiftUI.
  - Why: the code barely depends on Node or Electron. Every I/O goes through injected functions (`engine.js:186-193`), and `tests/support/peer.js` already runs the whole stack headless, outside Electron. That's the template for the iPhone host.
  - The Swift layer supplies what Node supplied: `fetch`, timers, sha256/md5 and random bytes (CryptoKit), a small `Buffer` shim, file reads and writes in the app's folder, and the Keychain instead of `safeStorage` for the sign-in token.
  - A build step (esbuild, already a common dev tool) bundles `src/sync` + `src/cloud` + `src/renderer/sync-apply.js` into one file for the app. A fix to sync on the desktop then reaches the iPhone at its next build: the two can't drift apart.
  - Cost: some bridging code, and JavaScriptCore runs slower on iOS (no JIT). That's fine for a board of hundreds to a few thousand notes.
- **Rejected: rewrite the engine in Swift.** About 4,000 lines of edge cases to re-derive, and any slip corrupts the desktop's data (see the rules below).
- **Rejected: the Firebase iOS SDK.** Its offline write queue fights the engine's "head moves by exactly +1" protocol, and it still needs all of the merge logic.

## Rules the iPhone app must keep (or it breaks the desktop)

From `15` and the code. These go into the iPhone app's tests.

1. **Keep every unknown field, with its exact type.** Items are written as whole documents, so dropping a field (`group`, `notepad`, `syncConflict`, anything newer) deletes it for every computer. The board stays in the same JSON shape as `recaller-data.json`; Swift reads what it needs and never rewrites what it doesn't understand.
2. **Never raise `head.schema`.** A `schema: 2` stops sync on every desktop. The app stops syncing itself if it ever sees `schema > 1`.
3. **Write the head only through the update mask**, and only the iPhone's own `commits.<deviceId>` entry. Correct `stats`. Carry `board.joiner` forward.
4. **Pictures are PNG only** (`<32 hex>.png` plus a `.t.png` thumbnail ≤ 640 px), uploaded before the commit that refers to them. Photos from the camera roll (HEIC, JPEG) are converted first.
5. **Per-device things stay on the phone:** drafts, folded and expanded flags, Eaten history, column widths, and the OpenAI key. They're never uploaded (`sync-apply.js:12-18`).

Running the real engine keeps rules 1–4 automatically. Rule 1 is the one the Swift screens must respect.

## What's needed on Google Cloud

**Nothing for the first version.**
- The app key has API limits only, with no app restriction, so it works from an iPhone as it is (`apikey.tf`).
- Sign-in is email and password over REST, the same as the desktop. Verification and reset links open in Safari.
- Apple doesn't require Sign in with Apple, because there is no Google or Facebook login.

**Later, optional (the owner applies these, as always):**
- `'ios'` in the device record's `platform` list (`firestore.rules:128`), plus the desktop's `PLATFORMS`/`NAMES` (`engine.js:47`, `merge.js:17`, `state.js:17`). Then the desktops can name the iPhone in conflict tags and the device list. Until then, the iPhone skips the device record (it's a backup only).
- A separate "Recaller iOS app" key restricted to the bundle ID, for its own usage numbers and rotation.

**Check first:** `infra/README.md` still says "the next plan" (the Storage overwrite fix) waits for the owner, but `imports.tf` and `prod.tfplan` are gone. Ask whether it was applied and whether `rules:smoke` passed 45/45.

## What the app has

**First version (the everyday loop):**
- Sign in, verify email, sign out, delete account (Apple requires in-app deletion).
- The board: **one column per screen, swipe left and right between columns**, with a column list (names and colours, groups, minimized ones) to jump to any column. A mockup comes first, because the owner rejected a "mobile model" look on the desktop (`10`, message 75).
- Each column shows Cooking cards, the Cooked note and the Served text, with the same colours and fonts (Geist, Instrument Sans, the Deep theme).
- **Tap to copy** (with the copy count), copy Cooked, copy Served.
- **New text | Dictate**, equal halves at the bottom, within thumb reach. Save closes the editor. New prompts go at the bottom.
- **↓ Cooked** shown on every card (phones have no hover). Swipe a card left to delete, with Undo. Swipe the Cooked note to Served.
- Long-press to edit a card, Cooked, Served or one part. Highlights (the four colours).
- Projects: new, rename, recolour, reorder, delete, clear Cooked or Served.
- Notepad, Eating and Done, minimized columns and groups, search, the Join notes with setting.
- Pictures: view them, copy one, attach from Photos, the camera or paste.
- Conflict copies with the "Other version" tag.
- Sync when the app opens and every minute while it's open, plus a pull when it comes back to the front.

**Dictation:** the same design as `voice.js` and `transcribe.js`: the phone cuts speech into phrases at pauses, sends each phrase to OpenAI (`gpt-transcribe`, streamed, with the last 400 characters as context), and the text appears word by word. The OpenAI key is pasted once in the iPhone's Settings and kept in the Keychain (it's never synced, same as the desktop). Microphone wording reuses the desktop's: "Recaller listens only while you dictate a prompt, and sends the recording to OpenAI to turn it into text."

**Later:** select several cards to copy them together, the Claude Code format, the Eaten drawer, drag and drop, a Home Screen widget showing one column, a Share button target (send text from any app into a column), Siri and Shortcuts.

**Not on iPhone:** screen snips (the camera and Photos replace them), the global hotkey, widget mode, column resizing, keyboard shortcuts, the menu bar.

## How it's built (phases)

Each phase ends with something the owner can see. Nothing writes to the real account until phase 3.

1. **Setup and a look (Simulator, no developer account needed).** An `ios/` folder in this repo with the Xcode project, bundle ID `com.akhan.recaller.ios`, iOS 18 or later. Bundle the sync code and get it running in JavaScriptCore against the local mock (`tests/mock-gcp/`, which the Simulator reaches on localhost), with `peer.js` playing a desktop. Render the board in the Deep theme with sample data. Screenshots of the phone layout go to the owner to approve.
2. **Read-only on the real account.** Sign in, pull the real board, show it, tap to copy. Sync is pull-only in this build, so the real notes can't be changed.
3. **Editing.** Turn on pushing: new text, move between stages, delete with Undo, edit, highlights, projects. Tested on the mock with `peer.js` first, then on a **test account the owner makes** (a second email), then on the real account. A local backup of the board is kept on the phone before the first push.
4. **Dictation and pictures.**
5. **On the owner's iPhone.** With the developer account: plug the phone in once, turn on Developer Mode, install from Xcode. Then TestFlight, so updates arrive without a cable.
6. **Polish:** app icon (from `build/icon-mac.png`), notepad, groups, Eating, search, settings, account deletion, empty and error states.

## Testing

- The desktop's JavaScript tests keep running as before (`npm run test:unit`); the iPhone bundle is built from the same files.
- New Swift tests (XCTest): the host layer (fetch, timers, crypto, files), a round-trip test that every field of a real-shaped board survives load and save byte for byte, and the board screens.
- End to end in the Simulator: the app and `peer.js` both syncing through `tests/mock-gcp/`, including conflicts, deletes and pictures.
- Never against the real cloud from a script; the owner's own account is touched only by the owner's own phone (phases 2–3).

## Open questions for the owner

1. Does the phone layout (one column per screen, swipe between columns) feel right? A mockup will show it in phase 1.
2. A test account (a second email) for phase 3: the owner creates it in the desktop app.
3. Which iPhone, and which iOS version? (iOS 18 or later is assumed.)
