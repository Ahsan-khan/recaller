# Recaller on Google Cloud

The accounts and cloud sync behind Recaller live in one Google Cloud project, `recaller-cloud`. Terraform describes all of it, from the files in this folder.

## What's there

| Resource | Value |
| --- | --- |
| Project | `recaller-cloud` (number 700753939032), display name "Recaller", no organization |
| Billing | "My Billing Account 1" (`01138A-E377EE-4F0D47`, billed in CAD) |
| Region | `us-east1` (South Carolina) for the database and the bucket. Neither can move later without migrating |
| Accounts | Firebase Authentication on Identity Platform: email + password, one account per email, email enumeration protection on, passwords of 8 or more characters (the last two are set by `scripts/auth-settings.sh`, see "Deliberately outside Terraform") |
| Sign-ups | Open to anyone. `signup_enabled` in `terraform.tfvars` pauses them (see "Kill switches") |
| Database | Firestore `(default)`, native mode, delete protection on, daily backups kept 7 days |
| Sync settings | In Firestore (`sync.tf`): 12 fields that no query uses have no single-field indexes, and `trash.expireAt` has a TTL, so a deleted note or project is erased from `users/{uid}/trash` about 30 days after it was deleted |
| Pictures | Cloud Storage bucket `gs://recaller-cloud-data` (uniform access, public access blocked, deleted files restorable for 7 days), linked to Firebase |
| Email pages | `https://recaller-cloud.firebaseapp.com/__/auth/action` (verify email, reset password), served by the default Hosting site. The links in the emails carry the email-page key (below) |
| Security rules | `firebase/firestore.rules` and `firebase/storage.rules`: a user whose email is verified reads and writes only their own `users/{uid}` documents and pictures (`ai_memory/15_accounts_and_sync.md`, 4.8 and 4.9) |
| IAM grant | One, additive (`sync.tf`): the Firebase Storage service agent has `roles/firebaserules.firestoreServiceAgent`, so the Storage rules can read the account's head in Firestore |
| App key | "Recaller desktop app", limited to Identity Toolkit, Secure Token, Firestore and Firebase Storage |
| Email-page key | Firebase's "Browser key (auto created by Firebase)". Recaller doesn't use it, but every verification and password-reset link carries it (see "The email-page key"). In `apikey.tf` as `email_page` since 2026-10-01, with only Identity Toolkit and Secure Token: the next plan adopts it and cuts its other 25 APIs |
| Budget | 15 CAD a month. Email alerts at 10% (1.50 CAD), 50%, 90% and 100% of actual spend, and once when the month's forecast passes 100% (from the next plan; until then 50%, 90% and 100%). Alerts only: nothing is stopped or capped |
| Terraform state | `gs://recaller-cloud-tfstate` (project owners only, old versions kept) |

The rows for accounts and sync describe the project since "Accounts and sync: the runbook" below was applied, on 2026-10-01. Before that, the live rules denied every client, the sync settings and the IAM grant didn't exist, and Firebase's own minimum of 6 characters applied to passwords. Three later changes of 2026-10-01 are in the files but not applied yet: the Storage rules fix (an upload over an existing picture refused), the email-page key and the budget's new alerts. They wait in one saved plan for the owner (see "The next plan").

## Layout

- `terraform/bootstrap/` creates the state bucket and decides who can read it.
- `terraform/prod/` holds everything else, one file per concern (`project.tf`, `apis.tf`, `firebase.tf`, `firestore.tf`, `auth.tf`, `storage.tf`, `rules.tf`, `sync.tf`, `apikey.tf`, `budget.tf`). The values for this deployment are in `terraform.tfvars`. `imports.tf` exists only while an adoption is pending (today: the email-page key), and is deleted after the apply that imports.
- `firebase/` holds the security rules. Terraform deploys them.
- `scripts/` holds the tools that talk to the live project with the owner's gcloud login: `auth-settings.sh` (the two sign-in settings Terraform can't express), `rules-test.js` and `rules-smoke.js` (the rules checks, `npm run rules:test` and `npm run rules:smoke`) and `purge-unverified.js` (removes accounts that never verified their email). They need Node.js, and `auth-settings.sh` also needs bash and curl (Git Bash on the PC).
- `.gitattributes` keeps the rules, the Terraform files and the shell scripts LF on every checkout. Terraform uploads the rules byte for byte, so a CRLF copy on Windows would otherwise plan new rulesets, and Git Bash refuses a script with CRLF endings.

Each root's `.terraform.lock.hcl` goes in git. It pins the provider versions and has checksums for Mac (Apple silicon and Intel), Windows and Linux. After `terraform init -upgrade`, refresh the checksums for all four, and do the same with `-chdir=infra/terraform/bootstrap`:

