import { HANDLE_PATTERN, isPlaceholderHandle, isReservedHandle } from '@gigacad/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { Db } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { idParams, parse, requireCaller, requireSessionCaller } from '../http.js';
import { createRateLimit } from '../rateLimit.js';
import { approveDeviceSignIn, denyDeviceSignIn, issueToken, listTokens, pendingDeviceSignIn, pollDeviceSignIn, revokeToken, startDeviceSignIn } from '../services/device.js';
import { AVATAR_TYPES, MAX_AVATAR_BYTES, avatarUrl, clearAvatar, setAvatar } from '../services/profiles.js';

const handleSchema = z
  .string()
  .regex(HANDLE_PATTERN, 'Use 1-39 lowercase letters, digits, or dashes')
  .refine((handle) => !isReservedHandle(handle), 'That handle is reserved')
  .refine((handle) => !isPlaceholderHandle(handle), 'Choose a handle of your own');

/** Characters as the database counts them (code points), so an emoji counts as what it is made of, not as UTF-16 halves. */
const characters = (value: string) => [...value].length;

/**
 * Free text that may be cleared: empty or blank becomes null. Line breaks arrive from forms
 * as CRLF; they're stored as LF, so they count once, as the form's counter counts them.
 */
const optionalText = (field: string, max: number, options: { multiline?: boolean } = {}) =>
  z
    .string()
    .transform((value) => {
      const text = value.replace(/\r\n?/g, '\n').trim();
      // A blank line is enough to separate paragraphs.
      return options.multiline ? text.replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n\n') : text.replace(/\s*\n\s*/g, ' ');
    })
    .refine((value) => characters(value) <= max, `${field} can be at most ${max} characters`)
    .transform((value) => value || null)
    .nullable()
    .optional();

/**
 * One rule for the website, with one message per problem. The scheme may be typed in any
 * case; it's stored lowercase, which the database's own check needs.
 */
const websiteSchema = z
  .string()
  .transform((value) => value.trim().replace(/^[a-z][a-z0-9+.-]*:/i, (scheme) => scheme.toLowerCase()))
  .superRefine((value, context) => {
    if (!value) return;
    if (characters(value) > 200) return context.addIssue({ code: 'custom', message: 'Website can be at most 200 characters' });
    let url: URL | null = null;
    try {
      url = new URL(value);
    } catch {
      // Reported below.
    }
    if (!url || !/^https?:\/\//.test(value) || (url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      context.addIssue({ code: 'custom', message: 'Use a link that starts with http:// or https://' });
    }
  })
  .transform((value) => value || null);

/** Days a handle someone gave up stays theirs, so links and emails naming it can't reach someone else. */
export const HANDLE_HOLD_DAYS = 90;

/**
 * Whether another account gave up this handle recently, or ever while it owned public projects
 * (whose links stay out there). The account that gave it up can always take it back.
 */
async function handleIsHeld(db: Db, handle: string, userId: string): Promise<boolean> {
  // Saving the profile resends the handle you already have, which is always yours to keep.
  const [held] = await db`
    select 1 from handle_history h
    where h.handle = ${handle} and h.user_id is distinct from ${userId}
      and (h.had_public_projects or h.released_at > now() - make_interval(days => ${HANDLE_HOLD_DAYS}))
      and not exists (select 1 from profiles p where p.id = ${userId} and p.handle = ${handle})
  `;
  return Boolean(held);
}

