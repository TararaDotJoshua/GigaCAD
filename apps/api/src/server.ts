import { buildApp } from './app.js';
import { createAuthenticator } from './auth.js';
import { loadConfig } from './config.js';
import { createSql } from './db.js';
import { runJobs } from './jobs.js';
import { createResendMailer } from './mail.js';
import { createStripePayments } from './payments.js';
import { createS3Storage } from './storage.js';

const config = loadConfig();
const sql = createSql(config.DATABASE_URL);
const storage = createS3Storage(config);
const app = buildApp({
  sql,
  storage,
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

// Background upkeep. An advisory lock keeps two instances from running it at once.
const mailer = config.RESEND_API_KEY ? createResendMailer({ apiKey: config.RESEND_API_KEY, from: config.MAIL_FROM }) : undefined;
const jobs = async () => {
  try {
    const report = await runJobs({ sql, storage, mailer, webOrigin: config.WEB_ORIGIN });
    if (report && Object.values(report).some((count) => count > 0)) app.log.info({ jobs: report }, 'background jobs');
  } catch (error) {
    app.log.error(error, 'background jobs failed');
  }
};
const timers =
  config.JOBS_INTERVAL_MINUTES > 0
    ? [setTimeout(jobs, 60_000), setInterval(jobs, config.JOBS_INTERVAL_MINUTES * 60_000)]
    : [];

const shutdown = async () => {
  timers.forEach((timer) => clearTimeout(timer));
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