```
terraform -chdir=infra/terraform/prod providers lock -platform=darwin_arm64 -platform=darwin_amd64 -platform=windows_amd64 -platform=linux_amd64
```

## Before you start

- Terraform 1.9 or later, ideally the same version on every machine (the Mac has 1.16.4), and gcloud.
  - Mac: `~/.local/bin/terraform` and `~/google-cloud-sdk/bin/gcloud`, installed without admin rights. Neither is on the PATH, so in each new terminal first run:

    ```
    export PATH="$HOME/.local/bin:$HOME/google-cloud-sdk/bin:$PATH"
    ```

  - Windows PC: install [Terraform](https://developer.hashicorp.com/terraform/install) and the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), and run the commands in PowerShell. Where PowerShell needs a different command, it is shown.
- Sign in once, as a user who owns the project and administers the billing account:

  ```
  gcloud auth login --update-adc
  gcloud auth application-default set-quota-project recaller-cloud
  ```

Terraform uses that login (Application Default Credentials). There are no service account keys, and there shouldn't be. The quota project matters: when you're signed in as a user, some Google APIs only answer when a project is named to bill the calls to.

The commands below run from the repo root.

## Bootstrap (done on 2026-09-29)

`terraform/bootstrap` creates the state bucket and its access policy, and keeps its own state in that bucket under `bootstrap/`. It assumes the project exists with billing linked: the project predates Terraform, and prod adopted it. For a new project, create it and link billing first (`gcloud projects create ID --name=Recaller`, then `gcloud billing projects link ID --billing-account=ACCOUNT`), and adopt it in prod with an import block, as the first apply did (see "The first apply: adopting what exists").

The bucket can't hold the state before it exists, so from scratch it goes like this:

1. Move `backend.tf` aside, then run `init` and `apply`. The bucket is created and the state is a local file.
2. Put `backend.tf` back and run `terraform -chdir=infra/terraform/bootstrap init -migrate-state`. The state moves into the bucket.
3. Delete the local `terraform.tfstate` files.

After that it is an ordinary root. It only needs running again to change the bucket or who can read it.

### The state bucket's access policy (added 2026-09-30)

The owners-only bucket policy and the bucket's `deletion_policy = "PREVENT"` came after the first bootstrap apply. They are applied on their own, before the prod import, so the prod state never holds a secret while anyone else can read it:

```
terraform -chdir=infra/terraform/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/terraform/bootstrap apply bootstrap.tfplan
rm infra/terraform/bootstrap/bootstrap.tfplan
```

That plan says `Plan: 1 to add, 1 to change, 0 to destroy.`: the new bucket policy, and the bucket's `deletion_policy` going from `DELETE` to `PREVENT`, which lives only in Terraform's state (nothing is sent to Google for it). Afterwards, `gcloud storage buckets get-iam-policy gs://recaller-cloud-tfstate` lists only `projectOwner:recaller-cloud`, and a bootstrap plan says "No changes."

## Everyday use

```
terraform -chdir=infra/terraform/prod init
terraform -chdir=infra/terraform/prod plan -out=prod.tfplan
terraform -chdir=infra/terraform/prod apply prod.tfplan
rm infra/terraform/prod/prod.tfplan
```

Read the plan before applying it; applying the saved plan doesn't print it again. The saved plan holds the app key and the sign-in password-hash parameters in clear text: it is git-ignored, and deleting it after the apply keeps it off the disk. The state is locked during a run, so two runs can't collide.

Before committing a change, run these. None of them changes anything at Google, and a CI job can run them after `terraform -chdir=infra/terraform/prod init -backend=false -input=false` (and the same for bootstrap):

```
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/prod validate
terraform -chdir=infra/terraform/bootstrap validate
```

## The first apply: adopting what exists

Everything was first created by a script (`infra/gcp/setup.sh`, now removed). An `imports.tf` handed each of those resources to Terraform, so nothing was rebuilt; it was deleted after that apply (the `imports.tf` there today adopts only the email-page key, see "The next plan"). Apply the bootstrap access policy first (see above).

The first plan prints every setting of each imported resource, and the provider doesn't treat the sign-in password-hash parameters (`sign_in.hash_config`: `signer_key` and `salt_separator`) as secret. They can't be rotated, so keep them off the screen, out of logs and out of any AI chat: for this run, mask the plan, then apply the saved plan.

```
# Mac
terraform -chdir=infra/terraform/prod plan -input=false -no-color -out=prod.tfplan 2>&1 \
  | sed -E 's/((signer_key|salt_separator)"?[[:space:]]*[=:][[:space:]]*).*/\1"(masked)"/'
terraform -chdir=infra/terraform/prod apply prod.tfplan
rm infra/terraform/prod/prod.tfplan
```

```
# Windows (PowerShell): this plan line, then the same apply and delete
terraform -chdir=infra/terraform/prod plan -input=false -no-color -out=prod.tfplan 2>&1 |
  ForEach-Object { "$_" -replace '((signer_key|salt_separator)"?\s*[=:]\s*).*', '$1"(masked)"' }
```

The pipe hides Terraform's exit code, so before applying, check that the plan ends with this line (a failed plan saves no plan file):

```
Plan: 26 to import, 0 to add, 2 to change, 0 to destroy.
```

Importing only reads. The two changes are the only calls that change anything at Google: they add labels (`app`, `managed-by`) to the project and to the bucket, which also gets `purpose`. The bucket's `deletion_policy` becomes `PREVENT` at the same time; that setting lives only in Terraform's state and nothing is sent to Google for it.

After that apply, delete `imports.tf` and plan again. It must say "No changes." From then on a plan shows only what changes, so the mask is needed again only for the commands listed under "Keeping the state private".

## Accounts and sync: the runbook (written 2026-09-30, applied 2026-10-01)

This turns on what accounts and sync need (`ai_memory/15_accounts_and_sync.md`, 2.4 to 2.7): `sync.tf`, the sign-up switch in `auth.tf` and `variables.tf`, the real rules in `firebase/`, and the two sign-in settings that `scripts/auth-settings.sh` sets. The owner runs it, with an agent if they like. Every step can be run again.

1. **Check the login.** This only reads:

   ```
   gcloud config list
   gcloud auth application-default print-access-token >/dev/null
   ```

   If the second command fails, sign in again as in "Before you start".

2. **The rules texts:** `npm run rules:test` (see "Checking the rules"). It deploys nothing, so it comes before the plan: if a case fails, stop here, before the new rules go live.

3. **Plan, and read the plan.** It runs where an agent can see it, so mask it as in "The first apply":

   ```
   terraform -chdir=infra/terraform/prod plan -input=false -no-color -out=prod.tfplan 2>&1 \
     | sed -E 's/((signer_key|salt_separator)"?[[:space:]]*[=:][[:space:]]*).*/\1"(masked)"/'
   ```

   It must say `Plan: 18 to add, 0 to change, 4 to destroy.` and show exactly this:
   - 13 `google_firestore_field` created: the 12 `unindexed` fields and `trash_expire_at`;
   - `google_project_iam_member.storage_rules_read_firestore` created;
   - both `google_firebaserules_ruleset` replaced (`+/-`) and both `google_firebaserules_release` re-created (`-/+`), because the rules files changed (see "Security rules").

   The Identity Platform config doesn't change: the adopted state already has `client.permissions` with both switches off, which is what `signup_enabled = true` asks for. Anything else is drift. If the plan changes `sign_in` or `authorized_domains` above all, stop and find out why before applying.

4. **Apply it:**

   ```
   terraform -chdir=infra/terraform/prod apply prod.tfplan
   rm infra/terraform/prod/prod.tfplan
   ```

   New rules and a new IAM grant take several minutes to reach every server. Give them 10 minutes before step 8.

5. **The sign-in settings:** `bash infra/scripts/auth-settings.sh`. It prints `enumeration protection : true`, a password policy with `"passwordPolicyEnforcementState":"ENFORCE"` and `"minPasswordLength":8`, and `sign-up disabled : false`. When it sets the policy, it says which of its two bodies the API took: record that in `ai_memory/15_accounts_and_sync.md` (2.10).

6. **The TTL:** `gcloud firestore fields ttls list --database='(default)' --project=recaller-cloud` lists `trash` and `expireAt`, first `CREATING`, later `ACTIVE`.

7. **The app's settings:** write `infra/gcp/project.json` as in "The app's settings", then run `npm run cloud:config`. The smoke test in the next step reads the project and the key from that file, so it comes first.

8. **The live project:** `npm run rules:smoke` (see "Checking the rules").

9. **Once, in the Firebase console: the name in the emails.** The emails use the project's public-facing name, and without one they say `recaller-cloud` (the owner's first email did). On this project, Project settings > General shows no field for it, most likely because the project was made from the command line and so has no OAuth brand, which is where that name lives. Set it this way instead:
   - Authentication > Sign-in method > Add new provider > Google. Switch Enable on, set "Public-facing name for project" to "Recaller" and "Support email for project" to the owner's address, and Save.
   - Open Google again, switch Enable off, and Save. The name stays. Don't leave Google sign-in on: Recaller doesn't use it, and the rules would let a Google account in (its email counts as verified).
   - The alternative, which never turns Google sign-in on: Google Cloud console > Google Auth Platform > Branding, with "Recaller" as the app name. It isn't confirmed to fill Firebase's field; if Project settings > General still shows no name afterwards, use the steps above.
   - Afterwards Project settings > General shows "Public-facing name: Recaller", and it is edited there from then on.

   Then, under Authentication > Templates, set the sender name to "Recaller" on "Email address verification" and on "Password reset", and leave the rest. The sending domain, against Spam, is in "Email delivery".

