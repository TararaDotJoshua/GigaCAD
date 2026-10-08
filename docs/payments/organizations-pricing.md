# Organization pricing

How organizations pay for GigaCAD, and how billing has to work to support it. Status: **proposed**, 2026-10-08. The four decisions below are settled. Everything else is a recommendation to review.

[The manifesto](../MANIFESTO.md) makes hardware teams the primary customer, and organizations are the next big feature after Windows. Individual accounts keep the storage-only plans in [the payments docs](README.md), unchanged. This page covers only organizations.

## Decided (2026-10-08)

1. **Organizations pay per editor, plus a shared storage pool.** An editor is anyone who can change an organization's projects. Viewers are free and unlimited.
2. **There's no general free organization.** Verified schools, student teams, and nonprofits get the Team plan free. Everyone else can try it with a trial.
3. **Two plans: Team and Business.** Business adds company sign-in (SSO), admin controls, and the audit log export.
4. **Team is $8 per editor per month.** Business is $18.

## The plans

| Plan | Monthly, per editor | Yearly, per editor | Storage per editor, pooled | For |
|---|---|---|---|---|
| Team | $8 | $80 | 50 GB | Startups, labs, and small hardware companies |
| Business | $18 | $180 | 100 GB | Companies that need company sign-in and admin control |

Yearly costs 10× the monthly price, the same as for individuals. Prices don't include tax.

What a bill looks like:

| Organization | Plan | Editors | Per month | Storage |
|---|---|---|---|---|
| Two founders | Team | 2 | $16 | 100 GB |
| Robotics startup | Team | 6 | $48 | 300 GB |
| Hardware company | Business | 15 | $270 | 1.5 TB |

### What each plan includes

**Every organization (Team and Business):**

- Organization-owned projects, private by default.
- Organization roles, teams, and **teams as approvers** in approval rules.
- One bill and one storage pool for every project the organization owns.
- A public organization page for its public projects.
- Unlimited free viewers.
- Every project feature individuals get: branches, release requests, previews, and later the issue tracker, Jira sync, and comments on the model.

**Business adds:**

- **SAML single sign-on**, with sign-in through it optionally required for members.
- **Required two-factor sign-in** for members.
- **Audit log export**: the organization's project events as CSV or JSON, and through the API.
- **Admin policies**: who may create projects, whether projects may be made public, whether projects may be forked outside the organization, and claiming the company's email domain.
- **Priority support** by email.

### Rules for drawing the line

- **Project features are never limited by plan.** A feature that changes how one project works (the tracker, Jira, review comments, BOMs) is on every plan, for individuals too. This keeps "every feature on every plan" true for individuals.
- **Team gets everything a team needs to work together.** Business gets what a *company* needs to control many people: identity, policy, and records. If a six-person team needs something to collaborate, it belongs in Team.

## Who is an editor

An organization pays for one seat per **editor**. A person is an editor if, in any of the organization's projects, they can:

- branch, check out, commit, or open release requests (role **contributor** or higher), or
- approve release requests (named in an approval rule, directly or through a team), or
- they're an organization **owner** or **admin**.

Everyone else is a **viewer**: they can browse, preview, and download, and they'll be able to comment once comments ship. Viewers are free. That includes the manager who checks progress, the machinist who downloads the release, and the customer who reviews a design.

- One person is one seat however many of the organization's projects they work in.
- **Outside collaborators**, people who aren't organization members but are added to one project with write access, need a seat too. Read-only guests stay free.
- Approving needs a seat because an approval decides what goes into main. It's a write to the most protected thing in a project.
- The rule for counting editors lives in `packages/core` (`orgEditors`), so the API, the web app, and tests all count the same way.

### Buying and using seats

The organization buys a **number of seats**, like GitHub. It isn't billed after the fact for whoever happened to be an editor.

- Giving someone editor access uses a free seat. With no free seat, the API refuses with `no_seat` ("All 6 seats are in use. Add a seat or make someone a viewer"), and owners and admins can add a seat right there.
- **Adding seats** takes effect at once, and Stripe charges the prorated difference.
- **Removing seats** takes effect at the next renewal, so there are no credits going back and forth. The organization can't drop below the number of editors it has now.
- The billing page shows seats bought, seats used, and who uses them.

