# UI

The web app in `apps/web`, and the desktop app's window in `clients/desktop/src/renderer`. How things should look is in [design/](../design/README.md). This page covers how the UI code is organized.

Plans in this folder:
- [file-directory-plan.md](file-directory-plan.md): the project file directory. Shipped in #34; a few questions are still open.
- [web-ux-plan.md](web-ux-plan.md): the 8-phase fix plan from the 2026-09-30 audit. Phases 1–6 are merged (#52–#55); phases 7 and 8 are in #58 and #59.

## One Next.js app, two sites

`apps/web` is a single Next.js app on Cloudflare Workers (through OpenNext). It decides which site to serve from the request's host:

- `gigacad.site`: marketing, docs, pricing, download, and legal pages.
- `app.gigacad.site`: the product, sign-in, and `/device` approval.

`lib/hosts.ts` holds the rules (`routeRequest`), and `proxy.ts` applies them and refreshes the Supabase session. On the marketing host, product and sign-in paths redirect to the app host; on the app host, `/` is the dashboard and marketing paths redirect back. When both URLs share a host, as in local development, nothing is split.

## Route groups (`apps/web/app`)

| Group | Pages |
|---|---|
| `(marketing)` | Home, `docs` and `docs/[slug]`, `download`, `pricing`, `privacy`, `terms`. Docs content is in `docs/content.tsx`; unwritten pages show dashed `.doc-pending` boxes |
| `(auth)` | `login`, `signup`, `forgot-password`, `reset-password`, `device` |
| `auth` | `auth/confirm` (email links) and the OAuth callback |
| `(product)/(account)` | `app` (dashboard), `new` (new project), `settings` (account), `settings/billing` |
| `(product)/explore` | Public projects |
| `(product)/[owner]` | Profile page |
| `(product)/[owner]/[project]` | Project root, `tree/[...path]`, `entries/[entryId]`, `branches`, `commits/[id]`, `release-requests`, `releases`, `settings`, `fork` |

`(product)/actions.ts` holds the server actions; `(product)/product.css` holds the product styles.

## How pages get data

- Server components call the API through `lib/api.ts` (`apiRequest`) and `lib/product.ts`, passing the signed-in user's Supabase access token (`lib/session.ts`). The web app doesn't query the database directly.
- Live updates: `components/product/LiveRefresh.tsx` subscribes to Supabase Realtime on `project_events` for the open project and refreshes the page. It calls `realtime.setAuth` first so private projects' events get through row-level security.
- Browser uploads (`lib/upload.ts`) hash the file, PUT it straight to R2 through a presigned URL, and then complete the upload through a server action. The browser limit is 2 GB.
- 3D previews (`lib/viewer.ts`, `lib/preview.ts`) use three.js. STEP and IGES load through `occt-import-js`, which `apps/web/scripts/vendor-occt.mjs` copies into `public/vendor/occt` before dev and build.

## Components

| Where | What |
|---|---|
| `components/` | Shared and marketing: `SiteChrome` (header and footer), `site.ts` (site URLs), `PartArt` in `parts.tsx` (the generated isometric line art), `icons.tsx`, `Logo.tsx`, `DiffPickDemo` (the working demo on the home page), `BranchDiagram`, `PricingPlans`, `AuthForm`, `DeviceApproval`, `LegalPage` |
| `components/product/` | Product UI: `Shell` and `SidebarNav`, `ProjectDirectory` (the file table), `UploadFiles`, `EntryMenu` (right-click menu), `TagPicker`, `PickEditor` (diff pick), `ActivityList`, `ContributionGraph`, `BillingPlans`, `LiveRefresh`, and smaller pieces |
| `lib/` | `hosts`, `session`, `api`, `product` (reads), `describe` (activity sentences and state treatments), `picks`, `paths`, `readme`, `return-path`, `messages`, `upload`, `viewer`, `preview`, `supabase/` clients |

## The desktop app's window

`clients/desktop/src/renderer` is a React app built with Vite. It reuses the web app's icons and logo directly from `apps/web/components` (`renderer/icons.ts`), and follows the same design system. It talks to the Electron main process through the preload bridge (`src/preload`). See [clients/](../clients/README.md).

## Tests

- Unit tests next to the code (`lib/*.test.ts`), run by `pnpm test`.
- Playwright end-to-end tests in `apps/web/e2e/*.e2e.ts`: the release flow, live refresh, the directory, and page statuses. Run with `pnpm --filter @gigacad/web e2e` against a local stack. Required in CI (`e2e`).