10. **The budget:** no change in this runbook. It stays at 15 CAD, and any new amount stays in CAD (`budget_currency = "CAD"`). Its alerts changed later (see "Cost").

### Rebuilding from an empty project

For disaster recovery only.

1. Install gcloud without admin rights: `CLOUDSDK_PYTHON=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3 ./google-cloud-sdk/install.sh --quiet --install-python=false --usage-reporting=false --path-update=false --command-completion=false`. The default `--install-python=true` runs `sudo`.
2. Sign in as in "Before you start".
3. Create the state bucket with `terraform/bootstrap`, as in "Bootstrap" (the project must exist, with billing linked).
4. Apply `terraform/prod`, adopting the project with an import block as "Bootstrap" says. Everything else is created: the APIs, Firebase, Identity Platform, the database in us-east1, the bucket and its Firebase link, the rules, the sync settings, the IAM grant, the app key and the budget. The Firebase Storage service agent appears only after Firebase Storage is turned on: if the IAM grant fails because that account doesn't exist yet, wait a minute and apply again. Firebase may make its own browser key in the new project too, and here the email links carry Firebase's key (see "The email-page key"). If it does, set `email_page_key_id` to that key's ID and adopt it with an import block, rather than letting Terraform create `email_page` as a second key.
5. Run steps 5 to 10 above, from `auth-settings.sh` on. A new key means a new app release.

