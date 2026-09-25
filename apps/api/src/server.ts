import { buildApp } from './app.js';
import { createAuthenticator } from './auth.js';
import { loadConfig } from './config.js';
import { createSql } from './db.js';
import { createStripePayments } from './payments.js';
import { createS3Storage } from './storage.js';

const config = loadConfig();
const sql = createSql(config.DATABASE_URL);
const app = buildApp({
  sql,
  storage: createS3Storage(config),
  authenticate: createAuthenticator({ sql, supabaseUrl: config.SUPABASE_URL, jwtSecret: config.SUPABASE_JWT_SECRET }),
  webOrigin: config.WEB_ORIGIN,
  ...(config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET
    ? { payments: createStripePayments({
        secretKey: config.STRIPE_SECRET_KEY,
        webhookSecret: config.STRIPE_WEBHOOK_SECRET,
        managedPayments: config.STRIPE_MANAGED_PAYMENTS,
      }) }
    : {}),
  logger: true,
});

const shutdown = async () => {
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
