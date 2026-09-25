#!/usr/bin/env bash
# Fails if a Stripe key or webhook secret is committed. The repository is public, so a
# leaked key must be rolled at once: https://dashboard.stripe.com/apikeys
set -uo pipefail
if git grep -nIE '(^|[^A-Za-z0-9_])((sk|rk)_(live|test)|whsec)_[A-Za-z0-9]{10,}' -- . ':!pnpm-lock.yaml'; then
  echo "Stripe secret found above. Remove it, roll the key, and keep secrets in Railway or ignored .env files." >&2
  exit 1
fi
echo "No Stripe secrets in tracked files."