## The next plan (saved 2026-10-01, for the owner)

Three changes of 2026-10-01 wait in one saved plan, `terraform/prod/prod.tfplan`. Its masked output ends with:

```
Plan: 1 to import, 2 to add, 2 to change, 2 to destroy.
```

- **Imported, then changed in place:** `google_apikeys_key.email_page`, Firebase's auto-created browser key (`imports.tf`). Its API list goes from 27 APIs to Identity Toolkit and Secure Token (see "The email-page key").
- **Changed in place:** `google_billing_budget.monthly`, with the new alerts (see "Cost").
- **Replaced:** `google_firebaserules_ruleset.storage` (`+/-`) and its release (`-/+`), for the Storage rules fix: an upload over an existing picture is refused (`ai_memory/15_accounts_and_sync.md`, section 0, item 34). `npm run rules:test` passed all 219 cases on these texts on 2026-10-01.
- Nothing else changes: not the Firestore rules, the sign-in config (`sign_in`, `authorized_domains`), the app key, the bucket or the IAM grant.

Apply it before the Mac's Combine (`ai_memory/15_accounts_and_sync.md`, 8.4): until then the live Storage rules accept an upload over an existing picture.

1. `terraform -chdir=infra/terraform/prod apply prod.tfplan`. If Terraform says the saved plan is stale (something changed since it was made), plan again with the mask and check that it says the same.
2. Delete the plan and the import block: `rm infra/terraform/prod/prod.tfplan infra/terraform/prod/imports.tf`. A masked plan then says "No changes."
3. Wait up to 10 minutes, then run `npm run rules:smoke`. It must pass 45 of 45.
4. Check that an email link still works: send a password reset to a test account and open its link. Google's page must let you set a new password.

## Checking the rules

Both checks use the owner's gcloud login, and neither is part of `npm test`.

**`npm run rules:test`** (`scripts/rules-test.js`) sends the texts in `firebase/` and every case in `tests/rules/cases.js` to the Firebase Rules API's test method. Nothing is deployed, read or written, and it's free. It prints SUCCESS or FAILURE per case; `node infra/scripts/rules-test.js TEXT` runs only the cases whose name contains TEXT. Run it before applying any rules change.

**`npm run rules:smoke`** (`scripts/rules-smoke.js`) checks the deployed rules, the indexes and the REST calls the app makes, on the real project. It reads the app key from `infra/gcp/project.json`, creates two throwaway accounts (`recaller-smoke-<random>@example.com`), and marks them verified with the owner's admin call, so no email is sent. Then, as `ai_memory/15_accounts_and_sync.md` 7.7 lists:

1. before verification, every read, write, upload and listing is refused;
2. the head: a +2 jump is refused, a +1 bump works, and another user can't read it;
3. one commit of the head plus 399 notes works (board writes make no access calls);
4. the app's pull query and full listing return every note in order, in pages of 300, with no index error;
5. a backwards rev, a tombstone with content and a hard delete are refused, a refused commit writes nothing, and a delete with its trash copy works;
6. pictures: a 100 KB multipart and a 3 MB resumable upload work with `Authorization: Firebase`, an overwrite is refused, the bytes come back the same, the listing works, and another user can't read or list them;
7. account deletion: once `deleting` is set, a board commit, a device write and an upload are refused; then the pictures, the documents (10 per commit), the head and the account delete;
8. a sign-up with a 7-character password is refused.

