import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createStripePayments, InvalidWebhookError } from './payments.js';

const WEBHOOK_SECRET = 'whsec_unit';

/** Records Stripe API calls and answers them from `routes`. */
function fakeStripe(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; body: URLSearchParams }[] = [];
  const httpClient = Stripe.createFetchHttpClient(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? 'GET', path: url.pathname, body: new URLSearchParams(String(init?.body ?? '')) });
    const body = routes[`${init?.method ?? 'GET'} ${url.pathname}`];
    return new Response(JSON.stringify(body ?? { error: { message: 'unexpected call' } }), { status: body ? 200 : 500, headers: { 'content-type': 'application/json' } });
  });
  return { calls, httpClient };
}

function signed(event: object) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return [Buffer.from(payload), signature] as const;
}

const payments = createStripePayments({ secretKey: 'sk_unit', webhookSecret: WEBHOOK_SECRET, managedPayments: true });

describe('Stripe webhooks', () => {
  it('resolves every plan-changing event to its subscription', () => {
    const event = (type: string, object: object) => signed({ id: 'evt_1', object: 'event', type, data: { object } });
    expect(payments.subscriptionIdFromWebhook(...event('checkout.session.completed', { object: 'checkout.session', subscription: 'sub_a' }))).toBe('sub_a');
    expect(payments.subscriptionIdFromWebhook(...event('checkout.session.async_payment_succeeded', { object: 'checkout.session', subscription: 'sub_b' }))).toBe('sub_b');
    expect(payments.subscriptionIdFromWebhook(...event('customer.subscription.deleted', { object: 'subscription', id: 'sub_c' }))).toBe('sub_c');
    expect(
      payments.subscriptionIdFromWebhook(...event('invoice.payment_failed', { object: 'invoice', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_d' } } })),
    ).toBe('sub_d');
    // A one-off payment with no subscription, and events billing ignores.
    expect(payments.subscriptionIdFromWebhook(...event('checkout.session.completed', { object: 'checkout.session', subscription: null }))).toBeNull();
    expect(payments.subscriptionIdFromWebhook(...event('invoice.paid', { object: 'invoice', parent: null }))).toBeNull();
    expect(payments.subscriptionIdFromWebhook(...event('customer.created', { object: 'customer', id: 'cus_1' }))).toBeNull();
  });

  it('rejects a bad signature', () => {
    const [body] = signed({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
    expect(() => payments.subscriptionIdFromWebhook(body, 't=1,v1=forged')).toThrow(InvalidWebhookError);
  });
});

describe('Stripe Checkout', () => {
  it('starts a Managed Payments subscription for the plan price, tagged for the Dashboard', async () => {
    const { calls, httpClient } = fakeStripe({
      'GET /v1/prices': { object: 'list', data: [{ id: 'price_maker_y', object: 'price' }], has_more: false },
      'POST /v1/checkout/sessions': { id: 'cs_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/cs_1' },
    });
    const withMp = createStripePayments({ secretKey: 'sk_unit', webhookSecret: WEBHOOK_SECRET, managedPayments: true, httpClient });
    const url = await withMp.createCheckout({ customerId: 'cus_1', userId: 'user-1', priceLookupKey: 'gigacad_maker_yearly', successUrl: 'https://app/s', cancelUrl: 'https://app/c' });
    expect(url).toBe('https://checkout.stripe.com/c/cs_1');

    const session = calls.find((call) => call.path === '/v1/checkout/sessions')!.body;
    expect(session.get('mode')).toBe('subscription');
    expect(session.get('customer')).toBe('cus_1');
    expect(session.get('line_items[0][price]')).toBe('price_maker_y');
    expect(session.get('managed_payments[enabled]')).toBe('true');
    expect(session.get('integration_identifier')).toMatch(/^gigacad_plans_[a-z]{8}$/);
    expect(session.get('subscription_data[metadata][user_id]')).toBe('user-1');
    // Dynamic payment methods: never pin the list.
    expect([...session.keys()].some((key) => key.startsWith('payment_method_types'))).toBe(false);
  });

  it('leaves Managed Payments off when configured off', async () => {
    const { calls, httpClient } = fakeStripe({
      'GET /v1/prices': { object: 'list', data: [{ id: 'price_1', object: 'price' }], has_more: false },
      'POST /v1/checkout/sessions': { id: 'cs_2', object: 'checkout.session', url: 'https://checkout.stripe.com/c/cs_2' },
    });
    const plain = createStripePayments({ secretKey: 'sk_unit', webhookSecret: WEBHOOK_SECRET, managedPayments: false, httpClient });
    await plain.createCheckout({ customerId: 'cus_1', userId: 'u', priceLookupKey: 'gigacad_maker_monthly', successUrl: 'https://a', cancelUrl: 'https://b' });
    expect(calls.find((call) => call.path === '/v1/checkout/sessions')!.body.has('managed_payments[enabled]')).toBe(false);
  });
});
