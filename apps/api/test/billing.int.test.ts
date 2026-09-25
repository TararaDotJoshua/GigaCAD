import { randomUUID } from 'node:crypto';
import { getPlan } from '@gigacad/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvalidWebhookError, type Payments, type SubscriptionSnapshot } from '../src/payments.js';
import { client, createHarness, createUser, sha256, upload, type Client, type Harness, type TestUser } from './helpers.js';

/** Stands in for Stripe: subscriptions live in a map, and webhooks name the subscription they're about. */
class FakePayments implements Payments {
  readonly subscriptions = new Map<string, SubscriptionSnapshot>();
  readonly customers: { userId: string; email: string | null }[] = [];
  checkouts: { customerId: string; priceLookupKey: string }[] = [];

  async createCustomer(input: { userId: string; email: string | null }) {
    this.customers.push(input);
    return `cus_${this.customers.length}_${randomUUID().slice(0, 6)}`;
  }
  async createCheckout(input: { customerId: string; priceLookupKey: string }) {
    this.checkouts.push(input);
    return `https://checkout.example/${input.priceLookupKey}`;
  }
  async createPortal(input: { customerId: string }) {
    return `https://portal.example/${input.customerId}`;
  }
  subscriptionIdFromWebhook(rawBody: Buffer, signature: string) {
    if (signature !== 'valid') throw new InvalidWebhookError('Invalid signature');
    return (JSON.parse(rawBody.toString('utf8')) as { subscription?: string }).subscription ?? null;
  }
  async getSubscription(id: string) {
    return this.subscriptions.get(id) ?? null;
  }
}

let harness: Harness;
let unpaid: Harness;
const payments = new FakePayments();
let owner: TestUser;
let helper: TestUser;
let asOwner: Client;
let asHelper: Client;

beforeAll(async () => {
  harness = await createHarness({ payments });
  unpaid = await createHarness();
  [owner, helper] = await Promise.all([createUser(harness, 'payer'), createUser(harness, 'helper')]);
  asOwner = client(harness, owner);
  asHelper = client(harness, helper);
});

afterAll(async () => {
  await harness?.close();
  await unpaid?.close();
});