This keeps bills predictable, and nobody gets an invoice they didn't choose.

## Storage

- The pool is **seats × storage per editor**: 6 Team seats give 300 GB. Free viewers add none.
- Every project the organization owns counts against the pool, the same way `storage_used_bytes` counts an individual's projects. A file stored in two of the organization's projects counts once.
- Going over the pool works the same as for individuals: new uploads fail with `storage_full`, and everything stays readable.
- **No storage add-on at launch.** A team that needs more storage than its seats give buys a seat. If teams with few editors and huge libraries keep hitting this, add storage packs later (see open questions).

## Trial, and free for education and nonprofits

### The 14-day trial

- A new organization can start a **14-day trial of Team** for any number of seats. Stripe Checkout collects a card up front and charges at the end unless the trial is canceled. Managed Payments supports trials and sends the trial start and trial ending emails itself.
- One trial per organization and per person who starts it.
- An organization without a plan can still exist: owners can set up its name, members, and teams. It can't create projects until it has a plan or a trial.

### Education and nonprofits

- **Who qualifies:** accredited schools and universities, student teams (FIRST, FSAE, rocketry, robotics, and similar clubs), and registered nonprofits.
- **What they get:** Team, free, up to 50 seats with 50 GB each. A bigger team writes in.
- **How:** a request form in organization settings, checked by hand. An approved request becomes a **grant**: a Team plan with a seat count and an end date, with no Stripe subscription behind it.
- **Grants last a year** and renew on request. An email goes out 30 days before a grant ends. If it ends, the organization becomes read-only (below) until someone renews it or pays.
- Business isn't granted. A school that needs SSO pays the Business price.

## When an organization stops paying

- `past_due` keeps the plan while Stripe retries the payment, the same as for individuals.
- When a subscription or grant ends, the organization becomes **read-only**. Everyone can still browse and download everything, including every release. Nothing new can be uploaded, checked out, or released. Paying again turns writing back on.
- Read-only lasts until someone pays or deletes the organization. GigaCAD never deletes a team's history because a card failed. That follows the manifesto's first rule: history is sacred.

## How it fits with individual plans

- Individual plans are unchanged: storage-only, with unlimited collaborators on personal projects.
- A team *could* share one person's Studio account instead of using an organization. That's allowed. It just has no organization roles, teams, shared ownership, or admin controls. Revisit only if it becomes common.
- **Moving projects into an organization.** A person can transfer a project they own to an organization they're an owner or admin of. The project's storage moves to the organization's pool, and the transfer fails with `storage_full` if the pool can't hold it.
- **Switching from a personal plan.** Someone who moves their work into an organization can cancel their personal plan in the Stripe portal. It stays active until the end of the period they paid for.
- One person's personal plan and their organizations' plans are separate subscriptions on separate Stripe customers.

## Stripe

Organizations reuse the setup in [the payments docs](README.md): Stripe Checkout with **Managed Payments**, the customer portal, and webhooks that read the subscription fresh and sync it.

| Piece | Individuals today | Organizations |
|---|---|---|
| Product tax code | `txcd_10103000`, SaaS personal use | `txcd_10103001`, SaaS business use (eligible for Managed Payments) |
| Price | Flat, quantity 1 | Per unit; **quantity = seats** |
| Lookup keys | `gigacad_maker_monthly` | `gigacad_org_team_monthly`, `gigacad_org_business_yearly` |
| Customer | One per person (`metadata.user_id`) | One per organization (`metadata.org_id`) |
| Synced fields | plan, interval, status, period end | the same, plus **seats** and `trial_end` |

