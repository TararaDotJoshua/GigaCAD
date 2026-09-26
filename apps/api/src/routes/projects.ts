import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { idParams, parse, requireCaller, viewerId } from '../http.js';
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
  restoreProject,
  setApprovalRules,
  setMember,
  updateProject,
} from '../services/projects.js';
import { getRelease, listReleases } from '../services/releases.js';

const role = z.enum(['owner', 'maintainer', 'contributor', 'viewer']);
export const visibility = z.enum(['public', 'private']);
export const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/, 'Use lowercase letters, digits, dots, dashes, or underscores');

export function projectRoutes(app: FastifyInstance, { sql }: AppDeps): void {
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
    await deleteProject(sql, id, requireCaller(request).userId);
    reply.status(204);
  });

  app.get('/v1/me/deleted-projects', async (request) => listDeletedProjects(sql, requireCaller(request).userId));

  app.post('/v1/projects/:id/restore', async (request) => {
    const { id } = parse(idParams, request.params);
    return restoreProject(sql, id, requireCaller(request).userId);
  });

  app.get('/v1/projects/:id/members', async (request) => {
    const { id } = parse(idParams, request.params);
    return listMembers(sql, id, viewerId(request));
  });

  app.put('/v1/projects/:id/members', async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(z.object({ handle: z.string().min(1).max(39), role }), request.body);
    await setMember(sql, id, requireCaller(request).userId, input.handle, input.role);
    return listMembers(sql, id, requireCaller(request).userId);
  });

  app.delete('/v1/projects/:id/members/:handle', async (request) => {
    const { id, handle } = parse(idParams.extend({ handle: z.string().min(1).max(39) }), request.params);
    await setMember(sql, id, requireCaller(request).userId, handle, null);
    return listMembers(sql, id, requireCaller(request).userId);
  });

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
        limit: z.coerce.number().int().min(1).max(500).default(200),
        /** `desc` lists the newest first, for activity feeds; `asc` (default) is for catching up. */
        order: z.enum(['asc', 'desc']).default('asc'),
      }),
      request.query,
    );
    return listEvents(sql, id, viewerId(request), query.after, query.limit, query.order);
  });

  app.get('/v1/projects/:id/releases', async (request) => {
    const { id } = parse(idParams, request.params);
    return listReleases(sql, id, viewerId(request));
  });

  app.get('/v1/projects/:id/releases/:number', async (request) => {
    const { id, number } = parse(idParams.extend({ number: z.coerce.number().int().positive() }), request.params);
    return getRelease(sql, id, number, viewerId(request));
  });
}
