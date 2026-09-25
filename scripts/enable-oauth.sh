#!/usr/bin/env bash
# Turns on GitHub and/or Google sign-in for the production Supabase project, then shows
# the buttons in the web app. Reads the OAuth apps' credentials from the ignored
# supabase/.env.oauth:
#
#   GITHUB_CLIENT_ID=…      GITHUB_CLIENT_SECRET=…
#   GOOGLE_CLIENT_ID=…      GOOGLE_CLIENT_SECRET=…
#
# Either pair may be left out. Needs a logged-in Supabase CLI (its token is read from
# the macOS keychain), jq, and gh.
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-gaxicutwgacxekqcsnpg}"
ENV_FILE="$(dirname "$0")/../supabase/.env.oauth"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a

token="${SUPABASE_ACCESS_TOKEN:-$(security find-generic-password -s 'Supabase CLI' -a supabase -w)}"
token="${token#go-keyring-base64:}"
[[ "$token" == sbp_* ]] || token="$(printf '%s' "$token" | base64 -d)"

body="{}"
providers=()
if [[ -n "${GITHUB_CLIENT_ID:-}" && -n "${GITHUB_CLIENT_SECRET:-}" ]]; then
  body=$(jq -c --arg id "$GITHUB_CLIENT_ID" --arg secret "$GITHUB_CLIENT_SECRET" \
    '. + {external_github_enabled: true, external_github_client_id: $id, external_github_secret: $secret}' <<<"$body")
  providers+=(GITHUB)
fi
if [[ -n "${GOOGLE_CLIENT_ID:-}" && -n "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  body=$(jq -c --arg id "$GOOGLE_CLIENT_ID" --arg secret "$GOOGLE_CLIENT_SECRET" \
    '. + {external_google_enabled: true, external_google_client_id: $id, external_google_secret: $secret}' <<<"$body")
  providers+=(GOOGLE)
fi
[[ ${#providers[@]} -gt 0 ]] || { echo "No complete credential pairs in $ENV_FILE" >&2; exit 1; }

status=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "authorization: Bearer $token" -H 'content-type: application/json' --data "$body")
[[ "$status" == 200 ]] || { echo "Supabase returned HTTP $status" >&2; exit 1; }

for provider in "${providers[@]}"; do
  gh variable set "NEXT_PUBLIC_${provider}_AUTH_ENABLED" --body true
  echo "Enabled $(tr '[:upper:]' '[:lower:]' <<<"$provider") sign-in."
done
# The flags are compiled into the web app, so it needs a fresh build.
gh workflow run deploy-web.yml --ref main
echo "Deploying the web app with the sign-in buttons: gh run watch"
