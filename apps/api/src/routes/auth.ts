import { HANDLE_PATTERN, isPlaceholderHandle, isReservedHandle } from '@gigacad/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { badRequest, notFound } from '../errors.js';
import { idParams, parse, requireCaller, requireSessionCaller } from '../http.js';
import { approveDeviceSignIn, issueToken, listTokens, pendingDeviceSignIn, pollDeviceSignIn, revokeToken, startDeviceSignIn } from '../services/device.js';
import { AVATAR_TYPES, MAX_AVATAR_BYTES, avatarUrl, clearAvatar, setAvatar } from '../services/profiles.js';

const handleSchema = z
  .string()
  .regex(HANDLE_PATTERN, 'Use 1-39 lowercase letters, digits, or dashes')
  .refine((handle) => !isReservedHandle(handle), 'That handle is reserved')
  .refine((handle) => !isPlaceholderHandle(handle), 'Choose a handle of your own');

// The database also checks the prefix, so a link like `HTTPS://…` must be caught here.
const websiteSchema = z
  .url({ protocol: /^https?$/, message: 'Use a link that starts with http:// or https://' })
  .refine((url) => /^https?:\/\//.test(url), 'Use a link that starts with http:// or https://');

/** Free text that may be cleared: empty or blank becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

export function authRoutes(app: FastifyInstance, { sql, storage, webOrigin }: AppDeps): void {
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
    return issueToken(sql, caller.userId, name);
  });

  app.get('/v1/me/tokens', async (request) => listTokens(sql, requireCaller(request).userId));

  app.delete('/v1/me/tokens/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    await revokeToken(sql, requireCaller(request).userId, id);
    reply.status(204);
  });

  async function me(userId: string) {
    const [profile] = await sql<{ avatarKey: string | null }[]>`
      select id, handle, display_name, bio, location, website, avatar_key, quota_bytes::float8 as quota_bytes, created_at from profiles where id = ${userId}
    `;
    if (!profile) throw notFound('Profile');
    const { avatarKey, ...rest } = profile;
    return { ...rest, avatarUrl: await avatarUrl(storage, avatarKey) };
  }

  app.get('/v1/me', async (request) => me(requireCaller(request).userId));

  app.patch('/v1/me', async (request) => {
    const { userId } = requireCaller(request);
    const changes = parse(
      z
        .object({
          handle: handleSchema.optional(),
          displayName: optionalText(100),
          bio: optionalText(160),
          location: optionalText(60),
          website: z
            .string()
            .trim()
            .max(200)
            .transform((value) => value || null)
            .pipe(websiteSchema.nullable())
            .nullable()
            .optional(),
        })
        .strict(),
      request.body,
    );
    const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    if (Object.keys(defined).length > 0) await sql`update profiles set ${sql(defined)} where id = ${userId}`;
    return me(userId);
  });

  // The avatar is sent as the raw image, so only these routes accept image bodies.
  app.register(async (scope) => {
    scope.addContentTypeParser([...AVATAR_TYPES], { parseAs: 'buffer', bodyLimit: MAX_AVATAR_BYTES }, (_request, body, done) => done(null, body));

    scope.put('/v1/me/avatar', async (request) => {
      const { userId } = requireCaller(request);
      if (!(request.body instanceof Buffer)) throw badRequest('invalid_image', 'Upload a PNG, JPEG, or WebP image');
      return { avatarUrl: await setAvatar(sql, storage, userId, request.body) };
    });

    scope.delete('/v1/me/avatar', async (request, reply) => {
      await clearAvatar(sql, storage, requireCaller(request).userId);
      reply.status(204);
    });
  });
}
