import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Authenticate, Caller } from './auth.js';
import type { Sql } from './db.js';
import { HttpError } from './errors.js';
import type { Mailer } from './mail.js';
import type { Payments } from './payments.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { blobRoutes } from './routes/blobs.js';
import { branchRoutes } from './routes/branches.js';
import { directoryRoutes } from './routes/directory.js';
import { projectRoutes } from './routes/projects.js';
import { releaseRequestRoutes } from './routes/releaseRequests.js';
import { sharingRoutes } from './routes/sharing.js';
import type { BlobStorage } from './storage.js';

declare module 'fastify' {
  interface FastifyRequest {
    caller: Caller | null;
  }
}

export interface AppDeps {
  readonly sql: Sql;
  readonly storage: BlobStorage;
  readonly authenticate: Authenticate;
  readonly webOrigin: string;
  /** Unset until payment keys are configured; paid plans are then unavailable. */
  readonly payments?: Payments;
  /** Unset without a mail key; notices that would go by email are then skipped. */
  readonly mailer?: Mailer;
  readonly logger?: boolean;
  /** Proxies in front of the API (Railway's edge is one), so `request.ip` is the client's address. */
  readonly trustProxyHops?: number;
}

// Postgres error codes the schema raises on purpose.
const PG_RAISED = 'P0001';
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
/** Text Postgres can't store: a NUL character, or bytes that aren't valid UTF-8. */
const PG_BAD_TEXT = new Set(['22021', '22P05']);
// A number too large for its column, like a release number past the `int` range.
const PG_OUT_OF_RANGE = '22003';

export function buildApp(deps: AppDeps): FastifyInstance {
  // Trusting a count of hops, like proxy-addr's numeric option: the socket's peer is hop 0.
  const hops = deps.trustProxyHops ?? 0;
  const trustProxy = hops > 0 ? (_address: string, hop: number) => hop < hops : false;
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 32 * 1024 * 1024, trustProxy });

  // @fastify/cors allows only GET, HEAD, and POST unless told otherwise; the API also uses PUT, PATCH, and DELETE.
  app.register(cors, { origin: [deps.webOrigin], methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], credentials: false });
  app.decorateRequest('caller', null);
  app.addHook('onRequest', async (request) => {
    request.caller = await deps.authenticate(request.headers.authorization);
  });

  app.setErrorHandler((error: FastifyError & { code?: string }, request, reply) => {
    if (error instanceof HttpError) {
      const retryAfter = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (error.status === 429 && retryAfter) reply.header('retry-after', String(retryAfter));
      return reply.status(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error.code === PG_RAISED) {
      return reply.status(409).send({ error: { code: 'locked', message: error.message } });
    }
    if (error.code === PG_UNIQUE_VIOLATION) {
      return reply.status(409).send({ error: { code: 'already_exists', message: 'That already exists' } });
    }
    if (error.code === PG_OUT_OF_RANGE) {
      return reply.status(422).send({ error: { code: 'out_of_range', message: 'A number in the request is too large' } });
    }
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      request.log.warn(error);
      return reply.status(409).send({ error: { code: 'in_use', message: 'Something else still refers to this, so it can’t be changed or removed' } });
    }
    if (error.code && PG_BAD_TEXT.has(error.code)) {
      return reply.status(400).send({ error: { code: 'invalid_request', message: 'Text can’t contain control characters' } });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: { code: 'invalid_request', message: error.message } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  app.get('/health', async () => ({ ok: true }));
  authRoutes(app, deps);
  projectRoutes(app, deps);
  branchRoutes(app, deps);
  releaseRequestRoutes(app, deps);
  blobRoutes(app, deps);
  billingRoutes(app, deps);
  sharingRoutes(app, deps);
  directoryRoutes(app, deps);
  return app;
}
