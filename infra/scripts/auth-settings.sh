#!/usr/bin/env bash
# Identity Platform settings the Terraform provider can't express (ai_memory/15_accounts_and_sync.md, 2.5):
# email enumeration protection and the password policy (8+ characters). Safe to run again: it reads the live
# config first, changes only what differs, then reads it back.
#
#   bash infra/scripts/auth-settings.sh        (on the PC, from Git Bash)
#
# It uses the owner's gcloud login (set GCLOUD to use another gcloud than ~/google-cloud-sdk/bin/gcloud or the
# one on the PATH). The config holds the web API key and the password-hash parameters, so it is never printed,
# written to a file or put on a command line: only the fields at the end are shown.
set -euo pipefail

PROJECT=recaller-cloud
BASE="https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config"
NL=$'\n'

# The body per the v2 discovery schema. The public how-to page shows a different shape
# (enforcementState/constraints); it is tried only if the first one is refused.
POLICY_V2='{"passwordPolicyConfig":{"passwordPolicyEnforcementState":"ENFORCE","forceUpgradeOnSignin":false,"passwordPolicyVersions":[{"customStrengthOptions":{"minPasswordLength":8,"maxPasswordLength":4096}}]}}'
POLICY_DOC='{"passwordPolicyConfig":{"enforcementState":"ENFORCE","forceUpgradeOnSignin":false,"constraints":{"minLength":8,"maxLength":4096}}}'

for tool in curl node; do
  command -v "$tool" >/dev/null || { echo "auth-settings: $tool is needed on the PATH." >&2; exit 1; }
done
if [ -z "${GCLOUD:-}" ]; then
  GCLOUD="$HOME/google-cloud-sdk/bin/gcloud"
  [ -x "$GCLOUD" ] || GCLOUD=gcloud
fi
TOKEN="$("$GCLOUD" auth print-access-token)" \
  || { echo "auth-settings: no token from $GCLOUD. Sign in with: gcloud auth login --update-adc" >&2; exit 1; }

# call METHOD URL [BODY] sets STATUS and RESPONSE. The token reaches curl on its standard input (-H @-), never on its
# command line. Not through <(...): Git Bash's curl is a Windows program and can't open that /dev/fd path.
call() {
  local raw
  if [ $# -ge 3 ]; then
    raw="$(printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -sS -X "$1" -H @- -H "X-Goog-User-Project: $PROJECT" \
      -H 'Content-Type: application/json' --data-binary "$3" -w '\n%{http_code}' "$2")" || return 1
  else
    raw="$(printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -sS -X "$1" -H @- -H "X-Goog-User-Project: $PROJECT" \
      -w '\n%{http_code}' "$2")" || return 1
  fi
  STATUS="${raw##*"$NL"}"
  RESPONSE="${raw%"$NL"*}"
}

# Google's error status and message only: a successful answer is the whole config.
http_error() {
  local why
  why="$(printf '%s' "$RESPONSE" | node -e '
    let e = {};
    try { e = JSON.parse(require("fs").readFileSync(0, "utf8")).error || {}; } catch {}
    process.stdout.write([e.status, e.message].filter(Boolean).join(": ").slice(0, 400));')" || why=''
  echo "auth-settings: $1 failed: HTTP $STATUS${why:+ $why}" >&2
}

get() {
  call GET "$BASE" || return 1
  [ "$STATUS" = 200 ] || { http_error 'reading the config'; return 1; }
  CONFIG="$RESPONSE"
}

patch() {
  call PATCH "$BASE?updateMask=$1" "$2" || return 1
  [ "$STATUS" = 200 ] || { http_error "changing $1"; return 1; }
}

# field PATH [DEFAULT]: one value of the config as JSON, DEFAULT (JSON) when it is missing.
field() {
  printf '%s' "$CONFIG" | node -e '
    const [path, fallback] = process.argv.slice(1);
    const withheld = new Set(["apiKey", "signerKey", "saltSeparator"]);
    const config = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const value = path.split(".").reduce((o, k) => (o == null ? o : o[k]), config);
    const out = value ?? (fallback ? JSON.parse(fallback) : null);
    process.stdout.write(JSON.stringify(out, (k, v) => (withheld.has(k) ? "(withheld)" : v)));' "$1" "${2-}"
}

# The wanted policy: enforced at sign-up, 8 to 4096 characters, no character classes, existing sign-ins never blocked.
policy_ok() {
  printf '%s' "$CONFIG" | node -e '
    const p = JSON.parse(require("fs").readFileSync(0, "utf8")).passwordPolicyConfig || {};
    const o = ((p.passwordPolicyVersions || [])[0] || {}).customStrengthOptions || {};
    const max = o.maxPasswordLength === undefined ? 4096 : Number(o.maxPasswordLength);
    process.exit(p.passwordPolicyEnforcementState === "ENFORCE" && !p.forceUpgradeOnSignin
      && Number(o.minPasswordLength) === 8 && max >= 4096
      && !o.containsLowercaseCharacter && !o.containsUppercaseCharacter
      && !o.containsNumericCharacter && !o.containsNonAlphanumericCharacter ? 0 : 1);'
}

get
changed=0

# 1. Email enumeration protection (on since setup; switched back on if someone turned it off).
if [ "$(field emailPrivacyConfig.enableImprovedEmailPrivacy false)" != true ]; then
  patch emailPrivacyConfig '{"emailPrivacyConfig":{"enableImprovedEmailPrivacy":true}}'
  echo "Turned email enumeration protection on."
  changed=1
fi

# 2. Password policy: 8+ characters enforced at sign-up; existing sign-ins are never blocked.
if ! policy_ok; then
  if patch passwordPolicyConfig "$POLICY_V2"; then
    echo "Set the password policy (v2 discovery body)."
  else
    echo "Trying the how-to page's body instead." >&2
    patch passwordPolicyConfig "$POLICY_DOC"
    echo "Set the password policy (how-to page body)."
  fi
  changed=1
fi

if [ "$changed" = 1 ]; then
  get
fi
ok=1
[ "$(field emailPrivacyConfig.enableImprovedEmailPrivacy false)" = true ] \
  || { echo "auth-settings: enumeration protection is still off." >&2; ok=0; }
policy_ok || { echo "auth-settings: the password policy isn't the wanted one (see below)." >&2; ok=0; }
if [ "$(field recaptchaConfig.emailPasswordEnforcementState '"OFF"')" = '"ENFORCE"' ]; then
  echo "WARNING: reCAPTCHA is enforced for email and password. The desktop app can't pass it, so sign-up and" >&2
  echo "         sign-in fail. Set it back to OFF (ai_memory/15_accounts_and_sync.md, 2.5)." >&2
fi

echo "enumeration protection : $(field emailPrivacyConfig.enableImprovedEmailPrivacy false)"
echo "password policy        : $(field passwordPolicyConfig)"
echo "sign-up disabled       : $(field client.permissions.disabledUserSignup false)"
echo "email link domain      : $(field client.firebaseSubdomain)   callbackUri: $(field notification.sendEmail.callbackUri)"
[ "$ok" = 1 ] || exit 1