- **Checkout** creates a subscription with `quantity` set to the chosen seats, `subscription_data.trial_period_days: 14` for a trial, and tax ID collection so businesses can add their VAT or tax number to invoices.
- **Seat changes** happen through GigaCAD's billing page, not the portal. The API updates the subscription item's quantity: more seats are prorated right away (`proration_behavior: 'always_invoice'`), and fewer seats take effect at the next renewal. The portal stays for payment methods, invoices, switching monthly and yearly, and canceling.
- **The webhook** maps the price's lookup key to an organization plan and its quantity to seats, then sets the organization's storage limit to seats × storage per editor in the same transaction.
- **Business customers often want an invoice they pay by bank transfer.** Managed Payments doesn't send one-off invoices, so organizations pay by card or Link at launch. If larger customers need invoices, revisit Managed Payments for organizations.

### To check in the sandbox before building

Managed Payments documents trials, updating subscriptions through the API, and the business SaaS tax code. Confirm these in the sandbox:

1. Changing a subscription's quantity with proration works on a Managed Payments subscription.
2. Tax ID collection in Checkout works with Managed Payments, and invoices show the customer's tax ID.
3. A trial that collects a card at Checkout charges correctly when it ends.

## What billing needs from the organization model

The organizations plan, which comes next, decides the full data model. Billing needs the following from it:

- **Organizations own projects and share the handle namespace with people**, so `gigacad.site/acme/rover` works. The recommended shape is an `accounts` table (`id`, `kind` person or organization, `handle`, `quota_bytes`) that `profiles` and `organizations` both extend. `projects.owner_id` and the storage functions then point at accounts, not profiles.
- **`billing_accounts` is keyed by account**, not by user, with new columns: `seats`, `trial_end`, and grant fields (`grant_kind` education or nonprofit, `grant_ends_at`). A new `org_plan_id` enum (`team`, `business`) keeps organization plans apart from individual ones.
- **Organization roles**: owner, admin, member. Owners and admins manage billing.
- **Teams** that approval rules can name, so the editor rule can count approvers who come through a team.
- **A read-only flag** derived from the billing state, checked wherever the API checks for writes today.

## Where the code changes

| Area | Change |
|---|---|
| `packages/core/src/plans.ts` | `ORG_PLANS` (Team, Business: price per editor, storage per editor), `orgPriceLookupKey`, `parseOrgPriceLookupKey`, `orgStorageBytes(plan, seats)` |
| `packages/core` | `orgEditors(...)`, the editor rule, with tests |
| `supabase/migrations` | Accounts, organization billing columns, grants, and `storage_used_bytes` by account |
| `apps/api/src/payments.ts` | Checkout with quantity and trial, `updateSeats`, organization metadata, seats in `SubscriptionSnapshot` |
| `apps/api/src/services/billing.ts` | Organization checkout, seat changes, `syncSubscription` for seats, `requireSeat`, read-only checks, and grant expiry in the background jobs |
| Stripe setup script | Organization products with the business tax code, per-unit prices, and lookup keys |
| `apps/web` | A "For teams" section on `/pricing`, and organization settings → Billing (plan, seats bought and used, storage, trial, grant request) |

## Build order

1. **Core.** Organization plans and the editor rule in `packages/core`, with tests.
2. **Schema.** Arrives with the organizations data model: accounts, organization billing columns, and grants.
3. **Stripe.** Organization products and prices in the setup script, and the three sandbox checks above.
4. **API.** Checkout with seats and a trial, seat changes, webhook sync, seat and read-only enforcement, and grant expiry.
5. **Web.** The pricing page's team section and the organization billing page.
6. **Business features**, one at a time after Team ships: audit log export, admin policies, required two-factor, then SAML SSO (Supabase supports SAML on its Pro plan).

Team should ship with organizations. Business can follow.

## Open questions

- **Storage packs.** Should teams be able to buy storage without seats, for example +500 GB for $X? Recommendation: wait until a real team asks.
- **A minimum for Business?** Many tools require 5 or more seats on their company plan. Recommendation: no minimum at launch.
- **Free reviewers?** A customer who only approves needs a seat under the editor rule. Is that right, or should approve-only access be free? Recommendation: keep it a seat for now, and watch for requests.
- **Price-change notice for organizations.** Same 30 days as the individual terms, which were assumed and not confirmed.
- **Launch discount for early teams**, such as the first year at 50% off through a promotion code. Checkout already allows promotion codes.
