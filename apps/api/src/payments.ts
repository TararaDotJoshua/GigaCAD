import Stripe from 'stripe';

/** A subscription as the billing service needs it, whatever the provider. */
export interface SubscriptionSnapshot {
  readonly id: string;
  readonly customerId: string;
  /** Stripe's status: active, trialing, past_due, canceled, unpaid, incomplete, … */
  readonly status: string;
  readonly priceLookupKey: string | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  /** Set on subscriptions GigaCAD's checkout created. */
  readonly userId: string | null;
}

/**
 * The payment provider behind billing. Stripe in production; tests use a fake.
 * Checkout is Stripe Checkout, so Link and cards work without extra code.
 */
export interface Payments {
  createCustomer(input: { userId: string; email: string | null }): Promise<string>;
  createCheckout(input: { customerId: string; userId: string; priceLookupKey: string; successUrl: string; cancelUrl: string }): Promise<string>;
  createPortal(input: { customerId: string; returnUrl: string }): Promise<string>;
  /** Verifies a webhook's signature and returns the subscription it's about, if any. */
  subscriptionIdFromWebhook(rawBody: Buffer, signature: string): string | null;
  getSubscription(id: string): Promise<SubscriptionSnapshot | null>;
}

export class InvalidWebhookError extends Error {}

/** Tags GigaCAD's sessions in the Stripe Dashboard so checkout flows can be compared. */
const INTEGRATION_IDENTIFIER = 'gigacad_plans_qvhtmzrk';

const subscriptionId = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === 'string' ? value : (value?.id ?? null);

export function createStripePayments(config: {
  /** A restricted key (rk_) is best; see docs/DEPLOYMENT.md step 10 for its permissions. */
  secretKey: string;
  webhookSecret: string;
  /**
   * Stripe as merchant of record: it calculates, collects, and remits sales tax, VAT, and
   * GST, and handles fraud and disputes. Must first be activated in the Dashboard.
   */
  managedPayments: boolean;
  /** Tests pass a fake transport. */
  httpClient?: ReturnType<typeof Stripe.createFetchHttpClient>;
}): Payments {
  const stripe = new Stripe(config.secretKey, config.httpClient ? { httpClient: config.httpClient } : {});
  return {
    async createCustomer({ userId, email }) {
      const customer = await stripe.customers.create({ ...(email ? { email } : {}), metadata: { user_id: userId } });
      return customer.id;
    },

    async createCheckout({ customerId, userId, priceLookupKey, successUrl, cancelUrl }) {
      const prices = await stripe.prices.list({ lookup_keys: [priceLookupKey], active: true, limit: 1 });
      const price = prices.data[0];
      if (!price) throw new Error(`No active Stripe price with lookup key ${priceLookupKey}`);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: userId,
        line_items: [{ price: price.id, quantity: 1 }],
        subscription_data: { metadata: { user_id: userId } },
        allow_promotion_codes: true,
        ...(config.managedPayments ? { managed_payments: { enabled: true } } : {}),
        integration_identifier: INTEGRATION_IDENTIFIER,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (!session.url) throw new Error('Stripe returned a checkout session without a URL');
      return session.url;
    },

    async createPortal({ customerId, returnUrl }) {
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return session.url;
    },

    subscriptionIdFromWebhook(rawBody, signature) {
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
      } catch {
        throw new InvalidWebhookError('Invalid Stripe signature');
      }
      // Every event that can change a subscription's plan or status resolves to that
      // subscription; the plan is then read fresh from Stripe.
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
        case 'checkout.session.async_payment_failed':
          return subscriptionId(event.data.object.subscription);
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
        case 'customer.subscription.paused':
        case 'customer.subscription.resumed':
          return event.data.object.id;
        case 'invoice.paid':
        case 'invoice.payment_failed':
          return subscriptionId(event.data.object.parent?.subscription_details?.subscription);
        default:
          return null;
      }
    },

    async getSubscription(id) {
      let subscription: Stripe.Subscription;
      try {
        subscription = await stripe.subscriptions.retrieve(id);
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') return null;
        throw error;
      }
      const item = subscription.items.data[0];
      return {
        id: subscription.id,
        customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        status: subscription.status,
        priceLookupKey: item?.price.lookup_key ?? null,
        currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        userId: subscription.metadata.user_id ?? null,
      };
    },
  };
}