It ends by deleting everything it made (with the owner's access, for anything the accounts couldn't delete themselves) and checking that no account, document or picture is left. It prints PASS or FAIL per check, then a "Recorded" block with the facts the spec leaves open: the `runQuery` framing, what Storage does with `Bearer`, REQUEST_TIME against `commitTime`, and the recent-login window. Copy those into `ai_memory/15_accounts_and_sync.md` (2.10). About 2,000 operations: cents at most.

- Before making anything, it checks that the owner's login can reach the admin API, Firestore and Cloud Storage, which the clean-up needs.
- It needs sign-ups open. While `signup_enabled = false`, it stops before making anything.
- Ctrl+C stops the checks and still cleans up; a second Ctrl+C leaves whatever is there. The throwaway emails and uids are printed, so leftovers can be found in the Firebase console (Authentication, Firestore `users/<uid>`, Storage `users/<uid>/`).

## Kill switches

| Situation | What to do |
| --- | --- |
| Stop new sign-ups | Set `signup_enabled = false` in `terraform/prod/terraform.tfvars`, then plan and apply. The plan must change only `disabled_user_signup` under `client` > `permissions`, from `false` to `true` (`Plan: 0 to add, 1 to change, 0 to destroy.`). New sign-ups then fail with `ADMIN_ONLY_OPERATION` and the app shows "New accounts are paused right now. Try again later." Existing accounts keep working, and anyone can still delete their own account. To reopen, remove the line or set it back to `true` |
| Stop new sign-ups this minute | Pause them without Terraform (below). The next apply turns sign-ups back on unless `signup_enabled = false` too, so set the variable as well |
| Stop one abusive user | Disable the account (below). Its next token refresh fails with `USER_DISABLED`, so all its traffic stops within an hour, when its last ID token expires. `"disableUser":false` undoes it |
| Stop everything | First the data, at once: replace both rules files with the deny-all texts below, then plan and apply. Then sign-in, sign-up and token refresh: in `terraform/prod/locals.tf`, set `app_key_services = ["apikeys.googleapis.com"]`, and in `terraform/prod/terraform.tfvars` set `signup_enabled = false`; then plan and apply. The app key then works only for the API Keys API, which takes no calls on a key alone. The deny-all rules and `signup_enabled = false` already stop data access and new accounts for every key, the email-page key included. That key can still sign in an existing account. Setting `email_page_key_services = ["apikeys.googleapis.com"]` in `locals.tf` stops that too, but it breaks every verification and reset link until it is undone. **Never leave either list empty: a key with no API targets works for every API** (the plan refuses an empty list). ID tokens already issued stay valid for up to an hour, which is why the rules go first. To undo, put the real files back (from git, or from copies kept before the change), set `signup_enabled` back to `true` (or remove the line), put the key lists back, and apply |
| Slow brute force | Optional: lower the Identity Toolkit API quotas in the Cloud console, IAM & Admin > Quotas |
| Accounts never verified | `node infra/scripts/purge-unverified.js` lists the unverified accounts created more than 7 days ago (`--days N` for another age), and with `--apply` deletes them. They hold no cloud data, since every rule requires a verified email. Check the output of the first `--apply`: the delete call's body is the documented one but not yet confirmed. Run it about once a month: it is the "later clean-up" the app and README promise when someone uses "Use a different email" after its first few minutes, and a mistyped address otherwise keeps its owner from signing up (`EMAIL_EXISTS`) |

The two direct calls, on the Mac (on the PC, from Git Bash). Both print only the HTTP status, `200` when it worked. Never print the answer of the config call: it is the whole sign-in config, with a key and the password-hash parameters. A user's UID is in the Firebase console, Authentication > Users.

```
TOKEN="$(gcloud auth print-access-token)"

# Pause sign-ups now
curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: recaller-cloud" -H "Content-Type: application/json" \
  -d '{"client":{"permissions":{"disabledUserSignup":true,"disabledUserDeletion":false}}}' \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/recaller-cloud/config?updateMask=client.permissions"

# Disable one account
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: recaller-cloud" -H "Content-Type: application/json" \
  -d '{"localId":"UID","disableUser":true}' \
  "https://identitytoolkit.googleapis.com/v1/projects/recaller-cloud/accounts:update"
```

