import { PLAN_IDS } from '@gigacad/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { HttpError } from '../errors.js';
import { parse, requireCaller, requireSessionCaller } from '../http.js';
import { InvalidWebhookError, type Payments } from '../payments.js';
import { getBilling, openPortal, startCheckout, syncSubscription } from '../services/billing.js';

const billingUnavailable = () => new HttpError(503, 'billing_unavailable', 'Paid plans are not available yet');

export function billingRoutes(app: FastifyInstance, { sql, payments, webOrigin }: AppDeps): void {
  const requirePayments = (): Payments => {
    if (!payments) throw billingUnavailable();
    return payments;
  };

  app.get('/v1/me/billing', async (request) => getBilling(sql, requireCaller(request).userId, payments !== undefined));

  app.post('/v1/billing/checkout', async (request) => {
    const { userId } = requireSessionCaller(request);
    const { plan, interval } = parse(
      z.object({ plan: z.enum(PLAN_IDS).exclude(['free']), interval: z.enum(['monthly', 'yearly']) }),
      request.body,
    );
    return startCheckout(sql, requirePayments(), userId, plan, interval, webOrigin);
  });

  app.post('/v1/billing/portal', async (request) => openPortal(sql, requirePayments(), requireSessionCaller(request).userId, webOrigin));

  // Stripe signs the exact bytes it sent, so this route keeps the body raw.
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    scope.post('/v1/billing/webhook', async (request, reply) => {
      const provider = requirePayments();
      const signature = request.headers['stripe-signature'];
      if (typeof signature !== 'string' || !Buffer.isBuffer(request.body)) throw new HttpError(400, 'invalid_webhook', 'Missing signature');
      let subscriptionId: string | null;
      try {
        subscriptionId = provider.subscriptionIdFromWebhook(request.body, signature);
      } catch (error) {
        if (error instanceof InvalidWebhookError) throw new HttpError(400, 'invalid_webhook', error.message);
        throw error;
      }
      if (subscriptionId) await syncSubscription(sql, provider, subscriptionId);
      reply.status(200);
      return { received: true };
    });
  });
}
