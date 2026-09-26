#!/usr/bin/env bash
# Checks the HTTP status of every kind of page on a deployed GigaCAD: marketing, every
# docs page, sign-in, Explore and a user page, the signed-out product redirect, the host
# split, and the API.
# Status codes only, never page content: a 500 once hid behind a page that still matched.
#
#   scripts/check-site.sh            # production
#   SITE=… APP=… API=… scripts/check-site.sh
set -uo pipefail

SITE="${SITE:-https://gigacad.site}"
APP="${APP:-https://app.gigacad.site}"
API="${API:-https://api.gigacad.site}"
# A user page to check. Handles can be renamed, so take the owner of a public project from Explore.
PROFILE="${PROFILE:-$(curl -s --max-time 20 "$API/v1/explore?sort=recent&limit=1" | grep -o '"ownerHandle":"[^"]*"' | head -1 | cut -d'"' -f4)}"
failed=0

# expect <status> <url> [<redirect prefix>]
expect() {
  local want="$1" url="$2" location="${3:-}" got redirect
  read -r got redirect < <(curl -s -o /dev/null --retry 2 --max-time 20 -w '%{http_code} %{redirect_url}' "$url")
  if [[ "$got" != "$want" || ( -n "$location" && "$redirect" != "$location"* ) ]]; then
    echo "FAIL $url: got $got${redirect:+ -> $redirect}, want $want${location:+ -> $location…}"
    failed=1
  else
    echo "ok   $got $url"
  fi
}

for path in / /docs /download /pricing /privacy /terms; do expect 200 "$SITE$path"; done
docs=$(curl -s --max-time 20 "$SITE/docs" | grep -o 'href="/docs/[^"#]*"' | sed 's/href="//; s/"$//' | sort -u)
if [[ -z "$docs" ]]; then echo "FAIL $SITE/docs links to no docs pages"; failed=1; fi
for path in $docs; do expect 200 "$SITE$path"; done

expect 200 "$APP/login"
expect 200 "$APP/signup"
expect 307 "$APP/" "$APP/login"
expect 200 "$APP/explore"
if [[ -n "$PROFILE" ]]; then
  expect 200 "$APP/$PROFILE"
  expect 200 "$APP/$PROFILE?tab=starred"
else
  echo "skip user page: Explore lists no public projects"
fi
expect 308 "$SITE/login" "$APP/login"
expect 308 "$APP/docs" "$SITE/docs"

expect 200 "$API/health"

exit "$failed"
