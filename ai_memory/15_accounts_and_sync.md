# 15: Accounts and sync on Google Cloud (1.17.0: built, tested, packaged and deployed)

**1.20.0 (2026-10-23):** no change to the engine, the rules or the cloud. Two new project fields sync as ordinary unknown fields: `minimized` (a minimized column, on every computer) and `notepad` (a hidden project whose first note is the notepad page; a conflict keeps both texts, shown under the page). The page's `syncBusy()` also waits while the notepad has focus or a save is pending.

**Status (2026-10-06, ninth session):** committed on `masos` ("huge", `4370072`, 2026-10-01), released as GitHub Release `v1.17.0` (the Windows installer only) and merged into `main` (PR #2). The PC has had 1.17.0 installed since 2026-10-01. Nothing below was rechecked in the ninth session.

**Status (2026-10-01, eighth session):** the design below is **built and tested** on `masos`, in the working tree (not committed yet). It is **live** since 2026-10-01: the owner applied the saved plan at about 17:54 UTC (and deleted it), ran `auth-settings.sh` (18:13 UTC) and `npm run rules:smoke` (18:14 UTC). Checked read-only afterwards: the deployed Firestore and Storage rules are byte-identical to `infra/firebase/*.rules` (released 17:54 UTC), a masked plan says "No changes", the trash TTL is ACTIVE, the Storage agent's grant is there, and the sign-in settings read: enumeration protection on, password policy ENFORCE at 8, sign-ups open, email + password on. The 1.17.0 builds exist (2026-10-01, rebuilt at 16:08 after the storage-overwrite fix and the Spam and "nothing to press" texts; both packages match the source file for file (52 files); `npm run test:unit` 714/714, and from source and against the packaged Mac `app.asar` alike: multi-copy 12/12, update-safety 21/21, features 139/139, the same three with accounts on (no request), sync 43/43): `dist/Recaller-1.17.0-arm64.dmg` and `dist/Recaller Setup 1.17.0.exe`.

**The smoke test (2026-10-01): 43 of 45 passed.** Both failures were one gap in the live Storage rules: they accepted an upload over a picture that was already there (section 0, item 34; the result and the "Recorded" block are in 2.10). It is **fixed in the repo, not deployed yet**: `storage.rules` (4.9), the rules cases, the mock and its twin, and the app's handling of a picture the account already holds. `npm run rules:test` passed all 219 cases on Google's Rules API (2026-10-01). Until the fix is deployed the live rules accept overwrites, so deploy before the Mac's Combine (8.4).

**The next plan (saved 2026-10-01, waiting for the owner):** `infra/terraform/prod/prod.tfplan`, `Plan: 1 to import, 2 to add, 2 to change, 2 to destroy.` It imports Firebase's auto-created browser key and cuts its API list to the two sign-in APIs (2.7), updates the budget's alerts (2.8), and replaces the Storage ruleset (`+/-`) and its release (`-/+`) with the fix above. The Firestore rules, the sign-in config and everything else stay unchanged. After the apply: delete `prod.tfplan` and `imports.tf`, wait up to 10 minutes, run `npm run rules:smoke` (**45 of 45 expected**), and check that an email link still works (a password reset for a test account, its link opened). The steps are under "The next plan" in `infra/README.md`.

- **Built:** `src/cloud/` (config, http, codec, auth, firestore, storage, tokens, account, and the `index.js` facade), `src/sync/` (keys, model, diff, merge, state, engine), `src/renderer/account.js` and `sync-apply.js`, and the hooks in `main.js`, `preload.js`, `app.js`, `index.html`, `styles.css`, `icons.js`, `store.js`, `backups.js` and `images.js`. Plus `scripts/cloud-config.js`, `scripts/accounts-on.js`, the npm scripts, and the `infra/` additions (`sync.tf`, the sign-up switch, the real rules texts, `scripts/auth-settings.sh`, `rules-test.js`, `rules-smoke.js`, `purge-unverified.js`; since 2026-10-01 also the email-page key in `apikey.tf` with its one-time `imports.tf`, and the budget's new alerts).
- **Where the code differs from this spec:** section 0, "As built", just below. Where they disagree, the code and section 0 win.
- **Tested** (the final gates, 2026-10-01 08:02–08:12, on the final code with `package.json` at 1.17.0):
  - `npm run test:unit`: **702/702** in all 20 files, plain Node (`tests/unit/`; about 50 s);
  - the GCP mock (`tests/mock-gcp/`) with its JavaScript twin of the rules, and the headless peer (`tests/support/peer.js`);
  - `npm run rules:test`: all **216** cases in `tests/rules/cases.js` (185 Firestore, 31 Storage) pass on Google's real rules engine, through the Rules API's test method, which deploys and reads nothing;
  - `npm run test:sync`: **43/43** on the Mac, from source and against the packaged `app.asar`;
  - the older suites: **12 + 21 + 139** on the Mac (they run with accounts off), from source and against the packaged `app.asar`;
  - `npm run test:accounts-on` runs those three suites again with accounts on and nobody signed in, and fails if the app sends any request (7.6): **12 + 21 + 139, no request**, from source and packaged;
  - both packages (`dist/mac-arm64/…/app.asar`, `dist/win-unpacked/resources/app.asar`): version 1.17.0, all 52 of the app's own files byte-identical to the source, `src/cloud/project.json` and `src/sync/` inside, nothing from `tests/`, `infra/`, `scripts/` or `ai_memory/`. The Mac app is ad-hoc signed; the Windows installer is unsigned and had never run on a PC then (the owner installed it on the PC that evening, at about 20:23).
  - **After the storage-overwrite fix (2026-10-01, section 0 item 34):** `npm run test:unit` **714/714** (12 new tests; one of them checks that 4.8 and 4.9 quote the rules files exactly), and `npm run rules:test` **219/219** (185 Firestore, 34 Storage) on Google's Rules API, once the runner sent `resource: null` for a new upload (section 0, item 34). Then the packages were rebuilt at 16:08 after the storage-overwrite fix and the Spam and "nothing to press" texts; both packages match the source file for file (52 files); `npm run test:unit` 714/714, and from source and against the packaged Mac `app.asar` alike: multi-copy 12/12, update-safety 21/21, features 139/139, the same three with accounts on (no request), sync 43/43. The builds made before the fix (now replaced) were safe with the fixed rules: their code already counted a refused upload of a picture that is there (its tests ran against a mock that refused overwrites, 65 times), only with a second metadata read where the fix makes one.
- **Still open:**
  1. **The live deploy: done** (2026-10-01; see the status above). Left from the runbook: step 9 (2.6), the name in the emails. The owner's first verification email said "recaller-cloud" and landed in Spam. Project settings › General shows no "Public-facing name" field on this project, so step 9 now sets it through the Google sign-in provider (switched on, then off again), then the sender name "Recaller" on both templates. Against Spam: a sending domain of our own, `recaller.ponders.ai` (four DNS records in Wix). Both are console steps for the owner ("Email delivery" in `infra/README.md`).
  2. **The real-cloud smoke test:** run by the owner on 2026-10-01: 43 of 45, with one rules gap (an upload over an existing picture was accepted), fixed in the repo (section 0, item 34). Its result and "Recorded" block are in 2.10 and 9.2. Left: the next plan (above), then `npm run rules:smoke` again (45 of 45 expected).
  3. **The manual two-computer check** (7.7).
  4. **The PC:** the 1.17.0 builds are made (version bumped, `cloud:config`, `dist:mac`, `dist:win`, the Mac suites against the packaged `app.asar`). Still open: all suites on the PC (the unit tests, 12 + 21 + 134, the same three with accounts on, and 43), which have never run there, and a first run of the Windows installer. The builds were remade after the storage-overwrite fix (16:08) and pass every Mac suite again, from source and packaged.
  5. **The saved plans:** the deploy's plan was applied and deleted by the owner on 2026-10-01. The next one, `prod.tfplan`, waits for the owner (above).
- **Infra history:** where this spec says "another session is converting infra" or that `imports.tf` is pending, that finished the same night the spec was written (26 resources imported, plan "No changes", `imports.tf` deleted). The `imports.tf` there now is a new one, with one import (Firebase's auto-created key); it is deleted after the next apply.

**The owner's answers (2026-09-30), which override the open questions in 9.3:**
- **Platforms (Q10):** accounts ship on **both** Windows and Mac, from the one codebase on `masos`, as **1.17.0** for both (Q2). The discarded 1.17.0 builds were never installed anywhere, so reusing the number is safe.
- **Look (Q3):** title font, Cooked colour, theme and density stay **per computer**, as this spec already says. Only "Join notes with" syncs.
- **Sign-ups (Q6):** **open now** (`signup_enabled = true`). Only the owner has the app today. Before sharing it: pause sign-ups (one Terraform variable) or add a hosted privacy and terms page.
- **Privacy contact (Q5):** the privacy note's contact line is **ahsan@ponders.ai**.
- **Budget (Q7):** unchanged, 15 CAD.
- **Two boards (Q4):** the PC uploads, and the Mac chooses Combine both at its first sign-in (the app asks at that moment).
- Q8, Q9 and Q11 keep the spec's defaults.
- **No extras in 1.17 (2026-09-30):** the owner declined adding an Intel/universal Mac build, a Linux build, auto-update and a hosted privacy/terms page to this release ("na no extras"). They stay open for later, alongside the paid items (Apple Developer ID and notarization, Windows code signing) and voice without a personal OpenAI key.

## 0 As built: where the code differs from this spec

Each difference is deliberate, and the code comments name the spec section it changes. Many were fixes for bugs that the verify-and-fix rounds found (`07` #86). Everything else is built as specified.

**Commits and crashes (`src/sync/engine.js`)**
1. **The head names each computer's last landed commit.** Every board commit also writes `commits.<deviceId>` = `"<rev>-<12 hex>"` on the head (its own update-mask path; other computers' commits leave it alone). A commit whose answer never came (no answer, a 5xx, a crash or a quit mid-commit) is settled by the next head read: it landed, it landed and others committed after it (its entities enter the shadow at its rev, so their changes merge as changes and its copy counts count once), or it never landed. Spec 5.5 step 13 relied on the precondition and a pull alone. The rules needed no change.
2. **The outgoing marker.** Before each commit, `state.json.outgoing` records the chunk: its commit id, rev, board, and each item's entry with hashes of its fields (whole and per field), so `state.json` stays small. It is cleared once the answer is known. After a restart those hashes, the shadow and the account's documents rebuild what the commit wrote; a field found nowhere counts as changed on both sides (text and pictures become a conflict copy, never an overwrite).
3. **The ack marker.** The acknowledging save of a patch writes `state.json.ack` (the patch's shadow delta, `H` and the head's update time) together with that save's fingerprint, then `shadow.json`, then `state.json` again. A crash in between is recovered by applying the delta, not by merging again, which would double copy counts. Spec 5.18 relied on the merge finding local == remote.
4. **The probe.** A sign-in in mid-session starts the engine after the page has loaded, so it first sends an empty patch; its acknowledging save tells the page's `contentSeq`, and the real patch follows. `onPageReady` also takes the page's `contentSeq` and what its `data:load` read (`main`, `bak` or `null`), passed on by the facade; that `contentSeq` is the one of the page's last save on disk, never of a save main still holds.

**Restores, deletions and the guard**
5. **The restore hold.** From `onRestore` until the page has loaded the restored file (and while main's `restoring` is set), the engine neither merges against nor pushes from the board before the restore: pulls and pushes wait, a merge already under way is dropped, and an open mass-delete question is cleared. `mode: 'restore'` is persisted before main writes the file.
6. **Tombstones are trimmed after 30 days (`trimTombstones`).** A deleted note or project keeps its last fields in the shadow while the account keeps its trash copy: 30 days from the tombstone's update time, or from when the shadow first held it. Then only the bare tombstone stays, as in the account. The fields let a merge tell an undelete elsewhere from an edit.
7. **The mass-delete record.** `state.json.massDelete = { ids }` holds the question for exactly the deletions it asked about, and the whole push waits until it is answered or those deletions are undone. A delete made later, with its undo label, explains only itself. Undo labels are dropped when no deletion is waiting, so an old label can't explain a later deletion. Upload's tombstoning of the account's pristine Welcome, and an answered **Delete them everywhere**, skip the guard. **Keep them in my account** runs a union that brings the notes back.

**Refusals and slow links**
8. **The 403 retry policy.** A `PERMISSION` answer to a commit is not a refusal at once. The head is read first (deleting or gone: handle that; moved: pull and retry). Then the commit is tried again after about 5 s and 30 s (±20 %), because a rules deploy re-creates the release for a second or two (`07` #88) and the rules can see a race before the precondition does. Only then is the chunk split and the failing items quarantined; each half re-reads the head on its own 403. Creating the head treats a 403 like `ALREADY_EXISTS` (a lost race). Refused pictures are held the same way (`picture:<id>` in the quarantine, "Sync paused" with Retry) while their note goes up without them, and are retried on their own backoff.
9. **The slow-link budgets.** A commit lost on the way while the head read just answered (and hasn't moved) means the link can't carry that much in time. The push is planned again with commits half the size, from 8 MiB down to 256 KiB, before any backoff, and the status doesn't say offline. After 3 commits land, the budget doubles again. A smallest-size commit lost that way is retried after a quiet backoff; only 3 in a row show as an error. Reads are halved only when a page is cut short by its deadline (`TIMEOUT`: a page too big for the link in time). A query page or a `batchGet` (at most 100 documents) cut short that way goes on from its cursor in pages half as big, down to one document, and nothing already read is read again; after 10 full pages the size doubles again. A dropped connection (`NETWORK`) says nothing about a page's size: that cycle fails as any request's would (offline, a backoff), and the read starts again at the size it had. A one-document read that keeps timing out is retried once after a quiet backoff; from the second cycle in a row it shows as paused ("something went wrong"). Only a cycle that gets through resets that count.
10. **A note never goes up without its project.** When a project can't go up (refused, or too large), the notes in it, and notes moved into it, stay on this computer with it and go up once it does. Up on their own, they would make another computer invent a "Recovered notes" column (5.7). They count as existing only here (item 11), not as waiting. A project the account holds only as such a stand-in merges with this computer's version winning. The other way round, a project's deletion doesn't go up while the account still has a live note in that project that the push neither deletes nor moves out (a note moved out of it here but held, say): every other computer would keep the project for that note and bring it back everywhere. The deletion waits for that note, with its undo labels kept; it counts as existing only here, not as waiting. Both rules hold across the halves of a split commit too. The fuzz test checks after every step that the account holds no live note in a deleted or missing project.

**Sign-out, quitting and account deletion (`src/cloud/index.js`, `account.js`, `main.js`)**
11. **Removing the board needs everything to be in the account.** "Also remove this board…" is refused (`PENDING`, with a `localOnly` count) while anything exists only on this computer, even with `force`: changes still waiting; quarantined notes or projects; too-large notes and projects, also before any push has recorded them (so offline too); the notes held with such a project and the deletions of projects held for a note (item 10); pictures the account lacks (refused, over 32 MB or not uploaded yet); or the whole board while the account doesn't hold it (no first sync yet, the cloud board missing or being deleted, the account deleted or turned off). `status()` counts too-large items the same way. Spec 5.14 refused it only while `pending > 0`.
12. **Consent for the unreadable copies.** The removal also deletes the `recaller-data.unreadable-*.json` copies (3.5), which may hold notes nothing else has, so they go only with explicit consent. `account:sign-out` takes a third flag, `removeUnreadable`. Without it, main answers `PENDING` with `localOnly.unreadable`; the panel then says "This PC also holds 2 unreadable copies of an older notes file, which may have notes this board doesn't. To remove them with the board, tick the box again.", unticks the box, and its label gains ", plus 2 unreadable copies of an older notes file". Ticking it again agrees.
13. **Saves are held during the removal.** `cloud.init()` gets a `holdSaves()` dep from main that works like `restoring`: the page's saves are ignored until it reloads on the Welcome board. Before the engine stops, `drain(2 s)` lets a patch on its way land, or withdraws it with an empty patch.
14. **No final push while the computer logs out, restarts or shuts down.** On Windows the window's `session-end` sets `sessionEnding` in main. On a Mac powerMonitor's `shutdown` (watched from the first sign-in on, never before; never ⌘Q) records when the notice came (`sessionEndingAt`), and it counts for 60 s: a log out the person cancels doesn't turn the final push off for the rest of the run. Within that time, or after `session-end`, the `before-quit` listener lets the quit through at once: holding it up would make macOS report that Recaller cancelled the log out. Changes not uploaded stay in the data file and go up at the next start. Spec 5.16 gave only Windows' `session-end` nothing new.
15. **A save acknowledging a patch never replaces the save waiting before it.** Signed in, `scheduleDataWrite()` writes the waiting save first when an acknowledging one arrives, so the engine sees what it held. A draft saved into a column that "Use my account's board" removes therefore reaches the disk, and the engine puts it in a `before-sync` backup before the board is replaced.
16. **`image:copy` downloads inside the clipboard queue.** Signed in, fetching a picture from the account and writing it to the clipboard happen together in `inOrder()`, so a copy made after it still lands last.
17. **Deletion signs in again before the last step.** `accounts:delete` wants a sign-in from the last ~5 minutes, and a big board takes longer to erase, so the same password (held only by the call) re-authenticates again just before step 7.
18. **"Use a different email"** deletes the unverified account only while the sign-up is recent: `accounts:delete` wants a sign-in from the last ~5 minutes. Later (or after any other refusal except `NETWORK` or `TOO_MANY_ATTEMPTS`, which change nothing and can be tried again) the account is left for `infra/scripts/purge-unverified.js`, and this computer signs out anyway. An account that was verified meanwhile is left alone (it may be in use elsewhere), and only this computer signs out.
19. **The device record knows its folder.** `device.json` also stores `place`, the `sync/` folder's inode and birth time. A copied folder is told apart by the folder, not only by the host hash, because a Mac's hostname can change with the network.
20. **Extra API:** `status().tooLargePictures`; `counts()`, which `AccountState.counts` carries for the delete panel; `deletion()`; `localOnly()` (with `unreadable`); `drain(ms)`; `onAccountChange()`; `completePictures({ deadline, strict, onProgress })` (items 29 and 31); and `idle()`, `whenIdle()`, `busy()` and `debug()` for tests. `AccountState.devices` entries carry an `id`; `AccountState.signingOut` is a plain sign-out's progress while it saves pictures (item 29), and `AccountState.deleting.what` can also be `'save-pictures'` (item 31). A plain sign-out answers `{ ok: true, picturesLeft }` when some full-size pictures stayed in the account. `cloud.init()` also takes `holdSaves` and `onShutdown`.

**The page (`app.js`)**
21. **More busy states hold a content patch:** a pointer still down on the board, a card sliding out after a delete, and a swiped Cooked note (for 1 s). A patch with `resetHistory` but no content change also waits, and clears the history.
22. **The draft rule in the page.** A patch that would remove a column holding a draft typed after main read the file isn't applied: the page saves the draft and answers `stale`, so main's next merge keeps the column. "Use my account's board" is the exception (item 15).
23. **The conflict toast** says "the copy" instead of "this Mac's" when the copies hold the other computer's text (a restore with no base keeps the local version in place). The card tag's tooltip names the computer from `AccountState.devices`.

**Infra (`infra/`)**
24. **"Stop everything" never empties a key's API list.** A key with no API targets works for every API. The kill switch sets `app_key_services = ["apikeys.googleapis.com"]` and `signup_enabled = false` (so no key of the project can make accounts), after replacing both rules files with deny-all texts (ID tokens stay valid for up to an hour). Spec 2.7 said to empty the list. Firebase's auto-created "Browser key" is the key in the email links, and since 2026-10-01 it is in Terraform as `google_apikeys_key.email_page`, limited to the sign-in APIs (2.7; the next plan imports it). The deny-all rules and `signup_enabled = false` already stop data access and new accounts for it too. Setting `email_page_key_services = ["apikeys.googleapis.com"]` would also stop sign-in with it, but breaks every verification and reset link until it is undone. Neither list may be empty: a precondition refuses that at plan time.
25. **The sync plan** is `18 to add, 0 to change, 4 to destroy`: 13 Firestore fields, the IAM member, and both rulesets and releases replaced. The Identity Platform config doesn't change: the adopted state already has both `client.permissions` switches off. Spec 2.4 expected one change there.
26. **`infra/.gitattributes`** keeps the rules, Terraform and shell files LF: Terraform uploads the rules byte for byte, so a CRLF checkout on the PC would plan new rulesets.
27. **Settled on the first `rules:test` run (2026-09-30):** the Rules API mocks `get` in Firestore rules and `firestore.get` in Storage rules (one item of 9.2). The other unconfirmed items wait for `rules:smoke` (it ran on 2026-10-01: 2.10 and 9.2).

**Held notes, full-size pictures and reset links (added in the last fix round, 2026-10-01)**
28. **A note held here outlives a deletion in the account** (`merge.js`, the `held` option). A note whose version here the account hasn't seen and can't take yet (held with a project the account doesn't have, item 10; refused; or too large) isn't removed when a deletion arrives from the account, whether the other computer deleted the note itself or its column. The merge treats it as a change made here: it stays, and goes up as an undelete together with its project. This is an exception to D10 (a move never beats a delete): moved here into a held project, the note still sits in its old column in the account, and a deletion there must not take it from where it is now.
29. **A plain sign-out first saves the full-size pictures here** (`src/cloud/index.js`). Pictures from another computer arrive as thumbnails, and their full size comes down only when opened (D14); signed out, nothing could fetch it. So a sign-out without "Also remove this board", while signed in, runs the final push and then, for at most 20 s, downloads the full size of every picture the board shows that this computer holds only as a preview (`completePictures`, not strict; the thumbnail first when that is missing too). They go 4 at a time; once a download times out while others share the link, they go one at a time, and each that timed out is tried once more on its own. No download starts after the 20 s (not even a full size whose thumbnail just came), and those still on their way when the sign-out ends are dropped. The status line says "Saving full-size pictures to this Mac… 3 of 12" ("this PC" on Windows; `AccountState.signingOut`). Offline, nothing is tried. The answer carries `picturesLeft`: the pictures not saved (not tried, cut short or failed), which stay in the account. A picture whose download finds the account without it isn't counted (one never tried still is), and none are while the account is being deleted elsewhere. The toast then says "Signed out. 3 full-size pictures stay in your account, and this Mac keeps their previews. Signing in again brings them here." (6.2).
30. **A full size missing here is shown and copied from its preview** (`src/images.js`). `recaller-img://` now falls back from a missing full size to the thumbnail (it already fell back the other way), after `fetchMissing` has had its try while signed in, and `readPng()` for `image:copy` reads the thumbnail when only that is here. That happens only for a picture from another computer whose full size never came down (offline, or signed out since). With 1.16 data every picture has both files, so it never happens there.
31. **Account deletion first saves the full-size pictures here** (`engine.deleteAccountData`). After step 1's re-authentication, and before anything is recorded (`state.deletion`) or erased, `completePictures({ strict: true })` downloads the full size of every picture the board shows that this computer holds only as a preview, as in item 29 but with no time limit, reported as `deleting.what = 'save-pictures'`. The first picture that can't be saved (offline included; a picture the account doesn't have isn't a failure) stops the deletion with nothing deleted, and so does a stop, a sign-out or a sign-in that stopped working meanwhile; it can be tried again from the start. A deletion resumed after that step had passed goes straight on. There is no pull first, on purpose: what a pull brings counts only once the page has saved it, and the page can hold a patch back indefinitely. So a note or picture another computer added since the last pull, at most one poll ago, isn't saved here; that computer keeps its own copy.
32. **The delete panel says what happened** (`src/renderer/account.js`). Its progress starts with "Saving full-size pictures to this Mac… 3 of 12" ("this PC" on Windows). A failure during that step says "Nothing was deleted: not every full-size picture could be saved to this Mac first. Check your connection, then try again."; a failure after it still says "Deletion stopped partway. Sign in again to finish it." (6.2).
33. **Reset links wait a minute** (`src/cloud/account.js` and `src/renderer/account.js`). "Send link" and "Change password" wait 60 s after a link went out, like "Send again", and count down ("Send link (42 s)"). Main also sends at most one reset link per email a minute: another request in that minute sends nothing and answers `RESET_UNAVAILABLE` with `retryAfterMs`; the page shows "Recaller can't send a reset link right now. Wait a while, then try again." and the button counts down that long (at most a minute). The limit counts every address, known or not, so the answer still never tells whether an account exists (5.13). A failed request starts no wait.

**Pictures the account already holds (found by the live smoke test, 2026-10-01)**
34. **An upload over a picture that is already there is refused, and the app counts the picture as uploaded** (`infra/firebase/storage.rules`, `src/cloud/storage.js`, `sendPicture` in `engine.js`, `tests/rules/cases.js`, `tests/mock-gcp/`). Not deployed yet (see the status).
    - **What the smoke test found.** Step 7 uploaded a thumbnail, then other bytes (an 8×8 PNG) under the same name: the live service answered 200, and the next download returned the new bytes. Both FAILs, and the "other bytes" of the `Bearer` record (2.10), are this one cause. In Cloud Storage for Firebase rules every upload of a file's contents is a `create`, also over a file that exists (`resource` then holds that file's metadata); `update` covers only changes to an existing file's metadata. So `allow update: if false` never applied to an overwrite, and `allow create` let it through. The fix (4.9): `allow create` also requires `resource == null`, right after `isOwner`, so an overwrite is refused before the head is read; `update` stays refused. A new upload is unaffected: nothing is stored under its name (a soft-deleted file isn't live).
    - **Why the 216 Rules API cases passed.** `cases.js` modelled the overwrite as method `update`, and the Rules API evaluates exactly the method a case names: the case proved a request the service never sends. The mock did the same (it asked its twin `update` when a file existed), so the twin agreed. The mock still refused overwrites (its twin denies `update`), so the app's refusal path did run (65 refused overwrites in the unit tests before the fix); only the method was wrong. Now the cases model an overwrite as a `create` with `existing` set (3 cases, all DENY) and keep a metadata `update` (DENY), and `validate()` allows `existing` on a Storage create; the mock evaluates every upload as `create` with `resource` = the stored file's metadata, at a resumable start and again at its finalize; the twin implements `resource == null`.
    - **The app.** After a 403, `storage.upload()` reads the file's metadata once, with the owner's own ID token: the same size and `md5Hash` → `{ existed: true }`; other bytes → `{ existed: true, differs: true }` with the account's size and hash. Other bytes mean another computer uploaded that picture first: in practice a thumbnail it made itself (another platform's or Electron version's encoder can give other bytes for the same picture). The account's copy is the shared one for that id and stays: nothing may replace it, and nothing is lost, because this computer keeps its own file. A full-size picture can't come out differently that way (ids are random, and a picture copied by hand is the same file); it would take a file changed after its upload, or a server fault. The same rule holds then, with one consequence: "Also remove this board" would remove this computer's version, and the account keeps its own. The picture counts as uploaded (`st.uploaded`), is never held ("Sync paused") or tried again, and the engine logs one line ("the account already holds this thumbnail with other bytes…"). Nothing there, or the stat refused too, is a real refusal, as before. A stat that can't answer (offline, a timeout, a 5xx) now throws its own error, so the cycle tries again later, instead of passing as PERMISSION. The engine's own second stat after a refusal is gone. Spec 3.3 said other bytes were PERMISSION.
    - **Where an upload meets a picture that is there:** a lost answer (a multipart upload, or a resumable finalize whose session can't be asked); a crash or a quit before `state.json` recorded the upload; a picture `pruneUploaded` forgot (nothing showed it) that comes back (an Undo, a restore); a head made again (`freshState` drops `uploaded`); a board whose pictures another computer uploaded first (Combine both after the boards were once copied by hand: the owner's go-live, 8.4); a thumbnail `ensureThumb` made here after the picture came down, when another computer had uploaded one first; draft pictures for the device record after a crash. Account deletion uploads nothing. Each costs one refused upload and one stat. A resumable upload is refused at its start if the service checks the rules there (the mock does), and at its finalize otherwise.
    - **Until the fix is deployed** the live rules accept such an upload, and the last computer's copy replaces the account's: the same bytes for a picture copied by hand, at worst another encoder's thumbnail. Nothing is lost either way, but deploy before the Mac's Combine.
    - **The Rules API needs `resource: null` said out loud (2026-10-01).** The first `rules:test` run after the fix failed the 3 ALLOW cases of a new upload with "Null value error" on `resource == null`: a TestCase without `resource` leaves it unset, while production passes null for a new file. `infra/scripts/rules-test.js` now sends `resource: null` for a Storage create with nothing stored (7.7). With that, `npm run rules:test` passed 219 of 219 on Google's Rules API. The rules texts didn't change.

---


This is the spec the team will build from. It starts from the two judges' verdicts. Judge 1 picked A (its data-safety core) and judge 2 picked C (its simple skeleton). The spec grafts in what both recommend and fixes every item on both must-fix lists. It uses the fact sheet for every Google Cloud assumption, and it was checked against the code on `masos` at `33f62ed` and against the live `infra/` folder on 2026-09-30.

**Infra changed during this run, after the judges read it.** `infra/gcp/setup.sh` and `infra/gcp/README.md` no longer exist. The project is now managed by Terraform:
- `infra/README.md`;
- `infra/terraform/bootstrap`, with state in `gs://recaller-cloud-tfstate`;
- `infra/terraform/prod`, one file per concern;
- `infra/firebase/firestore.rules` and `storage.rules`, locked for now;
- the git-ignored `infra/gcp/project.json`.

The files were written between 23:50 and 23:59 EDT, and another session was still working on them. `infra/terraform/prod/imports.tf` shows that the one-time adoption apply is still pending. So this spec puts every infrastructure change in the Terraform layout, and uses two small REST scripts only for settings the provider can't express.

---

## 1 Summary of decisions

### 1.1 The design in one paragraph

**Accounts.** Accounts are email and password in Firebase Authentication on Identity Platform, in the existing project `recaller-cloud`.

**Where the data lives.**
- The board goes to Cloud Firestore, database `(default)` in `us-east1`:
  - one per-user head document;
  - one document per project and one per note, in any stage;
  - a 30-day trash;
  - one record per computer.
- Pictures go to the existing bucket `gs://recaller-cloud-data`, as `.png` plus `.t.png`.
- There is no server code of our own.

**Where the code runs.** All network code runs in the Electron main process, as raw REST calls through `net.fetch`.
- No runtime npm dependency is added.
- The page keeps `connect-src 'none'` and never sees a token.

**How sync works.**
- The local file stays the source of truth.
- The engine pushes only data that `flushData()` has already written.
- Every push is a fast-forward-only commit that raises the head's `rev` by exactly one, with an `updateTime` precondition.
- Pulls read the range `(state.rev, head.rev]`. No clock is ever used for ordering.
- Remote changes reach the page as entity-level patches. The page applies a patch only when nobody is mid-edit, then acknowledges it by saving. The engine records the change as synced only after that save is on disk.

**Signed out,** the app behaves like 1.16.0: no sync files, no network and no timers. The only visible difference is one new Settings section.

### 1.2 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Reuse `recaller-cloud` as it is: project number 700753939032, Firestore `(default)` in **us-east1** with delete protection and daily backups kept 7 days, bucket `recaller-cloud-data` in US-EAST1 with 7-day soft delete, the API key "Recaller desktop app", the default Hosting site for the email pages, and the 15 CAD budget | All of it exists, and Firestore's location can't change. nam5 and us-central1 are ruled out |
| D2 | Terraform for every resource it can express. The password policy and the enumeration-protection check go in one idempotent REST script. The team doesn't set email templates or IAM for people | "Setup script or Terraform for each resource, never both". The google provider 8.5.0 pinned here has no `passwordPolicyConfig` and no `emailPrivacyConfig`. I checked the provider binary's schema strings |
| D3 | Raw REST from the main process through `net.fetch`, with `fetchImpl` injected so the code unit-tests under plain Node. No Firebase SDK | Security decision #5, no runtime dependency, and a Node mock is possible because this Mac has no Java for the emulators. `net.fetch` also follows system proxies and OS certificates |
| D4 | **No `get()`, `exists()` or `getAfter()` in any board write rule.** Board writes are gated atomically by the head write in the same commit. Item `_sync.rev` can only move forward (`resource` check, no access call). A 30-day id-and-rev audit, plus an audit whenever `head.stats` disagrees with the local shadow | The docs say access calls add up across a batched write (20 per batch, 10 per write), and they don't say which calls are cached. With per-item head checks, a 400-write first upload would be `PERMISSION_DENIED`. This design never makes such calls, so it doesn't depend on caching |
| D5 | Separate `projects`, `notes`, `trash` and `devices` subcollections under `users/{uid}`, with readable field names identical to the local file. Unrepresentable values go to `_json` | The owner asked that "everything is stored". The console reads like the data file. Two pull queries instead of one cost almost nothing |
| D6 | Tombstones are kept (minimal, `_sync` only). Every deletion also writes a full copy to `trash/` with a 30-day TTL. Hard deletes happen only during account deletion, or for tombstones below `head.minRev`, which the rules allow but v1 never does | Nothing is lost silently, and a deleted note can be recovered for 30 days |
| D7 | **Durability:** the engine reads local state only from `onFileWritten()` (after `writeJsonAtomic` succeeds). The shadow advances per committed chunk, and for pulls only after the page's acknowledging save is on disk | This closes the crash-loses-a-note hole found in B and C |
| D8 | **Union mode** is used after a restore, a `.bak` load, the Welcome seed, or a data file whose fingerprint (sha256 of what we last wrote) doesn't match. In union mode, a note missing locally never means it was deleted. A restore prefers the restored version | This protects small boards and removes the 20- and 25-note thresholds |
| D9 | Remote changes are applied as **entity-level patches** that reuse the page's live objects. A patch that changes content waits while an editor, drag, resize, pan, menu, dictation, busy composer or Undo toast is active. It is rejected as stale if the page's `contentSeq` moved. **Undo and redo history is cleared** when a content patch is applied (a documented v1 trade-off). Parking only the held entities, and rebasing undo, are listed for v2 | Simple and testable, with no silent revert through undo |
| D10 | Conflicts. When both computers change a text, the account's version stays in place and this computer's becomes a copy right after it, marked amber ("Check again") with `syncConflict`. An edit to the text beats a delete. A move, highlight or copy never beats a delete. For other fields, when both sides changed one, the later pusher wins | Converges, and never loses text |
| D11 | Copy counts sync as a counter merged as `remote + (local − base)`. This is exact because pushes are serialised by the precondition. `lastCopiedAt` takes the larger value. A copy is never counted as a content change on the page | The count shows on cards, so both computers should agree. No per-device map is needed |
| D12 | What syncs: projects, notes in all stages, their order, highlights, copy counts, pictures and the `joiner` preference. Each computer's view (widths, density, scroll, folds, title font, Cooked colour, card expansion), drafts, draft pictures and an allow-list of settings are uploaded as a **backup-only device record**, never applied to another computer. The OpenAI key and local backups are never uploaded | Screens differ (5120×1392 at 1× and a Retina at 2×). The allow-list is enforced by the security rules |
| D13 | Adaptive polling: 60 s when focused, 5 min when visible but unfocused, 30 min when hidden. Pull at once on summon (⌃⌥R or Ctrl+Alt+R), focus, show, resume, unlock, back online and page ready | `listen` isn't available over REST. This is the main cost lever |
| D14 | Thumbnails are uploaded. Full-size pictures download lazily, through the `recaller-img://` handler, the lightbox and `image:copy`. A merge never waits for downloads | Egress is the dominant cost at scale |
| D15 | Storage v0 uses `Authorization: Firebase <idToken>`, multipart up to 256 KiB and the SDK's resumable protocol above that. Storage rules read the head (`firestore.get`) **only on create and delete**, using the IAM grant `roles/firebaserules.firestoreServiceAgent` to `service-700753939032@gcp-sa-firebasestorage.iam.gserviceaccount.com` | Account deletion blocks uploads from the server side, and pictures are immutable |
| D16 | First sign-in never uploads a real board without asking: "Upload this board?", or Combine / Use my account's board. A pristine Welcome board is detected by structure and never forces a question | Protects shared computers (judge 1, must-fix #6) |
| D17 | The refresh token is sealed with `safeStorage` in `sync/account.json`. If sealing isn't possible, the sign-in lasts for the session only. `{plain}` is never stored outside a loopback-mock test. **Runs from source default to a memory store,** so no development or test run ever touches the keychain | Must-fixes #9 and #10 |
| D18 | The `enabled` flag hides accounts when the build has no cloud config, and in every existing suite (`RECALLER_DATA_DIR` without a mock base). Environment overrides are ignored when `app.isPackaged` | The existing suites stay literally unchanged |
| D19 | Account deletion: re-authenticate, commit `deleting: true` (the rules then refuse Firestore **and** Storage writes), delete the pictures, delete the documents in commits of 10, delete the head, then `accounts:delete` | Server-enforced and resumable |
| D20 | A schema guard (`head.schema > 1` means "Update Recaller" and sync stops), a `project` field in the account file, a before-quit final push of 1.5 s with a re-entry guard, `before-sync` backups, and a mass-delete guard for deletions no user action explains | Grafts from A, B and C |

### 1.3 What "everything is stored" maps to (for the owner)

| You said | Where it lives in Google Cloud |
|---|---|
| "all the columns" | `users/{uid}/projects/{projectId}`: name, colour, created time, column order, and any field a newer Recaller adds |
| the notes in each stage | `users/{uid}/notes/{noteId}`. `_sync.list` holds the data name: `notes` = Cooking, `used` = Cooked, `combined` = Served. Also text, pictures, times, highlight, copy count and order |
| "file names" | Recaller's only files are pictures: `gs://recaller-cloud-data/users/{uid}/images/{id}.png` and `{id}.t.png`, the same names as in `images/` on disk. Column names are the `name` field of each project |
| "account info" | Identity Platform holds the email, the password hash and whether the email is verified. `users/{uid}` holds the created time, board revision, counts and privacy acceptance. `devices/*` lists each computer |
| each computer's own things | `users/{uid}/devices/{deviceId}`: its name ("Mac" or "Windows PC"), view, drafts, draft pictures and allow-listed settings. It is a backup only |
| deleted notes | `users/{uid}/trash/*` for 30 days, then erased |
| never uploaded | the OpenAI API key and local backups |

### 1.4 Where each must-fix is handled

| Must-fix (judge 1 and judge 2) | Section |
|---|---|
| Reuse the live infra; Terraform only; CAD budget; region; gcloud flags; ship `project.json` | 2.1–2.9 |
| Durability ordering; shadow advances per committed item and only after the file write | 5.4, 5.5, 5.6 |
| Access-call limits (the 400-write commit) | D4, 4.8, the 400-write smoke check in 7.7 |
| Storage v0 auth header, resumable upload, IAM grant, gating create and delete | 3.3, 4.9, 2.4 |
| Password policy body in the v2 shape, reCAPTCHA errors, cleaning up unverified accounts | 2.5, 5.13, 2.7 |
| Shared-computer privacy (no automatic upload, shadow dropped for another account, remove-board option) | 5.9, 5.14 |
| Account deletion order, the account-exists check, disclosure | 5.15, 6.7 |
| Privacy note completeness, settings allow-list | 6.7, 4.2, 4.8 |
| Secrets, tokens, overrides, IPC validation, logging | 3.4, 3.5, 3.7 |
| Tests never touch the keychain | 3.4, 7.1, 7.7 |
| No startup rewrite; ids invented this session kept out of pushes | 5.10, 5.17 |
| Union for unreadable files, the seed, `.bak`, restore and downgrade | 5.10 |
| Quit re-entry guard | 5.16 |
| Client limits stricter than the rules; split a refused commit and quarantine the item | 4.7, 5.5 |
| Pristine Welcome board is computed, not assumed | 5.9 |
| Document the v1 trade-offs | 9.1 |

---

## 2 GCP architecture and setup

### 2.1 What exists

Read from `infra/README.md` and `infra/terraform/prod/*.tf`, 2026-09-30.

| Resource | State | Terraform file |
|---|---|---|
| Project `recaller-cloud` (number 700753939032), billing account `01138A-E377EE-4F0D47` in **CAD** | exists; billing link recorded, never changed by Terraform | `project.tf` |
| APIs: apikeys, billingbudgets, cloudresourcemanager, firebase, firebasehosting, firebaserules, firebasestorage, firestore, identitytoolkit, securetoken, serviceusage, storage | enabled; never disabled by Terraform | `apis.tf`, `locals.tf` |
| Firebase on the project, and the default Hosting site that serves `https://recaller-cloud.firebaseapp.com/__/auth/action` | exists | `firebase.tf` |
| Identity Platform config: email and password enabled, one account per email, authorized domains `recaller-cloud.firebaseapp.com` and `recaller-cloud.web.app`. Email enumeration protection is on | exists; enumeration protection is outside Terraform | `auth.tf` |
| Firestore `(default)`, native mode, Standard edition, **us-east1**, delete protection, PITR off, daily backups kept 7 days | exists | `firestore.tf` |
| Bucket `recaller-cloud-data` in US-EAST1: uniform access, public access blocked, 7-day soft delete, linked to Firebase | exists | `storage.tf` |
| Rules: `cloud.firestore` and `firebase.storage/recaller-cloud-data`, **both deny everything** | exists | `rules.tf`, `infra/firebase/*.rules` |
| API key "Recaller desktop app", limited to identitytoolkit, securetoken, firestore and firebasestorage | exists; the value reaches the app only through the `app_config` output | `apikey.tf` |
| Budget: 15 CAD a month, email alerts at 50 %, 90 % and 100 % | exists | `budget.tf` |
| gcloud 587.0.0 at `~/google-cloud-sdk`, signed in; Terraform at `~/.local/bin/terraform` | installed | — |

This table is the state of 2026-09-30. Since the deploy (2026-10-01) the real rules, the sync settings and the IAM grant are live. The budget's alerts (2.8) and Firebase's auto-created browser key (2.7) changed in Terraform the same day; they go live with the next plan (status).

**Precondition for any change in this spec (WP1).** The adoption apply from `imports.tf` must be finished and `imports.tf` deleted. A plan must then say "No changes". Don't edit `infra/terraform` while another session is mid-apply. Confirm the current state with the owner before creating anything.

### 2.2 Services and why

| Need | Service |
|---|---|
| Sign-up, sign-in, verification emails, password reset | Identity Platform through the Identity Toolkit v1 and Secure Token REST APIs. Email accounts are free up to 50,000 monthly active users |
| The board | Firestore Standard, `(default)`. Per-user subcollections; the free daily quota applies |
| Pictures | Cloud Storage for Firebase: object REST v0 with Storage security rules. The Always Free tier covers us-east1 |
| Rules | Firebase Rules, deployed by Terraform |
| Email action pages | The default Hosting site, which already exists (Google's hosted verify and reset pages) |
| Safety net | Daily Firestore backups kept 7 days, Storage soft delete for 7 days, and the 30-day `trash` collection |
| Cost alerts | The existing budget. Alerts only: budgets can't cap Firestore, Storage or Identity Platform |
| Server code | **None in v1.** Things that would need a server later: a per-user storage quota, an automatic spending cap, scheduled clean-up of unverified or orphaned accounts |

### 2.3 Region and cost (us-east1)

**The region is fixed** by the existing database. The bucket is in the same region, and us-east1 qualifies for the Cloud Storage Always Free tier.

**Prices** (USD list prices for us-east1, read on Google's pricing pages on 2026-10-01; a CAD account is billed from Google's own CAD prices, roughly 1.42 CAD per USD):
- Firestore Standard: reads $0.06, writes $0.18, deletes and TTL deletes $0.02 per 100k; stored data $0.18 per GiB-month; backups $0.03 per GiB-month; a restore $0.40 per GiB. The figures this spec first used ($0.03, $0.09, $0.01 and $0.15) were the us-central1 and us-west1 row, so operations cost twice what it assumed.
- Firestore free tier (one database per project): 50k reads, 20k writes and 20k deletes a day, 1 GiB stored, and 10 GiB of egress a month. TTL deletes, backups and restores have no free quota.
- Cloud Storage Standard: $0.02 per GiB-month, uploads (Class A) $0.005 per 1,000, downloads (Class B) $0.0004 per 1,000, egress $0.12 per GiB.
- Cloud Storage Always Free: 5 GB-months, 5,000 Class A, 50,000 Class B and 100 GB of North America egress a month. It is per billing account, shared by every bucket in us-east1, us-west1 and us-central1.
- Identity Platform email sign-in: free up to 50k monthly active users.

**One active user** (an estimate from the engine's timings and Google's size formulas, not a measurement): one computer in front 8 h a day and both hidden the rest of the time, 100 edits a day, 500 notes, 150 pictures a month.
- Reads: about 850 a day. Most are head polls: 60 an hour in front, 2 an hour hidden. Then the device list every 10 minutes in front, the other computer's pulls, summon and focus pulls, the head reads the rules make (uploads and device records), and the 30-day audit.
- Writes: about 270 a day (100 commits of about 2.5 writes, plus device records). TTL deletes: about 5 a day.
- Data: about 4 MB per board in Firestore. Pictures add about 240 MB a month (a 0.1 MB thumbnail and a full size of about 1.5 MB each), with about 60 MB of egress.

| Active users | First month | After a year | What costs |
|---|---|---|---|
| 1 (the owner) | ≈ $0.001 (0.00 CAD) | ≈ $0.001 | backups and TTL deletes; everything else is inside the free tiers |
| 10 | ≈ $0.01 | ≈ $0.46 | picture storage past the free 5 GB-months |
| 100 | ≈ $1.36 (1.93 CAD) | ≈ $6.64 (9.42 CAD) | reads, writes and uploads, then picture storage |
| 1,000 | ≈ $34 | ≈ $87 | reads and writes, then picture storage |
| 10,000 | ≈ $433 | ≈ $961 | as for 1,000 |

- **What costs money first:** the free 5,000 uploads a month run out at about 17 active users, Firestore reads at about 59 and writes at about 75. Picture storage keeps growing and becomes the biggest line. For the owner alone it passes the free 5 GB-months in about month 22 at 1.5 MB a picture (month 12 at 3 MB), sooner by whatever the board already holds.
- **Levers:** the focused poll interval (60 s → 120 s cuts about 28 % of reads), reading the device list only while Settings is open (about 11 %), and the size of pictures.
- **The 15 CAD budget** is passed at about 365 active users in their first month, or about 146 after a year, as pictures pile up. Its alerts are in 2.8.

### 2.4 Terraform changes (WP1)

**New file `infra/terraform/prod/sync.tf`:**

```hcl
# Accounts and sync (ai_memory/15_accounts_and_sync.md): Firestore field settings, the trash TTL,
# and the Storage rules' read of Firestore.

locals {
  # Fields nobody queries: no single-field indexes (less index storage, no hot index on
  # sequential timestamps). _sync.rev and _sync.deleted stay indexed: the pull queries use them.
  unindexed_fields = {
    notes_text        = { collection = "notes", field = "text" }
    notes_images      = { collection = "notes", field = "images" }
    notes_json        = { collection = "notes", field = "_json" }
    notes_sync_at     = { collection = "notes", field = "_sync.at" }
    projects_json     = { collection = "projects", field = "_json" }
    projects_sync_at  = { collection = "projects", field = "_sync.at" }
    trash_data        = { collection = "trash", field = "data" }
    trash_deleted_at  = { collection = "trash", field = "deletedAt" }
    devices_view      = { collection = "devices", field = "view" }
    devices_drafts    = { collection = "devices", field = "drafts" }
    devices_settings  = { collection = "devices", field = "settings" }
    devices_last_seen = { collection = "devices", field = "lastSeenAt" }
  }
}

resource "google_firestore_field" "unindexed" {
  for_each = local.unindexed_fields

  project    = google_firestore_database.default.project
  database   = google_firestore_database.default.name
  collection = each.value.collection
  field      = each.value.field

  # An empty block turns off every single-field index on this field.
  index_config {}
}

# Deleted notes and projects are kept in users/{uid}/trash for 30 days. Firestore removes each one
# (usually within a day) once expireAt has passed. TTL deletes are billed as ordinary deletes.
resource "google_firestore_field" "trash_expire_at" {
  project    = google_firestore_database.default.project
  database   = google_firestore_database.default.name
  collection = "trash"
  field      = "expireAt"

  ttl_config {}
  index_config {}
}

# The Storage rules read users/{uid} in Firestore (the "deleting" flag) before an upload or a delete.
# That cross-service read needs this role on the Firebase Storage service agent. google_project_iam_member
# is additive: it adds this one binding and never touches anyone else's access.
resource "google_project_iam_member" "storage_rules_read_firestore" {
  project = google_project.this.project_id
  role    = "roles/firebaserules.firestoreServiceAgent"
  member  = "serviceAccount:service-${google_project.this.number}@gcp-sa-firebasestorage.iam.gserviceaccount.com"

  depends_on = [google_firebase_storage_bucket.data]
}
```

**Edit `auth.tf`.** Add inside `google_identity_platform_config.this`:

```hcl
  # Sign-up kill switch: set signup_enabled = false and apply. New sign-ups then fail with
  # ADMIN_ONLY_OPERATION; existing accounts keep working. Users can always delete their own account.
  client {
    permissions {
      disabled_user_signup   = !var.signup_enabled
      disabled_user_deletion = false
    }
  }
```

**Edit `variables.tf`:**

```hcl
variable "signup_enabled" {
  description = "Whether anyone can create a new account. false is the kill switch."
  type        = bool
  default     = true
}
```

**Edit `rules.tf`:** nothing. It already deploys `../../firebase/*.rules`. **WP1 replaces the two rules files** with the full texts in 4.8 and 4.9.

**Expected plan:** `Plan: 18 to add, 0 to change, 4 to destroy.` (section 0, item 25):
- 12 field configurations to add, plus 1 TTL field;
- 1 IAM member to add;
- both rulesets replaced (`+/-`) and both releases re-created (`-/+`) (the README explains why);
- nothing else. The Identity Platform config doesn't change: the adopted state already has both `client.permissions` switches off, which is what `signup_enabled = true` asks for.

If the plan also proposes changes to `sign_in` or `authorized_domains`, stop and ask.

**README updates (WP1)** for `infra/README.md`:
- Add rows for sync (TTL, index exemptions, IAM grant, sign-up switch).
- Move the one IAM grant out of the "Deliberately outside Terraform" list, noting that it is additive.
- Add the password policy to the out-of-Terraform settings, with its script.
- Add the kill-switch runbook (2.7) and the rules checks (2.10).

### 2.5 Outside Terraform: `infra/scripts/auth-settings.sh` (WP1)

The script is idempotent: it reads first and changes only what differs. It covers the two Identity Platform settings the provider can't express. The script in the repo is the reference. The sketch first written here put the token on curl's command line and the whole config (a web API key and the password-hash parameters) on node's, so it was dropped. What the script does:
- **The login:** the owner's token from gcloud (`GCLOUD`, else `~/google-cloud-sdk/bin/gcloud`, else the one on the PATH). Every call goes to `https://identitytoolkit.googleapis.com/admin/v2/projects/recaller-cloud/config` with `X-Goog-User-Project: recaller-cloud`. It needs bash, curl and node (Git Bash on the PC).
- **Secrets stay off command lines.** The token reaches curl on its standard input (`-H @-`). It doesn't use `<(...)`, because Git Bash's curl is a Windows program and can't open that `/dev/fd` path. The config reaches node on standard input too. It is never printed whole, written to a file or put on a command line. The fields it prints show `apiKey`, `signerKey` and `saltSeparator` as "(withheld)". An error shows only Google's status and message.
- **1. Email enumeration protection:** if `emailPrivacyConfig.enableImprovedEmailPrivacy` isn't true, PATCH `?updateMask=emailPrivacyConfig` with `{"emailPrivacyConfig":{"enableImprovedEmailPrivacy":true}}`.
- **2. Password policy:** the wanted policy is ENFORCE, no forced upgrade at sign-in, a minimum of exactly 8, a maximum of at least 4096, and no required character classes. If the live one differs, PATCH `?updateMask=passwordPolicyConfig` with the body from the v2 discovery schema, `{"passwordPolicyConfig":{"passwordPolicyEnforcementState":"ENFORCE","forceUpgradeOnSignin":false,"passwordPolicyVersions":[{"customStrengthOptions":{"minPasswordLength":8,"maxPasswordLength":4096}}]}}`. Only if that is refused, it tries the public how-to page's shape, `{"passwordPolicyConfig":{"enforcementState":"ENFORCE","forceUpgradeOnSignin":false,"constraints":{"minLength":8,"maxLength":4096}}}`. It says which body the API took.
- **Then** it reads the config again (if it changed anything) and prints enumeration protection, the password policy, "sign-up disabled", and the email link domain and callback URI. It warns if reCAPTCHA is enforced for email and password, and exits with 1 if either setting is still wrong.

- Leave reCAPTCHA **unconfigured** (OFF). Enforce mode would reject every request from a desktop client.
- The app also checks for 8 or more characters locally, before any network call.

### 2.6 Ordered runbook

The runbook to follow is "Accounts and sync: the runbook" in `infra/README.md`. It started from this section and was corrected since, so it wins where they differ (it also has the PowerShell forms for the PC). This list follows it. The owner runs it with an agent. Every step can be run again.

1. **Check the login (read-only).**
   ```
   gcloud config list
   gcloud auth application-default print-access-token >/dev/null
   ```
   On the Mac, put `~/.local/bin` and `~/google-cloud-sdk/bin` on the PATH first (the README shows how). If ADC is missing: `gcloud auth login --update-adc`, then `gcloud auth application-default set-quota-project recaller-cloud`.
2. **Test the rules texts** with the Rules API (free, deploys and reads nothing): `npm run rules:test` (7.7). It comes before the plan: if a case fails, stop here, before the new rules go live.
3. **Plan, and read the plan.** One plan does both jobs: it shows the sync changes, and anything else in it is drift. It runs where an agent can see it, so mask it as the README shows (a plan that touches the sign-in config prints the password-hash parameters):
   ```
   terraform -chdir=infra/terraform/prod plan -input=false -no-color -out=prod.tfplan 2>&1 \
     | sed -E 's/((signer_key|salt_separator)"?[[:space:]]*[=:][[:space:]]*).*/\1"(masked)"/'
   ```
   It must say `Plan: 18 to add, 0 to change, 4 to destroy.` and show exactly the changes in 2.4. If it changes `sign_in` or `authorized_domains`, stop and find out why.
4. **Apply the saved plan,** then delete it (it holds the API key and the password-hash parameters in clear text):
   ```
   terraform -chdir=infra/terraform/prod apply prod.tfplan
   rm infra/terraform/prod/prod.tfplan
   ```
   New rules and the IAM grant take several minutes to reach every server. Give them 10 minutes before step 8.
5. **Apply the auth settings.** Run `bash infra/scripts/auth-settings.sh`. Expect:
   - enumeration protection `true`;
   - a password policy of ENFORCE with at least 8 characters;
   - sign-up disabled `false`.

   If it set the policy, record which of its two bodies the API took (2.10).
6. **Check the TTL is active.** `gcloud firestore fields ttls list --database='(default)' --project=recaller-cloud` lists `trash` and `expireAt`. It is CREATING at first and ACTIVE later.
7. **Write the app config.** It comes before the smoke test, which reads the project and the key from `infra/gcp/project.json`.
   ```
   mkdir -p infra/gcp
   terraform -chdir=infra/terraform/prod output -json app_config > infra/gcp/project.json
   npm run cloud:config
   ```
   This validates the file and copies it to `src/cloud/project.json`. Both files are git-ignored.
8. **Run the real-project smoke test** with throwaway accounts: `npm run rules:smoke` (7.7).
9. **Owner, in the Firebase console, once: the name in the emails.** The emails use the project's public-facing name; without one they say `recaller-cloud`, as the owner's first email did (2026-10-01). Project settings › General shows no field for it on this project, most likely because the project has no OAuth brand (it was made from the command line). So:
   - Authentication › Sign-in method › Add new provider › Google: switch Enable on, set "Public-facing name for project" to "Recaller" and a support email, and Save.
   - Open Google again, switch Enable off, and Save. The name stays. Don't leave Google sign-in on: the rules would let a Google account in.
   - Alternative, not confirmed to fill Firebase's field: Google Cloud console › Google Auth Platform › Branding, app name "Recaller".
   - Authentication › Templates: sender name "Recaller" on the verification and password-reset templates.
   - The sending domain against Spam (`recaller.ponders.ai`) is "Email delivery" in `infra/README.md`.
10. **Budget:** no change in this runbook. The 15 CAD budget exists, and every future amount stays in CAD (`budget_currency = "CAD"`). Its alerts changed later (2.8).

**Rebuilding from an empty project** (disaster recovery only; "Rebuilding from an empty project" in `infra/README.md`):
1. Install gcloud with `CLOUDSDK_PYTHON=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3 ./google-cloud-sdk/install.sh --quiet --install-python=false --usage-reporting=false --path-update=false --command-completion=false`. The default `--install-python=true` runs `sudo`.
2. Sign in as in step 1: `gcloud auth login --update-adc`, then set the quota project.
3. Create the project and link billing first (`gcloud projects create ID --name=Recaller`, then `gcloud billing projects link ID --billing-account=ACCOUNT`). Neither Terraform root creates the project: `terraform/bootstrap` assumes it exists. Then apply `terraform/bootstrap` (the state bucket), as the README's "Bootstrap" describes.
4. Apply `terraform/prod`, adopting the project with an import block, as `imports.tf` did. Everything else is created: the APIs, Firebase, Identity Platform, the database in us-east1, the bucket and its Firebase link, the rules, the sync settings, the IAM grant, the app key and the budget. The Firebase Storage service agent exists only once Firebase Storage is on. If the IAM grant fails because that account doesn't exist yet, wait a minute and apply again. For Firebase's own browser key (`email_page`, 2.7), follow step 4 in the README.
5. Run steps 5–10 above, from `auth-settings.sh` on. A new key means a new app release.

### 2.7 API key, abuse limits and kill switches

**API key.** Keep "Recaller desktop app" as it is: API targets only, no application restriction.
- A desktop app has no referrer or IP address to restrict on.
- The hosted verify and reset pages call Identity Toolkit from the browser with the key inside the email link. That turned out to be Firebase's own browser key, not this one (below).
- Firestore and Storage calls send only the ID token. The rules protect them, not the key.
- Firebase also auto-created a "Browser key". Recaller doesn't use it, but the email links do. On 2026-10-01 the API metrics (Cloud Monitoring, request counts per credential) showed one call with that key when the owner clicked a verification link: Identity Toolkit's SetAccountInfo, its only use in 7 days. Every call the app makes (SignUp, GetOobCode, SignInWithPassword, GetAccountInfo, GrantToken, DeleteAccount) used the app key. So the email action page uses the key its link carries, and restricting that key fully would break every verification and reset email. It is now in Terraform as `google_apikeys_key.email_page` (`apikey.tf`, adopted by `imports.tf`, ID `email_page_key_id`) with only the two sign-in APIs, Identity Toolkit and Secure Token (`email_page_key_services` in `locals.tf`). Firebase had given it 27, Firestore and Storage among them. The next plan (status) applies that. Never write either key's value anywhere.

**Abuse controls in v1:**
1. **Verified email before any cloud access.** Every rule requires `email_verified == true`.
2. **Identity Platform defaults:**
   - 100 new accounts per hour per IP address;
   - enumeration protection (`INVALID_LOGIN_CREDENTIALS`, and a silent reset for unknown emails);
   - on Blaze, 100,000 verification and 10,000 reset emails a day.
3. **Password policy:** 8 or more characters, on the server and in the app.
4. **Rules caps:**
   - 200 fields per item;
   - `_sync` shape checked, rev only moves forward;
   - pictures PNG only, at most 40 MB, immutable, named `<32 hex>(.t).png`;
   - device records capped (`view` ≤ 700,000 characters, `drafts` ≤ 200,000) and settings allow-listed;
   - no hard deletes except during account deletion;
   - Firestore itself caps a document at 1 MiB.
5. **Client throttles:**
   - after 5 wrong passwords in 10 minutes, a 30-second lock-out;
   - "Send again", "Send link" and "Change password" wait 60 s, and main sends at most one reset link per email a minute (section 0, item 33);
   - one account operation at a time over IPC (`BUSY`).
6. **Budget alerts** on a 15 CAD budget, from 10 % (1.50 CAD) of actual spend and on the month's forecast (2.8). Alerts only.

**Kill-switch runbook** (in `infra/README.md`):

| Situation | Action |
|---|---|
| Stop new sign-ups | Set `signup_enabled = false` in `terraform.tfvars`, then plan and apply. The plan changes only `disabled_user_signup` (`Plan: 0 to add, 1 to change, 0 to destroy.`). The app shows "New accounts are paused right now. Try again later." Emergency route, noting that Terraform reverts it on the next apply unless the var matches: `PATCH …/admin/v2/projects/recaller-cloud/config?updateMask=client.permissions` with body `{"client":{"permissions":{"disabledUserSignup":true,"disabledUserDeletion":false}}}`. Print only the HTTP status (`curl -sS -o /dev/null -w '%{http_code}\n'`), never the answer: it is the whole sign-in config, with a web API key and the password-hash parameters. The exact command is under "Kill switches" in `infra/README.md` |
| Stop one abusive user | `POST https://identitytoolkit.googleapis.com/v1/projects/recaller-cloud/accounts:update` with body `{"localId":"UID","disableUser":true}` and the owner's `Bearer` token plus `X-Goog-User-Project`, printing only the HTTP status (the README's command). Their next token refresh fails with `USER_DISABLED`, and all their traffic stops within an hour. `"disableUser":false` undoes it |
| Stop everything | **Superseded, don't do this:** a key with no API targets works for every API. Follow "Kill switches" in `infra/README.md` instead (deny-all rules first, then `app_key_services = ["apikeys.googleapis.com"]` and `signup_enabled = false`; if sign-in with the email-page key must stop too, `email_page_key_services = ["apikeys.googleapis.com"]`, which breaks the email links until undone; section 0, item 24). The original text: in `locals.tf`, empty `app_key_services`, then apply. Sign-in and token refresh stop at once, and every ID token has expired within an hour. Undo it the same way. Key rotation is in the README |
| Slow brute force | Optional: lower the Identity Toolkit API quotas in Cloud console › IAM & Admin › Quotas |
| Accounts never verified | `infra/scripts/purge-unverified.js` (WP1, optional in v1). Dry run by default. It pages `POST https://identitytoolkit.googleapis.com/v1/projects/recaller-cloud/accounts:query` with `{"returnUserInfo":true,"limit":"500","offset":"N","sortBy":"CREATED_AT"}`, picks `emailVerified != true` older than 7 days, and with `--apply` calls `…/accounts:batchDelete` with `{"localIds":[…],"force":true}`. Verify the batchDelete body on first use. Unverified accounts hold no cloud data, because the rules deny it |

**Not possible for a desktop REST client** (stated limitation):
- App Check and reCAPTCHA enforcement;
- per-user storage quotas (they need a server);
- an automatic spending cap (budgets only alert).

### 2.8 Budget

The existing `google_billing_budget.monthly` stays at 15 CAD. Its alerts changed on 2026-10-01 (live with the next plan; before that 0.5, 0.9 and 1.0 of current spend):
- 0.1, 0.5, 0.9 and 1.0 of current spend (`budget_alert_thresholds` in `variables.tf`). 0.1 is 1.50 CAD: normal spend is about 0.00 CAD, so it is an early abuse alarm.
- Once when the month's forecasted spend passes 1.0 (`budget.tf`), which can come before the money is spent.

It is still alerts only: nothing is capped, and Google's cost data can lag a day. The emails go to the billing account's admins and users. Change the amount only through `budget_amount` in `terraform.tfvars`, in CAD. Raise it before public sign-up grows (question Q7).

### 2.9 How the app gets its config (WP10)

**`scripts/cloud-config.js`:**
- `node scripts/cloud-config.js` copies `infra/gcp/project.json` to `src/cloud/project.json` after validating it:
  - `projectId` matches `^[a-z][a-z0-9-]{4,28}[a-z0-9]$`;
  - `apiKey` matches `^AIza[0-9A-Za-z_-]{35}$`;
  - `storageBucket`, `authDomain` and `region` are non-empty strings.
- `--check` exits with 1 if `src/cloud/project.json` is missing or invalid. With `RECALLER_NO_CLOUD=1` it only warns, and the build ships without accounts. The switch only lets a build go ahead without a valid file: with a valid file it is ignored, and the build has accounts. The app itself never reads it.

**`package.json`:**
- `"cloud:config": "node scripts/cloud-config.js"`.
- `"predist"`, `"predist:mac"`, `"predist:win"` and `"prepack"` are all `"node scripts/cloud-config.js --check"`.
- electron-builder already packs `src/**/*`, so the file ships in `app.asar`.

**`.gitignore`:** add `src/cloud/project.json`. The key is public by design; it stays out of git as the infra README decided.

**The PC build.** Either build the Windows installer on the Mac with `npm run dist:win` (x64 is pinned), or copy the one small `src/cloud/project.json` into the PC clone before `npm run dist`.

**No config means no accounts.** Without a valid `src/cloud/project.json`, `enabled` is false (only a run from source pointed at the mock has accounts without it, 3.3): the Account & sync section and its heading, the Help line (6.8) and the top-bar indicator stay hidden, and every hook does nothing.

### 2.10 Verification on the real project, and the unconfirmed items

The table lists each UNCONFIRMED item from the fact sheet and how the design copes. The checks run in `rules:smoke` and the manual check.

| Item | Design stance | Where it's verified |
|---|---|---|
| Whether access calls are cached across a batch | Designed out: board writes make no access calls | Smoke test: a 400-write commit succeeds |
| JSON framing of `runQuery` over HTTP | The client parses a JSON array, and falls back to newline- or concatenated-object parsing | Smoke test records the framing |
| v0 raw or `uploadType=media` upload, the `Bearer` scheme, multipart size limit | Not used: `Firebase` scheme, multipart ≤ 256 KiB, resumable above | Smoke test uploads 100 KB and 3 MB, and records what `Bearer` does (for information only) |
| `REQUEST_TIME` equal to the commit time | Never relied on. Ordering uses `rev` | Smoke test records it |
| Recent-login window | Re-authenticate immediately before deletion | Account-deletion steps in the manual check |
| Initial rules on an API-created database or bucket | Irrelevant: rules are deployed explicitly | `rules:test` and `rules:smoke` |
| Default action URL `…firebaseapp.com/__/auth/action` | The Hosting site exists | **Settled** by the owner's first real email (2026-10-01): its link opened `recaller-cloud.firebaseapp.com/__/auth/action`, which called Identity Toolkit with Firebase's own browser key (2.7) |
| Deliverability and the default sender | A spam hint up front in the app (6.2); the owner's email steps: the name (2.6, step 9) and a sending domain of our own ("Email delivery" in `infra/README.md`) | The owner's first email (2026-10-01) named the project "recaller-cloud" and landed in Spam. After the email steps: the manual check (7.7) |
| The v2 password-policy body shape | Discovery shape first, the documented shape as a fallback, then a read-back | `auth-settings.sh` output, plus the sign-up test with 7 characters in the smoke test |
| Auth deletion doesn't remove data | The client deletes the data first | Manual check (the console is empty) |

**The smoke test's result (`npm run rules:smoke`, run by the owner on 2026-10-01 after the deploy): 43 of 45 passed.**
- **The two failures are one gap.** `7. an overwrite is refused` expected HTTP 403 and got 200, and `7. the downloaded thumbnail matches the upload` found other bytes: the live Storage rules accepted an upload over the stored thumbnail, so the download returned the overwriting bytes. Fixed in the repo, not deployed yet (section 0, item 34). Once deployed, `rules:smoke` must pass all 45.
- **Everything else passed:** unverified access refused; only a +1 head bump; cross-user reads and writes refused; a 400-write commit; the pull and bootstrap queries in order with no index error (402 of 402, in 2 pages); a backwards rev, a tombstone with content and a hard delete refused; refused commits write nothing; a trash copy with a 30-day expiry; a device write; a 100 KB multipart and a 3.0 MB resumable upload with `Authorization: Firebase`; the picture's download matches; listing; other users refused; an upload with no head refused; deletion gating (a commit, a device write and an upload refused while deleting; the pictures, 405 documents, the head and the account deleted); a 7-character sign-up refused (`PASSWORD_DOES_NOT_MEET_REQUIREMENTS`); the full clean-up. Deleted pictures stay soft-deleted for 7 days, and the daily Firestore backups keep old documents for 7 days.

The "Recorded" block it printed:

```
REQUEST_TIME vs commitTime (head creation): commitTime - REQUEST_TIME = 56235 µs (2026-10-01T18:14:12.302Z / 2026-10-01T18:14:12.358235Z); 2 REQUEST_TIME values
REQUEST_TIME vs commitTime (400-write commit): commitTime - REQUEST_TIME = 1767884 µs (2026-10-01T18:14:13.302Z / 2026-10-01T18:14:15.069884Z); 400 REQUEST_TIME values
runQuery framing: a JSON array (Content-Type: application/json; charset=UTF-8)
Storage v0 with Authorization: Bearer <ID token>: HTTP 200, other bytes
recent-login window (A): accounts:delete accepted an ID token 4 s after sign-in
recent-login window (B): accounts:delete accepted an ID token 14 s after sign-in
```

What it settles:
- **REQUEST_TIME isn't the commit time.** REQUEST_TIME is the request's arrival time, in whole milliseconds, the same for every field of one commit (2 and 400 values, all equal). `commitTime` comes later: 56 ms for a small commit, 1.77 s for the 400-write commit. Nothing relies on either: ordering uses `rev`.
- **`runQuery` answers with one JSON array**, the form the client parses first. The NDJSON and back-to-back fallbacks stay, unused.
- **`Bearer` works for a Storage v0 download** (HTTP 200). Its "other bytes" were a side effect of the accepted overwrite: the thumbnail had been replaced by the 8×8 PNG before this download. With the fix deployed it should read "the right bytes". The app sends `Firebase` anyway.
- **The recent-login window:** these lines only show that ID tokens 4 s and 14 s old were accepted, not where the window ends. The app signs in again right before it deletes (section 0, items 17 and 18).
- **Uploads:** a 100 KB multipart and a 3.0 MB resumable upload work with `Firebase`, which also proves the IAM grant. An upload over an existing file is a `create` in Storage rules: that is the gap above.

---

## 3 Client architecture and modules

### 3.1 Where the code runs

**Main process only.**
- The renderer's CSP is unchanged (`connect-src 'none'`).
- The page receives account state (email, status, counts) and board patches, never a token.
- It sends a password over IPC only for sign-up, sign-in, re-authentication and deletion. Main never stores or logs it.

**The page's side of sync:**
- a small UMD module, `src/renderer/sync-apply.js`, loaded before `app.js`;
- the account UI in `src/renderer/account.js`, loaded after `app.js`.

**Main-process modules:**
- CommonJS, and none of them requires `electron` at module level, except `src/cloud/index.js` (the facade).
- Dependencies are injected, so everything else unit-tests under plain `node --test`, and the headless peer can run inside the e2e process.

### 3.2 Module map

```
src/cloud/
  project.json   generated, git-ignored { projectId, apiKey, storageBucket, authDomain, region }     (2.9)
  config.js      loadConfig(): endpoints, enabled flag, mock and fast flags, token-store mode           WP2
  http.js        createHttp(): JSON and bytes requests, CloudError mapping, serverNow()                  WP2
  codec.js       Firestore value codec, document encoding with _json, docId()                          WP2
  auth.js        createAuth(): Identity Toolkit and Secure Token REST                                  WP2
  firestore.js   createFirestore(): get, batchGet, query, queryAll, commit                             WP2
  storage.js     createStorage(): upload (multipart or resumable), download, stat, list, remove        WP2
  tokens.js      createTokenStore(): safeStorage, memory or test-file                                  WP5
  account.js     createAccount(): account lifecycle, single-flight getIdToken                          WP5
  index.js       the facade main.js uses: init, IPC, hooks (requires electron)                         WP6
src/sync/
  keys.js        fractional order keys                                                                 WP3
  model.js       data file → model, cloud docs → model, encode, pristine checks, counts                WP3
  diff.js        local model against the shadow → writes                                               WP3
  merge.js       three-way and union merges → patch and shadowAfter                                    WP3
  state.js       sync/ folder files (device, account, state, shadow)                                   WP5
  engine.js      createSync(): scheduling, push, pull, first sync, deletion, audit                     WP5
src/renderer/
  sync-apply.js  UMD: applyPatch(), per-device key lists (shared with main)                            WP3
  account.js     Settings › Account & sync, choice panels, top-bar indicator                           WP8
```

### 3.3 Signatures

```js
// ---- src/cloud/config.js (WP2)
loadConfig({ env = process.env, isPackaged, projectFile = path.join(__dirname, 'project.json') }) → CloudConfig
CloudConfig = {
  enabled: boolean, reason: 'ok' | 'no-config' | 'test-data-dir',
  projectId, apiKey, bucket, authDomain, region,          // strings
  endpoints: { identity, token, firestore, storage },     // no trailing slash
  //   real: https://identitytoolkit.googleapis.com/v1, https://securetoken.googleapis.com/v1,
  //         https://firestore.googleapis.com/v1, https://firebasestorage.googleapis.com/v0
  //   mock: `${base}/identitytoolkit.googleapis.com/v1`, … (the first path segment names the service)
  mock: boolean, tokenStore: 'secure' | 'memory' | 'test-file', fast: boolean, offline: boolean,
}
// Overrides, read only when !isPackaged:
//   RECALLER_GCP_BASE (http://127.0.0.1:PORT or http://localhost:PORT only; anything else is ignored with a log line),
//   RECALLER_GCP_PROJECT (default 'demo-recaller'), RECALLER_GCP_BUCKET (default 'demo-recaller.test'),
//   RECALLER_GCP_API_KEY (default 'mock-key'), RECALLER_GCP_REAL=1, RECALLER_TOKEN_STORE,
//   RECALLER_SYNC_FAST=1, RECALLER_SYNC_OFFLINE=1.
// enabled:
//   packaged:   project.json valid && !env.RECALLER_DATA_DIR
//   unpackaged: (mock || project.json valid) && !(env.RECALLER_DATA_DIR && !mock && env.RECALLER_GCP_REAL !== '1')
// tokenStore: packaged → 'secure'; unpackaged → RECALLER_TOKEN_STORE if it is 'secure' or 'memory', or 'test-file'
//   when mock is true; otherwise 'memory'. Runs from source never touch the keychain unless asked.

// ---- src/cloud/http.js (WP2)
class CloudError extends Error {
  constructor(code, { status = 0, retryable = false, detail = '', service = '' } = {})
}
// code: 'NETWORK' | 'TIMEOUT' | 'UNAUTHENTICATED' | 'PERMISSION' | 'NOT_FOUND' | 'HEAD_MOVED' | 'ABORTED' | 'QUOTA'
//     | 'SERVER' | 'BAD_REQUEST' | 'TOO_LARGE', or an Identity Toolkit code such as 'EMAIL_EXISTS'
createHttp({ fetchImpl, now = Date.now }) → {
  json(url, { method = 'GET', headers = {}, body, form, timeoutMs = 30000, service }) → { status, headers, data },
  bytes(url, { method = 'GET', headers = {}, body, timeoutMs = 120000, service }) → { status, headers, data: Buffer },
  serverNow() → number,   // Date.now() + median offset from the last 5 responses' Date headers
}
// Mapping (the first rule that fits wins):
//   thrown fetch → NETWORK; abort → TIMEOUT (both retryable).
//   service 'identity' | 'token' with status ≥ 400: the code that error.message starts with, but only when that
//     upper-case word (A–Z, 0–9 and _, a letter first) is followed by ':' (spaces allowed) or the end of the message:
//     "EMAIL_EXISTS", "WEAK_PASSWORD : Password should be…". Retryable on 429 and 5xx. Any other message falls
//     through to the HTTP status below: "API key not valid. Please pass a valid API key." is BAD_REQUEST with detail
//     INVALID_ARGUMENT (a plain /^[A-Z_]+/ would have made it 'API').
//   401 → UNAUTHENTICATED; 403 → PERMISSION; 404 → NOT_FOUND.
//   409 ALREADY_EXISTS and 400 FAILED_PRECONDITION → HEAD_MOVED, only for service 'firestore-commit'.
//   any other 409 → ABORTED (retryable).
//   413, or a 400 (INVALID_ARGUMENT or no status word) whose message contains "exceeds" or "too large" → TOO_LARGE;
//     other 400 → BAD_REQUEST.
//   429 or RESOURCE_EXHAUSTED → QUOTA (retryable); 5xx, UNAVAILABLE, DEADLINE_EXCEEDED → SERVER (retryable);
//     408 → TIMEOUT (retryable); anything else → BAD_REQUEST. A 2xx answer to json() that isn't JSON → SERVER
//     (retryable).
// Never logs headers, bodies, tokens, passwords or emails. detail holds only Google's status word.

// ---- src/cloud/codec.js (WP2)
toValue(json) → FirestoreValue         // throws UnrepresentableError
fromValue(value) → json                // a timestampValue (REQUEST_TIME and the like) comes back as its RFC 3339 text
encodeFields(obj, { skip: Set<string> | string[] | (key) => boolean }) → { fields, jsonKeys: string[] }
                                       // unrepresentable top-level keys go to fields._json; a key no map may hold goes
                                       // there as 'x-' + base64url(sha256(key)), holding the JSON of [key, value] (4.3)
decodeFields(fields) → object          // ignores _sync; merges _json (an x- entry gets its own key back); a _json that
                                       // isn't a map is kept as an ordinary field; built with Object.fromEntries (safe with __proto__)
docId(id) → string                     // /^[A-Za-z0-9_-]{1,128}$/ and not /^__.*__$/ → id; else 'x-' + base64url(sha256(id)); the caller stores the id in _sync.id
estimateBytes(fields) → number          // Buffer.byteLength(JSON.stringify(fields)) × 1.1

// ---- src/cloud/auth.js (WP2)
createAuth({ http, endpoints, apiKey }) → {
  signUp(email, password) → Session, signIn(email, password) → Session,
  refresh(refreshToken) → Session,
  lookup(idToken) → { uid, email, emailVerified, disabled },
  sendVerification(idToken) → void, sendPasswordReset(email) → void, deleteAccount(idToken) → void,
  claims(idToken) → { user_id, email_verified, exp },    // base64url decode, no verification
}
Session = { uid, email, idToken, refreshToken, expiresAt /* local receipt time + expiresIn */, emailVerified }

// ---- src/cloud/firestore.js (WP2); ID token as Authorization: Bearer
createFirestore({ http, endpoints, projectId, getIdToken /* ({force}) → Promise<string> */ }) → {
  name(path) → `projects/${projectId}/databases/(default)/documents/${path}`,
  get(path) → Doc | null,
  batchGet(paths) → Map<path, Doc | null>,               // ≤ 100 per request, chunked
  query(parentPath, structuredQuery) → { docs: Doc[], readTime },
  queryAll(parentPath, structuredQuery, { pageSize = 300 }) → AsyncIterable<Doc>,  // startAt cursor on the orderBy values
  //   (__name__ is added last when the order lacks it). A page that ends where the previous one did → SERVER
  //   (retryable), so paging can never loop on a server that ignored startAt.
  commit(writes) → { commitTime, writeResults: [{ updateTime }] },                   // service 'firestore-commit'
}
Doc = { path, name, fields, createTime, updateTime }
// runQuery and batchGet answer as a stream: a JSON array, or objects one after another. An answer cut short (an
// array missing its ']', an unfinished object) → SERVER (retryable), since a partial list would look complete.
// On UNAUTHENTICATED: getIdToken({ force: true }), then retry once (the same in storage.js).

// ---- src/cloud/storage.js (WP2); every request sends Authorization: Firebase <idToken>
createStorage({ http, endpoints, bucket, getIdToken }) → {
  upload(path, bytes, contentType = 'image/png') → { size, md5Hash, existed, differs? },
  //   ≤ 256 KiB: POST {storage}/b/{bucket}/o?name=<enc path>, X-Goog-Upload-Protocol: multipart,
  //     Content-Type: multipart/related; boundary=B; part 1 = JSON {name, contentType}, part 2 = the bytes.
  //   > 256 KiB: POST …/o?name=<enc> with X-Goog-Upload-Protocol: resumable, X-Goog-Upload-Command: start,
  //     X-Goog-Upload-Header-Content-Length, X-Goog-Upload-Header-Content-Type, and body {name, contentType};
  //     the upload URL comes from the X-Goog-Upload-URL header. Then POST <url> in 2 MiB chunks with
  //     X-Goog-Upload-Command: upload (the last: "upload, finalize") and X-Goog-Upload-Offset.
  //     Done when X-Goog-Upload-Status is final. On error, X-Goog-Upload-Command: query gives
  //     X-Goog-Upload-Size-Received, and the upload resumes from there.
  //   After either protocol, the size and md5Hash the answer reports must match the bytes sent, or SERVER: a picture
  //     can never be replaced, so a bad copy must not count as uploaded. A final resumable answer without them is
  //     checked with stat().
  //   403: stat(path) once (as built, section 0 item 34): the same size and md5 → { existed: true }; other bytes →
  //     { existed: true, differs: true } with the account's size and md5Hash (its copy stays); nothing there, or the
  //     stat refused too → PERMISSION; a stat that can't answer → its own error (NETWORK, TIMEOUT, SERVER…).
  download(path) → Buffer | null,          // GET …/o/<enc>?alt=media; 404 → null
  stat(path) → { size, md5Hash, contentType } | null,
  list(prefix) → AsyncIterable<string>,    // GET …/o?prefix=<enc>&delimiter=%2F&maxResults=1000&pageToken=
  remove(path) → boolean,                  // DELETE; 200 or 204 → true; 404 → false
}

// ---- src/cloud/tokens.js (WP5)
createTokenStore({ dir, safeStorage, mode, platform }) → {
  load() → { uid, email, emailVerified, refreshToken | null, keyStore, project, privacyVersion } | null,
  save({ uid, email, emailVerified, refreshToken, project, privacyVersion }) → 'keychain' | 'dpapi' | 'session' | 'test',
  clear() → void,
}
// secure: refresh = { enc: base64 } when safeStorage.isEncryptionAvailable() and encryptString succeeds;
//   otherwise refresh = null ('session': the token is kept in memory only). Never { plain }.
// memory: nothing is written, and account.json isn't created.
// test-file: refresh = { testPlain } (only when the config is a mock and unpackaged); safeStorage is never called.

// ---- src/cloud/account.js (WP5)
createAccount({ auth, tokens, config, onChange, now }) → {
  state() → { status: 'signed-out' | 'unverified' | 'signed-in' | 'needs-sign-in' | 'deleted' | 'disabled', uid?, email?, keyStore? },
  signUp(email, password, privacyVersion), signIn(email, password), reauthenticate(password) /* same uid required */,
  resendVerification(), checkVerified() → boolean /* lookup; on true, a forced refresh */,
  discardUnverified(), resetPassword(email), signOut(), forget(),
  getIdToken({ force = false } = {}) → Promise<string>,  // single flight; refreshes 5 min before expiry
  uid(), email(),
}

// ---- src/sync/keys.js (WP3)
keyBetween(a /* string|null */, b /* string|null */) → string
keysBetween(a, b, n) → string[]          // balanced by recursive bisection
orderKeys(ids, known /* Map id→key */) → Map<id, key>  // keeps the longest strictly increasing run of known keys
compareKeyed(a, b) → number              // by key, then by id
needsRekey(keys) → boolean               // any key longer than 48 characters

// ---- src/sync/model.js (WP3)
toModel(data) → Model                    // defensive: skips non-object projects, non-string or duplicate ids, non-string text
Model = { board: { joiner: 'blank' | 'line' | null }, projects: Map<id, { id, fields }>,
          notes: Map<id, { id, fields, project, list, copied, lastCopiedAt }>,
          columns: string[], lists: Map<string /* `${pid}\u0000${list}` */, string[]>, skipped: Set<string> }
fromDocs({ head, projectDocs, noteDocs }) → Remote
Remote = { rev, board, projects: Map<id, RDoc>, notes: Map<id, RDoc> }
RDoc = { id, docId, fields, key, rev, deleted, updateTime, by, project?, list?, copied?, lastCopiedAt? }
fieldsSig(fields) → string               // stable, key-sorted
encodeProject(entity, sync) → fields ; encodeNote(entity, sync) → fields ; tombstoneFields(sync) → fields
isPristineWelcome(project) → boolean ; isPristineBoard(model) → boolean
countLive(state) → { projects, notes, images }

// ---- src/sync/diff.js (WP3)
diffLocal({ shadow, local, mode /* 'normal' | 'union' | 'restore' */, quarantine }) → {
  upserts: [{ kind: 'project' | 'note', id, fields, key, project?, list?, copied?, lastCopiedAt?, reason: 'new' | 'undelete' | 'change' | 'counter' }],
  tombstones: [{ kind, id, key, project?, list?, trashData /* JSON text from the shadow fields */ }],
  pending: number, counterOnly: boolean, tooLarge: string[],
  deletions: { notes: number, projects: number },
}

// ---- src/sync/merge.js (WP3)
mergeRemote({ shadow, local, remote, mode /* 'normal' | 'union' | 'restore' | 'combine' | 'use-account' */,
              trash /* Map id → trash data */, devices, deviceId, now }) → {
  patch: PatchBody | null, shadowAfter: ShadowDelta, notices: Notice[], backupFirst: boolean,
}

// ---- src/sync/state.js (WP5)
openSyncDir(userData) → { dir, readDevice, writeDevice, readState, writeState, readShadow, writeShadow,
                          removeAccountState({ keepShadow }), removeAll() }

// ---- src/sync/engine.js (WP5)
createSync(deps) → Engine
deps = { syncDir, account, firestore, storage, images, backups, page /* { sendPatch, sendState } */,
         getDeviceSettings, getWindowState, hasPendingWrite, isRestoring, flushData, isOnline,
         config, platform, appVersion, now, timers, log }
Engine = {
  start(), stop(),
  onLoadResult({ from /* 'main' | 'bak' | null */, value, file }), onFileWritten(data, meta, text),
  mergeSaveMeta(prev, next) → meta | null,
  onPageLoading(), onPageReady({ session }), onNack({ patchId, reason }),
  onWindowState(), onSummon(), onResume(), onRestore(backupId),
  syncNow(), choose(answer), retry(),
  status() → SyncStatus, choice() → Choice | null, devices() → Device[], hasUnpushed() → boolean,
  ensureImage(id, thumb) → Promise<boolean>, finalPush(timeoutMs) → Promise<void>,
  deleteAccountData(onProgress) → Promise<void>,
}

// ---- src/cloud/index.js (WP6), the facade main.js requires
init(deps) ; registerIpc(ipcMain) ; enabled() ; active()
onLoadResult(r) ; onFileWritten(data, meta, text) ; mergeSaveMeta(prev, next) ; onPageLoading()
onRestore(id) ; onWindowState() ; onSummon() ; onResume() ; hasUnpushed() ; finalPush(ms) ; ensureImage(id, thumb)
// Every hook is wrapped in try/catch, never throws into main.js, and returns at once when !active().

// ---- src/renderer/sync-apply.js (WP3); UMD: window.SyncApply in the page, module.exports in Node
SyncApply = {
  applyPatch(data, patch) → { created: string[], removed: string[] },
  LOCAL_PROJECT_KEYS: ['id', 'notes', 'used', 'combined', 'notesCollapsed', 'usedCollapsed', 'augCollapsed',
                       'usedExpanded', 'augExpanded', 'draft', 'draftImages'],
  LOCAL_NOTE_KEYS: ['id', 'expanded', 'copied', 'lastCopiedAt'],   // copied and lastCopiedAt sync as counters
  isLocalKey(k) → boolean,     // in a list above, or a key starting with 'local' (convention for future per-device fields)
  newProjectDefaults() → { usedCollapsed: false, augCollapsed: false, draft: '', draftImages: [], notes: [], used: [], combined: [] },
}
```

### 3.4 Development and test switches

All switches are ignored when `app.isPackaged`.

| Variable | Effect |
|---|---|
| `RECALLER_GCP_BASE=http://127.0.0.1:PORT` | Every Google service goes to the mock. Required before `test-file` token storage is allowed |
| `RECALLER_GCP_REAL=1` | Allows the real project while `RECALLER_DATA_DIR` is set (manual checks only) |
| `RECALLER_TOKEN_STORE=memory` \| `test-file` \| `secure` | `memory` is already the default when unpackaged. `secure` is an explicit opt-in that can bring a keychain prompt on a Mac |
| `RECALLER_SYNC_FAST=1` | Timers ÷10: push debounce 200 ms, polls 1–2 s, verification poll 500 ms, backoff ÷10 |
| `RECALLER_SYNC_OFFLINE=1` | The engine behaves as if offline, for manual conflict tests |

### 3.5 Files on disk

All live in the data folder. None is created while signed out, and none is in a backup, because `backups.js` copies only `FILES = ['recaller-data.json', 'recaller-settings.json']` (`src/backups.js:11`).

| File | Content | Written |
|---|---|---|
| `sync/device.json` | `{ "version": 1, "id": "<32 hex>", "name": "Mac" \| "Windows PC", "host": "<16 hex of sha256(hostname+platform)>", "lastUid": "<uid>" \| null, "lastEmailMasked": "a•••@gmail.com" \| null, "createdAt": ms }` | at first sign-in. If `host` doesn't match (the folder was copied from another computer), a new id is made |
| `sync/account.json` | `{ "version": 1, "project": "recaller-cloud", "uid", "email", "emailVerified", "keyStore": "keychain" \| "dpapi" \| "session" \| "test", "refresh": { "enc": "…" } \| { "testPlain": "…" } \| null, "privacyVersion": "2026-10-01" \| null, "signedInAt": ms }` | at sign-in and when the token rotates. If `project` doesn't match the config, the file is ignored (never used with another project) |
| `sync/state.json` | see below | after every flush while signed in, and after each sync step. Written after the data file |
| `sync/shadow.json` | `{ "version": 1, "uid", "rev", "board": { "joiner" }, "projects": { "<id>": { "f": {…}, "k": "key", "r": 12, "u": "updateTime", "d": false, "i": "docId" } }, "notes": { "<id>": { "f": {…}, "p": "pid", "l": "notes", "k", "r", "u", "d", "i", "c": 3, "lc": ms } } }` | only after the matching commit or acknowledged file write (5.4) |
| `recaller-data.unreadable-<ISO time>.json` | a byte copy of a data file that couldn't be parsed | only while signed in, before anything can overwrite it; the 5 newest are kept |

The `sync/state.json` shape:

```json
{ "version": 1, "uid": "…", "rev": 57, "headUpdateTime": "2026-10-01T10:00:00.123456Z", "minRev": 0,
  "mode": "normal" | "union" | "restore" | "first",
  "seeded": false, "dataFile": { "sha256": "…", "bytes": 123456 },
  "uploaded": { "<imageId>": 3 },   // bitmask: 1 = thumbnail, 2 = full size
  "quarantine": { "note:<id>": { "code": "PERMISSION" | "TOO_LARGE", "sig": "…", "at": 0 } },
  "labels": ["Delete note"], "choice": null | { "kind": "…" },
  "lastPullAt": 0, "lastPushAt": 0, "lastAuditAt": 0, "lastIncomingBackupAt": 0,
  "deletion": null | { "startedAt": 0 } }
```

**Other rules for the sync folder:**
- **Writes** go through `writeJsonAtomic`.
- **Sign-out** deletes `account.json`. It keeps `state.json` and `shadow.json` for the same account, unless "Also remove this board…" is checked.
- **A different account signing in** means both files are deleted first.

### 3.6 IPC contract

Main validates every payload:
- email ≤ 254 characters matching `^[^\s@]+@[^\s@]+\.[^\s@]+$`;
- password: a string of 1–4096 characters;
- `choice` must be in the allow-list;
- `meta` must be a plain object (bad meta is treated as `{}`; the save is never dropped).

Only one account operation runs at a time; a second returns `{ ok: false, code: 'BUSY' }`.

**Page → main:**

| Preload | Channel | Type | Payload → result |
|---|---|---|---|
| `saveData(data, meta)` | `data:save` | send | existing payload plus `meta = { session, seq, contentSeq, labels: string[], ack?: patchId }`. Main ignores meta while signed out |
| `account.get()` | `account:get` | invoke | → `AccountState` |
| `account.signUp(email, password, privacyVersion)` | `account:sign-up` | invoke | `{ email, password, privacyVersion }` → `Result` |
| `account.signIn(email, password)` | `account:sign-in` | invoke | `{ email, password }` → `Result` |
| `account.resendVerification()` | `account:resend-verification` | invoke | → `Result` |
| `account.checkVerified()` | `account:check-verified` | invoke | → `Result & { verified: boolean }` |
| `account.discardUnverified()` | `account:discard-unverified` | invoke | → `Result` (deletes the unverified account if the sign-up was in the last few minutes and it wasn't verified meanwhile, otherwise leaves it for the clean-up script; then signs out. `NETWORK` and `TOO_MANY_ATTEMPTS` change nothing; section 0, item 18) |
| `account.resetPassword(email)` | `account:reset-password` | invoke | `{ email }` → `Result` (ok for unknown emails too; `RESET_UNAVAILABLE` with `retryAfterMs` when a link went to that email less than a minute ago; section 0, item 33) |
| `account.signOut(opts)` | `account:sign-out` | invoke | `{ force: boolean, removeBoard: boolean, removeUnreadable: boolean }` → `Result`, `{ ok: true, picturesLeft: n }` when a plain sign-out left full-size pictures in the account (section 0, item 29), or `{ ok: false, code: 'PENDING', pending: n, localOnly? }` |
| `account.deleteAccount(password)` | `account:delete` | invoke | `{ password }` → `Result` (progress arrives in `account:changed`, starting with `save-pictures`) |
| `sync.ready(info)` | `sync:ready` | send | `{ session }` at the end of `init()` |
| `sync.nack(info)` | `sync:nack` | send | `{ patchId, reason: 'stale' \| 'invalid' }` |
| `sync.now()` | `sync:now` | invoke | → `SyncStatus` |
| `sync.choose(answer)` | `sync:choose` | invoke | `{ choice: 'upload' \| 'combine' \| 'use-account' \| 'not-now' \| 'delete-everywhere' \| 'keep' \| 'retry' }` → `Result` |

**Main → page:**

| Channel | Payload |
|---|---|
| `account:changed` | `AccountState`, sent on every change |
| `sync:patch` | `Patch` (5.8) |

**Shapes:**

```ts
Result = { ok: true } | { ok: false, code: ResultCode, retryAfterMs?: number }
ResultCode = 'INVALID_EMAIL' | 'WEAK_PASSWORD' | 'EMAIL_EXISTS' | 'WRONG_PASSWORD' | 'USER_DISABLED' | 'TOO_MANY_ATTEMPTS'
  | 'LOCKED_OUT' | 'SIGNUP_PAUSED' | 'RESET_UNAVAILABLE' | 'NETWORK' | 'NOT_VERIFIED' | 'PENDING' | 'BUSY' | 'UNAVAILABLE'
AccountState = {
  enabled: boolean,
  state: 'signed-out' | 'unverified' | 'signed-in' | 'needs-sign-in' | 'deleted' | 'disabled',
  email?: string, keyStore?: 'keychain' | 'dpapi' | 'session' | 'test',
  sync?: SyncStatus, choice?: Choice | null,
  devices?: [{ id: string, name: string, platform: 'darwin' | 'win32' | 'linux', lastSeenAt: number, current: boolean }],
  counts?: { projects: number, notes: number, pictures: number } | null,   // the account's board, for the delete panel
  deleting?: { what: 'save-pictures' | 'pictures' | 'notes' | 'account', done: number, total: number } | null,
  signingOut?: { what: 'pictures', done: number, total: number },   // only while a plain sign-out saves pictures
}
SyncStatus = {
  phase: 'syncing' | 'synced' | 'pending' | 'offline' | 'waiting' | 'choosing' | 'paused' | 'update-needed' | 'deleting-elsewhere',
  pending: number, lastSyncedAt: number | null, tooLarge: number, quarantined: number,
  progress?: { what: 'upload-notes' | 'upload-pictures' | 'download-notes', done: number, total: number },
  error?: { code: 'PERMISSION' | 'QUOTA' | 'TOO_LARGE' | 'SERVER' | 'BAD_REQUEST' | 'UNKNOWN', retryAt?: number },
  waitingFor?: DeviceRef,
}
Choice = {
  kind: 'first-upload' | 'first-merge' | 'mass-delete' | 'account-gone',
  account?: { projects: number, notes: number, pictures: number, changedAt: number | null, device: DeviceRef | null },
  local?: { projects: number, notes: number, pictures: number },
  otherAccount?: string,   // masked email of the account this computer last synced with
  count?: number,          // mass-delete: notes that would be deleted
}
DeviceRef = { platform: 'darwin' | 'win32' | 'linux' | null, sameAsThis: boolean }
```

Main maps Identity Toolkit codes to `ResultCode`:

| Identity Toolkit code | ResultCode |
|---|---|
| INVALID_EMAIL, INVALID_IDENTIFIER, MISSING_EMAIL | `INVALID_EMAIL` |
| WEAK_PASSWORD, PASSWORD_DOES_NOT_MEET_REQUIREMENTS, MISSING_PASSWORD | `WEAK_PASSWORD` |
| EMAIL_EXISTS | `EMAIL_EXISTS` |
| INVALID_LOGIN_CREDENTIALS, INVALID_PASSWORD, EMAIL_NOT_FOUND, USER_NOT_FOUND (at sign-in) | `WRONG_PASSWORD` |
| USER_DISABLED | `USER_DISABLED` |
| TOO_MANY_ATTEMPTS_TRY_LATER, QUOTA_EXCEEDED | `TOO_MANY_ATTEMPTS` |
| ADMIN_ONLY_OPERATION | `SIGNUP_PAUSED` |
| anything containing RECAPTCHA | `RESET_UNAVAILABLE` on a reset, `UNAVAILABLE` elsewhere |
| OPERATION_NOT_ALLOWED, PASSWORD_LOGIN_DISABLED, CONFIGURATION_NOT_FOUND, PROJECT_NOT_FOUND | `UNAVAILABLE` |
| NETWORK, TIMEOUT | `NETWORK` |
| the client's own throttle | `LOCKED_OUT` with `retryAfterMs` |

CREDENTIAL_TOO_OLD_LOGIN_AGAIN is internal: main re-authenticates before deletion, so it never reaches the page.

### 3.7 Preload additions (`src/preload.js`)

```js
saveData: (data, meta) => ipcRenderer.send('data:save', data, meta),
account: {
  get: () => ipcRenderer.invoke('account:get'),
  signUp: (email, password, privacyVersion) => ipcRenderer.invoke('account:sign-up', { email, password, privacyVersion }),
  signIn: (email, password) => ipcRenderer.invoke('account:sign-in', { email, password }),
  resendVerification: () => ipcRenderer.invoke('account:resend-verification'),
  checkVerified: () => ipcRenderer.invoke('account:check-verified'),
  discardUnverified: () => ipcRenderer.invoke('account:discard-unverified'),
  resetPassword: (email) => ipcRenderer.invoke('account:reset-password', { email }),
  signOut: (opts = {}) => ipcRenderer.invoke('account:sign-out', { force: Boolean(opts.force), removeBoard: Boolean(opts.removeBoard) }),
  deleteAccount: (password) => ipcRenderer.invoke('account:delete', { password }),
  onChanged: (fn) => { const l = (_e, s) => fn(s); ipcRenderer.on('account:changed', l); return () => ipcRenderer.removeListener('account:changed', l); },
},
sync: {
  ready: (info) => ipcRenderer.send('sync:ready', info),
  nack: (info) => ipcRenderer.send('sync:nack', info),
  now: () => ipcRenderer.invoke('sync:now'),
  choose: (choice) => ipcRenderer.invoke('sync:choose', { choice }),
  onPatch: (fn) => { const l = (_e, p) => fn(p); ipcRenderer.on('sync:patch', l); return () => ipcRenderer.removeListener('sync:patch', l); },
},
```

### 3.8 Integration points in existing code

Verified against the code; each change does nothing while signed out.

**`src/store.js`**
- `writeJsonAtomic` (lines 30–43) now **returns** the serialised text. This is additive; existing callers ignore it.

**`src/main.js`**
- **Requires.** `const cloud = require('./cloud');`. The facade requires `net` and `powerMonitor` itself.
- **`scheduleDataWrite(data, meta)`** (135–139):
  ```js
  pendingData = data;
  pendingMeta = cloud.mergeSaveMeta(pendingMeta, meta); // null while signed out
  ```
  `mergeSaveMeta` keeps every `ack` (as `acks[]`), concatenates `labels`, and takes the newest `session`, `seq` and `contentSeq`.
- **`flushData()`** (123–133) becomes:
  ```js
  function flushData() {
    clearTimeout(dataTimer); dataTimer = null;
    if (!pendingData || restoring) return;
    let text;
    try { text = writeJsonAtomic(DATA_FILE(), pendingData); }
    catch (err) { console.error('[data] save failed:', err); return; }  // pendingData kept: retried by the next flush, as today
    const written = pendingData, meta = pendingMeta;
    pendingData = null; pendingMeta = null;
    cloud.onFileWritten(written, meta, text);                          // never throws; does nothing while signed out
  }
  ```
  Signed out, this behaves the same as today. Note that today a failed write keeps `pendingData` too, because the assignment sits after the write inside the `try`.
- **`loadData()`** (114–121): after `readJsonWithFallback`, call
  ```js
  cloud.onLoadResult({ from: from === DATA_FILE() ? 'main' : from ? 'bak' : null, value, file: DATA_FILE() })
  ```
  before `backup()`.
- **`data:load`** (443): `() => { cloud.onPageLoading(); return loadData(); }`.
- **`data:save`** (445–448): the handler takes `(_e, data, meta)` and calls `scheduleDataWrite(data, meta)`.
- **`restoreBackup(id)`** (413–429): after `backups.create('before-restore', …)`, call `cloud.onRestore(id)`. Also clear `pendingMeta` together with `pendingData`.
- **`createWindow()`** (163–240): on `focus`, `blur`, `show`, `hide`, `minimize` and `restore`, call `cloud.onWindowState()`. The facade reads `win.isVisible()`, `isMinimized()` and `isFocused()` through `getWindowState`.
- **`summon()`** (269–277): call `cloud.onSummon()` after `win.focus()`.
- **`image:copy`** (494–503): `await cloud.ensureImage(String(id), false)` before `images.readPng`. It returns at once while signed out.
- **`whenReady`** (548–587):
  - `cloud.init({ app, ipcMain, safeStorage, userData: app.getPath('userData'), isPackaged: app.isPackaged, getWindow: () => win, images, backups, flushData, hasPendingWrite: () => pendingData !== null, isRestoring: () => restoring, getDeviceSettings, appVersion: app.getVersion(), platform: process.platform })` after `protectData()`;
  - `images.serve({ fetchMissing: cloud.ensureImage })` in place of `images.serve()` (578);
  - `cloud.registerIpc(ipcMain)` inside `registerIpc()`.
- **`getDeviceSettings`** returns `{ theme, model, language, hint, hotkey, shotHotkey, hideAfterCopy }` from `settings`. It is an allow-list: never `apiKey`, `bounds`, `maximized` or `lastVersion`.
- **Lifecycle** (597–606). Register **after** the existing `before-quit` listeners, so that the flush and, on a Mac, `quitting = true` run first:
  ```js
  let finalPushDone = false;
  app.on('before-quit', (e) => {
    if (finalPushDone || !cloud.active() || !cloud.hasUnpushed()) return;
    e.preventDefault();
    finalPushDone = true;   // app.quit() below fires before-quit again; this lets it through
    flushData();
    cloud.finalPush(1500).finally(() => app.quit());
  });
  ```
  Also add `powerMonitor.on('resume' | 'unlock-screen', () => cloud.onResume())`, registered in the facade.

**`src/backups.js`**
- Line 12: `KEEP` gains `'before-sync': 10`. The `ID` regex (line 14) already accepts `before-sync`.

**`src/images.js`**
- `serve({ fetchMissing } = {})` (26–35). The handler becomes `async`:
  1. If the requested file is missing and `fetchMissing` exists, `await fetchMissing(id, isThumb)` (with a 15 s timeout inside the engine).
  2. Then the existing fallback from the thumbnail to the full picture.
  3. Otherwise 404.

  Without `fetchMissing` it behaves exactly as today.
- New functions:
  - `has(id, thumb = false)`;
  - `readFile(id, thumb = false)`;
  - `writeWithId(id, thumb, bytes)`: the id is checked against `/^[a-f0-9]{32}$/`, `mkdir -p`, then a tmp file and a rename;
  - `ensureThumb(id)`: writes `<id>.t.png` from `<id>.png` with the same 640 px rule as `store()`.

**`src/renderer/app.js`** (line references from `masos`):
- **`persist()`** (284–292) becomes `persist(extra = {})`, which sends `api.saveData(data, { session: SESSION, seq: ++saveSeq, contentSeq, labels: pendingLabels.splice(0), ...extra })`.
- **`pushHistory()`** (338–345): `contentSeq++; pendingLabels.push(label);`. This covers every checkpointed edit, including `dragEnd`, which calls `pushHistory` directly (line 2549).
- **`undo()` and `redo()`** (384–411): `contentSeq++; pendingLabels.push('Undo' | 'Redo')` before `applySnapshot`.
- **The joiner handler** (3440–3447): `contentSeq++; pendingLabels.push('Join setting')`.
- **`copyNote()`** (1039–1078): after the `await`, `const cur = locate(id); if (cur) { cur.note.copied = … }`.
- **`toggleSelect()`** (1149–1181): same pattern for `loc.note` after `await copySelection()`.
- **A new `// ---- sync` section:** `SESSION`, `saveSeq`, `contentSeq`, `pendingLabels`, `pendingPatch`, `syncBusy()`, `tryApplyPatch()`, `noticeText()`, the `api.sync.onPatch` handler (5.8), and `window.RecallerUI = { toast, openSettings, relTime }`.
- **`init()`** (3643–3672): as its last line, `api.sync?.ready({ session: SESSION })`.
- **`updateCard()`** (653–673): add `note.syncConflict ? 1 : 0` to the signature, and set `.card-sync-tag` text and title (6.5).
- **`startEdit()` onSave** (1001–1011): when the note has `syncConflict`, delete it as part of the edit.
- **`BACKUP_KIND`** (3325): add `'before-sync': 'Before sync'`.
- **Restore handler** (3476–3484): `const acc = await api.account?.get().catch(() => null);`, then use the signed-in confirm text from 6.8 when `acc?.state === 'signed-in'`.

**`src/renderer/index.html`**
- The new section (6.1) goes before `<h3 class="modal-section">Your data</h3>` (line 272).
- `#sync-status` goes in `.topbar-actions`, before `#open-help`.
- One Help line.
- Scripts in order: `icons.js`, `voice.js`, `sync-apply.js`, `app.js`, `account.js`.

---

## 4 Cloud data model and rules

### 4.1 Paths

```
users/{uid}                         head: board revision and board-wide fields (the only frequently written doc)
users/{uid}/projects/{docId}        one per project, live or tombstone
users/{uid}/notes/{docId}           one per note, any stage (_sync.list: notes = Cooking, used = Cooked, combined = Served)
users/{uid}/trash/{kind}-{docId}    full copy of a deleted project or note; TTL deletes it 30 days later
users/{uid}/devices/{deviceId}      one per computer: backup of its view, drafts and allow-listed settings
gs://recaller-cloud-data/users/{uid}/images/{imageId}.png      full picture, byte-identical to images/<id>.png
gs://recaller-cloud-data/users/{uid}/images/{imageId}.t.png    thumbnail (≤ 640 px), byte-identical to images/<id>.t.png
```

### 4.2 Documents

Decoded here; REST uses typed `fields`.

```jsonc
// users/{uid}: the head. Board commits write it with an updateMask, so fields from newer versions survive.
{ "schema": 1, "rev": 57, "minRev": 0, "deleting": false,
  "createdAt": "<REQUEST_TIME>", "updatedAt": "<REQUEST_TIME>",
  "lastDevice": "c0ffee…(32 hex)", "board": { "joiner": "blank" },
  "stats": { "projects": 12, "notes": 340, "images": 58 },           // live counts as of this rev
  "privacy": { "version": "2026-10-01", "acceptedAt": "<timestamp>" } }  // only when known at creation
// While being deleted: "deleting": true, "deletingAt": "<REQUEST_TIME>". The email is never copied into Firestore.

// users/{uid}/projects/{docId}
{ "name": "Wildfire RL", "color": "monstera", "createdAt": 1758690000000,
  "futureProjectField": "x",                                    // unknown fields travel under their own names
  "_json": { "weird": "[[1,2],[3]]" },                          // only for values Firestore can't hold
  "_sync": { "rev": 42, "key": "a0", "deleted": false, "by": "c0ffee…", "at": "<REQUEST_TIME>" } }

// users/{uid}/notes/{docId}
{ "text": "Review the fire spread model …", "images": [{ "id": "9f0c…", "w": 3024, "h": 1964 }],
  "createdAt": 1758690000000, "updatedAt": 1758693600000, "usedAt": 0,
  "copied": 5, "lastCopiedAt": 1758700000000, "highlight": "amber",
  "syncConflict": { "of": "3f2b…", "device": "c0ffee…", "at": 1758700000000 },   // only on conflict copies
  "futureNoteField": { "nested": true },
  "_sync": { "rev": 42, "key": "a0V", "deleted": false, "by": "c0ffee…", "at": "<REQUEST_TIME>",
             "project": "<projectId>", "list": "used", "id": "<original id, only when docId ≠ id>" } }

// Tombstone (projects and notes): only _sync, with "deleted": true (project and list kept on notes).

// users/{uid}/trash/note-{docId}  (written in the same commit as the tombstone)
{ "kind": "note", "data": "<JSON text of the synced fields as last synced>", "rev": 58,
  "project": "<pid>", "list": "notes", "by": "c0ffee…", "deletedAt": "<REQUEST_TIME>", "expireAt": "<serverNow() + 30 days>" }

// users/{uid}/devices/{deviceId}  (every 10 min when changed, and at quit if time remains)
{ "name": "Mac", "platform": "darwin", "appVersion": "1.17.0", "lastSeenAt": "<REQUEST_TIME>", "lastRev": 57,
  "view": "<JSON text: { prefs: { density, colWidths, scroll, lastProjectId, titleFont, cookedColor, …unknown prefs },
             projects: { <id>: { notesCollapsed, usedCollapsed, augCollapsed, usedExpanded, augExpanded } },
             notes: { <id>: { expanded: true } }, top: { …unknown top-level keys } }>",
  "drafts": "<JSON text: { <projectId>: { text, images: [{ id, w, h }] } }>",
  "settings": { "theme": "deep", "model": "gpt-transcribe", "language": "", "hint": "", "hotkey": "Control+Alt+R",
                "shotHotkey": "", "hideAfterCopy": false } }
```

**REST encoding of one note write** inside a commit:

```json
{ "update": { "name": "projects/recaller-cloud/databases/(default)/documents/users/UID/notes/3f2b8c1e-…",
    "fields": { "text": { "stringValue": "…" },
                "images": { "arrayValue": { "values": [{ "mapValue": { "fields": { "id": { "stringValue": "9f0c…" },
                            "w": { "integerValue": "3024" }, "h": { "integerValue": "1964" } } } }] } },
                "createdAt": { "integerValue": "1758690000000" }, "copied": { "integerValue": "5" },
                "_sync": { "mapValue": { "fields": { "rev": { "integerValue": "58" }, "key": { "stringValue": "a0V" },
                           "deleted": { "booleanValue": false }, "by": { "stringValue": "c0ffee…" },
                           "project": { "stringValue": "p1" }, "list": { "stringValue": "notes" } } } } } },
  "updateTransforms": [{ "fieldPath": "_sync.at", "setToServerValue": "REQUEST_TIME" }] }
```

### 4.3 Encoding rules (`codec.js`)

**Values:**

| JSON value | Firestore value |
|---|---|
| integer (`Number.isSafeInteger`) | `integerValue`, as a string |
| any other finite number | `doubleValue` |
| boolean | `booleanValue` |
| null | `nullValue` |
| string | `stringValue` |
| array | `arrayValue` |
| object | `mapValue` |

**When a whole top-level field goes into `_json`** as its `JSON.stringify` text:
- an array directly inside an array;
- a string with a lone surrogate (detected by regex);
- a map key that no map may hold: empty, reserved (`^__[\s\S]*__$`, Firestore's `__.*__` with a line break inside counted too), holding a lone surrogate, or longer than 1,500 bytes;
- nesting deeper than 20 (a field's own map or array is level 1, as in Firestore's docs);
- a top-level key starting with `_`.

**A top-level key that no map may hold** (by the same key rules) can't even be a key inside `_json`. It goes there under `x-` + base64url(sha256(key)), and its text is the JSON of `[key, value]`, so decoding restores the exact name. A key with a lone surrogate is hashed from its UTF-16 code units, since UTF-8 would turn every lone surrogate into the same character.

`JSON.stringify` escapes lone surrogates, so `_json` always holds valid UTF-8.

**What's excluded from item documents:** the per-device keys (`SyncApply.isLocalKey`) and the structural keys. Counters are written as the typed `copied` (total) and `lastCopiedAt`.

**Items are always written as whole documents,** with no update mask. This is safe because the head precondition guarantees the writer has seen the latest version.

**The head is written with an update mask** of `['rev', 'lastDevice', 'board', 'stats']`, plus `privacy` when it changes.

**Decoding** uses `{ ...typed fields except _sync and _json, ...parsed _json }`, and the id is `_sync.id ?? docId`. An `x-` entry whose text is `[key, value]` with a matching hash gets its own key back. Nothing is dropped: a `_json` that isn't a map (this codec never writes one) is kept as an ordinary field named `_json`, and a `_json` entry that isn't valid JSON text is kept as the text. Remote documents are coerced like `normalize()`:
- non-string `name` → "Untitled", non-string `color` → `monstera`;
- `images` cleaned with the 32-hex id rule;
- numbers coerced;
- a non-string `text` becomes `String(text ?? '')` and is logged;
- remote data is never dropped silently.

### 4.4 What syncs and what stays on each computer

| Data | Syncs? | Notes |
|---|---|---|
| Project `name`, `color`, `createdAt`, column order, existence, unknown project fields | yes | |
| Note `text`, `images` (image objects whole, unknown image fields included), `createdAt`, `updatedAt`, `usedAt`, `highlight`, `syncConflict`, stage, order within the stage, existence, unknown note fields | yes | stage uses the data names |
| `copied` | yes, as a counter | merged as remote + (local − base); pushed on blur or hide, with the next content push, after 10 minutes, or at quit |
| `lastCopiedAt` | yes | the larger value wins |
| `prefs.joiner` | yes (`head.board.joiner`) | it changes what a copy contains |
| `prefs.density`, `colWidths`, `scroll`, `lastProjectId`, `titleFont`, `cookedColor`, unknown prefs | no; device record | the screens differ; see question Q3 for the look |
| `notesCollapsed`, `usedCollapsed`, `augCollapsed`, `usedExpanded`, `augExpanded`, note `expanded` | no; device record | view state. A project arriving from the other computer gets `newProjectDefaults()` |
| `draft`, `draftImages` | no; device record, with draft pictures uploaded | never merged into another computer's composer |
| unknown top-level keys and `version` | no; device record `view.top` | not board content |
| keys starting with `local` | no | a new convention for future per-device fields |
| Settings file | allow-list only, device record | theme, model, language, hint, hotkey, shotHotkey, hideAfterCopy. The rules reject anything else |
| OpenAI API key | **never** | stays in `safeStorage` on each computer |

### 4.5 Order

- **Membership lives on the note:** `_sync.project` plus `_sync.list`. There are no order arrays in the cloud, so a note can never be lost from an array.
- **Order is a key.** `_sync.key` is a base-62 fractional key, compared as a plain string, ties broken by id. The digits are `0-9A-Za-z`, which ascend in code-unit order, and a key never ends in `0`. A project's key is its column position.
- **`keyBetween`**, the reference algorithm:
  ```js
  const D = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  function keyBetween(a, b) {                 // a < result < b; null means unbounded
    a = a || '';
    if (b != null && !(a < b)) throw new RangeError('keyBetween: a must sort before b');
    let out = '';
    for (let i = 0; ; i++) {
      const da = i < a.length ? D.indexOf(a[i]) : 0;
      const db = b != null && i < b.length ? D.indexOf(b[i]) : 62;
      if (da === db) { out += D[da]; continue; }
      if (db - da > 1) return out + D[(da + db) >> 1];
      out += D[da]; b = null;                 // below b at this digit: unbounded above from here
    }
  }
  ```
- **Keys are assigned only when pushing,** from the local array order. `orderKeys()` keeps the longest strictly increasing run of shadow keys (a longest increasing subsequence, O(n log n)). Only the others get new keys, spread between their kept neighbours:
  - a drag writes 1 note;
  - "Sort prompts oldest first" writes only the notes that moved;
  - Move to Served writes each moved note, because `list` changes.
- **The first upload** uses `keysBetween(null, null, n)`, which gives balanced keys of about log₆₂ n + 1 characters.
- **Long keys:** when a key exceeds 48 characters, that list is re-keyed evenly on its next push. The rules cap keys at 64.

### 4.6 Pictures

- **Immutable per id.** The rules refuse an upload to a name that already holds a file (in Storage rules that upload is a `create` with `resource` set, so `create` requires `resource == null`) and every metadata `update`. An upload refused because the picture is there counts as uploaded, whatever its bytes: the account's copy stays, and this computer keeps its own file (section 0, item 34).
- **Upload order:**
  - Before committing a chunk that references a picture, upload `<id>.t.png` and then `<id>.png`, three at a time. `ensureThumb` first, if the thumbnail is missing.
  - Record the result in `state.uploaded`.
  - Notes without pictures go in earlier chunks, so text never waits for pictures.
- **Download:**
  - Thumbnails are prefetched in the background after each patch (four at a time), and also fetched on demand by `recaller-img://`.
  - Full-size pictures are fetched on demand, for the lightbox and for `image:copy`. As built, also before a plain sign-out (for at most 20 s) and before an account deletion: every full size the board shows that is here only as a preview (section 0, items 29 and 31). A full size still missing is shown and copied from its thumbnail (item 30).
  - A merge never waits for pictures.
- **Draft pictures** are uploaded at low priority after content, for the device-record backup, and are never downloaded by another computer.
- **Local `images:gc`** is unchanged. Downloads are newer than one hour and are referenced, so they are safe.
- **Cloud clean-up of unreferenced pictures:** none in v1. Pictures leave the cloud only when the account is deleted.

### 4.7 Size limits

The client limits are stricter than the rules.

| Item | Client | Rules and platform |
|---|---|---|
| Note document | quarantined as `TOO_LARGE` above 900 KB estimated; it stays local and in local backups | 1 MiB per document (no rules cap on text) |
| Fields per item | ≤ 150 | ≤ 200 |
| Order key | re-keyed above 48 characters | ≤ 64 |
| Commit | ≤ 400 writes and ≤ 8 MiB estimated; one chunk per second during bulk uploads | 10 MiB per request; ≈ 500 writes per second on sequential indexed fields |
| Picture | skipped above 32 MB; the note still syncs, with the status line | ≤ 40 MB, PNG only |
| Device `view` and `drafts` | ≤ 600,000 and ≤ 150,000 characters; first drop `view.notes`, then truncate drafts with `"truncated": true` | ≤ 700,000 and ≤ 200,000 |
| Trash `expireAt` | serverNow() + 30 days | between now and now + 40 days |

### 4.8 Firestore rules (`infra/firebase/firestore.rules`, full text)

```
rules_version = '2';

// Recaller accounts and sync (ai_memory/15_accounts_and_sync.md). Deployed by infra/terraform/prod/rules.tf.
// Every signed-in user whose email is verified owns /users/{uid} and everything under it; nobody else can
// read or write it. A board change is one commit that also moves users/{uid}.rev up by exactly one, so no
// board write can succeed while the account is being deleted: the head write in the same commit is refused.
// Project, note and trash writes make no get()/exists() calls, so a commit of any size stays within the
// access-call limits (20 per batched write). One ruleset serves every released Recaller version: a new
// version's rules must keep accepting everything older versions write.
service cloud.firestore {
  match /databases/{database}/documents {

    function isOwner(uid) {
      return request.auth != null
        && request.auth.uid == uid
        && request.auth.token.email_verified == true;
    }

    function headOf(uid) {
      return get(/databases/$(database)/documents/users/$(uid)).data;
    }

    function incoming() {
      return request.resource.data;
    }

    // _sync, the bookkeeping on every project and note. kind is 'project' or 'note'.
    function validSync(kind) {
      let s = incoming()._sync;
      return s is map
        && s.keys().hasAll(['rev', 'key', 'deleted', 'by', 'at'])
        && s.keys().hasOnly(['rev', 'key', 'deleted', 'by', 'at', 'id', 'project', 'list'])
        && s.rev is int && s.rev > 0
        && s.key is string && s.key.size() > 0 && s.key.size() <= 64
        && s.deleted is bool
        && s.by is string && s.by.size() <= 64
        && s.at == request.time
        && (!('id' in s) || (s.id is string && s.id.size() <= 1500))
        && (kind == 'project'
            || (s.project is string && s.project.size() > 0 && s.project.size() <= 1500
                && s.list in ['notes', 'used', 'combined']));
    }

    // A tombstone keeps only _sync; a live item has at most 200 fields.
    function validShape() {
      return incoming()._sync.deleted == true
        ? incoming().keys().hasOnly(['_sync'])
        : incoming().keys().size() <= 200;
    }

    // An item's rev only moves forward, so an incremental pull can't miss a later write.
    function revMovesForward() {
      return incoming()._sync.rev > resource.data._sync.rev;
    }

    // Hard deletes: only while the account is being deleted, or tombstones at or below head.minRev.
    function mayHardDelete(uid) {
      let head = headOf(uid);
      return head.get('deleting', false) == true
        || (resource.data._sync.deleted == true && resource.data._sync.rev <= head.get('minRev', 0));
    }

    match /users/{uid} {
      allow get: if isOwner(uid);

      allow create: if isOwner(uid)
        && incoming().keys().size() <= 50
        && incoming().schema is int && incoming().schema >= 1
        && incoming().rev == 1
        && incoming().minRev == 0
        && incoming().deleting == false
        && incoming().createdAt == request.time
        && incoming().updatedAt == request.time;

      allow update: if isOwner(uid) && incoming().keys().size() <= 50 && (
          // A board commit: rev goes up by exactly one; a deletion in progress can't be undone.
          (resource.data.deleting == false
            && incoming().deleting == false
            && incoming().rev == resource.data.rev + 1
            && incoming().schema is int && incoming().schema >= resource.data.schema
            && incoming().minRev is int && incoming().minRev >= resource.data.minRev
            && incoming().minRev <= incoming().rev
            && incoming().createdAt == resource.data.createdAt
            && incoming().updatedAt == request.time)
          // The start of an account deletion: only deleting and deletingAt change.
          || (incoming().diff(resource.data).affectedKeys().hasOnly(['deleting', 'deletingAt'])
            && incoming().deleting == true
            && incoming().deletingAt == request.time));

      allow delete: if isOwner(uid) && resource.data.deleting == true;

      match /projects/{projectId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && validSync('project') && validShape();
        allow update: if isOwner(uid) && validSync('project') && validShape() && revMovesForward();
        allow delete: if isOwner(uid) && mayHardDelete(uid);
      }

      match /notes/{noteId} {
        allow read: if isOwner(uid);
        allow create: if isOwner(uid) && validSync('note') && validShape();
        allow update: if isOwner(uid) && validSync('note') && validShape() && revMovesForward();
        allow delete: if isOwner(uid) && mayHardDelete(uid);
      }

      match /trash/{itemId} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && incoming().keys().hasOnly(['kind', 'data', 'rev', 'project', 'list', 'by', 'deletedAt', 'expireAt'])
          && incoming().kind in ['project', 'note']
          && incoming().data is string
          && incoming().rev is int
          && incoming().by is string && incoming().by.size() <= 64
          && incoming().deletedAt == request.time
          && incoming().expireAt is timestamp
          && incoming().expireAt > request.time
          && incoming().expireAt < request.time + duration.value(40, 'd');
        allow delete: if isOwner(uid) && headOf(uid).get('deleting', false) == true;
      }

      match /devices/{deviceId} {
        allow read: if isOwner(uid);
        allow create, update: if isOwner(uid)
          && deviceId.matches('[a-f0-9]{32}')
          && headOf(uid).get('deleting', false) == false
          && incoming().keys().hasOnly(['name', 'platform', 'appVersion', 'lastSeenAt', 'lastRev', 'view', 'drafts', 'settings'])
          && incoming().name is string && incoming().name.size() <= 60
          && incoming().platform in ['darwin', 'win32', 'linux']
          && incoming().lastSeenAt == request.time
          && (!('view' in incoming()) || (incoming().view is string && incoming().view.size() <= 700000))
          && (!('drafts' in incoming()) || (incoming().drafts is string && incoming().drafts.size() <= 200000))
          && (!('settings' in incoming()) || (incoming().settings is map
              && incoming().settings.keys().hasOnly(['theme', 'model', 'language', 'hint', 'hotkey', 'shotHotkey', 'hideAfterCopy'])));
        allow delete: if isOwner(uid) && headOf(uid).get('deleting', false) == true;
      }
    }
  }
}
```

**Access-call budget:**
- Board commits (head, projects, notes, trash): **0**.
- A device write: 1, as a single-document request.
- A hard delete: 1 per delete, so deletions are committed 10 at a time, well under 20 per batch.
- A missing head makes `get()` fail, which denies. That is intended.

### 4.9 Storage rules (`infra/firebase/storage.rules`, full text)

Changed after the 2026-10-01 smoke test: `allow create` also requires `resource == null`, because an upload over an existing file is a `create` in Storage rules, not an `update` (section 0, item 34). Not deployed yet.

```
rules_version = '2';

// Recaller pictures (deployed by infra/terraform/prod/rules.tf).
// users/{uid}/images/<32 hex>.png is the full picture, <32 hex>.t.png its thumbnail.
// A picture never changes once uploaded, and is deleted only while the account is being deleted.
// In Storage rules every upload of a file's contents is a create, also an upload over a file that already
// exists (resource is then that file's metadata); update applies only to changing an existing file's
// metadata. So create requires resource == null, and update is never allowed.
// A new upload and a delete read the account's head in Firestore (one billed read each; at most two per
// evaluation are allowed); an upload over an existing picture is refused before that read. The read needs
// roles/firebaserules.firestoreServiceAgent on the Storage service agent (infra/terraform/prod/sync.tf).
// A missing head denies the upload: the app creates the head first.
service firebase.storage {
  match /b/{bucket}/o {

    function isOwner(uid) {
      return request.auth != null
        && request.auth.uid == uid
        && request.auth.token.email_verified == true;
    }

    function deleting(uid) {
      return firestore.get(/databases/(default)/documents/users/$(uid)).data.get('deleting', false);
    }

    match /users/{uid}/{allPaths=**} {
      allow list: if isOwner(uid);
    }

    match /users/{uid}/images/{name} {
      allow get: if isOwner(uid);
      allow create: if isOwner(uid)
        && resource == null
        && name.matches('[a-f0-9]{32}([.]t)?[.]png')
        && request.resource.size > 0
        && request.resource.size <= 40 * 1024 * 1024
        && request.resource.contentType == 'image/png'
        && deleting(uid) == false;
      allow update: if false;
      allow delete: if isOwner(uid) && deleting(uid) == true;
    }
  }
}
```

### 4.10 Indexes and TTL

- **No composite indexes.** Every query runs inside one user's subcollection:
  - `_sync.rev` range plus `orderBy (_sync.rev, __name__)`;
  - `orderBy __name__`.
  The automatic single-field indexes on map subfields serve them.
- **Index exemptions and the TTL** are in `sync.tf` (2.4).

---

## 5 Sync algorithm

### 5.1 Invariants

| # | Invariant | Enforced by |
|---|---|---|
| S1 | The local file is the source of truth. Signed out behaves like 1.16.0 | `active()` is false: no files, timers or network |
| S2 | Deletions are pushed only from files this app wrote, in normal mode | the fingerprint and union triggers (5.10) |
| S3 | Pushes are fast-forward only | head `updateTime` precondition, plus the rules' rev+1 |
| S4 | Editing a note's content beats a delete; when both sides edit a text, both versions are kept | merge rules (5.7) |
| S5 | No hard deletes outside account deletion | rules |
| S6 | The engine syncs only what is on disk. The shadow advances only for states on disk (pushes: per committed chunk; pulls: after the page's acknowledging save is written) | `onFileWritten` ordering |
| S7 | A remote change never changes something under an open editor, drag, menu or Undo toast | page deferral (5.8) |
| S8 | No clock orders anything | `rev` and keys only; clocks are used only for `expireAt` (±10 days tolerated) and "5m ago" |

### 5.2 Engine phases and triggers

- **Account status** comes from `account.state()`. When signed in, the engine phase is one of: `syncing`, `synced`, `pending`, `offline`, `waiting` (a patch deferred by the page), `choosing`, `paused`, `update-needed` or `deleting-elsewhere`.
- **One network task at a time.** Triggers set flags (`wantPull`, `wantPush`, `wantDevice`), and a single `run()` loop does the work.

| Trigger | Action |
|---|---|
| `onFileWritten` with a content change | push after a 2 s trailing debounce, at most 10 s after the first change |
| counter-only change (copies) | push on blur or hide, with the next content push, after 10 min, or at quit |
| per-device change | device record after 10 min, and at quit if time remains |
| focused / visible but unfocused / hidden or minimised | poll the head every 60 s / 5 min / 30 min (`getWindowState()` read on each tick) |
| summon, focus, show | pull at once, at most once per 10 s after the last head read (`pullSoon()`) |
| resume, unlock, back online, page ready, "Sync now" | pull at once, without the 10 s limit (so does the account becoming signed in: a sign-in, or the email found verified) |
| offline (`net.isOnline()` false) | no attempts; check every 30 s |
| failures | backoff 5 s, 15 s, 1 min, 5 min, then every 15 min, ±20 % jitter; reset on success, focus, show, resume, unlock, "Sync now" or back online |

### 5.3 Startup

1. **At the start of `whenReady`,** `cloud.init()` loads `sync/account.json` if it exists (the token is decrypted only when packaged), and `device.json`, `state.json` and `shadow.json`. There is no network call yet.
2. **`onLoadResult({ from, value, file })`,** when signed in:
   - `L_disk = value` (the file as on disk);
   - `fingerprint = sha256(JSON.stringify(value, null, 2))` when `from === 'main'`. For files `writeJsonAtomic` wrote, this equals the file's bytes;
   - choose the mode (5.10);
   - if the main file exists but couldn't be parsed (`from !== 'main'`), copy its bytes to `recaller-data.unreadable-<ISO>.json` straight away.
3. **`onPageReady({ session })`** starts the loop: token, then head, then pull or first sync, then push.

### 5.4 Detecting local changes (durability)

- The engine's local state is **only** `L_disk`. It is updated in `onFileWritten(data, meta, text)`, which main calls after `writeJsonAtomic` succeeds.
- Each call also updates `state.dataFile = { sha256(text), bytes }` and writes `state.json`, which is small, always after the data file.
- `meta.acks` commits pending pull patches (5.6).
- `meta.labels` are added to `state.labels` for the mass-delete guard.
- **Pending local changes** are `diffLocal(shadow, toModel(L_disk), mode)`, per entity:
  - A new or changed entity, compared by `fieldsSig`, position register or counter, becomes an upsert.
  - An entity in the shadow, alive, and missing locally becomes a tombstone plus a trash copy, **in normal mode only**.
  - Per-device fields are ignored.
  - Entities skipped by the defensive `toModel` are never tombstoned. They are ids invented this session by `normalize()`, which aren't on disk yet.
- The file on disk plus the shadow is the offline queue. It survives restarts, crashes and downgrades.

### 5.5 Push (fast-forward only)

1. **Wait until:** signed in, verified, online, not restoring, `hasPendingWrite()` false, no patch in flight, no choice pending, the phase isn't `paused`, and `schema` is OK.
2. **`GET users/{uid}`.**
   - Missing while `state.rev > 0`: go to 5.9 "account gone".
   - `rev != state.rev`: pull first (5.6).
   - `deleting`: `deleting-elsewhere`.
   - `schema > 1`: `update-needed`.
   - `minRev > state.rev`: full resync (5.11).
3. **Diff.** If nothing changed, write the device record if it's due, and stop.
4. **Mass-delete guard.** If there are tombstones and **none** of `state.labels` is in the explaining set (`Delete note`, `Delete project`, `Clear Cooked`, `Clear Served`, `Delete Cooked note`, `Delete Served text`, `Edit Cooked`, `Edit Served`, `Undo`, `Redo`), and the tombstones cover at least 5 notes or at least 1 project, then set the choice `mass-delete` and stop.
5. **Order the chunks,** each ≤ 400 writes including the head and trash writes, and ≤ 8 MiB:
   1. project creates and undeletes;
   2. note upserts without pictures;
   3. note upserts with pictures (after their uploads);
   4. note tombstones with trash copies;
   5. other project upserts;
   6. project tombstones with trash copies.

   No intermediate state then has a live note inside a missing project.
6. **Commit each chunk.** For chunk k: `rev = state.rev + 1`.
   - The head write: `{ rev, lastDevice, board, stats }`, `updateMask ['rev', 'lastDevice', 'board', 'stats']`, an `updatedAt` REQUEST_TIME transform, and `currentDocument: { updateTime: state.headUpdateTime }`.
   - The item writes: whole documents with `_sync.rev = rev`, `_sync.by = deviceId`, and a `_sync.at` REQUEST_TIME transform.
   - Trash writes: a `deletedAt` REQUEST_TIME transform.
   - `stats` is counted from the shadow after this chunk.
7. **On success:** apply the chunk's written values to the shadow, **for exactly the entities in the chunk**. Set `state.rev = rev` and `state.headUpdateTime = writeResults[0].updateTime`. Write `shadow.json`, then `state.json`. Clear `state.labels` once all the tombstones they explained are committed. During bulk uploads, wait 1 s before the next chunk.
8. **On `HEAD_MOVED`** (400 FAILED_PRECONDITION, 409 ALREADY_EXISTS) **or `ABORTED`:** pull, merge, let the page acknowledge, recompute, and retry. After 5 in a row, back off.
9. **On `PERMISSION` (403):**
   1. GET the head again. If it is deleting or missing, handle that.
   2. Otherwise **split the chunk**: commit halves, each with its own head bump, until single items fail.
   3. Quarantine each failing entity (`state.quarantine`, keyed by kind and id, with its current signature) and keep syncing the rest.
   4. Show `paused · PERMISSION` with a Retry button. A quarantined entity is retried automatically when its signature changes, or on Retry.
10. **On `TOO_LARGE`:** quarantine the entity as `TOO_LARGE`.
11. **On `UNAUTHENTICATED`:** force a token refresh once, then retry.
12. **On `BAD_REQUEST`:** stop pushing. `paused · BAD_REQUEST` means a client bug; log the Google status only.
13. **A lost response is safe.** The retry fails the precondition, and the pull returns our own documents. A pulled document that this computer wrote (`_sync.by` is its device id) is used as the base, because it is what the shadow would hold after that commit: whatever differs locally was changed here since, and its copy count already includes this computer's copies. So nothing is written twice and no copy counts twice. (Not at the first sign-in, which has no base.) Section 0, items 1 and 2, add how the next head read settles a commit whose answer never came.

**Creating the head** (first sync on an empty account): first confirm the account still exists with a forced token refresh. Then commit the head alone:
- `{ schema: 1, rev: 1, minRev: 0, deleting: false, lastDevice, board, stats: zeros, privacy? }`;
- `createdAt` and `updatedAt` REQUEST_TIME transforms;
- `currentDocument: { exists: false }`.

If it fails with `ALREADY_EXISTS`, another computer won the race: restart the first-sync decision.

### 5.6 Pull and apply

1. **Read the head.** `rev H`. If `H == state.rev`, nothing to do.
2. **Query.** `runQuery` on parent `users/{uid}`, first `projects`, then `notes`:
   ```json
   { "structuredQuery": { "from": [{ "collectionId": "notes" }],
     "where": { "compositeFilter": { "op": "AND", "filters": [
       { "fieldFilter": { "field": { "fieldPath": "_sync.rev" }, "op": "GREATER_THAN", "value": { "integerValue": "<state.rev>" } } },
       { "fieldFilter": { "field": { "fieldPath": "_sync.rev" }, "op": "LESS_THAN_OR_EQUAL", "value": { "integerValue": "<H>" } } } ] } },
     "orderBy": [ { "field": { "fieldPath": "_sync.rev" }, "direction": "ASCENDING" },
                  { "field": { "fieldPath": "__name__" }, "direction": "ASCENDING" } ],
     "limit": 300 } }
   ```
   Page with `startAt: { values: [{ integerValue: rev }, { referenceValue: name }], before: false }`. Tombstones are included.
   - **No gaps:** every commit is atomic, and commit k+1 needs the head at k, so every commit ≤ H is complete and visible.
   - **Consistent pages:** writes after the head read carry rev > H, so the pages are consistent.
3. **Merge.** `mergeRemote({ shadow, local: toModel(L_disk), remote, mode, trash })`. Trash documents are needed only for union decisions without a base; they are read with `batchGet`.
4. **No page change needed** (`patch == null`, including echoes of our own writes): apply `shadowAfter` directly, set `state.rev = H`, save, then push if the diff isn't empty. This is safe because the disk already equals the merged state for those entities.
5. **Otherwise:**
   1. If `backupFirst` is true (the patch removes at least 10 notes or any project with notes, at most once an hour), run `backups.create('before-sync', { reason: 'incoming' })`.
   2. `page.sendPatch({ id, session, basedOnContentSeq: meta.contentSeq of L_disk's save, … })` and keep `{ id, remote, H, shadowAfter }` in memory as `inFlight`.
6. **On an ack:** when `onFileWritten` sees `meta.acks` containing `inFlight.id`, commit `shadowAfter` (the remote state, **not** the merged one), set `state.rev = H`, write the shadow and state, clear `inFlight`, then push. The differences local won are pushed like any local change.
7. **On `sync:nack` with `stale`:** after the next flush, recompute the merge from the new `L_disk` with the **same** remote documents, and send a new patch.
8. **On `onPageLoading()`:** drop `inFlight`. The shadow didn't advance, so the next pull repeats the same merge (deterministic, including conflict-copy ids).
9. **Refresh device labels.** Unknown `_sync.by` values trigger one `runQuery` of `devices` (a few reads).

### 5.7 Merge rules (`merge.js`)

Each entity has registers compared three ways (base = shadow, local, remote):
- **Content:** `text` and `images` together, with `updatedAt` following the winner.
- **Position:** `project`, `list`, `key` and `usedAt`. The local key comes from `orderKeys` against the shadow's keys.
- **Every other field separately:** `highlight`, `syncConflict`, `createdAt`, each unknown field, and project `name` and `color`.
- **Counters.**
- **Board:** `joiner`.

**Normal mode:**

| Situation | Result |
|---|---|
| Only one side changed a register | that side's value |
| Both changed a register to the same value | that value |
| Both changed **content**, differently | **Remote stays in place** (keeps the id). The local version becomes a new note right after it: id `${id}-c${sha256(text + '\n' + imageIds).slice(0, 8)}`, local fields, `highlight: local.highlight ?? 'amber'`, `syncConflict: { of: id, device: myDeviceId, at: now }`, `copied: 0`. Notice `CONFLICT` |
| Both changed position, or any other field | **local wins**, so the later pusher wins and both computers converge |
| Counters | `copied = remote.copied + max(0, local.copied − base.copied)`; `lastCopiedAt = max(local, remote)`. The patch carries `copiedDelta = max(0, merged.copied − local.copied)`. That is `max(0, remote.copied − base.copied)` whenever the local count is at least the base's. When it is lower (after a restore or a stale `.bak`), the delta lifts the local count to the account's instead of leaving an older count to be pushed over it |
| Local deleted, remote changed **content** or an unknown field | keep remote (add it back locally). Notice `KEPT_NOTE` |
| Local deleted, remote changed only position, highlight or counters, or nothing | push the tombstone |
| Remote tombstone, local changed content or an unknown field | keep local and push an undelete. Notice `KEPT_NOTE` |
| Remote tombstone, local unchanged or changed only position, highlight or counters | remove locally |
| Remote tombstone (the note itself or its column deleted elsewhere) for a note held here: moved into a project the account doesn't have yet, refused, or too large | keep local; it goes up as an undelete with its project. An exception to D10 (section 0, item 28) |
| Remote project tombstone and local has a merged live note in it, a non-empty `draft` or `draftImages`, or a changed name, colour or unknown field | keep the project and push an undelete. Notice `KEPT_PROJECT` or `KEPT_PROJECT_DRAFT` |
| Local project deleted, remote changed its name, colour or unknown fields, or a remote note is live in it | keep it (resurrected from the remote document) |
| After merging: a live note whose project isn't live | resurrect the project from local, then the shadow, then the trash; failing all three, create "Recovered notes" (`monstera`) after the last column. Notice `KEPT_PROJECT` |
| Conflict copies | placed right after the original in the merged list order |

**Union and restore modes** (5.10) change only these rows:

| Situation | union (`.bak`, seed, fingerprint mismatch, same account signing in again) | restore |
|---|---|---|
| Entity missing locally, alive remotely | add it locally (never a deletion) | add it locally |
| Local present, remote tombstone, base present | local == base: remove; otherwise keep and undelete | keep and undelete |
| Local present, remote tombstone, no base | local content == trash copy: remove; otherwise keep and undelete | keep and undelete |
| Both present, no base, content differs | remote in place, local as a copy | **local in place**, remote as a copy |
| Both present, no base, position differs | remote wins | local wins |
| Counters with no base | `max(local, remote)` | `max(local, remote)` |

**Combine** (first sign-in) is union with no base, plus:
- local-only projects are appended after the account's last column, in local order;
- local-only notes in shared projects go at the end of their stage;
- a pristine Welcome project on this computer is removed, not uploaded.

**Use my account's board:** every local-only entity is removed, and the account's board is applied, positions included. Per-device fields stay for matching ids.

### 5.8 Applying patches in the page, editors, drafts and undo

**Patch shape** (main → page, `sync:patch`):

```ts
Patch = {
  id: string, session: string, basedOnContentSeq: number,
  changesContent: boolean,            // false: only counters or lastCopiedAt changed
  resetHistory: boolean,              // true for first-sign-in choices and whenever changesContent is true
  board?: { joiner: 'blank' | 'line' | null },            // null: delete prefs.joiner
  projects: { upsert: { [id: string]: { fields: object } },   // synced fields only
              remove: string[], order: string[] | null },     // the full column order, or null for unchanged
  notes: { upsert: { [id: string]: { fields: object, project: string, list: 'notes' | 'used' | 'combined' } },
           remove: string[],
           counters: { [id: string]: { copiedDelta: number, lastCopiedAt: number } } },
  lists: { [projectId: string]: { notes?: string[], used?: string[], combined?: string[] } },  // final order of touched lists
  notices: Notice[],
}
Notice = { code: 'CONFLICT' | 'KEPT_NOTE' | 'KEPT_PROJECT' | 'KEPT_PROJECT_DRAFT' | 'REMOTE_DELETES' | 'RESTORED_FROM_ACCOUNT'
                | 'COMBINED' | 'USED_ACCOUNT', count?: number, name?: string, device?: DeviceRef, a?: number, b?: number }
```

**`SyncApply.applyPatch(data, patch)`** is pure. It mutates `data` in place and **reuses live objects**:
1. **Project upserts.**
   - If the project exists: delete every synced key (not `isLocalKey`, not structural) that is missing from `fields`, then assign `fields`.
   - Otherwise: push `{ id, ...fields, ...newProjectDefaults() }`.
2. **Project removals:** splice out those projects, together with their notes.
3. **Note upserts.**
   - If the note exists anywhere: move it when its project or list differs, delete missing synced keys, and assign `fields`. `expanded`, `copied`, `lastCopiedAt` and `local*` keys are untouched.
   - Otherwise: append `{ id, ...fields, copied: 0, lastCopiedAt: 0 }` to the target list and add the id to `created`.
4. **Note removals.**
5. **Counters:**
   ```js
   note.copied = (note.copied || 0) + copiedDelta;
   note.lastCopiedAt = Math.max(note.lastCopiedAt || 0, lastCopiedAt);
   ```
6. **List order.** For each list in `lists`: `project[list] = ids.map(live).filter(Boolean)`, then **every live note of that list the patch didn't mention**, appended. Nothing can vanish.
7. **Column order.** `order` works the same way: projects it doesn't mention are appended.
8. **Joiner:** set or delete `data.prefs.joiner`.
9. Return `{ created, removed }`.

**In `app.js`:**

```js
function syncBusy(p) {
  if (!p.changesContent) return false;                             // counters are commutative: apply at once
  if (ui.editing || dragActive || resizing || openMenuEl || Voice.isActive()) return true;
  if (document.body.classList.contains('is-panning')) return true;
  for (const c of columns.values()) if (c.stageEditor || c.renaming || c.composer?.isBusy()) return true;
  if (ui.composing && p.projects.remove.includes(ui.composing)) return true;
  return Boolean(toastHost.querySelector('.toast[data-history]:not(.is-leaving)'));  // wait out an Undo toast
}
function tryApplyPatch() {
  clearTimeout(patchTimer);
  const p = pendingPatch;
  if (!p) return;
  if (p.session !== SESSION || (p.changesContent && p.basedOnContentSeq !== contentSeq)) {
    pendingPatch = null; api.sync.nack({ patchId: p.id, reason: 'stale' }); return;
  }
  if (syncBusy(p)) { patchTimer = setTimeout(tryApplyPatch, 700); return; }
  pendingPatch = null;
  const { created } = SyncApply.applyPatch(data, p);
  if (p.changesContent) {
    contentSeq++;
    history.undo.length = 0; history.redo.length = 0; dismissHistoryToasts(); paintHistory();
  }
  if (created.length <= 10) created.forEach((id) => fresh.add(id));
  persist({ ack: p.id });
  render();                                   // also drops removed ids from ui.selection (existing code)
  if (ui.editing && !locate(ui.editing)) ui.editing = null;
  if (ui.anchor && !locate(ui.anchor.id)) ui.anchor = null;
  if (dialog.open) paintDensity();            // joiner
  for (const n of p.notices) toast(noticeText(n), { duration: 7000 });
}
api.sync?.onPatch((p) => { pendingPatch = p; tryApplyPatch(); });
```

**What this gives:**
- **Card editor.** A patch that changes content waits while the editor is open (phase `waiting`).
  - Saving raises `contentSeq`, so the patch goes stale and main recomputes. If both sides changed the text, that's a conflict copy, never an overwrite.
  - Cancelling means the waiting remote edit or delete then applies.
- **Stage editors, renaming, drags, resizing, panning, menus, dictation and snips** all make the page wait. Menus hold project objects, which is why they count as busy (for example the colour swatches at `app.js:3165–3198`).
- **The new-prompt composer stays open.** Its DOM survives `render()`, and drafts are per computer and never touched. A remote delete of the composer's column waits until the composer closes. Then either the draft is non-empty (`closeComposer` persists it), or a saved prompt exists, and either way the merge keeps the project. Otherwise the project is removed.
- **Undo.** History is cleared by every patch that changes content, and patches wait while an Undo toast is visible (3.2–9 s). So "delete, then Undo straight away" still works. Undo never reverts the other computer's work. v2: a lazy rebase.
- **Copy counts** use delta counters, so a copy made during a deferral isn't lost. `copyNote` and `toggleSelect` also look the note up again after their `await`.

### 5.9 First sign-in on a computer

This happens when there is no shadow for this account (never synced here, or `device.lastUid` differs, in which case the old shadow and state are deleted first).

1. Do a forced token refresh. `USER_NOT_FOUND` means the account was deleted: stop.
2. GET the head.
3. If the head exists, read everything: `projects` and `notes`, tombstones included, `orderBy __name__`, pages of 300, with `state.rev` set to the head **read before listing**. Then do one incremental pull, to catch writes made during the listing.
4. Compute `accountBoardPristine` and `localPristine` (below).

| Account | This computer | Action |
|---|---|---|
| empty (no head), or only a pristine Welcome | pristine Welcome or empty | Create the head and upload the board. No question, because the seed holds no personal data. If the account has a pristine Welcome, use it instead (identical boards) |
| empty, or only a pristine Welcome | a real board | Choice **`first-upload`**: "Upload this board?", with a warning when `lastUid` differs. On **Upload**: `before-sync` backup, then create the head if needed, then tombstone the account's pristine Welcome (with trash copies), then upload everything. **Not now** leaves the phase at `choosing` |
| has a board | pristine Welcome or empty | `before-sync` backup, then **Use my account's board**, with the Welcome removed. Notice `USED_ACCOUNT` |
| has a board | a real board | Choice **`first-merge`**: **Combine both** / **Use my account's board** / **Not now**. A warning shows when `lastUid` differs. Both real answers make a `before-sync` backup first and set `resetHistory` |

**Pristine is computed, never assumed** (`model.isPristineWelcome(project)`). All of these must hold:
- `name === 'Welcome'`, `color === 'monstera'`;
- `used` and `combined` are empty;
- `draft === ''` and `draftImages` is empty;
- exactly 10 notes, each with empty `images`, `copied === 0`, `lastCopiedAt === 0`, `usedAt === 0`, no `highlight`, and `updatedAt === createdAt`;
- `|project.createdAt − note.createdAt| ≤ 2000`. The seed (`seedData()`) stamps the project just before its ten notes, so a note's time is equal or a few milliseconds later. The first version of this rule, `0 ≤ project − note ≤ 2000`, had the sign backwards and failed a seed whose clock ticked between the two.

A board is pristine when it holds exactly one project and that project is a pristine Welcome. For the cloud side, the check runs on the decoded documents.

**After any first sync:** `mode = 'normal'`, `device.lastUid = uid` and `lastEmailMasked` are saved.

**For the owner:**
1. On the PC: sign up, then Upload.
2. On the Mac: sign in, then **Combine both**.

That moves the PC's notes to the Mac with no file copying (open question 17).

### 5.10 Union triggers (unreadable file, seed, `.bak`, downgrade, restore)

Mode is set at `onLoadResult` and persisted in `state.json`. It becomes `normal` after the next successful sync.

| Condition | Mode |
|---|---|
| `from === 'bak'` (main file unreadable) | `union`; the unreadable main file is copied aside |
| `from === null` and the file exists (both unreadable) | `union`, with `seeded: true`. The page writes the Welcome seed; the merge **removes the pristine seed** (explicit `remove`), never uploads it, and applies the account's board. Notice `RESTORED_FROM_ACCOUNT`. The unreadable bytes were copied aside first |
| `from === 'main'` but the fingerprint ≠ `state.dataFile.sha256` (written by 1.16 after a downgrade, copied in by hand, edited, or a crash before `state.json` was updated) | `union`, with the shadow as base: edits made meanwhile push normally, deletions made meanwhile are undone |
| `onRestore(id)` was called (persisted before the write) | `restore` |
| the same account signs in again after a sign-out | `union` if the fingerprint differs; `normal` otherwise |

**Known cost:** union mode can bring back notes that were deleted elsewhere, or deleted while signed out. That is deliberate: resurrect rather than lose.

### 5.11 Deletes, trash, tombstones, `minRev` and the audit

- **Every delete** writes a minimal tombstone (kept) plus a full trash copy with `expireAt = serverNow() + 30 d`. The TTL erases the copy.
- **Firestore hard deletes** happen only during account deletion. The rules also allow tombstones at or below `head.minRev`; that clean-up job isn't built in v1. The protocol is fixed now: `minRev` only rises, and a computer whose `state.rev < head.minRev` does a **full resync**.
  1. Read everything (as in 5.9).
  2. Merge in `union` mode with the shadow as base.
  3. Shadow entities the cloud lacks, with `r ≤ minRev`, count as remote tombstones.
- **Audit (anti-entropy).** It runs when `head.stats` disagrees with the shadow's live counts after a settled pull, and otherwise every 30 days per computer.
  1. `runQuery` with `select _sync.rev, _sync.deleted` over `projects` and `notes`.
  2. Documents whose `(rev, updateTime)` differ from the shadow, or which the shadow lacks, are fetched in full with `batchGet` and merged as a pull.
  3. Shadow entities missing from the cloud, and not below `minRev`, are dropped from the shadow, so their local copies upload as new.

  Cost: one read per document.

### 5.12 Backups

- The existing backups are unchanged: `upgrade`, `daily` (plus the Mac's hourly check), `manual` and `before-restore`.
- **New `before-sync` backups** (10 kept, labelled "Before sync") are made before:
  - every first-sign-in upload or choice;
  - "Use my account's board";
  - an incoming patch that removes at least 10 notes or any project with notes (at most once an hour).
- Daily backups now include changes from the other computer, because the local file is always complete.
- **Restore while signed in** is a union: nothing is deleted from the account. See the confirm text in 6.8.

### 5.13 Tokens, verification, errors and clock

**Token refresh.**
- `securetoken` is called 5 minutes before expiry, measured as local receipt time + `expiresIn`. Refreshes are single-flight, and also happen after a 401 and on resume.
- A rotated refresh token is sealed again.
- These refresh errors mean `needs-sign-in`: `TOKEN_EXPIRED` (for example after a password change or reset elsewhere), `INVALID_REFRESH_TOKEN`, `PROJECT_NUMBER_MISMATCH`.
- `USER_DISABLED` means `disabled`. `USER_NOT_FOUND` means `deleted`.
- In every case the board, shadow and state are kept.

**Not verified.**
- There is no Firestore or Storage traffic (the rules would deny it anyway).
- `accounts:lookup` runs on "I've verified", on window focus (at most every 10 s), and every 30 s for 10 minutes after sign-up or "Send again" while the verify panel is showing.
- When it reports verified: a **forced refresh**, so the new ID token carries `email_verified: true`, then the first sync.

**Sign-in lock-out.** After 5 wrong passwords in 10 minutes, `LOCKED_OUT` for 30 s.

**Password reset.** `sendOobCode PASSWORD_RESET` gives the neutral message, for unknown emails too. As built, it isn't always neutral: main sends at most one reset link per email a minute, and another request in that minute answers `RESET_UNAVAILABLE` with `retryAfterMs` (section 0, item 33). That limit counts every address, known or not, so it still never tells whether an account exists. Any code containing `RECAPTCHA` also gives `RESET_UNAVAILABLE`.

**Recent-login rule.** Deleting the account re-authenticates immediately before (`signInWithPassword`, same uid required). Changing the password uses the email reset flow, so it never needs a recent login.

**Clock.** `rev`, keys and REQUEST_TIME only. `serverNow()` comes from the `Date` headers of responses.

### 5.14 Sign-out and switching accounts

1. If content changes are waiting and the computer is online, try `finalPush(10 s)`.
2. If changes are still waiting and `force` is false, return `PENDING` with the count, and the page asks (6.2).
   - With **"Also remove this board…"** checked, sign-out is refused until `pending == 0`. The page shows the status and "Sync now". As built, also while anything else exists only here (section 0, item 11).
   - As built, a plain sign-out (the box not ticked) then saves the full-size pictures here, for at most 20 s (section 0, item 29).
3. `engine.stop()`, then `tokens.clear()`: delete `account.json`, keep `device.json` (with `lastUid`).
4. **Default:** keep `state.json` and `shadow.json`. Signing in again as the **same** account resumes in union or normal mode (5.10), so no question is asked. A **different** account deletes them first and then runs 5.9.
5. **"Also remove this board, its pictures and its backups from this computer":**
   - Main deletes `recaller-data.json` (plus `.bak` and `.tmp`), `images/`, `backups/`, `sync/state.json` and `sync/shadow.json`.
   - It sets `device.lastUid = null` and reloads the page, which shows the Welcome board.
   - The settings file (theme, hotkeys, OpenAI key) stays. The data folder itself is never removed.
6. Toast: "Signed out. Your board stays on this computer." With the remove option instead: "Signed out. This board was removed from this computer; your account keeps it." As built, when full-size pictures stayed in the account: "Signed out. {n} full-size pictures stay in your account, and {HERE} keeps their previews. Signing in again brings them here." (6.2).

### 5.15 Account deletion

1. `reauthenticate(password)`. A wrong password returns `WRONG_PASSWORD` ("Password is wrong.").
   - **As built, before step 2: save the full-size pictures here** (section 0, item 31). While the loop still runs and before anything is recorded or erased, the engine downloads the full size of every picture the board shows that this computer holds only as a preview (`completePictures`, strict). Progress: "Saving full-size pictures to {HERE}… {d} of {t}". If any can't be saved, the deletion stops with nothing deleted and can be tried again. A resumed deletion that had passed this step skips it. There is no pull first.
2. Stop the loop and discard `inFlight`. Waiting changes are not pushed. `state.deletion.startedAt` is recorded, then the engine **reads the head**:
   - **Missing** (an account that never uploaded, or a deletion interrupted after step 6): skip steps 3–6 and go straight to step 7. Step 3's write would be judged a create there, which the rules refuse, so without this the deletion could never finish. Skipping is safe: with no head the rules allow no upload or device write, and the head is always deleted last, so nothing else is left.
   - **Already `deleting`** (an interrupted deletion, or one started on another computer): skip step 3.
3. **Set `deleting: true`.** One commit writing the head with `updateMask ['deleting']`, a `deletingAt` REQUEST_TIME transform, `currentDocument: { exists: true }`, and no rev change. From then on, the rules refuse every board commit, device write and picture upload, from any computer. If the commit fails, the head is read again: gone means step 7, `deleting` means go on (the write landed, or another computer set it), and anything else stops the deletion with the error.
4. **Pictures.** `storage.list('users/{uid}/images/')`, then `remove()` each one, 8 at a time. Progress: "Deleting pictures… d of t".
5. **Documents.** For each of `notes`, `projects`, `trash` and `devices`, run `queryAll` with `select __name__`, then delete in commits of **10** deletes, 4 in parallel. Progress: "Deleting notes… d of t". Then the pictures are listed once more and any found are deleted: an upload that began before `deleting` was set may have finished since.
6. Delete the head.
7. `auth.deleteAccount(idToken)`. If the sign-in from step 1 is more than 4 minutes old, the same password signs in again first (section 0, item 17). `USER_NOT_FOUND` counts as done: an earlier answer was lost.
8. Locally: `account.forget()`. Remove `account.json`, `state.json` and `shadow.json`, and set `device.lastUid = null`. **The board stays.**

**Interruptions.**
- `state.deletion.startedAt` stays set. The next start shows "Finishing account deletion…" and asks for the password again.
- Any computer that signs in sees `deleting: true` and offers **Finish deleting** instead of syncing.

**Other computers.**
- A pull that sees `deleting: true` gives `deleting-elsewhere`.
- A head that is missing while `state.rev > 0` triggers a forced refresh. `USER_NOT_FOUND` means `deleted` ("This account was deleted…").
- If the account still exists, the choice is `account-gone`: [Upload this board] [Sign out]. **Never automatic.**
- A computer in `first-upload` also refreshes before creating a head, so a deleted account's token (valid for up to an hour) can never recreate data.

**Disclosed retention.** Firestore's daily backups and Storage soft delete keep deleted data for up to 7 days. Google finishes erasing sign-in records within 180 days.

### 5.16 Quit

- The final push is the `before-quit` listener in 3.8: 1.5 s, re-entry guarded, and only when `active()` and `hasUnpushed()` (content or counters).
- It flushes first, so `L_disk` holds every content change. Content saves go through `persist()` immediately; only drafts and `lastProjectId` are debounced, and they don't sync.
- The device record goes up only if time remains.
- On a Mac, `quitting = true` is already set by the earlier listener.
- Windows `session-end` gets nothing new: unpushed changes stay durable locally and upload at the next start.
- Signed out, the listener returns at once, so quitting is exactly as in 1.16.

### 5.17 How the update-safety invariants hold

| Invariant | How it holds |
|---|---|
| An up-to-date `recaller-data.json` stays byte-identical when a new version starts | Sync state lives in `sync/`. The engine never writes the data file; only the page's `persist()` does, for real changes or acknowledged patches. Signed in with nothing new in the cloud, no patch is sent and nothing is written. `normalize()` repairs aren't persisted at startup, and entities they invent stay out of pushes until a real save |
| Signed out, the app is 1.16.0 | `active()` is false: no `sync/` folder, no timers, no network, no quit delay. `enabled` is false in the existing suites. The only UI difference is the Settings section |
| Unknown fields are never dropped | Locally, `normalize()` spreads them. In the cloud they are stored under their own names or in `_json`. Patches delete only synced keys that the other side removed |
| Only additions | The one new data field is `syncConflict`, on conflict copies only. The settings file gets no new keys |
| User choices are never migrated | Per-computer choices never cross over. `joiner` travels only when changed |
| Downgrades to 1.16 are safe | 1.16 ignores `sync/`, and lists `before-sync` backups by their raw kind. Back on 1.17, the fingerprint mismatch makes the next sync a union |
| Backups before a new version | `protectData()` is unchanged, plus `before-sync` backups |
| Data folder, `productName`, `appId` | unchanged |
| Undo isn't persisted | unchanged; history is cleared on content patches |

### 5.18 Crash safety

| Crash point | Why it's safe |
|---|---|
| After a commit, before `shadow.json` is saved | Next start: `head.rev ≠ state.rev`, so the engine pulls its own documents back. Each one this computer wrote is used as the base (5.5 step 13), so there's no conflict and no copy is counted twice. Section 0, items 1 and 2, settle the commit itself |
| After a patch was sent, before the acknowledging save is written | The shadow didn't advance. The same deterministic merge runs again |
| After the acknowledging save, before `shadow.json` | Local already equals the merged state. As built, the ack marker recovers it by applying the saved delta rather than merging again, which would count copies twice (section 0, item 3) |
| Midway through a multi-chunk push | Each chunk is a complete, ordered state; the rest pushes later |
| After a flush, before `state.json` records the fingerprint | Next start sees a mismatch: a union. It resurrects rather than deletes |
| `writeJsonAtomic` throws or `restoring` is set | `onFileWritten` isn't called, so nothing advances |

---

## 6 UI and strings

### 6.1 Placement and taste

**Where:** a new `<h3 class="modal-section">Account &amp; sync</h3>` with `<section class="field" id="account">`, placed **immediately before "Your data"**. `account.js` renders into it.

**It is hidden when `enabled` is false,** together with its heading and the Help line (6.8).

**Style:**
- only existing parts: `.field`, `.help`, `.help.ok`, `.help.bad`, `.key-row`, `.btn-primary`, `.btn-ghost`. As built, a small block of new classes joins them (`.account-*`, `.btn-danger`, `.btn-danger-ghost`, the indicator's and the card tag's); `05`, "Accounts and sync", describes them;
- one filled action per state;
- danger colour only for Delete;
- inputs side by side at wide widths, stacked below 520 px;
- nothing overlaps;
- no stacked modals: every panel is inline in the section.

**Form behaviour (known issue 21):**
- Every button is `type="button"`.
- **Enter** in an account input calls `preventDefault()` and submits that small form, so Settings doesn't close.
- **Esc** in an account input calls `preventDefault()` and `stopPropagation()` and closes the form only.
- Password fields are cleared when Settings closes.

**DOM contract** (for WP9 and WP7):
- the container `#account` has `data-state` and `data-phase`;
- buttons `[data-action="…"]` use the action names shown with each button below;
- inputs `input[name=email]`, `input[name=password]`, `input[name=confirm-delete]`, `input[name=remove-board]`;
- `.account-error`, `.account-note`, and `#account-status` (with `aria-live="polite"`);
- `details.privacy-note`;
- the top-bar `#sync-status` with `data-phase` and `.sync-dot`;
- the card tag `span.card-sync-tag`.

### 6.2 States and strings

`{HERE}` is "this PC" on Windows and "this Mac" on a Mac (`IS_MAC`).

**Signed out**
- Help: "Keep this board in your own Recaller account on Google Cloud, and on every computer where you sign in. Recaller works the same without an account."
- Buttons: [Create account] `create` (primary), [Sign in] `sign-in`.

**Create account**
- Labels and placeholders: "Email" ("you@example.com"); "Password" ("At least 8 characters"), with a toggle "Show" / "Hide".
- Buttons: [Create account] `submit-create` (primary), [Cancel] `cancel`.
- Link: "I already have an account".
- Help: "By creating an account you agree to how your data is stored: see What's stored and where."
- Disclosure: `details.privacy-note` "What's stored and where" (6.7).
- Busy: "Creating account…"

**Check your email**
- Title: **Check your email**
- Body: "We sent a link to {email}. Open it, then come back to Recaller: it notices by itself. Not in your inbox? Look in Spam. Nothing is uploaded until your email is verified."
- Buttons: [I've verified] `verified` (primary), [Send again] `resend`, [Use a different email] `different-email` (deletes the unverified account if this is done within a few minutes of the sign-up; otherwise a later clean-up removes it; either way this computer signs out).
- Status lines:
  - "Not verified yet. The email can take a minute; check your spam folder too."
  - "Sent again to {email}. Not in your inbox? Look in Spam."
  - the button reads "Send again ({s} s)" during the 60 s cooldown.

**Sign in**
- Same fields.
- Buttons: [Sign in] `submit-sign-in` (primary), [Cancel].
- Links: "Forgot password?" `forgot`, "Create an account instead".
- Busy: "Signing in…"

**Forgot password**
- Help: "We'll email you a link to set a new password."
- Buttons: [Send link] `send-reset`, [Cancel].
- After sending: "If there's an account for {email}, a link is on its way (if it isn't in your inbox, look in Spam). After you change the password, sign in again on each computer."
- After a link went out, the button reads "Send link ({s} s)" for 60 s (2.7). Main also sends one link per email a minute: another answers `RESET_UNAVAILABLE` with `retryAfterMs`, which the button counts down.
- No email typed: "Type your email above first."

**Signed in**
- Line: **{email}**, then the status line (table below).
- Help: "This board is kept in your account and on every computer where you sign in. Changes sync by themselves, so there's nothing to press; Sync now only skips the wait. Column widths, folded sections, scroll, drafts and the look stay on each computer."
- Where the sign-in is kept:
  - Mac: "Your sign-in is kept in your Mac’s keychain."
  - Windows: "Your sign-in is kept encrypted on this PC."
  - Session only: "This computer can't store your sign-in securely, so you'll sign in again next time you open Recaller."
- Devices, hidden when there is no other computer: "Also signed in on: your {Windows PC | Mac} · {relTime}"
- Buttons: [Sync now] `sync-now`, [Sign out] `sign-out`.
- Links: "Change password" `change-password` (sends the reset email; confirmation: "We emailed {email} a link to set a new password (if it isn't in your inbox, look in Spam). After you change it, sign in again on each computer."; then "Change password ({s} s)" for 60 s, like Send link), "Delete account…" `delete` (danger style).

**Status line** (`#account-status`):

| Phase | Text |
|---|---|
| synced | "Synced · {relTime}" |
| syncing | "Syncing…" |
| syncing, first upload | "Uploading your board… {done} of {total} notes" / "Uploading pictures… {done} of {total}" |
| syncing, first download | "Downloading your board… {done} of {total} notes" |
| pending | "1 change waiting to upload" / "{n} changes waiting to upload" |
| offline | "Offline · changes upload when you're back online" |
| waiting | "Changes from {device} will appear when you close the editor." |
| paused | "Sync paused · {reason}" (table below) |
| update-needed | "Your account was synced by a newer Recaller. Update Recaller on {HERE} to keep syncing." |
| deleting-elsewhere | "This account is being deleted on another computer." |

**Paused reasons:**

| Code | Text and buttons |
|---|---|
| PERMISSION | "the cloud refused a change. It stays on {HERE}." [Retry] `retry` |
| QUOTA | "Google Cloud is busy. Recaller will try again in a few minutes." |
| SERVER | "Google Cloud had a problem. Trying again in {t}." |
| TOO_LARGE | "1 note is too large to sync (over 900 KB). It stays on {HERE}." / "{n} notes are too large to sync (over 900 KB). They stay on {HERE}." For pictures: "1 picture is too large to sync (over 32 MB)." |
| BAD_REQUEST | "this version of Recaller hit an error. Your notes are safe on {HERE}; check for an update." |
| UNKNOWN | "something went wrong. Trying again in {t}." |

**Needs sign-in**
- "You're signed out on {HERE} because your password changed or your sign-in expired. Your notes here are safe, and changes you make meanwhile upload after you sign in."
- Buttons: [Sign in] `sign-in-again` (the email is filled in), [Stop syncing] `stop-syncing` (signs out).

**Deleted:** "This account was deleted. Your notes here are safe." [Use without an account] `use-without-account`

**Turned off:** "This account has been turned off. Your notes here are safe." [Use without an account]

**Sign out with changes waiting:**
- "{n} change(s) haven't uploaded yet. They stay on {HERE}; notes you deleted may come back if you sign in again later."
- Checkbox: "Also remove this board, its pictures and its backups from {HERE}".
- Buttons: [Sign out anyway] `sign-out-confirm`, [Keep syncing] `keep-syncing`.
- With the checkbox and changes waiting: "Wait until everything is uploaded before removing the board from {HERE}." [Sync now]

**Sign out with nothing waiting:**
- "Sign out of {email}? Your board stays on {HERE} unless you remove it."
- The same checkbox.
- Buttons: [Sign out] `sign-out-confirm`, [Cancel].

**Signing out (either panel, without the checkbox):** first, for at most 20 s, the full size of every picture the board shows that {HERE} holds only as a preview (another computer added it) comes down, so the board stays whole signed out. Status line: "Saving full-size pictures to {HERE}… {d} of {t}" (`AccountState.signingOut`). Done (toast): "Signed out. Your board stays on this computer." If some are left (offline, out of time, failed): "Signed out. {n} full-size pictures stay in your account, and {HERE} keeps their previews. Signing in again brings them here." ("1 full-size picture stays … keeps its preview … brings it here.")

**Delete account** (inline danger panel):
- Title: **Delete your Recaller account?**
- Body: "This deletes your account and everything in it from Google Cloud: {p} projects, {n} notes and {k} pictures. {HERE, capitalised} keeps its own copy of the board. Other computers keep theirs but stop syncing. Google's backups of the deleted data expire within 7 days. This can't be undone."
- Fields: "Password", and "Type DELETE to confirm" (placeholder "DELETE").
- Buttons: [Delete account] `delete-confirm` (danger; disabled until both fields are filled and the text is exactly DELETE), [Cancel].
- Progress: "Saving full-size pictures to {HERE}… {d} of {t}" (first, before anything is deleted: the pictures {HERE} holds only as previews) · "Deleting pictures… {d} of {t}" · "Deleting notes… {d} of {t}" · "Deleting account…"
- Errors: "Password is wrong." · "Deletion stopped partway. Sign in again to finish it." · while saving the pictures, when nothing was deleted yet: "Nothing was deleted: not every full-size picture could be saved to {HERE} first. Check your connection, then try again."
- Resuming: "Finishing account deletion…"
- Done (toast): "Account deleted. Your board stays on {HERE}."

### 6.3 Choice panels (inline in the section)

**`first-upload`**
- Title: **Upload this board?**
- Body: "Your account {email} is empty. Upload {HERE}'s board ({p} projects · {n} notes · {k} pictures) to it? It then syncs with every computer where you sign in."
- When `otherAccount` is set: "{HERE, capitalised}'s board was last synced with another account ({masked}). Uploading copies it into {email}."
- Buttons: [Upload this board] `choice-upload` (primary), [Not now] `choice-not-now`.

**`first-merge`**
- Title: **Your account already has a board**
- Lines:
  - "Account: {p} projects · {n} notes · last changed {date} on {device}"
  - "{HERE, capitalised}: {p} projects · {n} notes"
- The same warning line when `otherAccount` is set.
- Buttons: [Combine both] `choice-combine` (primary), [Use my account's board] `choice-use-account`, link "Not now" `choice-not-now`.
- Help: "Combine keeps everything from both; {HERE}'s projects are added after your account's, and nothing is deleted. Use my account's board replaces {HERE}'s board and puts it in a backup first (Settings › Backups). Either way, Recaller backs up {HERE}'s board before changing anything."

**`mass-delete`**
- Title: **Delete {n} notes everywhere?**
- Body: "Recaller is about to delete {n} notes from your account and every computer, but no delete you made explains it."
- Buttons: [Keep them in my account] `choice-keep` (primary), [Delete them everywhere] `choice-delete-everywhere` (danger ghost).

**`account-gone`**
- Title: **Your account's cloud board is missing**
- Body: "Your account exists, but its cloud board is empty or was removed."
- Buttons: [Upload this board] `choice-upload`, [Sign out] `sign-out`.

### 6.4 Top-bar indicator (`#sync-status`)

- **Element:** `<button class="icon-btn sync-btn" id="sync-status" hidden>` in `.topbar-actions`, before `#open-help`.
- **Icons:** `I.cloud`, `I.cloudOff` and `I.cloudAlert` (stroke icons on the 24 px grid), plus a 6 px `.sync-dot` in the Check-again amber `#f59e0b`.
- **Hidden** while signed out, and while synced, pending (online), or syncing for less than 1.5 s. Helpers stay out of sight when not needed.
- **Click:** runs `RecallerUI.openSettings()` and scrolls `#account` into view.

| State | Look | Tooltip |
|---|---|---|
| syncing longer than 1.5 s | cloud, slow 1.2 s opacity breathe; static under `prefers-reduced-motion` | "Syncing…" |
| offline with changes waiting | cloud-off, muted | "Offline · {n} changes will upload when you're back online" |
| offline for more than 60 s, nothing waiting | cloud-off, muted | "Offline · changes from your other computers arrive when you're back online" |
| waiting | cloud | "Changes from {device} will appear when you close the editor" |
| unverified | cloud with dot | "Verify your email to start syncing" |
| choosing | cloud with dot | "Choose how to sync {HERE}'s board" |
| paused | cloud-alert with dot | "Sync paused · click for details" |
| needs-sign-in | cloud with dot | "Sign in again to keep syncing" |
| update-needed | cloud with dot | "Update Recaller to keep syncing" |
| deleted, disabled, deleting-elsewhere | cloud with dot | "This account can't sync · click for details" |

### 6.5 Toasts, card tag, device names

Ordinary incoming changes get no toast.

| Notice | Toast (7 s) |
|---|---|
| CONFLICT | "A note was changed on two computers. Both versions are kept; {HERE}'s is marked Check again." With count > 1: "{n} notes were changed on two computers. Both versions of each are kept; {HERE}'s are marked Check again." |
| KEPT_NOTE | "A note you deleted was changed on {device}, so it was kept." |
| KEPT_PROJECT | "“{name}” was deleted on {device}, but it had changes here, so it was kept." |
| KEPT_PROJECT_DRAFT | "“{name}” was deleted on {device}, but it had an unsaved draft here, so it was kept." |
| REMOTE_DELETES | "{Device} deleted {n} notes. {HERE, capitalised}'s board was backed up first (Settings › Backups)." |
| RESTORED_FROM_ACCOUNT | "{HERE, capitalised}'s notes file couldn't be read, so your board was restored from your account. The unreadable file was kept in the data folder." |
| COMBINED | "Combined: {a} projects from your account and {b} from {HERE}." |
| USED_ACCOUNT | "{HERE, capitalised} now shows your account's board. Its previous board is in Settings › Backups." |
| after upload | "Your board is in your account now." |

**Device names from `DeviceRef`:**

| DeviceRef | Name |
|---|---|
| `darwin`, not the same platform as this computer | "your Mac" |
| `darwin`, same platform | "your other Mac" |
| `win32`, not the same platform | "your Windows PC" |
| `win32`, same platform | "your other PC" |
| unknown | "another computer" |

A leading capital is used where a sentence starts.

**Card tag** (`.card-sync-tag` in `.card-meta`, after the highlight tag): "Other version".
- Tooltip: "Changed on two computers at once. This copy is the version from {this Mac | this PC | your Mac | your Windows PC}."
- Saving the note from its editor removes the tag.

### 6.6 Account error strings (page side, by `Result.code`)

| Code | String |
|---|---|
| INVALID_EMAIL | "That email address doesn't look right." |
| WEAK_PASSWORD | "Use at least 8 characters." (checked locally first, with no network call) |
| EMAIL_EXISTS | "There's already an account with this email." [Sign in instead] |
| WRONG_PASSWORD | "Email or password is wrong." (in the delete panel: "Password is wrong.") |
| USER_DISABLED | "This account has been turned off." |
| TOO_MANY_ATTEMPTS | "Too many tries from this network. Wait a few minutes, then try again." |
| LOCKED_OUT | "Too many wrong passwords. Try again in {s} seconds." |
| SIGNUP_PAUSED | "New accounts are paused right now. Try again later." |
| RESET_UNAVAILABLE | "Recaller can't send a reset link right now. Wait a while, then try again." |
| NETWORK | "Can't reach Recaller's cloud. Check your internet connection." |
| NOT_VERIFIED | "Not verified yet. The email can take a minute; check your spam folder too." |
| UNAVAILABLE and anything else | "Accounts aren't available right now. Try again later." |

### 6.7 Privacy note

This is the text of `details.privacy-note`, and of README "Accounts, sync and privacy", **version 2026-10-01**.

> **What's stored and where** (version 2026-10-01)
>
> - **Your account:** your email address and your password, kept by Google Identity Platform (the password only as a secure hash).
> - **Your board:** every project and note in Cooking, Cooked and Served, their order, highlights, copy counts and the "Join notes with" setting, and the pictures in your notes. Notes and projects you delete are kept for 30 days so they can be recovered, then erased; only a small record that each was deleted, with no text, stays until the account is deleted. Pictures stay in your account until the account is deleted, even after the note or draft that held them is gone.
> - **Each computer's own things,** as a backup that is never copied onto another computer: its name ("Mac" or "Windows PC"), platform, Recaller version and last sync time, its unsaved drafts and their pictures, its view (column widths, folded sections, scroll positions, density, title font, Cooked colour), and these settings: colour theme, voice model, language, vocabulary hint, the two shortcuts, and "hide after copying".
> - **Never uploaded:** your OpenAI API key and your local backups. Voice recordings go from your computer straight to OpenAI with your own key.
> - **Where:** Google Cloud (Firebase), in the United States (South Carolina). Google encrypts it in transit and at rest, but it is **not end-to-end encrypted**: the person who runs Recaller's Google Cloud project can technically read it, and only looks at it to fix a problem you report.
> - Your data isn't sold, shared, or used for ads or AI training.
> - **Deleting:** Settings › Account & sync › Delete account removes your account, board and pictures from Google Cloud straight away. Google's backups of the database and of deleted pictures expire within 7 days, and Google finishes erasing sign-in records within 180 days.
> - **Contact:** ahsan@ponders.ai

### 6.8 Other strings

**Restore confirm** (`window.confirm`).
- Signed out, unchanged: "Replace all your projects and notes with the backup from {label}?\n\nWhat you have now is backed up first, so you can go back to it."
- Signed in: "Bring back the board from {label}?\n\nYou're signed in, so nothing is deleted from your account: notes in the backup are added back, and notes that are only in your account stay. What you have now is backed up first."

**Backups list:** the `before-sync` kind shows as "Before sync".

**Help › Handy moves** (new line, `#help-account`, shown only when `enabled` is true, like the section): "**On every computer:** Settings › Account & sync keeps this board in your account. Column widths, folds, drafts and the look stay on each computer."

**Picture not available:** unchanged. `image:copy` returns `false`, and the existing "Couldn't copy to the clipboard." applies.

### 6.9 Windows and Mac labels

| Label | Windows | Mac |
|---|---|---|
| `{HERE}` | "this PC" | "this Mac" |
| where the sign-in is kept | "Your sign-in is kept encrypted on this PC." | "Your sign-in is kept in your Mac’s keychain." |
| this computer's device name | "Windows PC" | "Mac" |
| menus and keys | no change | no change (⌘, still opens Settings; Enter and ↩ submit account forms on both) |

Everything else is identical on both platforms. Every Mac difference goes through `IS_MAC` (`window.recaller.platform === 'darwin'`) in `account.js`.

---

## 7 Testing

### 7.1 Principles

- **External services are mocked.** Every Google service is a local Node mock. There are no Firebase emulators (no Java on this Mac), and paid services are never called by default.
- **No keychain.**
  - Suites use `RECALLER_TOKEN_STORE=test-file` with a loopback mock, which the config requires.
  - Runs from source default to `memory`.
  - The sync suite replaces `safeStorage.encryptString` and `decryptString` with tripwires that fail a check if called.
- **No OS prompts.**
  - No microphone and no real snip.
  - Settings files are pre-written with `"hotkey": "", "shotHotkey": ""`.
  - `shell.openExternal` is stubbed in the sync suite **on both platforms**.
- **Never `MODE=real` on the Mac.** Run `node --check` before every suite.
- **The existing suites stay literally unchanged:** 12 + 21 + 139 on the Mac, 12 + 21 + 134 on the PC. They set `RECALLER_DATA_DIR` without a mock base, so `enabled` is false. As built, `npm run test:accounts-on` runs them once more with accounts on and nobody signed in (7.6).

### 7.2 GCP mock (`tests/mock-gcp/`, WP4)

**Setup.**
- `createGcpMock({ projectId = 'demo-recaller', bucket = 'demo-recaller.test' })` returns `{ listen() → port, close(), control… }`.
- It runs in-process (like the OpenAI mock) and binds only to `127.0.0.1`.
- Suites set `RECALLER_GCP_BASE` before `require(APP_MAIN)`.
- It is deterministic, with microsecond `updateTime`s and a controllable clock.

| Area | Endpoints | Behaviour |
|---|---|---|
| Identity Toolkit | `POST /identitytoolkit.googleapis.com/v1/accounts:{signUp, signInWithPassword, sendOobCode, lookup, delete}?key=` | Checks the key. Users in memory. Google-shaped errors `{ error: { code: 400, message: "CODE : detail", errors: [...] } }`. Enumeration protection: sign-in failures say `INVALID_LOGIN_CREDENTIALS`, a reset for an unknown email is a silent success. Password policy of 8+ (`PASSWORD_DOES_NOT_MEET_REQUIREMENTS`). `sendOobCode` supports `VERIFY_EMAIL` and `PASSWORD_RESET` and records to `outbox`. ID tokens are JWT-shaped, unsigned, with `user_id`, `email_verified` and `exp`; `email_verified` changes only when a new token is issued |
| Secure Token | `POST /securetoken.googleapis.com/v1/token` (form) | Refresh grant. Rotates the token. `TOKEN_EXPIRED` after `revokeTokens`, `USER_DISABLED`, `USER_NOT_FOUND` |
| Firestore | `GET …/documents/{path}`; `POST …/documents:batchGet`; `POST …/documents/users/{uid}:runQuery` (field and composite AND filters with `GREATER_THAN`, `LESS_THAN_OR_EQUAL`, `EQUAL`; `orderBy` including `__name__`; `startAt`/`before`; `limit`; `select`; response as a **JSON array**); `POST …/documents:commit` (update with or without `updateMask`, delete, `updateTransforms` REQUEST_TIME, preconditions `exists` and `updateTime`; atomic) | Precondition failures return 400 `FAILED_PRECONDITION` or 409 `ALREADY_EXISTS`. `commitTime` and `writeResults` are returned. **A JavaScript twin of the rules in 4.8** is evaluated on every write and read, including **access-call counting** (≤ 10 per write, ≤ 20 per request; exceeding gives 403). A denial is 403 `PERMISSION_DENIED`. A missing or expired token is 401 |
| Storage v0 | `POST /firebasestorage.googleapis.com/v0/b/{bucket}/o?name=` (multipart **and** resumable: start, upload, finalize, query); `GET …/o/{enc}?alt=media`; `GET …/o/{enc}` (metadata); `GET …/o?prefix=&delimiter=&pageToken=&maxResults=`; `DELETE …/o/{enc}` | Accepts **only** `Authorization: Firebase <token>`; `Bearer` gets 401. A twin of 4.9: name pattern, PNG, size, immutability, and the head's `deleting` flag read from the Firestore store. As built, every upload is evaluated as the live service does it: `create`, with `resource` = the metadata of the file stored under that name (null for a new name), at a resumable start and again at its finalize (section 0, item 34) |

**Control API** (in-process):
- **Accounts:** `verify(email)`, `revokeTokens(email)`, `expireIdTokens()`, `disableUser(email)`, `deleteUser(email)`, `setSignupDisabled(bool)`, `requireRecaptchaForReset(bool)`, `tooManyAttemptsAfter(n)`.
- **Failures:** `fail({ service, status: 503 | 429 | 'offline', times })`, `bumpHeadBetweenGetAndCommit()`, `denyDoc(path)` (forces a 403 for one document), `pauseAfter(step)`, `skewMs`.
- **The other computer:** `remote(uid)` returns `editNote`, `addNote`, `moveNote`, `deleteNote`, `deleteProject`, `setJoiner`, `copy(id, n)`, each a correct precondition-checked commit with `_sync.by = 'b0'.repeat(16)`.
- **Inspection:** `outbox`, `log` (every request: method, path, auth scheme; no bodies), `docs(uid)`, `objects(uid)`, `reset()`.

### 7.3 Rules cases, in three layers

1. **`tests/rules/cases.js`** (WP1) holds shared cases:
   `{ name, service: 'firestore' | 'storage', method, path, auth: { uid, verified } | null, time, existing, incoming, head, expect: 'ALLOW' | 'DENY' }`.
   At least these:
   - Head: owner get / other user / unverified; create rev 1 / create rev 2; +1 bump / +2 jump / bump while deleting / start deletion / undo deletion / changing `createdAt` / schema going down / `minRev` > rev.
   - Notes: create valid; bad list `cooked`; tombstone with content; `_sync.at` ≠ request time; rev going backwards; key of 65 characters; 201 fields; hard delete while not deleting; hard delete while deleting; hard delete of a tombstone at `minRev`.
   - Projects: the same basic set.
   - Trash: valid; `expireAt` at 60 days; an extra key.
   - Devices: valid; `apiKey` in settings; while deleting; a bad device id.
   - Storage: upload `.png` / `.t.png` / JPEG / 41 MB / other user / unverified / while deleting / head missing; overwrite (update); delete while not deleting; delete while deleting; own get; other get; own list.
   - **As built (section 0, item 34):** each case names the method the live service uses. In Storage every upload is a `create`, with `existing` set when a file is stored under that name, so "overwrite (update)" became "overwrite (create over a stored picture)", plus a thumbnail with other bytes and an overwrite while deleting (all DENY), and a metadata update (DENY). A Rules API case proves the rules only for the method it names.
2. **The mock's twin** passes every case (`tests/unit/rules-twin.test.js`).
3. **The real rules text** passes every case through the Rules API (`npm run rules:test`, 7.7).

### 7.4 Unit tests (`npm run test:unit`, meaning `node --test "tests/unit/**/*.test.js"`; plain Node, no windows)

- **Use the glob,** quoted, which runs every `*.test.js` under `tests/unit/`, subfolders included. A directory argument (`node --test tests/unit/`) fails on Node 24: the folder is loaded as a module (`MODULE_NOT_FOUND`), and the run reports one failed test named `tests/unit`.
- **Check the count.** A glob that matches nothing exits 0 with 0 tests, so a green run must also report more than 0 tests.
- **As built:** 20 files and 714 tests since the storage-overwrite fix (the rules twin's 219 cases count as subtests; section 0, item 34). At the final gates, before that fix, they were 702 tests with 216 cases. The table lists every file.

| File | WP | Covers |
|---|---|---|
| `config.test.js` | 2 | overrides ignored when packaged; `enabled` truth table; non-loopback base refused; token-store defaults |
| `codec.test.js` | 2 | every JSON type round-trips; integers vs doubles; nested arrays, lone surrogates, `__x__` keys and depth over 20 go to `_json`; `__proto__` safety; `docId` |
| `clients.test.js` | 2 | against the mock: error mapping; 401 then refresh then retry; precondition errors mapped to `HEAD_MOVED`; `runQuery` paging; JSON-array and NDJSON parsing; multipart at ≤ 256 KiB; resumable above, with a resume after an injected failure; the `Firebase` scheme; 403 then stat treated as existed. As built (section 0, item 34): one stat after a 403, these bytes → existed, other bytes → existed with `differs` (the account's copy stays), a stat that can't answer keeps its own error; a finalize refused because the name got its picture meanwhile; a lost multipart answer sent again |
| `keys.test.js` | 3 | 10,000-case property test (a < k < b, never ends in `0`); `keysBetween` balance; `orderKeys` keeps the most keys (a drag changes 1); ties; re-keying |
| `model.test.js` | 3 | `toModel` skips malformed entities; per-device keys excluded; pristine detection (seed on both platforms, touched seed, "Welcome" made by hand) |
| `diff.test.js` | 3 | normal vs union vs restore; counters; tombstones only in normal mode; quarantine; too-large |
| `merge.test.js` | 3 | **every row of the 5.7 tables**; deterministic conflict-copy ids; merging again is idempotent; Combine and Use-account; project resurrection and "Recovered notes" |
| `apply.test.js` | 3 | `applyPatch` reuses live objects; unmentioned notes appended (nothing vanishes); per-device keys untouched; counters as deltas; joiner removal |
| `mock.test.js`, `rules-twin.test.js` | 4 | mock protocol conformance; all rules cases. As built: every upload is asked of the twin as `create` with `resource` (an overwrite at a multipart upload, a resumable start or a finalize included), and an overwrite is refused by `resource == null` before the head is read; 4.8 and 4.9 here quote the two rules files exactly (line endings aside) |
| `state.test.js` | 5 | the `sync/` folder (`openSyncDir`): nothing exists until written; defensive reads; atomic writes; unknown fields kept; a folder copied from another computer gets its own device id; what `removeAccountState()` and `removeAll()` take away |
| `tokens.test.js`, `account.test.js` | 5 | with a fake `safeStorage`: never `{plain}`; a throwing `encryptString` gives session-only; `project` mismatch ignored; single-flight refresh; verification then forced refresh; discarding an unverified account; one reset link per email a minute; deletion's recent-login rule |
| `facade.test.js` | 6 | `src/cloud/index.js` in plain Node, with a stand-in for Electron and main's debounced write: removing the board keeps the unreadable copies until the person agrees; a sign-in mid-session gets the `contentSeq` of the save on disk; a Mac log out (`shutdown`, watched only while signed in); a draft saved just before "Use my account's board" reaches the disk first; a plain sign-out saves the full-size pictures (at most 20 s; `picturesLeft` counts only pictures the account keeps; none saved when removing the board or after a `PENDING` answer, until "Sign out anyway"); a deletion shows `save-pictures` first, and a failure there deletes nothing |
| `images.test.js` | 6 | `src/images.js` with a stand-in for Electron: signed out, every file served as in 1.16, and a picture known only by its preview shown and copied from it; signed in, the account is asked for the full size first |
| `quit.test.js` | 6 | `main.js`'s quit with sync, its own code run in a vm with stand-ins for `app`, the facade and the clock: signed out or with nothing to upload, a quit is never held; with changes waiting, one final push of 1.5 s; never during a log out, restart or shut down; on a Mac a cancelled log out stops counting after a minute |
| `account-page.test.js` | 8 | `src/renderer/account.js` in a vm over a small DOM with a stand-in for `window.recaller`: on both platforms, the sign-out's and the deletion's "Saving full-size pictures…" lines, the toasts after a sign-out, and a deletion that fails while saving ("Nothing was deleted…"); and the 60 s waits of [Send link] and "Change password" |
| `engine.test.js` | 5 | two engines (PC and Mac) with real temp folders, the headless peer and the mock: push and pull both ways; `HEAD_MOVED` race; chunk order; picture-before-commit order; the first-sync table (all 4 rows, pristine rows, other-account warning); union triggers (`.bak`, seed with copy-aside, fingerprint mismatch, restore); split-and-quarantine on 403; audit repair; `minRev` resync; schema guard; account deletion with gating (the second engine's commit, device write and upload refused); account-gone after head deletion; **crash injection at every `await`** (throw, discard the engine, recreate from disk, assert no revert, no loss and convergence). As built, also: notes held back with a project the account doesn't have, and a project's deletion held back for such a note; slow and lossy links; `completePictures` and the deletion's picture save; pictures the account already holds (a copied board's Combine with another encoder's thumbnail, a lost answer, a crash before `state.json`, an Undo), each refused and counted from one stat, never held or sent again |
| `fuzz.test.js` | 5 | three computers (engine plus a page simulator honouring `contentSeq`, labels, busy states and deferral) and one mock; 50 seeds × 2,000 random steps (add, edit, move, reorder, sort, whole-text edit, delete, clear, projects, a move into a project too large for the account or with the note's own write refused, its old column sometimes deleted at once, copy, highlight, editor open and close, offline, crash, restart). After every step: the account holds no live note in a deleted or missing project. After quiescence: identical boards on synced fields, shadow = cloud, no duplicate ids, every live note in a live project, and in **no-delete runs every text ever saved exists on every computer, in place or as a copy**. `FUZZ_SEEDS` raises the count |
| `privacy.test.js` | 8 | the privacy note (6.7) is word for word the same in `account.js`, README and this spec, and covers what the account really keeps: a deleted note's pictures, and every field of a computer's device record |

### 7.5 New e2e suite (`npm run test:sync`, meaning `tests/e2e/sync.e2e.js`, WP9)

**Setup:**
- Computer A is the real app in-process: `quiet()`, `macRect()` or the off-screen rectangle, `showInactive`, `RECALLER_DATA_DIR=.out/sync-a`, the mock base, `RECALLER_TOKEN_STORE=test-file`, `RECALLER_SYNC_FAST=1`.
- Computer B is the headless peer (`tests/support/peer.js`, from WP5) in `.out/sync-b`.
- The seed board carries `futureTopLevel`, `futureProjectField`, `futureNoteField`, `futureImageField` and two pictures, one of them 1 MB (resumable).

**Checks:**

1. **Signed out with cloud enabled:**
   - no request reaches the mock during start and 20 edits;
   - no `sync/` folder;
   - the data file is byte-identical before the first edit;
   - `#sync-status` is hidden;
   - the section shows [Create account] [Sign in].
2. **Settings keys:** Enter in `input[name=email]` doesn't close Settings; Esc closes only the form.
3. **Short password:** "Use at least 8 characters.", with no request.
4. **Sign-up:**
   - the mock user exists and `VERIFY_EMAIL` is in the outbox;
   - "Check your email" shows;
   - **no Firestore or Storage request while unverified**.
5. **Verification:**
   - "I've verified" too early shows the not-verified text;
   - `verify()` then focus leads to the `first-upload` choice;
   - no Firestore write happens before the choice.
6. **Upload:** the mock holds every project and note, with:
   - data-name lists;
   - keys ascending in screen order;
   - per-device fields absent;
   - unknown fields present;
   - correct `copied`, `head.rev` and `stats`;
   - a `before-sync` backup listed as "Before sync".
7. **Pictures:**
   - `.t.png` and `.png` uploaded with `Authorization: Firebase` **before** the commit that references them (by log order);
   - the 1 MB picture uses the resumable protocol.
8. **After the upload:**
   - `recaller-data.json` is byte-identical;
   - `sync/` holds `account.json`, `device.json`, `state.json` and `shadow.json`;
   - backup folders hold only the two files.
9. **Wrong password:** "Email or password is wrong."; after 5, the lock-out text.
10. **Password reset** (as built):
    - with reCAPTCHA required, the `RESET_UNAVAILABLE` text, and [Send link] doesn't wait after that failure;
    - an unknown email gets the neutral text and puts nothing in the outbox; [Send link] then counts down its 60 s ("Send link (n s)", disabled);
    - a known email (asked through the bridge, since the button waits) puts `PASSWORD_RESET` in the outbox; asked again at once, main sends nothing and answers `RESET_UNAVAILABLE` with `retryAfterMs`.
11. **Sign-ups paused:** "New accounts are paused right now. Try again later."
12. **Local edit:** the head rev goes up within 2 s (fast timers), with `_sync.by` = A's device id.
13. **B's changes reach A:** B edits, adds, moves to Cooked, deletes and reorders a column. After A's focus:
    - A shows them all, with no toast;
    - A's widths, density, folds, drafts and scroll are unchanged.
14. **Joiner:** B changes it, and A's Settings reflects it.
15. **Copy counts:** A copies twice and B three times; both show base + 5.
16. **Offline conflict:** both keep an amber copy with "Other version" and a toast.
17. **A deletes while B edits:** the note survives with B's text, and a toast shows.
18. **B deletes a project while A adds to it:** the project is kept on both.
19. **Card editor open on A:**
    - B's edit waits (status "Changes from … appear when you close the editor");
    - saving gives a conflict copy;
    - in a cancel variant, B's text appears.
20. **Composer with a draft in a project B deletes:** the composer and draft survive, and the project is kept.
21. **Undo toast visible:** a content patch waits until the toast has gone, then Undo is disabled. A counter-only patch leaves history alone.
22. **Patch during a copy:** a patch lands during `copyNote`'s `await`; the count lands on the live note.
23. **Drag in progress:** the patch applies after the drop, and both changes are present.
24. **Offline:** 3 edits show "3 changes waiting to upload"; back online, one push; the indicator is hidden again.
25. **Expired ID tokens:** refreshed without the user noticing.
26. **Revoked refresh token:**
    - needs-sign-in text;
    - edits still save locally;
    - signing in again (same account) pushes them, with nothing deleted.
27. **Precondition race:** a retry, no duplicates.
28. **One document denied:** that note is quarantined ("Sync paused · the cloud refused a change…"), the others sync; Retry syncs it once the denial is removed.
29. **A 950 KB note:** the too-large text; others sync.
30. **Unknown fields round-trip** from A to the cloud to B and back, unchanged. `futureTopLevel` appears only in A's device record.
31. **Unreadable file:**
    - corrupt the data file and its `.bak`, then reload the page;
    - the Welcome board is replaced by the account's board;
    - the mock receives no tombstones;
    - an `unreadable` copy exists;
    - the toast shows.
32. **`.bak` fallback:** a union; nothing deleted in the mock.
33. **Restore an older backup while signed in:**
    - nothing deleted in the mock;
    - notes from the backup come back on B;
    - B's newer notes stay on A.
34. **Mass-delete guard** (a crafted save without labels):
    - the choice text shows;
    - "Keep them in my account" deletes nothing and restores them locally.
35. **Second account:** sign out, sign in to another account that has a board. The choice shows the other-account warning, and nothing from account 1 reaches account 2 unless Combine is chosen.
36. **Combine:** a union, with a `before-sync` backup; the pristine Welcome isn't uploaded.
37. **Use my account's board:** the local board is replaced, and the backup holds the old one.
38. **Sign-out:**
    - with changes waiting, the `PENDING` text;
    - after signing out, `account.json` is gone, the board is untouched, and no further requests go out;
    - the remove option deletes the data file, images and backups, shows Welcome, and keeps the settings file.
39. **Delete account:**
    - a wrong password gives its text;
    - then the mock has no documents or objects for the uid and no Auth user;
    - A's board is unchanged and A is signed out;
    - B shows "This account was deleted."
40. **Deletion gating:** with the mock paused after `deleting: true`, B's commit, device write and upload are all refused, and B shows "being deleted".
41. **Quit with changes waiting:** the final push appears in the log within 1.5 s, and the app exits.
42. **Security:**
    - no token field in any IPC result or in `window.recaller`;
    - the CSP still says `connect-src 'none'`;
    - no renderer console errors;
    - the `safeStorage` tripwires were never hit.
43. **Mac only:** the Dock is hidden, focus is never stolen (`macState`), and the keychain is untouched.

**Counts:** about 43 checks, the same on the Mac and the PC.

### 7.6 Existing suites and `npm test`

```
"test": "npm run test:unit && npm run test:multicopy && npm run test:update && npm run test:features && npm run test:accounts-on && npm run test:sync"
```

As built, `npm run test:accounts-on` (`scripts/accounts-on.js`) runs multi-copy, update-safety and features a second time with accounts **on** and nobody signed in, the state a build with a cloud config starts in. A test data folder alone turns accounts off, so the plain runs never see it. It points `RECALLER_GCP_BASE` at a local listener and fails if the app sends it any request.

Expected totals (the unit tests since the storage-overwrite fix, the e2e suites as of the final gates):
- Mac: unit tests (714), then 12 + 21 + 139, then 12 + 21 + 139 again with accounts on (no request), then 43.
- PC: unit tests (714), then 12 + 21 + 134, then 12 + 21 + 134 again with accounts on (no request), then 43.

### 7.7 Owner-run checks against the real project

They use the owner's gcloud login. They are free or cost cents, and are never part of `npm test`.

**`npm run rules:test`** (`infra/scripts/rules-test.js`) reads nothing and writes nothing.
- It posts each ruleset's source plus the converted cases to `POST https://firebaserules.googleapis.com/v1/projects/recaller-cloud:test`, using `Authorization: Bearer $(gcloud auth print-access-token)` and `X-Goog-User-Project: recaller-cloud`.
- Test cases use `request: { auth, path, method, time, resource }`, `resource` (`{ data }` in Firestore, the object's `{ size, contentType }` in Storage), and `functionMocks` for `get()` and `firestore.get()`.
- A case proves the rules only for the method it names, so each names the one the live service uses. A Storage overwrite is a `create` whose TestCase `resource` is the stored object's metadata. A Storage create without `existing` sends `resource: null`, as production does for a new name: a TestCase without `resource` leaves it unset, and `resource == null` then fails with "Null value error" (the first run after the fix, 2026-10-01). With that, all 219 cases passed. Modelled as `update`, the overwrite passed here while the live rules accepted it (section 0, item 34).
- It prints SUCCESS or FAILURE per case.
- **Settled on the first run** (section 0, item 27): the function-mock name is `get` in Firestore rules and `firestore.get` in Storage rules. The mock's argument is the plain path `/databases/(default)/documents/users/<uid>` in `exactValue` (another uid's path doesn't match), and a result of `{ undefined: {} }` stands for a missing head: the call fails and the rule denies, as a real `get()` of a missing document does.

**`npm run rules:smoke`** (`infra/scripts/rules-smoke.js`) creates two throwaway users (`recaller-smoke-<random>@example.com`) with the app key. It reads the project and the key from `infra/gcp/project.json`, which is why the app config is written before it (2.6).
1. **Unverified access.** Check that access is denied **before** verifying.
2. **Mark them verified** with the admin call `POST https://identitytoolkit.googleapis.com/v1/projects/recaller-cloud/accounts:update` `{ "localId": UID, "emailVerified": true }` (owner token). No emails are sent. Then sign in.
3. **Head rules:** a +2 bump is refused, a +1 bump works, and a cross-user read is refused.
4. **A 400-write commit** (the head plus 399 notes) succeeds, which proves the access-call design.
5. **The exact pull query and bootstrap query** return everything in order with no index error. Record the HTTP framing.
6. **Item rules:** a backwards rev, a tombstone with content, and a hard delete while not deleting are all refused.
7. **Storage:**
   - a 100 KB multipart upload with `Firebase` works (a working upload also proves the IAM grant, because the Storage rules read the head in Firestore on every upload);
   - a 3 MB resumable upload works;
   - an overwrite is refused;
   - download bytes match;
   - list works;
   - record what `Bearer` does.
8. **Deletion gating:**
   - start deletion;
   - a board commit is refused;
   - a device write is refused;
   - an upload is refused (this alone can't prove the IAM grant, since a missing grant also refuses every upload; the working uploads in step 7 prove it);
   - pictures delete;
   - documents delete 10 at a time;
   - the head deletes;
   - `accounts:delete`.
9. **Record** whether REQUEST_TIME equals `commitTime`, and try a sign-up with 7 characters (`PASSWORD_DOES_NOT_MEET_REQUIREMENTS`).
10. **Clean up** everything and assert that nothing remains.

About 2,000 operations, inside the free tier.

**Manual two-computer check,** after the app is built:
1. `npm run cloud:config`. Create `tests/e2e/.out/manual-a` and `manual-b`, each holding `recaller-settings.json` with `{"hotkey":"","shotHotkey":""}`.
2. Start A:
   ```
   RECALLER_GCP_REAL=1 RECALLER_TOKEN_STORE=memory RECALLER_DATA_DIR="$PWD/tests/e2e/.out/manual-a" npm start
   ```
   Start B the same way in a second terminal with `manual-b`. The single-instance lock is per data folder. No keychain is touched.
3. On A, create an account with a plus-address of your own email. Check the real email:
   - the sender and the wording: after the email steps ("Email delivery" in `infra/README.md`), From "Recaller <noreply@recaller.ponders.ai>" and a subject ending "for Recaller";
   - in Gmail, ⋮ › Show original: SPF and DKIM PASS for `recaller.ponders.ai`;
   - the spam folder;
   - the link host `recaller-cloud.firebaseapp.com/__/auth/action` (the link carries Firebase's own browser key, 2.7: there is nothing to compare). Click the link, then choose "I've verified", then **Upload this board**.
4. In the Firebase console, check `users/{uid}` (rev and stats), `projects`, `notes`, and the bucket's `users/{uid}/images`.
5. On B, sign in, then **Combine both**. A new note on A appears on B at focus. Paste a picture on A (from the clipboard, not a snip): the thumbnail appears on B, and the lightbox loads the full size.
6. **Conflict:** quit B, restart it with `RECALLER_SYNC_OFFLINE=1`, edit the same note on both, then restart B without the variable. Both versions are kept.
7. **Change password** from A. Use the email link, then restart both: both show needs-sign-in, then sign in again.
8. **Delete account** from A. Firestore, Storage and Authentication are empty for the uid, and B shows "This account was deleted."
9. Check the budget page (15 CAD) and the billing report (≈ 0). Then **delete `tests/e2e/.out/manual-*`**.

---

## 8 Work packages and order

### 8.1 Packages and strict file ownership

Every file has exactly one owner.

| WP | Scope | Creates or edits (sole owner) |
|---|---|---|
| **WP1 Cloud infra and rules** (owner present for applies) | Terraform additions, rules texts, auth settings, rules tests, runbooks | `infra/firebase/firestore.rules`, `infra/firebase/storage.rules`, `infra/terraform/prod/sync.tf` (new), `infra/terraform/prod/auth.tf`, `infra/terraform/prod/variables.tf`, `infra/README.md`, `infra/scripts/auth-settings.sh` (new), `infra/scripts/rules-test.js` (new), `infra/scripts/rules-smoke.js` (new), `infra/scripts/purge-unverified.js` (new, optional), `tests/rules/cases.js` (new) |
| **WP2 REST clients** | config, http, codec, auth, Firestore, Storage | `src/cloud/config.js`, `http.js`, `codec.js`, `auth.js`, `firestore.js`, `storage.js`; `tests/unit/config.test.js`, `codec.test.js`, `clients.test.js` |
| **WP3 Sync core (pure)** | keys, model, diff, merge, page apply | `src/sync/keys.js`, `model.js`, `diff.js`, `merge.js`, `src/renderer/sync-apply.js`; `tests/unit/keys.test.js`, `model.test.js`, `diff.test.js`, `merge.test.js`, `apply.test.js` |
| **WP4 GCP mock** | 7.2 | `tests/mock-gcp/index.js`, `server.js`, `auth.js`, `firestore.js`, `storage.js`, `rules.js`; `tests/unit/mock.test.js`, `rules-twin.test.js` |
| **WP5 Engine, account and tokens** | 5.x, token store, headless peer | `src/sync/engine.js`, `src/sync/state.js`, `src/cloud/account.js`, `src/cloud/tokens.js`, `tests/support/peer.js`; `tests/unit/tokens.test.js`, `account.test.js`, `engine.test.js`, `fuzz.test.js` |
| **WP6 Main wiring** | facade, IPC, hooks, images, backups, store | `src/cloud/index.js` (new); edits to `src/main.js`, `src/preload.js`, `src/store.js`, `src/backups.js`, `src/images.js` |
| **WP7 Page data glue** | meta, `contentSeq`, labels, patch apply, busy rules, looking notes up again, `RecallerUI`, card tag, restore text, backup label | edits to `src/renderer/app.js` |
| **WP8 Account UI** | section, choice panels, indicator, privacy note, styles, icons | `src/renderer/account.js` (new); edits to `src/renderer/index.html` (section, `#sync-status`, script tags, Help line), `src/renderer/styles.css` (a new block **before** the macOS block: section, indicator, `.card-sync-tag`), `src/renderer/icons.js` (`cloud`, `cloudOff`, `cloudAlert`) |
| **WP9 E2E** | 7.5 | `tests/e2e/sync.e2e.js` (new), `tests/e2e/README.md` |
| **WP10 Build, version and docs** | config pipeline, scripts, version, user and handoff docs | `package.json`, `.gitignore`, `scripts/cloud-config.js` (new), `README.md`, `ai_memory/15_accounts_and_sync.md` (new) and edits to `ai_memory/README.md`, `02`, `03`, `04`, `06`, `07`, `08`, `09`, `11`, `12`, `13`, `14` (including the fact corrections: gcloud needs `--install-python=false` with `CLOUDSDK_PYTHON`; automated Auth setup means Identity Platform; commits have no 500-write cap; the per-document write rate depends on the workload) |

### 8.2 Interfaces between packages

These are frozen by this spec.

| Producer → consumer | Contract |
|---|---|
| WP2 → WP5, WP6 | the signatures in 3.3 (`createHttp`, `createAuth`, `createFirestore`, `createStorage`, `loadConfig`, `codec`); `CloudError` codes |
| WP3 → WP5 | `toModel`, `fromDocs`, `diffLocal`, `mergeRemote`, `orderKeys`, `isPristine*`, `countLive`; the shadow shape in 3.5; the `PatchBody` and `ShadowDelta` shapes |
| WP3 → WP7 | `window.SyncApply` (3.3) and `Patch` (5.8) |
| WP4 → WP2, WP5, WP9 | the endpoints and control API in 7.2; `tests/rules/cases.js` from WP1 |
| WP5 → WP6 | `createSync(deps)` and the `Engine` API; `createAccount`; `createTokenStore`; `openSyncDir` |
| WP6 → WP7, WP8 | the IPC contract and preload (3.6, 3.7); `AccountState`, `SyncStatus`, `Choice`, `Result` |
| WP7 → WP8 | `window.RecallerUI = { toast(message, opts), openSettings(), relTime(ts) }`; the `.card-sync-tag` element (WP8 styles it) |
| WP8 → WP9 | the DOM contract in 6.1 |
| WP1 → WP10 | `infra/gcp/project.json` produced by the Terraform output; WP10 validates and copies it |

### 8.3 Integration order and gates

| Phase | Work | Gate |
|---|---|---|
| **0** (another session) | Terraform adoption apply; `imports.tf` deleted; plan says "No changes" | owner confirms |
| **1, in parallel** | WP1 (rules texts and `cases.js` first, apply later), WP2, WP3, WP4, WP8 (against a fake `window.recaller`, seen with a copy of `capture-board.js`), WP10 (`cloud-config.js`, script lines) | `node --check` on every file; WP2, WP3 and WP4 unit tests green |
| **2** | WP5 (on WP2, WP3 and WP4), WP7 (on the WP3 apply and the IPC contract) | `engine.test.js`, `fuzz.test.js` and crash injection green; WP4 rules twin green |
| **3** | WP6 wires everything; integration by the lead | **I1** `npm run test:unit` green, with more than 0 tests run (a glob that matches nothing exits 0; 7.4). **I2** the existing suites on the Mac unchanged at **12 + 21 + 139**. **I3** `npm run test:sync` green on the Mac |
| **4** (owner present) | WP1 real deploy: the 2.6 runbook steps 1–8 (`infra/README.md`): `rules:test` before the plan, then plan, apply, auth settings, the TTL and the app config, then `rules:smoke` | every case passes; smoke results recorded, including the UNCONFIRMED items |
| **5** | Manual two-computer check (7.7) | passes |
| **6** | WP10: version (1.17.0 unless Q2 says otherwise), docs; `npm run dist:mac` and `npm run dist:win`; suites against the packaged `app.asar` on the Mac; on the PC, all suites (12 + 21 + 134 + unit + sync) | green; the owner commits and pushes |

### 8.4 Go-live sequence for the owner

1. On both computers: Settings › Back up now.
2. Install the new version on the PC (the upgrade backup runs). Sign up there, verify, then **Upload this board**.
3. Install it on the Mac, replacing `/Applications/Recaller.app`; eject the old dmg first. Sign in, then **Combine both**, or **Use my account's board** if you don't want the Mac's own notes.
4. On the Mac, when asked, allow the keychain ("Always Allow") for "Recaller Safe Storage". If you refuse, the sign-in lasts for the session only.

---

## 9 Risks and questions for the owner

### 9.1 Risks, mitigations and v1 trade-offs

| Risk or trade-off | Mitigation or note |
|---|---|
| **Storage v0 API isn't documented** (only the SDK is the authority) | Isolated in `storage.js` with the SDK's exact protocols; smoke test on the real bucket. Fallback: a small Cloud Run signed-URL service (v2) |
| **Firestore rules trust the client's item `_sync.rev`** | The atomic head gate, the rev-forward rule, the 30-day and stats-triggered audit, the fuzz test with the rules twin, and the real-project smoke test |
| **Undo history is cleared** when a remote content change is applied | Patches wait out Undo toasts. v2: a lazy rebase |
| **An open editor defers all incoming content changes** (and pushes) until it closes | The status shows "waiting". v2: park only the held entities |
| **Union mode can bring back notes** deleted elsewhere, or while signed out, after a restore, `.bak`, seed or downgrade | Deliberate: resurrect rather than lose. Before-sync and before-restore backups exist |
| **Conflict copies can pile up** after heavy offline editing on both computers | Amber highlight plus the "Other version" tag; delete the copies as usual |
| **Polling latency:** up to 60 s on an untouched focused screen | Instant on summon or focus, which is when the owner switches computers |
| **Mac keychain prompt** for "Recaller Safe Storage" after each ad-hoc-signed build | Session-only fallback; a Developer ID would stop it (existing question 15) |
| **No per-user quota, App Check or automatic spend cap** | Verified email, rules caps, the kill switches in 2.7, budget alerts |
| **Firestore location is permanent** (us-east1) | Already decided by the existing database |
| **Email deliverability** from Google's shared sender `noreply@recaller-cloud.firebaseapp.com`: the owner's first email (2026-10-01) named the project "recaller-cloud" and landed in Spam | A spam hint up front in the app ("Not in your inbox? Look in Spam.", 6.2). Owner's console steps: the public-facing name and sender name "Recaller" (2.6, step 9), then a sending domain of our own, `recaller.ponders.ai`, with the 4 DNS records the console lists added in Wix (ponders.ai's DNS host; its own mail isn't touched; never a CNAME on `recaller.ponders.ai` itself). Custom SMTP only if mail still lands in Spam after that ("Email delivery" in `infra/README.md`) |
| **Legal:** public sign-up makes the owner a data controller (privacy policy, deletion requests, GDPR if EU users arrive, US storage) | Self-serve deletion, a versioned privacy note; terms needed before public launch (Q6) |
| **The `app.js` monolith grows** (3,675 lines) | The risky logic is pure and unit-tested in `sync-apply.js` and `src/sync/*`; the UI is in `account.js` |
| **Large boards:** full-data IPC and O(n) diffs per push debounce | Fine to about 10,000 notes (≈ 50 ms). An existing debt noted in `11` #8 |
| **Infra is being converted by another session right now** | WP1 waits for phase 0. Only additive resources plus the rules files |
| **Orphaned data** if an account deletion is interrupted after the head is deleted | The account still exists and can finish: with no head, the deletion goes straight to `accounts:delete` (5.15). An operator orphan sweep in v2 |

### 9.2 Checklist of unconfirmed facts

Each item is verified by `rules:smoke`, `auth-settings.sh` or the manual check (2.10). The smoke test of 2026-10-01 (43 of 45, one rules gap: section 0, item 34) settled most of them, and Google's pricing page and the owner's first real email two more:
- the us-east1 Firestore prices: **settled** on 2026-10-01 from Google's pricing page (the South Carolina row): $0.06, $0.18 and $0.02 per 100k, $0.18 per GiB-month (2.3);
- the `runQuery` framing: **settled**, a JSON array (`Content-Type: application/json; charset=UTF-8`);
- the v0 multipart and `Bearer` behaviour: **settled**. A 100 KB multipart and a 3.0 MB resumable upload work with `Firebase`; a `Bearer` download answers HTTP 200 (its "other bytes" came from the accepted overwrite, not from `Bearer`). It also showed that an upload over an existing file is a `create` in Storage rules, which the rules didn't refuse (section 0, item 34);
- whether REQUEST_TIME equals `commitTime`: **settled, it doesn't.** REQUEST_TIME is the request's arrival time; `commitTime` was 56 ms later for a small commit and 1.77 s later for the 400-write commit;
- the recent-login window: **partly.** ID tokens 4 s and 14 s after sign-in were accepted; where the window ends wasn't measured;
- the password-policy body shape (the smoke test's 7-character sign-up was refused with `PASSWORD_DOES_NOT_MEET_REQUIREMENTS`, so the policy is enforced);
- the email action URL and wording: **settled** by the owner's first real email (2026-10-01). The link opens `recaller-cloud.firebaseapp.com/__/auth/action` and carries Firebase's own browser key (2.7). The email named the project "recaller-cloud", because the project has no public-facing name yet (2.6, step 9);
- the function-mock names in the Rules API: **settled** on the first `rules:test` run (2026-09-30): `get` in Firestore rules, `firestore.get` in Storage rules (section 0, item 27);
- whether `accounts:batchDelete` accepts the documented body.

### 9.3 Questions for the owner

1. **Q1 – Existing setup.** Is the Terraform adoption finished (`imports.tf` applied and deleted)? May WP1 then add the sync resources, deploy the real rules and run `auth-settings.sh` against `recaller-cloud`?
2. **Q2 – Version.** Call this 1.17.0? The discarded 1.17.0 builds sit in `dist/_discarded-1.17.0/`. If either computer ever ran one, reusing 1.17.0 would skip the upgrade backup, so 1.18.0 would be safer.
3. **Q3 – The look across computers.** This spec keeps title font, Cooked colour, colour theme and density per computer, and syncs only "Join notes with". Should title font and Cooked colour follow you instead?
4. **Q4 – Your two boards.** On the Mac's first sign-in, pick **Combine both** (the Mac's notes are added after the PC's columns)? This replaces the manual PC-to-Mac copy.
5. **Q5 – Privacy contact.** Which address goes in the privacy note? Do you agree with the wording "only looks at it to fix a problem you report"?
6. **Q6 – Public launch.** Anyone can sign up once this ships. Do you want sign-ups paused (`signup_enabled = false`) until you've used it yourself for a while? Should a hosted privacy and terms page (Firebase Hosting) come before public sign-up?
7. **Q7 – Budget.** Keep 15 CAD a month for now? What amount once sign-up is public?
8. **Q8 – Restore while signed in.** v1 never deletes anything from the account on a restore (restored notes come back; newer ones stay). Is that what you expect, or do you want a later option "Make my account match this backup"?
9. **Q9 – Sign-out on a shared computer.** Is the optional "Also remove this board, its pictures and its backups from this computer" (it keeps your settings and OpenAI key) worded right?
10. **Q10 – Branch.** Build this on `masos` and merge `masos` into `main` afterwards, so one codebase ships both editions? The PC suites must pass first.
11. **Q11 – Later.** Wanted after v1: changing the account email, "Sign in with Google", a "Recently deleted" view (from the 30-day trash), or automatic clean-up of unused cloud pictures?

**Sources for the facts added in this synthesis:**
- [Firestore rules conditions: access-call limits (20 per batched write, summed across writes; caching unspecified)](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Storage rules with Firestore data (default database only, at most two document reads per evaluation, billed as Firestore reads)](https://firebase.google.com/docs/storage/security/rules-conditions)
- [Firebase Security Rules IAM roles, including roles/firebaserules.firestoreServiceAgent](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaserules)
- [Cross-service Rules release notes](https://firebase.google.com/support/release-notes/security-rules)
- [Identity Platform password policy (documented example body)](https://docs.cloud.google.com/identity-platform/docs/password-policy)
- [Identity Toolkit v2 discovery (`customStrengthOptions.minPasswordLength` and related fields)](https://identitytoolkit.googleapis.com/$discovery/rest?version=v2)
- [Identity Toolkit v1 discovery (`accounts:query` request fields)](https://identitytoolkit.googleapis.com/$discovery/rest?version=v1)
- [Firebase Rules API discovery (`projects.test`, TestCase, FunctionMock)](https://firebaserules.googleapis.com/$discovery/rest?version=v1)
- [Firebase JS SDK storage requests (multipart and resumable headers, chunk size, list parameters)](https://raw.githubusercontent.com/firebase/firebase-js-sdk/main/packages/storage/src/implementation/requests.ts)
- [Firestore billing example (nam5 unit prices)](https://docs.cloud.google.com/firestore/native/docs/billing-example)
- [Firestore free quota](https://firebase.google.com/docs/firestore/pricing)
- [Firestore pricing (the us-east1 row, confirmed on 2026-10-01; 2.3)](https://cloud.google.com/firestore/pricing)