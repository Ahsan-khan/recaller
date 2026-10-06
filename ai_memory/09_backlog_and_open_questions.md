# 09: Backlog, known issues and open questions

## Fixed in 1.6.0 (the five known issues from 1.5.0)

1. **"Clear used" cleared the wrong stage.** The ⋯ menu now has **Clear Combined (n)** (data `used`) and **Clear Final (n)** (data `combined`), both undoable with a toast. Clearing archives nothing; see open question 2.
2. **The card "move back" button was never shown.** `.act-back` and its handler were removed.
3. **Leftover dead code from 1.4.0.** The swipe-to-Used path (`g.toFinal`, `swipe-add`), `addToFinal()`, the `is-used` card class and its CSS, and `drag-ghost.is-used` were removed. (A prompt dropped straight onto Final still works; that goes through `dragEnd`.)
4. **Search skipped the combined texts.** Terms are now highlighted inside the Combined note, the Final text and their Notes rows, and a text containing every term opens up while searching: to its full length in 1.6, and since 1.7 only as far as Show more opens it (at most min(56vh, 480px), scrolling inside). Those texts are still not *filtered*, and Enter still copies the top prompt card.
5. **Mixed order inside Augmented.** Parts can now be reordered with ↑ / ↓ in the Notes list. The stored order of older notes was not changed automatically (update safety); the owner can reorder them.

## Making Recaller work for everyone (asked in round 10, 2026-09-24)

The owner asked what it would take for everyday users, not just them. The answer given, in priority order:

**Must-have before handing it to anyone**
1. **Signed installer.** Without it Windows SmartScreen shows "unknown publisher", and most people stop there. Options: an OV code-signing certificate, or Azure Trusted Signing (cheaper, monthly).
2. **Auto-update** (electron-updater + GitHub Releases, since the repo is already there). People won't reinstall by hand, and fixes must reach them.
3. **Voice without an OpenAI key.** Almost nobody has an API key. Options: on-device transcription (whisper.cpp or Windows speech) as the free, private default with OpenAI as an optional upgrade; or a hosted proxy with accounts and billing (which costs money and needs abuse protection).
4. **Onboarding.** A short first-run tour on top of the Welcome project and the 1.7 help panel, and names/labels checked with 3–5 real users (Cooking/Cooked/Served are the owner's words).
5. **Getting data in and out.** Import from text/Markdown/clipboard and export a column or the Served text to `.md`/`.txt`.
6. **Feedback and crash reports** (opt-in), plus a privacy note. Anything paid also needs terms. (1.17.0 has an in-app privacy note for accounts, version 2026-10-01; a hosted privacy and terms page is still open, see "Accounts and sync" below.)

**Should-have**
7. **A macOS build: done for the owner's own use** in the seventh session (the Mac edition of 1.16.0 on branch `masos`, ad-hoc signed, Apple Silicon only; see `08`). **Still open for everyone else:** an Apple Developer ID and notarization, and possibly Intel Macs (see "The Mac edition" below). Many AI-tool users are on Mac.
8. **Accessibility:** keyboard alternatives for every drag and swipe (some exist: U, Delete), keyboard column resize, screen-reader labels, checked contrast.
9. **Light theme polish and "follow system theme".** Advanced voice settings behind an "Advanced" toggle.
10. **An in-app "What's new"** after updates.

**Later / decisions for the owner**
11. **Sync across devices / cloud backup:** built as 1.17.0 (accounts and local-first sync on Google Cloud, eighth session). The cloud side is live since 2026-10-01; the app was released on 2026-10-06 (GitHub Release `v1.17.0`). See "Accounts and sync (1.17.0): what's still open" below and `15`.
12. **Distribution:** a landing page, GitHub Releases, winget or the Microsoft Store (and a dmg download for the Mac). Started for the owner alone: 1.17.0's Windows installer is the GitHub Release `v1.17.0` (2026-10-06). The repo is private, so nobody else can download it.
13. **Business model:** free or paid, who pays for transcription, and support.

## Accounts and sync (1.17.0): what's still open

Built and tested on `masos` (2026-10-01) and committed that evening ("huge", `4370072`); released as GitHub Release `v1.17.0` and merged into `main` on 2026-10-06. The Google Cloud side is live since 2026-10-01. Items 1 to 4 were last checked on 2026-10-01. The design and its as-built differences are in `15`.

**Before the release (in this order):**
1. **The live deploy: done on 2026-10-01.** Checked read-only afterwards: the deployed Firestore and Storage rules are byte-identical to `infra/firebase/*.rules` (released 17:54 UTC), a masked plan says "No changes", the trash TTL is ACTIVE, the Storage agent's grant is there, and the sign-in settings read: enumeration protection on, password policy ENFORCE at 8, sign-ups open, email + password on. Left from the runbook: step 9, the name in the emails (see "The verification email" below).
2. **`npm run rules:smoke`: ran on 2026-10-01 with 43 of 45.** The two failures were one rules gap: the live Storage rules accepted an upload over an existing picture, because in Storage rules that upload is a `create`, which `allow update: if false` never covered. **Fixed in the repo, not deployed yet** (`15`, section 0, item 34): `storage.rules` requires `resource == null` to create, the rules cases and the mock model an overwrite the way the service sends it, and the app counts a picture the account already holds as uploaded (one stat; with other bytes the account's copy stays). Its result and "Recorded" block are in `15`, 2.10 and 9.2. `npm run rules:test` passed all 219 cases on Google's Rules API (2026-10-01).
   **Pending: the owner applies the next plan, before the Mac's Combine in step 7.** It is saved as `infra/terraform/prod/prod.tfplan` and says `Plan: 1 to import, 2 to add, 2 to change, 2 to destroy.`: Firebase's auto-created key imported and cut to the two sign-in APIs, the budget's alerts updated, the Storage ruleset replaced and its release re-created. The Firestore rules, the sign-in config and everything else stay unchanged. After the apply: delete `prod.tfplan` and `imports.tf`, wait up to 10 minutes, run `npm run rules:smoke` (45 of 45 expected), and check that an email link still works (a password reset for a test account, its link opened). The steps are under "The next plan" in `infra/README.md`.
3. **The manual two-computer check** (`15`, 7.7): a real email (after the email steps: the sender "Recaller <noreply@recaller.ponders.ai>", SPF and DKIM PASS, the spam folder, the link host), Upload and Combine both, a picture, an offline conflict, a password change, an account deletion, then the budget page.
4. **The 1.17.0 builds: done on the Mac (2026-10-01).** `dist/Recaller-1.17.0-arm64.dmg` and `dist/Recaller Setup 1.17.0.exe`, with the version bumped and `cloud:config` run. Both packages matched the source file for file, and every Mac suite passes against the packaged `app.asar` (12 + 21 + 139, the same with accounts on, 43). After the storage-overwrite fix and the new account texts they were rebuilt at 16:08 after the storage-overwrite fix and the Spam and "nothing to press" texts; both packages match the source file for file (52 files); `npm run test:unit` 714/714, and from source and against the packaged Mac `app.asar` alike: multi-copy 12/12, update-safety 21/21, features 139/139, the same three with accounts on (no request), sync 43/43. Rebuild again only if the code changes.
5. **The PC:** no suite has run there on `masos` (still true on 2026-10-06, after the merge into `main`). Expect the unit tests, then 12 + 21 + 134, the same three again with accounts on (`test:accounts-on`), then 43.
6. **Commit and merge: done.** The owner committed and pushed 1.17.0 on `masos` on 2026-10-01 ("huge", `4370072`, then the docs, `f724f71`). At their "okay merge masos to main" on 2026-10-06, PR #2 merged it into `main` (`9d30f1f`).
7. **The owner's go-live** (`15`, 8.4): Back up now on both computers, install, sign up and Upload on the PC, then sign in and Combine both on the Mac (and allow the keychain item there). The PC has 1.17.0 installed since 2026-10-01 (about 20:23); whether the owner signed up and uploaded isn't recorded.

**Open risks and owner steps (as of 2026-10-01):**
- **Open sign-ups and the extractable key.** Sign-ups are open, and the app key ships inside every copy of the app, so anyone can take it out. Scripted accounts with real mailboxes can verify their email and then store data within the rules' size limits; only the budget's alerts would notice (from 1.50 CAD once the next plan is applied, and Google's cost data can lag a day). The options: pause sign-ups (`signup_enabled = false`, "Kill switches" in `infra/README.md`), or lower the Identity Platform quotas. App Check doesn't fit a desktop app.
- **Firebase's auto-created "Browser key": answered on 2026-10-01.** The owner step "compare the key in a real verification link with the app key" isn't needed any more. The API metrics (Cloud Monitoring, request counts per credential) showed that the owner's click on a verification link was this key's only use in 7 days (Identity Toolkit's SetAccountInfo), while every call the app makes used the app key. So the email links carry this key, and restricting it fully would break every verification and reset email. It stays, in Terraform as `google_apikeys_key.email_page`, with only Identity Toolkit and Secure Token; the next plan imports it and drops the other 25 of its 27 APIs (`11` #79, "The email-page key" in `infra/README.md`). Never paste key values into a chat.
- **The verification email (owner steps, console and Wix).** The owner's first email (2026-10-01) said "recaller-cloud" and landed in Spam. The app now says to look in Spam; these steps fix the email itself ("Email delivery" in `infra/README.md`):
  1. **The name** (runbook step 9): Project settings › General has no "Public-facing name" field on this project. In the Firebase console, Authentication › Sign-in method › Add new provider › Google: switch Enable on, set "Public-facing name for project" to "Recaller" and a support email, and Save. Then switch Google off again and Save: the name stays (don't leave Google sign-in on). The alternative, not confirmed to fill Firebase's field, is Google Cloud › Google Auth Platform › Branding.
  2. **The sender name** "Recaller" on the verification and password-reset templates (Authentication › Templates).
  3. **Against Spam, a sending domain of our own:** the emails come from Google's shared `firebaseapp.com` sender. On a template, "customize domain" with `recaller.ponders.ai`; add the 4 DNS records the console shows in Wix (ponders.ai's DNS host); when the console says the domain is verified (up to 24 hours), click Apply Custom Domain. ponders.ai's own mail isn't touched. Never put a CNAME on `recaller.ponders.ai` itself.
- **Unverified accounts:** "Use a different email" deletes the new account only within a few minutes of the sign-up, so run `infra/scripts/purge-unverified.js` about once a month (dry run first; its delete call's body is unconfirmed).

**Declined for 1.17, open for later** (the owner: "na no extras"):
- Apple Developer ID signing and notarization (also stops the keychain prompt returning after each ad-hoc-signed update), and Windows code signing. Both cost money.
- Auto-update.
- Intel or universal Mac builds, and a Linux build.
- **A hosted privacy and terms page.** Needed before anyone but the owner uses the app, because sign-ups are open: anyone who has the app can make an account. Until then, pause sign-ups (`signup_enabled = false`) before sharing the app.
- Voice without a personal OpenAI key.

**Features not built yet:**
- **A trash view.** Deleted notes and projects are kept 30 days in the account's `trash/`, but the app can't show or restore them; the privacy note promises they "can be recovered". Today only Undo, the local backups, or the project owner reading the trash copy in the Firebase console can bring one back.
- **Deleted notes' pictures stay in the account until the account is deleted** (the privacy note says so). v2: erase pictures no note or draft uses any more. That needs a rules change: the Storage rules allow a picture to be deleted only while the account is being deleted.
- Changing the account's email, "Sign in with Google", and a scheduled clean-up of never-verified accounts (`infra/scripts/purge-unverified.js` exists, run by hand; its delete call's body is unconfirmed).
- Anything that needs server code: a per-user storage quota, an automatic spending cap, an orphaned-data sweep after an interrupted deletion, and the `minRev` tombstone clean-up job (the protocol is ready; nothing runs it).
- v2 ideas from `15`, 9.1: hold back only the entities an editor holds instead of every content change, and rebase Undo instead of clearing it.

**Known minor issues and v1 trade-offs:**
- Undo history is cleared whenever a change from another computer lands.
- An open editor holds back every incoming content change, and pushes, until it closes ("waiting").
- After a restore, a `.bak` load, an unreadable file or a downgrade, the union merge can bring back notes deleted elsewhere or while signed out. Deliberate: resurrect rather than lose.
- Conflict copies can pile up after heavy offline editing on both computers; they're marked, and deleted like any note.
- Up to 60 s before an untouched, focused window sees a change (instant on summon or focus).
- Pictures from another computer are previews until opened online (`15`, D14). Offline, the full size of such a picture isn't there: the lightbox and copying use the preview. A sign-out saves the missing full sizes first, for up to 20 s.
- No pull before deleting the account (declined: the page can hold a patch back indefinitely). A note or picture another computer added since the last pull (one poll: up to a minute while Recaller is in front) isn't on this computer when the account goes; that computer keeps its own copy.
- On a Mac, the keychain prompt for "Recaller Safe Storage" may come back after every ad-hoc-signed update; refused, the sign-in lasts for the session only.
- Until the email steps above are done, verification and reset emails come from Google's shared sender `noreply@recaller-cloud.firebaseapp.com`, name the project "recaller-cloud", and may land in Spam (the owner's first one did). The app's "Check your email" panel, "Sent again" note and both reset confirmations now say to look in Spam.
- Still unconfirmed (`15`, 9.2): the password-policy body shape (the `auth-settings.sh` output; the smoke test confirmed the policy is enforced); where the recent-login window ends (the smoke test saw ID tokens 4 s and 14 s old accepted); and the `accounts:batchDelete` body (the first `purge-unverified.js --apply`). Settled by `rules:smoke` on 2026-10-01: `runQuery` answers with a JSON array; `Bearer` downloads from Storage v0 work; REQUEST_TIME is the request's arrival time, before `commitTime` (56 ms for a small commit, 1.77 s for 400 writes). Also settled on 2026-10-01: the us-east1 Firestore prices (`15`, 2.3), and the email link host (`recaller-cloud.firebaseapp.com/__/auth/action`) from the owner's first real email.
- Whether Storage checks the rules when a resumable upload starts, or only at its finalize: the mock checks both, and the app handles a refusal at either (`15`, section 0, item 34). A smoke-test record of a resumable overwrite would settle it.
- Removing the board also deletes the kept copies of an unreadable notes file, after the panel names them and the person ticks the box again (`15` section 0, item 12). This landed in the last hour of the session: check it once more on a real run.
- **Very slow links (from the final verification, all rare):**
  - A picture that can't download within http.js's 120 s even on its own (a 32 MB picture below about 2.2 Mbit/s) can't be saved, so deleting the account over that link stops each time, cleanly, with nothing deleted. Later: Range requests or a size-based deadline in `storage.js`.
  - A first sync on a link that loses answers restarts its listing after each loss, as in round 2. A note that can't arrive within 60 s even alone (near 900 KB below about 120 kbit/s) makes every retry list everything before it again (billed reads); the status shows paused. Later: keep the pages already read across failed cycles.
  - Only a TIMEOUT makes read pages smaller; a proxy's 504 or a dropped connection doesn't.
  - Uploads: unconfirmed whether Firebase Storage keeps the bytes of a resumable part the client cut short. If it doesn't, several large pictures pasted together on an uplink below about 400 kbit/s could hold a chunk back for hours. Check once against the real service; the one-at-a-time fallback that downloads now use would fit `uploadPictures` too.
  - A sign-out's 20 s picture save discards downloads still on their way when it ends (up to 4 pictures of wasted download).
- If the page reloads while an account deletion runs, it shows the "Finishing account deletion…" panel with the running progress, and clicking there answers BUSY until the deletion ends.
- Offline, the sign-out toast's "full-size pictures stay in your account" also counts pictures it never tried, including any the account never had.
- **Held deletions (from the final verification; nothing is lost in any of them):**
  - A column's deletion held for a note (`15` section 0, item 10) isn't counted as waiting, so a plain sign-out doesn't mention it; a later union (signing in again after edits made while signed out, a `.bak`, a crash before `state.json`) brings the column back empty here.
  - Its "Delete project" undo label is kept for the whole hold. During a long hold it can explain an unrelated unlabelled deletion, weakening the mass-delete question; and since `st.labels` keeps at most 1000, a very long hold can lose it and ask a needless question when the deletion finally goes.
  - `localOnly().projects` counts a held column deletion as a project "only here", so the sign-out panel's wording can mislead (the refusal itself is right).
  - The merge's held exception also keeps a refused (quarantined) note whose change was only a highlight or a position in the same column, so a column deleted on the other computer comes back there each time while the refusal lasts. Narrower option: apply the exception only to deletions that came with the note's old column.
- `app.js` grew to about 3,900 lines; the risky logic is in `src/sync/` and `sync-apply.js`, with unit tests. Whole-board saves and diffs are O(n) per push, fine to about 10,000 notes.

## The Mac edition: what's still open (seventh session)

The Mac edition of 1.16.0 was built for the owner's own use on branch `masos` (see `14_macos.md` for the whole of it, `08` "1.16.0 for Mac", and `11` #49 onward). The owner committed and pushed it there as "mac build" (`16961eb` + `9536853`, 2026-09-29); it was merged into `main` with 1.17.0 on 2026-10-06 (PR #2). Finder's `.DS_Store`, committed by accident in `16961eb`, was taken out of git and added to `.gitignore` in the owner's next commit, "fix" (`f86cf19`), which they also pushed. Still open:

1. **Signing and notarization for sharing.** The dmg is ad-hoc signed. That is enough on the owner's Mac, where a copy they download or AirDrop needs **Open Anyway** once, but sharing it properly needs an Apple Developer ID ($99 a year), the hardened runtime and notarization. An ad-hoc signature also changes with every build, so macOS may ask again for the microphone, for Screen Recording and for the "Recaller Safe Storage" keychain item after each update. A stable Developer ID signature would stop that. (Question 15.)
2. **Intel Macs.** The dmg is arm64 only; Intel Macs would need a universal (or x64) build. (Question 16.)
3. **Moving the PC's notes to the Mac.** Answered on 2026-09-30 (question 17): through an account in 1.17.0, the PC uploads and the Mac chooses Combine both. Until that ships, the copy below still works. If they want it: quit Recaller on the Mac (⌘Q; closing the window only hides it), then copy only `recaller-data.json` and `images/` from `%APPDATA%\Recaller` into `~/Library/Application Support/Recaller`. That replaces the board the Mac has had since the owner's first run (late on 2026-09-29), so first check that its `backups/` folder exists: the first run started with no data file, so it made no backup. If there's none yet, use Settings › Backups › Back up now before quitting. Don't copy `recaller-settings.json`: its API key is DPAPI-encrypted and can't be decrypted on a Mac (enter the key again there), its saved hotkey `CommandOrControl+Alt+R` would mean ⌥⌘R on a Mac, and its window bounds come from the ultrawide.
4. **Merged into `main`** on 2026-10-06 (question 18, answered; PR #2). The Windows 1.17.0 installer was built on the Mac and is installed on the PC, but the suites still haven't run on the PC from this code. Run them before the next Windows release (expect the unit tests, then 12 + 21 + 134, the same three with accounts on, then 43).
5. **A Mac look review** (question 14). Retina draws 1.5px borders at full weight, so the arrow ring and the composer ring look slightly heavier than on the 1× PC, and the frame edge reads stronger at 2×. Nothing was tuned for Retina.
6. **Full screen and snips.** Snipping over another app's full-screen Space is untested; `setVisibleOnAllWorkspaces` is avoided on purpose, because it flickers the Dock. A snip started while Recaller itself is in full screen first leaves full screen, and the window comes back windowed afterwards, not in full screen.
7. **Start at login** isn't built, on either computer.
8. **Not verified by a session, and not reported by the owner yet:** real key presses (the ⌘ shortcuts, ⌃⌥R, and whether ⌘Z reaches the page or the menu first), the real traffic lights, installing from the dmg, and the microphone, Screen Recording and keychain prompts. The suites only load the packaged `app.asar` in the development Electron; the owner first opened the packaged Recaller.app itself late on 2026-09-29 (at about 20:43 they copied it into `/Applications`, then opened the copy in the mounted dmg, which was still the running Recaller at the end of the session), and how that went isn't recorded. `npm run dist:win` hasn't been run yet either.
9. **Small Mac rough edges:**
   - Run from source (`npm start`, the suites), the app menu is titled "Electron". The packaged app should say "Recaller"; that isn't confirmed yet.
   - The Mac draft flush on `beforeunload` checks `draftTimer`, which is never cleared after its save runs. So once any draft or column pick has been saved in a session, every unload sends one more save of the data in memory. That's harmless, but it's one more reason to quit Recaller before copying data files in.
   - Fixed at the end of the session: the test harness's `macRect()` used to take x from the outermost display but y from the pointer's display, so with an external display at a different height the 2px sliver could land on no display. It now takes y from the display that forms the chosen outer edge. That was checked with simulated screens; the suites themselves have only run on the built-in screen.

## Known issues and rough edges

1. **Internal names still say Augmented and used.** Functions `augmentedText()`, `copyAugmented()`, `moveAugmentedToFinal()`, `startAugGesture()`, CSS `.used*` / `.aug-*`, and flags like `usedCollapsed`. They're internal only; `STAGE_NAME` holds the screen names. Renaming CSS/JS is safe (not data), but it's churn; data field names must never change.
2. **The resize handle has no keyboard equivalent.** Widths can only be changed with the mouse (reset works from the menu and the top bar).
3. **`prefs.colWidths` keeps entries for deleted projects.** Deliberate: undoing a project delete brings its width back. The top-bar reset clears them all, but it only runs, and its button is only enabled, while some current project has a custom width. If only deleted projects' widths remain, the button is disabled and those entries stay in the file.
4. **Whole-text edit merges parts.** Saving a *changed* whole Cooked or Served text replaces its parts with one note (as in 1.5). Per-part editing (✎ in Notes) avoids that. Watch whether the owner expects the parts to survive a whole-text edit.
5. **Mixed prompt order in old columns.** Since 1.7 new prompts go to the bottom, but prompts saved earlier stay newest-first until the owner uses ⋯ → Sort prompts oldest first. It isn't done automatically (update safety; the owner may have ordered some by hand).
6. **`cardTarget()` has an unused `project` variable.** Trivial.
7. **The row trash hides behind the Notes toggle (1.15).** Deleting one prompt from Cooked takes Notes → hover → trash. The Notes list is closed at start and isn't remembered. If the owner doesn't find it, options: open the list by default when Cooked has 2+ notes, remember `augPartsOpen` per column, or make Delete work on a focused row. A hovered row at slim width keeps only ~60px of its text for the five buttons. See also item 14.
8. **Deleting a note from Cooked/Served isn't animated.** The row and the text just update (like ↑ / ↓). Cards animate out; stage parts don't.
9. **The board arrows are less discoverable (1.16).** They show only within 96px of the board's edge, so someone who never moves there won't see them. The wheel, drag-to-pan and the scrollbar still work, and README explains it. If the owner misses them, options: a faint edge hint (a thin gradient or a small notch) while the board overflows, or a wider zone.

Found by the seventh session's audit of the code. They are reported here and **not fixed**: the Mac edition was not allowed to change Windows behaviour.

10. **On Windows, the last keystrokes of a draft can be lost on close or quit.** Draft typing, and `prefs.lastProjectId`, are saved through `persistSoon()`, a 400ms debounce in the page. On Windows nothing sends a waiting save when the window closes or the app quits: the page's `beforeunload` only saves the scroll positions, and main's `flushData()` only writes what the page has already sent. The Mac edition fixes this on the Mac only (a `beforeunload` flush, plus main flushes on `closed` and `will-quit`). Also, `rememberProject()` runs only on a pointer press inside a column, so a column reached by keyboard, menu or search isn't remembered as the last one used.
11. **A failed restore silently drops every later edit.** `restoreBackup()` makes a before-restore backup, sets `restoring = true` and writes the backup's data with `writeJsonAtomic()`, with no try/catch around them. If the write throws, `restoring` stays true and the page isn't reloaded, so every later `data:save` is ignored and `flushData()` does nothing until the next `data:load` (a reload or a restart). The invoke also rejects instead of returning `{ ok: false }`, and the Restore button's handler has no try/catch, so no toast appears. (If the before-restore backup throws, `restoring` isn't set yet, but there's still no toast.)
12. **An unreadable data file can be overwritten by the Welcome board.** If `recaller-data.json` and its `.bak` both fail to parse, `loadData()` returns null. The page then builds the Welcome board and saves it, and main overwrites the unreadable file about 250ms later. If the file parses but `projects` isn't an array, `normalize()` returns null and the Welcome board is shown, and the first change overwrites the file (straight away if the file's `version` is missing or below 2). After that the only good copies are in `backups/` (Settings › Backups), so recovery advice should point there. This matters most when notes are copied between computers by hand. `normalize()` also drops notes whose text isn't a string, images with a bad id and projects that aren't objects, and replaces missing or duplicate ids.
13. **Ctrl+N (⌘N on a Mac) throws away an open edit.** Opening another editor (New prompt, Dictate, a right-click or pencil, E or F2, Ctrl+N) and undo/redo call `stopEditing()` or `closeStageEditors()`, which remove an open card editor or Cooked/Served editor without saving; only the new-prompt composer keeps its text, as a draft. The global Ctrl+K, F, N, M, comma, Shift+N and Shift+S keys have no "typing" guard (only Z and Y do), so Ctrl+N works even while typing in a card editor, and discards that edit along with any dictation running in it. On a Mac ⌃N is a text-editing key and no longer does this, but ⌘N still does.
14. **A press on a Cooked Notes row acts on the whole Cooked note.** The Notes list (`.aug-parts`) sits inside `.aug-note`, so pressing a row anywhere except its buttons starts the whole-note gesture (`startAugGesture`): a click copies all of Cooked, a left swipe moves the whole note to Served, and a drag moves it. A stray left swipe on a row sends everything to Served (undoable). A plain click on a Served row does nothing. No check covers it. It bears on item 7 and question 11.
15. **A second Esc (or ✕) while the composer shows "Writing…" drops dictation.** The first Esc stops listening. A second one closes the composer while phrases are still queued or streaming, and those are lost; only text already inserted survives, in the draft.
16. **The selection bar can be stale.** Clicking the Cooked note or the Served text overwrites the clipboard but leaves a Ctrl+click selection and its "n notes copied" bar in place. Only a card click (`copyNote`) clears the selection.
17. **"Minimize after copying" and multi-copy.** Ctrl+click copies (⌘-click on a Mac) never minimise or hide the window; only single copies do. With the setting on, a plain click minimises or hides the window, and the blur clears the Explorer-style anchor, so "a plain click, then Ctrl+clicks" never includes the first note.
18. **A Served text with only pictures copies nothing.** `copyFinal()` stops when the text is empty, while the Cooked note copies its first picture in that case.
19. **Settings can misstate the API key.** It says "Saved and encrypted on this PC" (on a Mac, "Saved in your Mac’s keychain") whenever the settings file holds a key object and some key is usable. That includes a `{ plain }` key (saved unencrypted when OS encryption was unavailable), and a key that can't be decrypted, such as a DPAPI key copied from the PC to a Mac, while `OPENAI_API_KEY` is set: `getApiKey()` then silently uses the env key instead. Without the env var, a key that can't be decrypted shows "Needed for voice…" and a Remove button.
20. **Backups contain the API key.** Every backup folder copies `recaller-settings.json`, including the saved key (in plain text if it was saved as `{ plain }`). Never share a backup folder. Restore writes back only the data file.
21. **Enter closes Settings.** Settings is a `<form method="dialog">`, so pressing Enter in the API key, Language or Vocabulary field closes it (the typed key is saved on close). Any new button in Settings needs `type="button"`.

## Untested in real conditions

These were covered only by simulations: a fake microphone, a mock OpenAI server, a single display.

- **Real OpenAI calls with the owner's real API key.**
  - Streaming format: the event names come from OpenAI's docs, and there is a non-streaming fallback.
  - The `languages[]` field.
  - The `prompt` context.
  - Error responses (401 and 429 messages).
- **A real microphone** on the owner's hardware, and how well the adaptive voice detection cuts phrases for their voice and room. The owner confirmed in round 2 that transcription came out correct. On the Mac, no session has used the real microphone. The owner's own Recaller (the dmg copy) started its audio service at 20:54:55 on 2026-09-29, so they probably tried dictating. Whether macOS's microphone prompt appeared, what they chose and whether transcription worked isn't recorded; ask.
- **Multi-monitor screenshots**, and displays scaled above 100%. The crop maths uses the display bounds and scale factor, but was only tested at 100%. On the Mac's 2× Retina screen the suites skip the real snip, so it is untested there too; its images would be stored at 2× (a whole-screen snip of 3024×1964).
- **Global hotkeys clashing** with the owner's other apps. Ctrl+Alt+R was chosen to avoid VS Code's Ctrl+Shift+Space. On the Mac, ⌃⌥R was chosen to avoid VS Code's ⌥⌘R (Reveal in Finder); clashes there are untested.
- **Column resizing with a real mouse** on the owner's ultrawide (the suite drives it with synthetic input).
- **macOS:** the Mac edition passes the Mac-safe suites, but only with synthetic input, the fake microphone and no real snip. The session never launched its packaged app; the owner's first run at the end of the seventh session isn't reported yet (see "The Mac edition" above).
- **Linux:** never built or run.
- **Accounts and sync (1.17.0):** on the real Google Cloud project, so far only `npm run rules:test` (the rules texts), `npm run rules:smoke` (real tokens, Firestore and Storage, with throwaway accounts) and the owner's own sign-up (a real verification email, whose link they clicked) have run. Sync between two real computers, the PC, and the Mac's keychain prompt for the sign-in are untested (`15`, status).

## Ideas offered or likely wanted (not requested yet)

- **Import prompt files:** import `Dev Prompts.txt` and `Longterm Prompts.txt` (they were next to the old `iresine\recaller` folder, in `C:\Users\User\Documents\iresine` on the PC) as projects. This was offered at the end of 1.0.0; the owner didn't respond.
- **Export and share:** export a project or the Served text to `.md` or `.txt`.
- **Drag to reorder parts** inside the Notes lists (1.6 has ↑ / ↓ buttons).
- **Archive history:** keep a history of cleared Served texts ("sessions") instead of just clearing.
- **Auto-update** with electron-updater and a GitHub release feed (the repo is on GitHub, and 1.17.0 is its first release). Currently the owner runs each new installer by hand. The repo is private, so a feed for anyone else needs a public releases repo or another host.
- **Code signing,** to remove the SmartScreen warning (and a Developer ID on the Mac; see "The Mac edition" above).
- **Tray icon** (a menu-bar icon on a Mac), or start with Windows (start at login on a Mac).
- **Keyword hints:** the gpt-transcribe `keywords` parameter could replace the prompt-based vocabulary hint (the docs mention a `keywords` array).
- **Pinned prompts:** pin or favourite prompts to the top of a column.
- **Search additions:** a search filter for highlighted prompts ("is:check").
- **Per-column width via keyboard** (e.g. Alt+← / Alt+→ on a focused column).

## Technical debt

- **`src/renderer/app.js` is about 3,900 lines in one file** with 1.17 on `masos` (3,576 in 1.16, and 3,675 with the Mac edition). It is organised by sections but monolithic. Splitting it into modules (views, gestures, composer, stages, settings) would help. Use classic scripts or a bundler; ES modules over `file://` were deliberately avoided.
- **The data and UI names for the stages differ** (`notes` = Cooking, `used` = Cooked, `combined` = Served). This is documented everywhere; a future migration could rename them, but only with a lossless, backed-up, tested migration, and only if the owner agrees.
- **Unit tests only for sync.** Since 1.17 `tests/unit/` covers `src/cloud/`, `src/sync/`, `sync-apply.js`, `src/images.js`, `main.js`'s quit, the account page (`src/renderer/account.js`, in a vm) and the privacy note's wording (714 tests in 20 files, plain Node); the rest of the UI still has only end-to-end suites. The e2e suites depend on timing, and the owner's real mouse moving over the test window can occasionally interfere; re-run before debugging.
- **The test runner can report a crash as a pass.** `scripts/run-electron.js` exits with `code ?? 0`, so a suite that dies from a signal (a crash or a kill) counts as a success to npm, and `npm test` goes on to the next suite. Always check the "n/n passed" line.
- **Two suites can hang.** `multi-copy.e2e.js` and `capture-board.js` have no `.catch` on `app.whenReady().then(…)`, so an exception leaves Electron running, with its window strip, until it's killed. `features` and `update-safety` print HARNESS FAIL and exit.
- **A mistyped MODE skips most update checks.** In `update-safety`, any MODE other than `real` seeds the synthetic data, but its 12 extra checks need `MODE === 'synthetic'` exactly, so `MODE=Real` reports 9/9.
- **The suites use the real clipboard,** on both computers. Copying something during a run loses it, and can fail a check.
- **Two platforms in one codebase.** Every Mac difference sits behind `IS_MAC` (main, renderer and screenshot code; `MAC` in `voice.js`), `body.is-mac` (CSS), the `data-mac` / `data-mac-title` attributes (HTML) or the Mac build sections, and must stay fenced (`11` #49). A change to Windows behaviour should be a deliberate Windows release.
- **The Soft theme gets less attention** than Deep, which is the default and what the owner uses.

## Open questions for the owner

1. Blank line or single new line between joined notes? (The default is blank line; the setting exists.)
2. Should clearing Served archive the text somewhere instead of deleting it (it's only undoable until restart)?
3. Import the two prompt `.txt` files?
4. Do they want auto-update or code signing? (For the Mac, see question 15.)
5. Is Instrument Sans the right column-title font? (Default since 1.6; eight alternatives are in Settings.)
6. Should the count next to "Cooked" go too? (1.6 removed only the counter on the last stage, now Served, as asked.)
7. "All the colors are girly": did that mean only the Combined colours (changed in 1.7), or also the project palette (Blossom pink, Orchid, Fuchsia)? If the palette, offer a muted set.
8. Which everyday-user items (above) to start with? The suggested first three are signing, auto-update and key-free voice.
9. Is the 1.9 calm board calm enough with many columns? If not, offer a "calm headers" option (dark neutral header with a coloured stripe) or a narrower Compact default. Ask; don't impose.
10. Which Cooked colour do they like? (Ocean is the default since 1.13; Teal, Midnight and Graphite are in Settings. Brown is out.)
11. Does the 1.15 delete match what they meant by "delete something in cooked": one prompt (Notes → trash) or the whole note (right-click → trash)? Is the row trash easy enough to find?
12. Does the 1.14 picture flow (copy the text, then click the picture and copy again) work where they paste?
13. The 1.16 board frame (answered: "a border to organize everything" meant the board frame, not the arrow): is the frame's edge right (strength, the bright top-left sheen, the 12px margin)? Should the arrows keep their emerald ring now that the frame exists? Is showing the arrows only near the edge (96px) right?
14. Does the Mac edition look and feel right on the Retina screen? The 1.5px rings and the frame edge read heavier at 2× than on the PC.
15. Should the Mac app get a Developer ID ($99 a year) and notarization, to share it and to stop macOS asking for permissions again after each update? ("Just me for now" was the answer for the first build.)
16. Are Intel Macs needed (a universal build)?
17. Move the PC's notes to the Mac, or keep a separate board on each computer? **Answered 2026-09-30:** through an account in 1.17.0; the PC uploads and the Mac chooses Combine both.
18. Merge `masos` into `main`, and when? **Answered 2026-10-06:** merged by PR #2 (`9d30f1f`).
19. Was 1.16.0 ever installed on the PC? **Moot (checked 2026-10-06):** the PC has 1.17.0 since 2026-10-01.
20. When can the live deploy of accounts and sync happen? **Answered:** the owner deployed it on 2026-10-01. The next plan (`prod.tfplan`) waits for them ("Accounts and sync (1.17.0): what's still open" above).
21. Before anyone else gets the app: pause sign-ups, or add the hosted privacy and terms page first?
22. Which later account features are wanted: a "Recently deleted" view of the 30-day trash, changing the account email, "Sign in with Google", automatic clean-up of unused cloud pictures? (`15`, Q11.)

## Suggested next steps for whoever continues

1. Read `README.md` → `03` → `04` in this folder, and `14` before any Mac work.
2. Run `npm install`, then `npm test`, and confirm everything is green. With 1.17 on `masos`: the unit tests (714), then 12 + 21 + 134 checks on Windows and 12 + 21 + 139 on a Mac (the real snip's 3 checks are skipped there and 8 Mac checks added), the same three suites again with accounts on (`test:accounts-on`), then 43 for accounts and sync. On `main` and `v1` (1.16): 12 + 21 + 134 on Windows only. On the Mac the suites keep out of the way (2px windows, no Dock icon, no focus stealing, no microphone or screen recording), but they overwrite the clipboard. The owner approved running them on the Mac in the seventh session ("Yes, run them"). Run them on a Mac only from a branch that has `tests/e2e/mac-harness.js` (`masos`); on `main` or `v1` they are the Windows-only suites and would, among other things, snip the real screen.
3. Check what's installed. On the PC: 1.17.0 since 2026-10-01 (checked on 2026-10-06). On the Mac, at the very end of the seventh session, the owner copied the packaged 1.16.0 into `/Applications` and then opened the copy inside the mounted dmg (still the running one when the session ended). That run created `~/Library/Application Support/Recaller`, which now holds their real notes. Ask how the first install, the permission prompts and the Mac look went (question 14), and whether the 1.16 frame and arrows are right (question 13). Questions 11 and 12 were never answered either.
4. Check git. As of 2026-10-06: `main` = `origin/main` = `9d30f1f`, PR #2's merge of `masos`, which holds 1.17.0. `masos` = `origin/masos` = `f724f71` (the owner's 1.17.0 commit "huge", `4370072`, then the docs), on top of the Mac edition ("mac build" `16961eb` + `9536853`, "fix" `f86cf19`, "done" `33f62ed`). `v1` = `origin/v1` = `664212a` "1.16". The tag `v1.17.0` carries the GitHub Release with the Windows installer. To see what's on GitHub without fetching, use `git ls-remote origin` (read-only). `stash@{0}` (on the Mac only) is the discarded 1.17.0 attempt: leave it alone. The owner commits versions themselves ("1.8" … "1.16" on `v1`, "mac build" and "huge" (1.17.0) on `masos`) and pushes through GitHub Desktop; don't commit, fetch, pull or push unless asked.
5. Ask the owner the open questions above before building bigger features. The everyday-user roadmap at the top of this file is the biggest next step if they want to share Recaller.