The deny-all texts, for `firebase/firestore.rules` and `firebase/storage.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

## Security rules

Edit `infra/firebase/firestore.rules` or `storage.rules`, run `npm run rules:test`, then plan and apply. After the apply, `npm run rules:smoke` checks them on the real project (see "Checking the rules").

A ruleset can't be edited, and the Terraform provider can't re-point a release in place. So the plan shows the ruleset replaced (`+/-`, the new one created first) and its release re-created (`-/+`). Rules that don't compile fail when the new ruleset is created, before anything live changes. For the second or two between deleting and re-creating the release, clients may be refused.

### The plan for a rules-only change

`rules.tf` reads the two files, so a rules change needs no Terraform edit. Mask the plan as in "The first apply" (it costs nothing, and nothing in it should need masking). A change to `storage.rules` alone must plan exactly this, and nothing else:

```
  # google_firebaserules_release.storage must be replaced
-/+ resource "google_firebaserules_release" "storage" {
  # google_firebaserules_ruleset.storage must be replaced
+/- resource "google_firebaserules_ruleset" "storage" {
Plan: 2 to add, 0 to change, 2 to destroy.
```

- The ruleset is replaced (`+/-`): its `content` shows the new text, comments included, since the file is uploaded byte for byte.
- Its release is re-created (`-/+`), because its `ruleset_name` changes.
- Nothing else changes: not the other file's ruleset and release, not the sign-in config (`sign_in`, `authorized_domains`), the bucket, the key or the IAM grant. Anything else is drift, or a CRLF copy of a rules file (see `.gitattributes`): stop and find out why before applying.
- A change to `firestore.rules` alone gives the same with `.firestore` in place of `.storage`; a change to both, `Plan: 4 to add, 0 to change, 4 to destroy.`

Apply the saved plan and delete it, as always. Give the new rules up to 10 minutes to reach every server, then run `npm run rules:smoke`: **every check must pass** (45 of 45 as of 1.17.0). A failure there is a finding about the rules, not a flake. The run of 2026-10-01 passed 43 of 45: the live Storage rules accepted an upload over an existing picture, because in Storage rules that upload is a `create` (only metadata changes are `update`), and the Rules API cases had passed only because they named it `update` (`ai_memory/15_accounts_and_sync.md`, section 0, item 34). The fix is in "The next plan".

## The app's settings

The app needs the project ID, the API key, the bucket, the auth domain and the region. They come from one sensitive output, written to `infra/gcp/project.json`. That folder isn't in git (only this ignored file lives there), so a fresh clone doesn't have it yet:

```
# Mac
mkdir -p infra/gcp
terraform -chdir=infra/terraform/prod output -json app_config > infra/gcp/project.json
```

```
# Windows (PowerShell)
New-Item -ItemType Directory -Force infra/gcp | Out-Null
terraform -chdir=infra/terraform/prod output -json app_config | Set-Content -Encoding ascii infra/gcp/project.json
```

Every value is plain ASCII, and `-Encoding ascii` stops Windows PowerShell from writing UTF-16. The file is git-ignored (so is any `project.json` under `infra/`) and has the same fields the old script wrote. `npm run cloud:config` checks it and copies it to `src/cloud/project.json` (also git-ignored), which the build packs into the app. Without that copy, `npm run dist` and `npm run dist:mac` stop, unless `RECALLER_NO_CLOUD=1` asks for a build without accounts (`ai_memory/15_accounts_and_sync.md`, 2.9).

The key isn't a secret in the usual sense: it ships inside every copy of the app and only identifies the project. Sign-in and the security rules are what protect the data. It still stays out of git.

## Rotating the API key

The key is built into every released app, so a new key takes an app release:

1. In `apikey.tf`, copy the `app` key as `app_next` with a new ID: lowercase letters, digits and hyphens, starting with a letter, such as `recaller-desktop-2`. Apply.
2. Point `apiKey` in `outputs.tf` at `google_apikeys_key.app_next`, apply, write `project.json` again and ship a release.
3. When the old versions no longer matter, delete the `app` block and apply. The old key is deleted.
4. To tidy up, rename `app_next` back to `app` with a `moved` block, set `app_api_key_id` to the new ID, and point `apiKey` back at `app`. The plan must show only the move.

Google won't delete a key that was used in the last 7 days. For a leaked key that is being abused, set `deletion_policy = "FORCE"` on it and apply before deleting it.

## The email-page key

Firebase created a key of its own in the project: "Browser key (auto created by Firebase)". Recaller never uses it, but every verification and password-reset email does: the link carries it, and Firebase's action page calls Identity Toolkit with it. The API metrics showed this on 2026-10-01. When the owner clicked a verification link, the page's call (Identity Toolkit's SetAccountInfo) was this key's only use in 7 days, while every call the app makes used the app key. To look again: Cloud console > Monitoring > Metrics explorer, the consumed API request count grouped by `credential_id`.

- It stays, with the two sign-in APIs only: Identity Toolkit and Secure Token (`email_page_key_services` in `locals.tf`). Taking those away too would break every email link. Firebase had given it 27 APIs, Firestore and Storage among them; the next plan removes the other 25.
- It is `google_apikeys_key.email_page` in `apikey.tf`, adopted by the import in `imports.tf` (deleted after that apply); its ID is the variable `email_page_key_id`. Like the app key it has API targets only, no application restriction, and `prevent_destroy`: deleting it would break the links in emails already sent, and Firebase may make a new key.
- It isn't served publicly (`https://recaller-cloud.firebaseapp.com/__/firebase/init.json` answered 404 on 2026-10-01), but everyone who gets an email from the project has it. Never paste its value anywhere.
- "Stop everything" (see "Kill switches") says what to do with it in an emergency.

## Recovering the state

The state is in `gs://recaller-cloud-tfstate`, under `prod/` and `bootstrap/`. Every write keeps the previous version: up to about the last 20, for at most a year. Restore only while no run holds the lock: the first listing below must not show `prod/default.tflock`. Then pick a generation from the second listing and copy it over the current state:

```
gcloud storage ls gs://recaller-cloud-tfstate/prod/
gcloud storage ls --all-versions gs://recaller-cloud-tfstate/prod/
gcloud storage cp "gs://recaller-cloud-tfstate/prod/default.tfstate#GENERATION" gs://recaller-cloud-tfstate/prod/default.tfstate
terraform -chdir=infra/terraform/prod plan
```

The copy becomes the current state, and the one it replaces is kept as an old version, so nothing is lost. The plan then shows how the recovered state differs from what is live.

If a crashed run left the state locked, `terraform -chdir=infra/terraform/prod force-unlock LOCK_ID` releases it (use `-chdir=infra/terraform/bootstrap` for the bootstrap state). Only do that when no other run is going.

## Keeping the state private

The state and any saved plan hold the API key and the sign-in password-hash parameters in clear text. These commands print them, so don't run them where the output is kept or shared (a log, a screen share, an AI chat):

- `terraform output -json` prints the key. Only redirect it into `infra/gcp/project.json`, as above.
- `terraform show` (of the state or of a saved plan), `terraform state show google_identity_platform_config.this`, and any plan that imports, replaces or destroys that resource print the hash parameters. Pipe them through the same mask as the first plan.
- `TF_LOG` debug logs contain both. Don't set `TF_LOG` against prod.

Only project owners can read or write the state bucket. Cloud Storage's default bucket policy also lets project viewers read it and editors write it; `terraform/bootstrap` replaces that policy with one that names only `projectOwner:recaller-cloud`. To give someone else access to the state, add them there. Never delete that policy block: Terraform would then set an empty policy, and since owners reach the bucket only through it, everyone would be locked out of the state. An owner can get back in by granting themselves Storage Admin on the project (`gcloud projects add-iam-policy-binding recaller-cloud --member=user:EMAIL --role=roles/storage.admin`).

Bucket IAM can't close one gap: Firebase's own service account, `firebase-adminsdk-fbsvc@recaller-cloud.iam.gserviceaccount.com`, has a project-wide role that reaches every bucket, this one included. Never create a key for it (Firebase console > Project settings > Service accounts > Generate new private key); give any server code its own service account with narrow roles. Don't copy state files anywhere else.

## Deliberately outside Terraform

- **Email enumeration protection.** It is on (Firebase console, Authentication > Settings > User actions), but the Google provider can't express it. `scripts/auth-settings.sh` checks it and turns it back on if someone turned it off. Terraform's changes to the sign-in config only send the fields they change, so they never turn it off.
- **Password policy.** 8 to 4096 characters with no required character classes, enforced at sign-up; existing sign-ins are never blocked. The app checks the same 8 before it sends anything. The provider can't express it either, so `scripts/auth-settings.sh` sets it, and for the same reason Terraform never resets it. Without it, Firebase would accept any password of 6 or more characters.
- **`auth-settings.sh` itself.** Run it after any rebuild, or whenever the two settings above may have changed: it reads the live config first, changes only what differs, and prints only the fields it checks. The config it reads holds a key and the password-hash parameters, so it never prints it whole, writes it to a file or puts it on a command line.
- **reCAPTCHA.** Off, and it must stay off: enforcing it would refuse every sign-up and sign-in from the desktop app, which can't answer a reCAPTCHA. `auth-settings.sh` warns if it is enforced.
- **The billing link.** `project.tf` records the billing account, but Terraform never changes it. Terraform would read the link through the Cloud Billing API, which isn't enabled in the project, and a mistake there would unlink billing and stop the database and the bucket. Change it in the Cloud console. To hand it to Terraform later: enable `cloudbilling.googleapis.com`, remove the `ignore_changes` in `project.tf`, and check that the plan shows no change.
- **APIs that Firebase turned on by itself** (BigQuery, Logging, Monitoring and others). Terraform manages only the ones listed in `locals.tf`, and never turns an API off.
- **Who can access the project (IAM).** The owner is the account that created it. Managing people's access in Terraform is easy to get wrong in a way that locks everyone out, and there is one person to manage. Two exceptions: the state bucket's own policy, which bootstrap manages (see "Keeping the state private"), and the one grant sync needs, in `sync.tf`: the Firebase Storage service agent gets `roles/firebaserules.firestoreServiceAgent`, so the Storage rules can read the account's head in Firestore. That grant is a `google_project_iam_member`, which is additive: it adds that single binding and never touches anyone else's access.
- **Firebase's own settings**, such as the public-facing name the emails use (runbook step 9), the email templates' sender name and sending domain (see "Email delivery") and the project's `firebase` labels. The public-facing name appears to be the project's OAuth brand, which can only be set in a console: Google shut down the API that created brands on 2026-03-19. The provider's sign-in config has no email-template settings either.
- **The DNS records for `recaller.ponders.ai`.** ponders.ai's DNS is at Wix, outside this project, so the sending domain's records are added there by hand (see "Email delivery").

## Email delivery

Firebase sends the verification and password-reset emails. Until the steps below are done, they come from Google's shared sender, `noreply@recaller-cloud.firebaseapp.com`, and name the project `recaller-cloud`. The owner's first one (2026-10-01) did, and it landed in Spam, most likely because scammers send phishing from `firebaseapp.com` addresses too and nothing in the email ties it to Recaller. The app now tells people to look in Spam. Terraform can't do any of these steps: they are one-time steps for the owner, in the console and at Wix.

1. **The name:** runbook step 9 (the public-facing name, and the sender name on both templates).
2. **A sending domain of our own,** against Spam: `recaller.ponders.ai`, a new subdomain. ponders.ai's own mail (its MX and SPF records) isn't touched.
   - Firebase console > Authentication > Templates: click the pencil on "Email address verification", then "customize domain", and enter `recaller.ponders.ai`.
   - The console lists 4 DNS records: two TXT records and two CNAMEs. ponders.ai's DNS is at Wix: Domains > ⋯ next to ponders.ai > Manage DNS Records, then + Add Record in the TXT and CNAME sections. The host name is only the part before `.ponders.ai`. Copy the values from the console.
   - When the Templates tab shows "Verification complete" (Google allows up to 24 hours), click Apply Custom Domain. Both templates must then send from `noreply@recaller.ponders.ai`; use "customize domain" on any that still shows firebaseapp.com.
   - Never put a CNAME on `recaller.ponders.ai` itself (for a website, say): a CNAME can't share a name with those TXT records.
3. **Test:** send a verification or reset email to a test account. Expect From "Recaller <noreply@recaller.ponders.ai>" and a subject ending "for Recaller". In Gmail, ⋮ > Show original should say PASS for SPF and DKIM. A new subdomain starts with no reputation, so judge it over a few days.

If mail still lands in Spam after that, the next step would be custom SMTP (Templates > SMTP settings): another mail service with its own DNS records, and its password kept in the Firebase config.

## Cost

Normal spend is about 0.00 CAD a month. The prices, the usage estimate per user and the totals are in `ai_memory/15_accounts_and_sync.md`, 2.3.

- **Free tiers:** Firestore gives 50,000 reads, 20,000 writes and 20,000 deletes a day, 1 GiB stored and 10 GiB of egress a month. Cloud Storage's Always Free (5 GB-months, 5,000 uploads, 50,000 downloads and 100 GB of egress a month) is per billing account, shared by every bucket in `us-east1`, `us-west1` and `us-central1`. Identity Platform email sign-in is free up to 50,000 monthly active users.
- **Billed from the first byte:** the daily backups ($0.03 per GiB-month, about 7 copies of the database) and the trash TTL's erasures ($0.02 per 100,000, like any delete). They have no free quota, but cost a fraction of a cent at this size.
- **As people join:** the free uploads run out first, at about 17 active users. Picture storage keeps growing and becomes the biggest line. 100 active users cost about 1.36 USD in their first month and 6.64 USD after a year. The 15 CAD budget is passed at about 365 users, or about 146 after a year.
- Terraform costs nothing, the state bucket is tiny (and in `us-east1`, inside the same free pool), `npm run rules:test` is free, and a run of `npm run rules:smoke` costs cents at most.

The budget (`budget.tf`, the alert levels in `variables.tf`, the amount in `terraform.tfvars`) emails the billing account's admins and users when the month's actual spend passes 10% (1.50 CAD), 50%, 90% and 100% of 15 CAD, and once when Google's forecast for the month passes 100%. Normal spend is about 0.00 CAD, so the 10% email is meant as an early abuse alarm (see "Kill switches"). It is still only an alert: nothing is stopped or capped, and Google's cost data can lag a day. The new levels go live with the next plan; until then the alerts are at 50%, 90% and 100%.
