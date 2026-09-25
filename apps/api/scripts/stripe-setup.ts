/**
 * Creates or updates GigaCAD's plans in Stripe: one product per paid plan, a monthly and
 * a yearly price each (found by lookup key), the customer portal, and the webhook.
 * Safe to run again. Run it once in a sandbox and once in live mode, with a key that can
 * write products, prices, the customer portal, and webhook endpoints (not the API's key):
 *
 *   STRIPE_SECRET_KEY=rk_… pnpm --filter @gigacad/api stripe:setup https://api.gigacad.site
 *
 * It prints the webhook signing secret the first time; set it as STRIPE_WEBHOOK_SECRET.
 */
import { formatBytes, PLANS, priceLookupKey, type BillingInterval } from '@gigacad/core';
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
const apiUrl = process.argv[2];
if (!key || !apiUrl) {
  console.error('Usage: STRIPE_SECRET_KEY=rk_… pnpm --filter @gigacad/api stripe:setup <api url>');
  process.exit(1);
}
const stripe = new Stripe(key);
const WEB_URL = process.env.WEB_ORIGIN ?? 'https://app.gigacad.site';
// "Software as a service (SaaS) - personal use", chosen by the owner from Stripe's list
// (https://docs.stripe.com/tax/tax-codes). Managed Payments needs an eligible code on every product.
const TAX_CODE = 'txcd_10103000';
const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
];

const portalProducts: { product: string; prices: string[] }[] = [];
for (const plan of PLANS) {
  if (plan.id === 'free') continue;
  const found = await stripe.products.search({ query: `metadata['gigacad_plan']:'${plan.id}'` });
  const description = `${plan.summary} ${formatBytes(plan.storageBytes)} of storage.`;
  const product =
    found.data[0] ??
    (await stripe.products.create({ name: `GigaCAD ${plan.name}`, description, tax_code: TAX_CODE, metadata: { gigacad_plan: plan.id } }));
  await stripe.products.update(product.id, { name: `GigaCAD ${plan.name}`, description, tax_code: TAX_CODE, active: true });

  const prices: string[] = [];
  for (const interval of ['monthly', 'yearly'] as BillingInterval[]) {
    const lookupKey = priceLookupKey(plan.id, interval);
    const cents = (interval === 'monthly' ? plan.monthlyUsd : plan.yearlyUsd) * 100;
    const [existing] = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, expand: ['data.product'] })).data;
    const matches =
      existing &&
      existing.unit_amount === cents &&
      existing.currency === 'usd' &&
      existing.recurring?.interval === (interval === 'monthly' ? 'month' : 'year') &&
      existing.tax_behavior === 'exclusive' &&
      (typeof existing.product === 'string' ? existing.product : existing.product.id) === product.id;
    if (matches) {
      prices.push(existing.id);
      console.log(`ok       ${lookupKey}  ${existing.id}`);
      continue;
    }
    // Prices can't change; a new one takes over the lookup key and the old one retires.
    const price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: cents,
      recurring: { interval: interval === 'monthly' ? 'month' : 'year' },
      lookup_key: lookupKey,
      transfer_lookup_key: true,
      // Prices are before tax; tax is added at checkout.
      tax_behavior: 'exclusive',
    });
    if (existing) await stripe.prices.update(existing.id, { active: false });
    prices.push(price.id);
    console.log(`created  ${lookupKey}  ${price.id}`);
  }
  portalProducts.push({ product: product.id, prices });
}

// The customer portal: switch plans, cancel at the period end, update cards, see invoices.
const portal: Stripe.BillingPortal.ConfigurationCreateParams = {
  name: 'GigaCAD',
  default_return_url: `${WEB_URL}/settings/billing`,
  business_profile: { privacy_policy_url: 'https://gigacad.site/privacy', terms_of_service_url: 'https://gigacad.site/terms' },
  features: {
    customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      products: portalProducts,
      proration_behavior: 'create_prorations',
    },
  },
};
const [defaultPortal] = (await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })).data;
if (defaultPortal) {
  const { name: _name, ...update } = portal;
  await stripe.billingPortal.configurations.update(defaultPortal.id, update);
  console.log(`updated  portal  ${defaultPortal.id}`);
} else {
  console.log(`created  portal  ${(await stripe.billingPortal.configurations.create(portal)).id}`);
}

const webhookUrl = new URL('/v1/billing/webhook', apiUrl).toString();
const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
const endpoint = endpoints.data.find((candidate) => candidate.url === webhookUrl);
if (endpoint) {
  await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: EVENTS, disabled: false });
  console.log(`updated  webhook ${webhookUrl} (its signing secret is unchanged)`);
} else {
  const created = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: EVENTS, description: 'GigaCAD plans' });
  console.log(`created  webhook ${webhookUrl}`);
  console.log(`\nSet STRIPE_WEBHOOK_SECRET=${created.secret} on the API.`);
}