async function newProject(api: Client) {
  const response = await api.post('/v1/projects', { slug: `p-${randomUUID().slice(0, 8)}`, name: 'P' });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

function webhook(subscription: string, signature = 'valid') {
  return harness.app.inject({
    method: 'POST',
    url: '/v1/billing/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    payload: JSON.stringify({ subscription }),
  });
}

describe('storage limits', () => {
  it('counts each file version once across the projects an account owns', async () => {
    const user = await createUser(harness, 'counter');
    const api = client(harness, user);
    const [a, b] = [await newProject(api), await newProject(api)];
    await upload(harness, api, a, ['twelve bytes']);
    await upload(harness, api, b, ['twelve bytes', 'four']);
    const billing = await api.get('/v1/me/billing');
    expect(billing.status).toBe(200);
    expect(billing.body).toMatchObject({ plan: 'free', usedBytes: 16, quotaBytes: getPlan('free').storageBytes, billingEnabled: true, canManage: false });
  });

  it("refuses uploads past the project owner's limit, even from a contributor", async () => {
    const projectId = await newProject(asOwner);
    await asOwner.put(`/v1/projects/${projectId}/members`, { handle: helper.handle, role: 'contributor' });
    await upload(harness, asOwner, projectId, ['0123456789']);
    await harness.sql`update profiles set quota_bytes = 15 where id = ${owner.id}`;

    // A file the owner already stores costs nothing.
    const again = await asHelper.post(`/v1/projects/${projectId}/blobs/uploads`, { blobs: [{ sha256: sha256('0123456789'), size: 10 }] });
    expect(again.status).toBe(200);

    const tooMuch = await asHelper.post(`/v1/projects/${projectId}/blobs/uploads`, { blobs: [{ sha256: sha256('six more'), size: 8 }] });
    expect(tooMuch.status).toBe(403);
    expect(tooMuch.body.error.code).toBe('storage_full');
    expect(tooMuch.body.error.message).toContain(`@${owner.handle} is out of storage`);

    // The helper's own quota is untouched.
    const fits = await asHelper.post(`/v1/projects/${projectId}/blobs/uploads`, { blobs: [{ sha256: sha256('four'), size: 4 }] });
    expect(fits.status).toBe(200);
  });

  it('refuses at completion when parallel uploads together pass the limit', async () => {
    const user = await createUser(harness, 'racer');
    const api = client(harness, user);
    const projectId = await newProject(api);
    await harness.sql`update profiles set quota_bytes = 10 where id = ${user.id}`;
    const first = await api.post(`/v1/projects/${projectId}/blobs/uploads`, { blobs: [{ sha256: sha256('seven 1'), size: 7 }] });
    const second = await api.post(`/v1/projects/${projectId}/blobs/uploads`, { blobs: [{ sha256: sha256('seven 2'), size: 7 }] });
    harness.storage.put(first.body.uploads[0].url, 'seven 1');
    harness.storage.put(second.body.uploads[0].url, 'seven 2');
    const done = await api.post(`/v1/projects/${projectId}/blobs/complete`, {
      uploadIds: [first.body.uploads[0].uploadId, second.body.uploads[0].uploadId],
    });
    expect(done.body.completed).toHaveLength(1);
    expect(done.body.failed).toEqual([{ uploadId: second.body.uploads[0].uploadId, reason: 'storage_full' }]);
  });
});

describe('billing', () => {
  it('is unavailable without payment keys', async () => {
    const api = client(unpaid, owner);
    expect((await api.get('/v1/me/billing')).body.billingEnabled).toBe(false);
    const checkout = await api.post('/v1/billing/checkout', { plan: 'maker', interval: 'monthly' });
    expect(checkout.status).toBe(503);
  });

  it('upgrades through checkout and the subscription webhook, then back to free when it ends', async () => {
    const user = await createUser(harness, 'upgrader');
    const api = client(harness, user);
    expect((await api.post('/v1/billing/checkout', { plan: 'free', interval: 'monthly' })).status).toBe(400);
    expect((await api.post('/v1/billing/portal')).status).toBe(409);

    const checkout = await api.post('/v1/billing/checkout', { plan: 'builder', interval: 'yearly' });
    expect(checkout.status).toBe(200);
    expect(checkout.body.url).toBe('https://checkout.example/gigacad_builder_yearly');
    const customerId = payments.checkouts.at(-1)!.customerId;
    expect(payments.customers.at(-1)!.email).toMatch(/@test\.gigacad\.site$/);

    const subscription: SubscriptionSnapshot = {
      id: `sub_${randomUUID().slice(0, 8)}`,
      customerId,
      status: 'active',
      priceLookupKey: 'gigacad_builder_yearly',
      currentPeriodEnd: new Date('2027-09-25T00:00:00Z'),
      cancelAtPeriodEnd: false,
      userId: user.id,
    };
    payments.subscriptions.set(subscription.id, subscription);
    expect((await webhook(subscription.id, 'forged')).statusCode).toBe(400);
    expect((await webhook(subscription.id)).statusCode).toBe(200);

    let billing = (await api.get('/v1/me/billing')).body;
    expect(billing).toMatchObject({ plan: 'builder', interval: 'yearly', status: 'active', quotaBytes: getPlan('builder').storageBytes, canManage: true });
    expect(new Date(billing.currentPeriodEnd).toISOString()).toBe('2027-09-25T00:00:00.000Z');

    // Paying already: checkout sends them to the portal instead of a second subscription.
    expect((await api.post('/v1/billing/checkout', { plan: 'studio', interval: 'monthly' })).body.url).toBe(`https://portal.example/${customerId}`);

    // Canceling at the period end keeps the plan until then.
    payments.subscriptions.set(subscription.id, { ...subscription, cancelAtPeriodEnd: true });
    await webhook(subscription.id);
    expect((await api.get('/v1/me/billing')).body).toMatchObject({ plan: 'builder', cancelAtPeriodEnd: true });

    payments.subscriptions.set(subscription.id, { ...subscription, status: 'canceled' });
    await webhook(subscription.id);
    billing = (await api.get('/v1/me/billing')).body;
    expect(billing).toMatchObject({ plan: 'free', interval: null, status: 'canceled', quotaBytes: getPlan('free').storageBytes });
  });

  it("ignores an old subscription ending after its replacement started", async () => {
    const user = await createUser(harness, 'switcher');
    const api = client(harness, user);
    await api.post('/v1/billing/checkout', { plan: 'maker', interval: 'monthly' });
    const customerId = payments.checkouts.at(-1)!.customerId;
    const base = { customerId, currentPeriodEnd: null, cancelAtPeriodEnd: false, userId: user.id };
    const old = { ...base, id: `sub_old_${randomUUID().slice(0, 6)}`, status: 'active', priceLookupKey: 'gigacad_maker_monthly' };
    const replacement = { ...base, id: `sub_new_${randomUUID().slice(0, 6)}`, status: 'active', priceLookupKey: 'gigacad_studio_monthly' };
    payments.subscriptions.set(old.id, old);
    await webhook(old.id);
    payments.subscriptions.set(replacement.id, replacement);
    await webhook(replacement.id);
    payments.subscriptions.set(old.id, { ...old, status: 'canceled' });
    await webhook(old.id);
    expect((await api.get('/v1/me/billing')).body).toMatchObject({ plan: 'studio', quotaBytes: getPlan('studio').storageBytes });
  });

  it('hides the storage limit from the public profile', async () => {
    const [row] = await harness.sql<{ allowed: boolean }[]>`select has_column_privilege('anon', 'profiles', 'quota_bytes', 'select') as allowed`;
    expect(row!.allowed).toBe(false);
  });
});
