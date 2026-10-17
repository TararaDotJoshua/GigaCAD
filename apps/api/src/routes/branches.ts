import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { idParams, parse, requireCaller, sha256Schema, viewerId } from '../http.js';
import {
  archiveBranch,
  checkIn,
  checkOut,
  createBranch,
  createCommit,
  forceRelease,
  getBranch,
  getCommit,
  listBranches,
  listCommits,
} from '../services/branches.js';

const branchName = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/, 'Use letters, digits, dots, dashes, or underscores');
const machine = z.string().min(1).max(200);

export function branchRoutes(app: FastifyInstance, { sql }: AppDeps): void {
  app.post('/v1/projects/:id/branches', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(z.object({ name: branchName, fromRelease: z.number().int().positive().optional() }), request.body);
    reply.status(201);
    return createBranch(sql, id, requireCaller(request).userId, input);
  });

  app.get('/v1/projects/:id/branches', async (request) => {
    const { id } = parse(idParams, request.params);
    return listBranches(sql, id, viewerId(request));
  });

  app.get('/v1/branches/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    return getBranch(sql, id, viewerId(request));
  });

  app.post('/v1/branches/:id/checkout', async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(z.object({ machine }), request.body);
    return checkOut(sql, id, requireCaller(request).userId, input.machine);
  });

  app.post('/v1/branches/:id/checkin', async (request) => {
    const { id } = parse(idParams, request.params);
    return checkIn(sql, id, requireCaller(request).userId);
  });

  app.post('/v1/branches/:id/force-release', async (request) => {
    const { id } = parse(idParams, request.params);
    return forceRelease(sql, id, requireCaller(request).userId);
  });

  app.post('/v1/branches/:id/archive', async (request) => {
    const { id } = parse(idParams, request.params);
    return archiveBranch(sql, id, requireCaller(request).userId);
  });

  app.get('/v1/branches/:id/commits', async (request) => {
    const { id } = parse(idParams, request.params);
    return listCommits(sql, id, viewerId(request));
  });

  app.post('/v1/branches/:id/commits', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(
      z.object({
        parentId: z.uuid(),
        machine,
        kind: z.enum(['autosave', 'version']),
        message: z.string().max(5000).optional(),
        versionLabel: z.string().min(1).max(100).optional(),
        files: z
          .array(z.object({ path: z.string().min(1).max(1024), blob: sha256Schema, itemId: z.uuid().optional() }))
          .max(50_000),
      }),
      request.body,
    );
    const result = await createCommit(sql, id, requireCaller(request).userId, input);
    reply.status(result.created ? 201 : 200);
    return result;
  });

  app.get('/v1/commits/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    return getCommit(sql, id, viewerId(request));
  });
}
