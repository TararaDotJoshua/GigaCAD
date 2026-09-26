import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.url(),
  SUPABASE_URL: z.url(),
  /** Only needed for projects that still sign sessions with the legacy shared secret (HS256). */
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  /** Where people approve desktop sign-ins, e.g. https://app.gigacad.site */
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  /** Minutes between background job runs (storage cleanup, purges, stale checkout notices). 0 turns them off. */
  JOBS_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),
  /** Resend API key for stale checkout notices. Without it the notices are skipped. */
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().default('GigaCAD <no-reply@send.gigacad.site>'),
  /** Paid plans. Both or neither; without them the API runs with the free plan only. */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Managed Payments (Stripe as merchant of record). On unless set to false, e.g. in a sandbox without it activated. */
  STRIPE_MANAGED_PAYMENTS: booleanString.default(true),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
