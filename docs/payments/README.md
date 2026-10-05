# Payments

GigaCAD charges for storage only. Every plan has every feature and unlimited collaborators. Paid plans are live and on sale.

## Plans

The source of truth is `packages/core/src/plans.ts`. The API, the pricing page, the billing page, and the Stripe setup script all read it.

| Plan | Monthly | Storage |
|---|---|---|
| Free | $0 | 5 GB |
| Maker | $6 | 25 GB |
| Builder | $15 | 100 GB |
| Workshop | $39 | 500 GB |
| Studio | $99 | 2 TB |

Yearly costs 10× the monthly price. Prices don't include tax.

## Storage limits

- The **project owner's** plan covers a project, including uploads from collaborators.
- An upload that would go over the limit fails with `storage_full`. Nothing becomes unreadable; people can still browse and download.
- `profiles.quota_bytes` holds the current limit and `storage_used_bytes(owner)` measures use ([data/](../data/README.md#storage-accounting)).

## Stripe

GigaCAD sells through Stripe Checkout with **Managed Payments**: Stripe (through Link) is the merchant of record and handles sales tax, VAT, GST, fraud, disputes, and refunds. Products use tax code `txcd_10103000` (SaaS, personal use). One-off invoices aren't available with Managed Payments.

| Piece | Where |
|---|---|
| Stripe client | `apps/api/src/payments.ts` (`createStripePayments`) |
| Billing logic | `apps/api/src/services/billing.ts` |
| Routes | `POST /v1/billing/checkout`, `POST /v1/billing/portal`, `POST /v1/billing/webhook`, `GET /v1/me/billing` |
| Account record | `billing_accounts`: plan, interval, Stripe customer and subscription, status, period end, cancel at period end |
| Catalog setup | `pnpm --filter @gigacad/api stripe:setup <api url>` creates the products, monthly and yearly prices (lookup keys like `gigacad_maker_yearly`), the customer portal, and the webhook. Safe to re-run |
| Web | `/pricing` (`components/PricingPlans.tsx`) and Account → Plan and storage (`settings/billing`, `components/product/BillingPlans.tsx`) |

### How a purchase works

1. The person picks a plan. The API creates a Checkout session and returns its URL.
2. Stripe handles payment and tax, then returns to the billing page.
3. Webhooks (checkout completed or async payment, subscription created, updated, deleted, paused, or resumed, invoice paid or failed) call `syncSubscription`. It reads the subscription, maps its price lookup key to a plan, and updates `billing_accounts` and `profiles.quota_bytes` in one transaction.
4. Plan changes and cancellations happen in the Stripe customer portal and sync back the same way.

`active`, `trialing`, and `past_due` keep a paid plan, so Stripe can retry a failed payment. Anything else drops the account to Free. An old subscription ending doesn't touch the one that replaced it. To give someone a plan by hand, update `billing_accounts.plan` and `profiles.quota_bytes` together; the next webhook for that account overwrites it.

### Configuration

- API: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (both or neither; without them everyone is on Free), and `STRIPE_MANAGED_PAYMENTS` (default `true`).
- Web: `NEXT_PUBLIC_BILLING_ENABLED=true` opens paid plans on `/pricing`. While it's `false`, they show "Opens soon".
- Accounts: live `acct_1UJdwnROVPYVDZkN`, and sandbox `acct_1UJdx3EuhsFYXEuz` for development. Keys live only in Railway and the ignored `apps/api/.env.stripe`.
- Use restricted keys (`rk_`), one per job. The permissions are in [deployment step 10](../operations/deployment.md#10-paid-plans-stripe).

Still owed by the owner: a support email in Stripe, deleting the sandbox webhook that points at production, and moving the API to a restricted live key ([roadmap](../product/roadmap.md)).

## Testing

In the sandbox, use card `4242 4242 4242 4242` with a US address, and check that Checkout shows tax. `apps/api/src/payments.test.ts` and `apps/api/test/billing.int.test.ts` cover the code.
