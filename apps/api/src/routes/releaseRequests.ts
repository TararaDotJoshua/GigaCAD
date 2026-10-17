import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { idParams, parse, requireCaller, sha256Schema, viewerId } from '../http.js';
import {
  approve,
  closeReleaseRequest,
  generateCandidate,
  getReleaseRequest,
  listReleaseRequests,
  openReleaseRequest,
  release,
  reportRebuild,
  setPicks,
  updateCandidateFiles,
  withdrawApproval,
} from '../services/releaseRequests.js';
import { approvedAlready, notifyReleaseRequest, type RequestNotice } from '../services/notices.js';

const picks = z.object({
  actions: z.record(z.uuid(), z.enum(['take_branch', 'keep_main'])).optional(),
  replacements: z.array(z.object({ branchItemId: z.uuid(), mainItemId: z.uuid() })).max(10_000).optional(),
});

export function releaseRequestRoutes(app: FastifyInstance, { sql, mailer, webOrigin }: AppDeps): void {
  /** Emails who the step concerns, after it commits; a mail failure is logged, never returned. */
  const notify = async <T>(request: FastifyRequest, kind: RequestNotice, requestId: string, result: T): Promise<T> => {
    if (mailer) await notifyReleaseRequest(sql, mailer, webOrigin, { kind, requestId, actorId: requireCaller(request).userId }).catch((error: unknown) => request.log.warn(error, 'release request notice not sent'));
    return result;
  };

  app.post('/v1/branches/:id/release-requests', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(20_000).optional() }), request.body);
    reply.status(201);
    const opened = await openReleaseRequest(sql, id, requireCaller(request).userId, input);
    // Approvers hear once the request has a candidate to review.
    return notify(request, 'candidate', opened.releaseRequest.id, opened);
  });

  app.get('/v1/projects/:id/release-requests', async (request) => {
    const { id } = parse(idParams, request.params);
    return listReleaseRequests(sql, id, viewerId(request));
  });

  app.get('/v1/release-requests/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    return getReleaseRequest(sql, id, viewerId(request));
  });

  app.put('/v1/release-requests/:id/picks', async (request) => {
    const { id } = parse(idParams, request.params);
    return setPicks(sql, id, requireCaller(request).userId, parse(picks, request.body));
  });

  app.post('/v1/release-requests/:id/candidate', async (request) => {
    const { id } = parse(idParams, request.params);
    return notify(request, 'candidate', id, await generateCandidate(sql, id, requireCaller(request).userId));
  });

  app.put('/v1/release-requests/:id/candidate/files', async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(
      z.object({
        baseManifestId: z.uuid(),
        files: z.array(z.object({ itemId: z.uuid(), blob: sha256Schema })).max(50_000),
      }),
      request.body,
    );
    return updateCandidateFiles(sql, id, requireCaller(request).userId, input);
  });

  app.post('/v1/release-requests/:id/rebuild-report', async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(
      z.object({
        candidateManifestId: z.uuid(),
        status: z.enum(['passed', 'passed_with_warnings', 'failed']),
        messages: z
          .array(z.object({ level: z.enum(['info', 'warning', 'error']), message: z.string().max(2000), path: z.string().max(1024).optional() }))
          .max(5000),
      }),
      request.body,
    );
    return reportRebuild(sql, id, requireCaller(request).userId, input);
  });

  app.post('/v1/release-requests/:id/approvals', async (request) => {
    const { id } = parse(idParams, request.params);
    const repeat = await approvedAlready(sql, id, requireCaller(request).userId);
    const result = await approve(sql, id, requireCaller(request).userId);
    return repeat ? result : notify(request, 'approved', id, result);
  });

  app.delete('/v1/release-requests/:id/approvals', async (request) => {
    const { id } = parse(idParams, request.params);
    return withdrawApproval(sql, id, requireCaller(request).userId);
  });

  app.post('/v1/release-requests/:id/release', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(z.object({ notes: z.string().max(20_000).optional() }), request.body ?? {});
    reply.status(201);
    return notify(request, 'released', id, await release(sql, id, requireCaller(request).userId, input));
  });

  app.post('/v1/release-requests/:id/close', async (request) => {
    const { id } = parse(idParams, request.params);
    return notify(request, 'closed', id, await closeReleaseRequest(sql, id, requireCaller(request).userId));
  });
}
