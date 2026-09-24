import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { notFound } from '../errors.js';
import { idParams, parse, requireCaller, requireSessionCaller } from '../http.js';
import { approveDeviceSignIn, issueToken, listTokens, pendingDeviceSignIn, pollDeviceSignIn, revokeToken, startDeviceSignIn } from '../services/device.js';

const handleSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/, 'Use 1-39 lowercase letters, digits, or dashes');

export function authRoutes(app: FastifyInstance, { sql, webOrigin }: AppDeps): void {
  app.post('/v1/auth/device/code', async (request) => {
    const { clientName } = parse(z.object({ clientName: z.string().min(1).max(100) }), request.body);
    return startDeviceSignIn(sql, webOrigin, clientName);
  });

  app.post('/v1/auth/device/approve', async (request) => {
    const caller = requireSessionCaller(request);
    const { userCode } = parse(z.object({ userCode: z.string().min(4).max(20) }), request.body);
    return approveDeviceSignIn(sql, caller.userId, userCode);
  });

  app.get('/v1/auth/device/pending/:userCode', async (request) => {
    requireSessionCaller(request);
    const { userCode } = parse(z.object({ userCode: z.string().min(4).max(20) }), request.params);
    return pendingDeviceSignIn(sql, userCode);
  });

  app.post('/v1/auth/device/token', async (request) => {
    const { deviceCode } = parse(z.object({ deviceCode: z.string().min(1).max(200) }), request.body);
    return pollDeviceSignIn(sql, deviceCode);
  });

  app.post('/v1/auth/tokens', async (request, reply) => {
    const caller = requireSessionCaller(request);
    const { name } = parse(z.object({ name: z.string().min(1).max(100) }), request.body);
    reply.status(201);
    return { accessToken: await issueToken(sql, caller.userId, name) };
  });

  app.get('/v1/me/tokens', async (request) => listTokens(sql, requireCaller(request).userId));

  app.delete('/v1/me/tokens/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    await revokeToken(sql, requireCaller(request).userId, id);
    reply.status(204);
  });

  app.get('/v1/me', async (request) => {
    const { userId } = requireCaller(request);
    const [profile] = await sql`select id, handle, display_name, quota_bytes::float8 as quota_bytes, created_at from profiles where id = ${userId}`;
    if (!profile) throw notFound('Profile');
    return profile;
  });

  app.patch('/v1/me', async (request) => {
    const { userId } = requireCaller(request);
    const changes = parse(
      z.object({ handle: handleSchema.optional(), displayName: z.string().max(100).nullable().optional() }).strict(),
      request.body,
    );
    const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    if (Object.keys(defined).length > 0) await sql`update profiles set ${sql(defined)} where id = ${userId}`;
    const [profile] = await sql`select id, handle, display_name, quota_bytes::float8 as quota_bytes, created_at from profiles where id = ${userId}`;
    return profile;
  });
}
