# Auth

Sign-in uses Supabase Auth. The API checks every request itself, and project roles decide what each person can do.

## Signing in on the web

- Email and password with a confirmation email, plus password recovery. Pages: `app/(auth)/login`, `signup`, `forgot-password`, `reset-password`.
- Email links open `app/auth/confirm`, which shows a confirmation screen and only uses the token after the person clicks Continue. OAuth returns to `/auth/callback`.
- GitHub and Google buttons appear when `NEXT_PUBLIC_GITHUB_AUTH_ENABLED` and `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` are `true`. The OAuth apps aren't created yet; `scripts/enable-oauth.sh` turns them on once they are ([roadmap](../product/roadmap.md)).
- Session cookies come from `@supabase/ssr` (`lib/supabase/`). `proxy.ts` refreshes the session on each request and sends signed-out visitors on private pages to `/login?next=…`.
- A new account picks its public handle on `/app` before it can create projects.
- Emails go through Resend's SMTP (`send.gigacad.site`) using the templates in `supabase/templates/`. Hosted Supabase doesn't read `config.toml`, so the templates were uploaded by hand.

## Signing in from the CLI and desktop app

A device-code flow, like GitHub's (`services/device.ts`):

1. The client calls `POST /v1/auth/device/code` and shows an 8-character code such as `ABCD-EF23`.
2. The person opens `app.gigacad.site/device`, signs in, checks the code, and approves.
3. The client polls `POST /v1/auth/device/token` every 5 seconds and gets a long-lived **device token** (`gcd_…`). Codes expire after 10 minutes.

Only a SHA-256 hash of each token is stored (`device_tokens`). People can list and revoke tokens through `/v1/me/tokens`. The CLI keeps its token in `~/.config/giga/config.json` (`%APPDATA%\giga` on Windows, or `GIGA_CONFIG_DIR`), and the desktop app shares it.

## How the API checks a request

`createAuthenticator` in `apps/api/src/auth.ts` reads the `Authorization: Bearer` header:

- A `gcd_` token is looked up by hash and must not be revoked.
- Anything else must be a Supabase session JWT, verified against the project's JWKS with issuer `<supabase>/auth/v1` and audience `authenticated`. `SUPABASE_JWT_SECRET` is only for local stacks that still sign with HS256. Leave it unset in production.

The result is a caller (`userId`, and `via: 'session' | 'device'`), or none for signed-out reads of public projects.

## Roles

Each project member has one role, from lowest to highest: **viewer**, **contributor**, **maintainer**, **owner** (`services/access.ts`).

| Role | Can |
|---|---|
| viewer | Read the project |
| contributor | Branch, check out, commit, open release requests, edit root files and tags |
| maintainer | Change project settings, force-release locks, archive branches, and manage members and approval rules |
| owner | Everything, including deleting the project. The owner's storage plan pays for the project |

`projectAccess` loads a project and the caller's role in one query. Private projects return 404 to outsiders, so they look like they don't exist. `requireProjectRole` returns 403 when the role is too low. Who may approve a release request is set separately in `approval_rules`.

## Row-level security

Every table has RLS on. Policies only allow `select`, through `can_read_project(project_id)` (a member, or the project is public) and its private-schema twin. Profiles are readable by everyone. Favorites are visible only to their owner. Writes never go through RLS, because only the API writes. Security-definer functions are locked down in `20260925012709_harden_security_definer_functions.sql`.

## Secrets

Never put a Supabase secret or service-role key in a `NEXT_PUBLIC_` variable. The web app only gets the publishable key. Local secret files (`apps/api/.env*`, `apps/web/.env.local`, `supabase/.env.oauth`) are ignored by git, and `scripts/check-secrets.sh` fails CI if a key shows up in the repo.
