import { formatBytes, getPlan, parsePriceLookupKey, priceLookupKey, type BillingInterval, type PlanId } from '@gigacad/core';
import type { Db, Sql } from '../db.js';
import { conflict, HttpError } from '../errors.js';
import type { Payments } from '../payments.js';

/** Stripe statuses that keep a paid plan. past_due keeps it while Stripe retries the payment. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export interface BillingView {
  readonly plan: PlanId;
  readonly interval: BillingInterval | null;
  readonly status: string | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly usedBytes: number;
  readonly quotaBytes: number;
  /** False until the API has payment keys; the web app then hides upgrade buttons. */
  readonly billingEnabled: boolean;
  /** Has a payment account, so the billing portal can open. */
  readonly canManage: boolean;
}

export async function getBilling(sql: Sql, userId: string, billingEnabled: boolean): Promise<BillingView> {
  const [row] = await sql<Omit<BillingView, 'billingEnabled'>[]>`
    select coalesce(b.plan, 'free') as plan, b.interval, b.subscription_status as status, b.current_period_end,
      coalesce(b.cancel_at_period_end, false) as cancel_at_period_end,
      storage_used_bytes(p.id)::float8 as used_bytes, p.quota_bytes::float8 as quota_bytes,
      b.stripe_customer_id is not null as can_manage
    from profiles p left join billing_accounts b on b.user_id = p.id
    where p.id = ${userId}
  `;
  return { ...row!, billingEnabled };
}

/**
 * Refuses to add file data to an owner's projects past the owner's storage limit.
 * Blobs the owner already stores in any of their projects cost nothing.
 */
export async function requireStorageFor(db: Db, ownerId: string, blobs: readonly { sha256: string; size: number }[]): Promise<void> {
  if (blobs.length === 0) return;
  const stored = await db<{ sha256: string }[]>`
    select distinct pb.sha256 from project_blobs pb join projects p on p.id = pb.project_id
    where p.owner_id = ${ownerId} and p.deleted_at is null and pb.sha256 = any(${blobs.map((blob) => blob.sha256)}::text[])
  `;
  const have = new Set(stored.map((row) => row.sha256));
  const adding = blobs.filter((blob) => !have.has(blob.sha256)).reduce((total, blob) => total + blob.size, 0);
  if (adding === 0) return;
  const [account] = await db<{ handle: string; quotaBytes: number; usedBytes: number }[]>`
    select handle, quota_bytes::float8 as quota_bytes, storage_used_bytes(id)::float8 as used_bytes from profiles where id = ${ownerId}
  `;
  if (!account || account.usedBytes + adding <= account.quotaBytes) return;
  throw new HttpError(
    403,
    'storage_full',
    `@${account.handle} is out of storage: ${formatBytes(account.usedBytes)} of ${formatBytes(account.quotaBytes)} used, and this needs ${formatBytes(adding)} more. Delete projects or upgrade the plan in Account settings on gigacad.site.`,
    { usedBytes: account.usedBytes, quotaBytes: account.quotaBytes, neededBytes: adding },
  );
}

async function billingCustomer(sql: Sql, payments: Payments, userId: string) {
  await sql`insert into billing_accounts (user_id) values (${userId}) on conflict do nothing`;
  const [account] = await sql<{ stripeCustomerId: string | null; stripeSubscriptionId: string | null; subscriptionStatus: string | null }[]>`
    select stripe_customer_id, stripe_subscription_id, subscription_status from billing_accounts where user_id = ${userId}
  `;
  if (account!.stripeCustomerId) return { ...account!, customerId: account!.stripeCustomerId };
  const [user] = await sql<{ email: string | null }[]>`select email from auth.users where id = ${userId}`;
  const customerId = await payments.createCustomer({ userId, email: user?.email ?? null });
  // Another request may have created one first; keep whichever landed.
  const [saved] = await sql<{ stripeCustomerId: string }[]>`
    update billing_accounts set stripe_customer_id = coalesce(stripe_customer_id, ${customerId}), updated_at = now()
    where user_id = ${userId} returning stripe_customer_id
  `;
  return { ...account!, customerId: saved!.stripeCustomerId };
}

/** Where to send someone who picked a paid plan: Stripe Checkout, or the portal if they already pay. */
export async function startCheckout(
  sql: Sql,
  payments: Payments,
  userId: string,
  plan: Exclude<PlanId, 'free'>,
  interval: BillingInterval,
  webOrigin: string,
): Promise<{ url: string }> {
  const account = await billingCustomer(sql, payments, userId);
  const returnUrl = `${webOrigin}/settings/billing`;
  if (account.stripeSubscriptionId && LIVE_STATUSES.has(account.subscriptionStatus ?? '')) {
    return { url: await payments.createPortal({ customerId: account.customerId, returnUrl }) };
  }
  const url = await payments.createCheckout({
    customerId: account.customerId,
    userId,
    priceLookupKey: priceLookupKey(plan, interval),
    successUrl: `${returnUrl}?checkout=done`,
    cancelUrl: returnUrl,
  });
  return { url };
}

export async function openPortal(sql: Sql, payments: Payments, userId: string, webOrigin: string): Promise<{ url: string }> {
  const [account] = await sql<{ stripeCustomerId: string | null }[]>`select stripe_customer_id from billing_accounts where user_id = ${userId}`;
  if (!account?.stripeCustomerId) throw conflict('no_billing_account', 'Choose a paid plan first');
  return { url: await payments.createPortal({ customerId: account.stripeCustomerId, returnUrl: `${webOrigin}/settings/billing` }) };
}

/**
 * Brings an account's plan in line with a subscription. Reads the subscription fresh from
 * the provider, so webhooks arriving late or twice do no harm.
 */
export async function syncSubscription(sql: Sql, payments: Payments, subscriptionId: string): Promise<void> {
  const subscription = await payments.getSubscription(subscriptionId);
  if (!subscription) return;
  await sql.begin(async (tx) => {
    const [account] = await tx<{ userId: string; stripeSubscriptionId: string | null }[]>`
      select user_id, stripe_subscription_id from billing_accounts
      where stripe_customer_id = ${subscription.customerId} or (${subscription.userId}::uuid is not null and user_id = ${subscription.userId}::uuid)
      order by (stripe_customer_id = ${subscription.customerId}) desc
      limit 1 for update
    `;
    if (!account) return;

    const price = parsePriceLookupKey(subscription.priceLookupKey);
    const live = LIVE_STATUSES.has(subscription.status) && price !== null;
    // An old subscription ending doesn't touch the one that replaced it.
    if (!live && account.stripeSubscriptionId && account.stripeSubscriptionId !== subscription.id) return;

    const plan: PlanId = live ? price.plan : 'free';
    await tx`
      update billing_accounts set
        plan = ${plan},
        interval = ${live ? price.interval : null},
        stripe_customer_id = coalesce(stripe_customer_id, ${subscription.customerId}),
        stripe_subscription_id = ${live ? subscription.id : null},
        subscription_status = ${subscription.status},
        current_period_end = ${live ? subscription.currentPeriodEnd : null},
        cancel_at_period_end = ${live && subscription.cancelAtPeriodEnd},
        updated_at = now()
      where user_id = ${account.userId}
    `;
    await tx`update profiles set quota_bytes = ${getPlan(plan).storageBytes} where id = ${account.userId}`;
  });
}
