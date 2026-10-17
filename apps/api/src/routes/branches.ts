import { branchNameProblem } from '@gigacad/core';
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
  notifyLockReleased,
  unarchiveBranch,
} from '../services/branches.js';

// One message per problem, the same ones the web form shows as you type.
const branchName = z.string().superRefine((name, context) => {
  const problem = branchNameProblem(name);
  if (problem) context.addIssue({ code: 'custom', message: problem });
});
const machine = z.string().min(1).max(200);

export function branchRoutes(app: FastifyInstance, { sql, mailer, webOrigin }: AppDeps): void {
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
    const { branch, notice } = await forceRelease(sql, id, requireCaller(request).userId);
    if (notice && mailer) await notifyLockReleased(mailer, webOrigin, notice).catch((error: unknown) => request.log.warn(error, 'lock notice not sent'));
    return branch;
  });

  app.post('/v1/branches/:id/archive', async (request) => {
    const { id } = parse(idParams, request.params);
    const { branch, notice } = await archiveBranch(sql, id, requireCaller(request).userId);
    if (notice && mailer) await notifyLockReleased(mailer, webOrigin, notice).catch((error: unknown) => request.log.warn(error, 'lock notice not sent'));
    return branch;
  });

  app.post('/v1/branches/:id/unarchive', async (request) => {
    const { id } = parse(idParams, request.params);
    return unarchiveBranch(sql, id, requireCaller(request).userId);
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
