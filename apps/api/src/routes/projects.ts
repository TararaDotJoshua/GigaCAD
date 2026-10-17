import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { idParams, parse, requireCaller, viewerId } from '../http.js';
import { notifyLockReleased, type LockReleaseNotice } from '../services/branches.js';
import { withAvatars } from '../services/profiles.js';
import {
  createProject,
  deleteProject,
  findProject,
  getApprovalRules,
  getProject,
  listDeletedProjects,
  listEvents,
  listMembers,
  listMyProjects,
  notifyNewMember,
  restoreProject,
  setApprovalRules,
  setMember,
  updateProject,
} from '../services/projects.js';
import { notifyMemberRemoved, notifyProjectDeleted, notifyRoleChanged, sendLater } from '../services/notices.js';
import { getRelease, listReleases, releaseArchive } from '../services/releases.js';
import { contentDisposition } from '../storage.js';

const role = z.enum(['owner', 'maintainer', 'contributor', 'viewer']);
export const visibility = z.enum(['public', 'private']);
export const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/, 'Use lowercase letters, digits, dots, dashes, or underscores');

export function projectRoutes(app: FastifyInstance, { sql, storage, mailer, webOrigin }: AppDeps): void {
  /** Someone's role in the project before a role change, to tell them it changed. Null if they aren't a member. */
  const memberRole = async (projectId: string, handle: string) => {
    const [row] = await sql<{ role: string }[]>`
      select m.role from project_members m join profiles p on p.id = m.user_id where m.project_id = ${projectId} and p.handle = ${handle}
    `;
    return row?.role ?? null;
  };

  app.post('/v1/projects', async (request, reply) => {
    const { userId } = requireCaller(request);
    const input = parse(
      z.object({ slug, name: z.string().min(1).max(100), description: z.string().max(2000).optional(), visibility: visibility.optional() }),
      request.body,
    );
    reply.status(201);
    return createProject(sql, userId, input);
  });

  app.get('/v1/projects', async (request) => listMyProjects(sql, requireCaller(request).userId));

  app.get('/v1/projects/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    return getProject(sql, id, viewerId(request));
  });

  app.get('/v1/users/:handle/projects/:slug', async (request) => {
    const params = parse(z.object({ handle: z.string().min(1).max(39), slug: z.string().min(1).max(100) }), request.params);
    return findProject(sql, params.handle, params.slug, viewerId(request));
  });

  app.patch('/v1/projects/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    const changes = parse(
      z
        .object({
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(2000).optional(),
          visibility: visibility.optional(),
          license: z.string().max(100).nullable().optional(),
        })
        .strict(),
      request.body,
    );
    return updateProject(sql, id, requireCaller(request).userId, changes);
  });

  app.delete('/v1/projects/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const actorId = requireCaller(request).userId;
    await deleteProject(sql, id, actorId);
    if (mailer) sendLater(request.log, 'deletion notice', () => notifyProjectDeleted(sql, mailer, { projectId: id, actorId }));
    reply.status(204);
  });

  app.get('/v1/me/deleted-projects', async (request) => listDeletedProjects(sql, requireCaller(request).userId));

  app.post('/v1/projects/:id/restore', async (request) => {
    const { id } = parse(idParams, request.params);
    return restoreProject(sql, id, requireCaller(request).userId);
  });

  app.get('/v1/projects/:id/members', async (request) => {
    const { id } = parse(idParams, request.params);
    return withAvatars(storage, await listMembers(sql, id, viewerId(request)));
  });

  const memberInput = z.object({ handle: z.string().min(1).max(39), role });

  /** Adds someone new. An existing member is a 409 `already_member`, so adding never changes a role by surprise. */
  app.post('/v1/projects/:id/members', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(memberInput, request.body);
    const { added } = await setMember(sql, id, requireCaller(request).userId, input.handle, input.role, { onlyNew: true });
    if (added && mailer) await notifyNewMember(mailer, webOrigin, added).catch((error: unknown) => request.log.warn(error, 'member notice not sent'));
    reply.status(201);
    return withAvatars(storage, await listMembers(sql, id, requireCaller(request).userId));
  });

  /** Sets a member's role, adding them if needed. */
  app.put('/v1/projects/:id/members', async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(memberInput, request.body);
    const before = await memberRole(id, input.handle);
    const { added, releasedLocks } = await setMember(sql, id, requireCaller(request).userId, input.handle, input.role);
    if (added && mailer) await notifyNewMember(mailer, webOrigin, added).catch((error: unknown) => request.log.warn(error, 'member notice not sent'));
    notifyLocks(request, releasedLocks);
    if (before && before !== input.role && mailer) {
      const change = { projectId: id, handle: input.handle, role: input.role, actorId: requireCaller(request).userId };
      sendLater(request.log, 'role notice', () => notifyRoleChanged(sql, mailer, webOrigin, change));
    }
    return withAvatars(storage, await listMembers(sql, id, requireCaller(request).userId));
  });

  /** Removes a member. Anyone but the owner can remove themselves, which leaves the project (and returns no list). */
  app.delete('/v1/projects/:id/members/:handle', async (request, reply) => {
    const { id, handle } = parse(idParams.extend({ handle: z.string().min(1).max(39) }), request.params);
    const actorId = requireCaller(request).userId;
    const { left, releasedLocks } = await setMember(sql, id, actorId, handle, null);
    notifyLocks(request, releasedLocks);
    if (left) return reply.status(204).send();
    // setMember 404s for someone who isn't a member, so only a member who was just removed is told.
    if (mailer) sendLater(request.log, 'removal notice', () => notifyMemberRemoved(sql, mailer, webOrigin, { projectId: id, handle, actorId }));
    return withAvatars(storage, await listMembers(sql, id, requireCaller(request).userId));
  });

  function notifyLocks(request: FastifyRequest, notices: readonly LockReleaseNotice[]) {
    if (!mailer) return;
    for (const notice of notices) sendLater(request.log, 'lock notice', () => notifyLockReleased(mailer, webOrigin, notice));
  }

  app.get('/v1/projects/:id/approval-rules', async (request) => {
    const { id } = parse(idParams, request.params);
    return getApprovalRules(sql, id, viewerId(request));
  });

  app.put('/v1/projects/:id/approval-rules', async (request) => {
    const { id } = parse(idParams, request.params);
    const rules = parse(
      z.object({
        requiredCount: z.number().int().min(0).max(20),
        approverUserIds: z.array(z.uuid()).max(100),
        approverRoles: z.array(role).max(4),
        allowSelfApproval: z.boolean(),
        requireCleanRebuild: z.boolean(),
      }),
      request.body,
    );
    return setApprovalRules(sql, id, requireCaller(request).userId, rules);
  });

  app.get('/v1/projects/:id/events', async (request) => {
    const { id } = parse(idParams, request.params);
    const query = parse(
      z.object({
        after: z.coerce.number().int().min(0).default(0),
        /** Only events older than this id, for paging back through a `desc` feed. */
        before: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
        /** `desc` lists the newest first, for activity feeds; `asc` (default) is for catching up. */
        order: z.enum(['asc', 'desc']).default('asc'),
      }),
      request.query,
    );
    return listEvents(sql, id, viewerId(request), query.after, query.limit, query.order, query.before);
  });

  app.get('/v1/projects/:id/releases', async (request) => {
    const { id } = parse(idParams, request.params);
    return listReleases(sql, id, viewerId(request));
  });

  app.get('/v1/projects/:id/releases/:number', async (request) => {
    const { id, number } = parse(idParams.extend({ number: z.coerce.number().int().positive() }), request.params);
    return getRelease(sql, id, number, viewerId(request));
  });

  /** Every file in a release as one stored (uncompressed) ZIP, streamed. */
  app.get('/v1/projects/:id/releases/:number/archive', async (request, reply) => {
    const { id, number } = parse(idParams.extend({ number: z.coerce.number().int().positive() }), request.params);
    const archive = await releaseArchive(sql, storage, id, number, viewerId(request));
    return reply.header('content-type', 'application/zip').header('content-disposition', contentDisposition(archive.filename)).send(archive.stream);
  });
}
