import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Authenticate, Caller } from './auth.js';
import type { Sql } from './db.js';
import { HttpError } from './errors.js';
import type { Payments } from './payments.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { blobRoutes } from './routes/blobs.js';
import { branchRoutes } from './routes/branches.js';
import { projectRoutes } from './routes/projects.js';
import { releaseRequestRoutes } from './routes/releaseRequests.js';
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
  readonly logger?: boolean;
}

// Postgres error codes the schema raises on purpose.
const PG_RAISED = 'P0001';
const PG_UNIQUE_VIOLATION = '23505';

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 32 * 1024 * 1024 });

  // @fastify/cors allows only GET, HEAD, and POST unless told otherwise; the API also uses PUT, PATCH, and DELETE.
  app.register(cors, { origin: [deps.webOrigin], methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], credentials: false });
  app.decorateRequest('caller', null);
  app.addHook('onRequest', async (request) => {
    request.caller = await deps.authenticate(request.headers.authorization);
  });

  app.setErrorHandler((error: FastifyError & { code?: string }, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error.code === PG_RAISED) {
      return reply.status(409).send({ error: { code: 'locked', message: error.message } });
    }
    if (error.code === PG_UNIQUE_VIOLATION) {
      return reply.status(409).send({ error: { code: 'already_exists', message: 'That already exists' } });
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
  return app;
}