export function authRoutes(app: FastifyInstance, { sql, storage, webOrigin }: AppDeps): void {
  // Starting a sign-in needs no account, so it's limited per address; a client polls every
  // 5 seconds, so a code gets a little more than that; approving is limited per person.
  const startLimit = createRateLimit({ limit: 20, windowMs: 60_000 });
  const pollLimit = createRateLimit({ limit: 30, windowMs: 60_000 });
  const approveLimit = createRateLimit({ limit: 20, windowMs: 60_000 });
  const avatarLimit = createRateLimit({ limit: 10, windowMs: 60_000 });

  app.post('/v1/auth/device/code', async (request) => {
    startLimit(request.ip);
    const { clientName } = parse(z.object({ clientName: z.string().min(1).max(100) }), request.body);
    return startDeviceSignIn(sql, webOrigin, clientName);
  });

  app.post('/v1/auth/device/approve', async (request) => {
    const caller = requireSessionCaller(request);
    approveLimit(caller.userId);
    const { userCode } = parse(z.object({ userCode: z.string().min(4).max(20) }), request.body);
    return approveDeviceSignIn(sql, caller.userId, userCode);
  });

  app.post('/v1/auth/device/deny', async (request, reply) => {
    approveLimit(requireSessionCaller(request).userId);
    const { userCode } = parse(z.object({ userCode: z.string().min(4).max(20) }), request.body);
    await denyDeviceSignIn(sql, userCode);
    reply.status(204);
  });

  app.get('/v1/auth/device/pending/:userCode', async (request) => {
    approveLimit(requireSessionCaller(request).userId);
    const { userCode } = parse(z.object({ userCode: z.string().min(4).max(20) }), request.params);
    return pendingDeviceSignIn(sql, userCode);
  });

  app.post('/v1/auth/device/token', async (request) => {
    const { deviceCode } = parse(z.object({ deviceCode: z.string().min(1).max(200) }), request.body);
    pollLimit(`${request.ip} ${deviceCode}`);
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
    const caller = requireCaller(request);
    // A leaked desktop token mustn't be able to sign the person out everywhere else.
    if (caller.via === 'device' && caller.tokenId !== id) throw forbidden('A device can only sign itself out. Sign out other devices on gigacad.site');
    await revokeToken(sql, caller.userId, id);
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

  // Changing the handle or profile is for the website: a desktop or CLI token can't rename the account.
  app.patch('/v1/me', async (request) => {
    const { userId } = requireSessionCaller(request);
    const changes = parse(
      z
        .object({
          handle: handleSchema.optional(),
          displayName: optionalText('Display name', 100),
          bio: optionalText('Bio', 160, { multiline: true }),
          location: optionalText('Location', 60),
          website: websiteSchema.nullable().optional(),
        })
        .strict(),
      request.body,
    );
    const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    if (Object.keys(defined).length > 0) {
      await sql.begin(async (tx) => {
        if (changes.handle) {
          const [taken] = await tx`select 1 from profiles where lower(handle) = lower(${changes.handle}) and id <> ${userId}`;
          if (taken) throw conflict('handle_taken', 'That handle is taken');
        }
        if (changes.handle && (await handleIsHeld(tx, changes.handle, userId))) {
          throw conflict('handle_unavailable', 'Someone used this handle recently, so old links to it could reach your projects. Choose another.');
        }
        await tx`update profiles set ${tx(defined)} where id = ${userId}`;
      });
    }
    return me(userId);
  });

  // The avatar is sent as the raw image, so only these routes accept image bodies.
  app.register(async (scope) => {
    scope.addContentTypeParser([...AVATAR_TYPES], { parseAs: 'buffer', bodyLimit: MAX_AVATAR_BYTES }, (_request, body, done) => done(null, body));

    scope.put('/v1/me/avatar', async (request) => {
      const { userId } = requireSessionCaller(request);
      // Checking an image takes real work, so one account can't keep the API busy with uploads.
      avatarLimit(userId);
      if (!(request.body instanceof Buffer)) throw badRequest('invalid_image', 'Upload a PNG, JPEG, or WebP image');
      return { avatarUrl: await setAvatar(sql, storage, userId, request.body) };
    });

    scope.delete('/v1/me/avatar', async (request, reply) => {
      await clearAvatar(sql, storage, requireSessionCaller(request).userId);
      reply.status(204);
    });
  });
}
