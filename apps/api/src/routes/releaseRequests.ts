import type { FastifyInstance } from 'fastify';
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
  rebuildReportPage,
  release,
  reportRebuild,
  setPicks,
  updateCandidateFiles,
  withdrawApproval,
} from '../services/releaseRequests.js';

/** The candidate the caller reviewed. Approving or releasing anything else is refused as stale. */
const reviewed = { candidateManifestId: z.uuid() };

/** Bidirectional controls would let a path or message display reversed. */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const reportText = (max: number) => z.string().transform((text) => text.replace(BIDI, '').trim()).pipe(z.string().min(1).max(max));

const picks = z.object({
  actions: z.record(z.uuid(), z.enum(['take_branch', 'keep_main'])).optional(),
  replacements: z.array(z.object({ branchItemId: z.uuid(), mainItemId: z.uuid() })).max(10_000).optional(),
});

export function releaseRequestRoutes(app: FastifyInstance, { sql }: AppDeps): void {
  app.post('/v1/branches/:id/release-requests', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(z.object({ title: z.string().min(1).max(200), body: z.string().max(20_000).optional() }), request.body);
    reply.status(201);
    return openReleaseRequest(sql, id, requireCaller(request).userId, input);
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
    return generateCandidate(sql, id, requireCaller(request).userId);
  });

  app.put('/v1/release-requests/:id/candidate/files', async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(
      z.object({
        baseManifestId: z.uuid(),
        files: z.array(z.object({ itemId: z.uuid(), blob: sha256Schema })).min(1).max(50_000),
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
          .array(z.object({ level: z.enum(['info', 'warning', 'error']), message: reportText(2000), path: reportText(1024).optional() }))
          .max(1000),
      }),
      request.body,
    );
    return reportRebuild(sql, id, requireCaller(request).userId, input);
  });

  app.get('/v1/release-requests/:id/rebuild-report', async (request) => {
    const { id } = parse(idParams, request.params);
    const page = parse(
      z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(1000).default(200) }),
      request.query,
    );
    return rebuildReportPage(sql, id, viewerId(request), page);
  });

  app.post('/v1/release-requests/:id/approvals', async (request) => {
    const { id } = parse(idParams, request.params);
    return approve(sql, id, requireCaller(request).userId, parse(z.object(reviewed), request.body ?? {}));
  });

  app.delete('/v1/release-requests/:id/approvals', async (request) => {
    const { id } = parse(idParams, request.params);
    return withdrawApproval(sql, id, requireCaller(request).userId);
  });

  app.post('/v1/release-requests/:id/release', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(z.object({ ...reviewed, notes: z.string().max(20_000).optional() }), request.body ?? {});
    reply.status(201);
    return release(sql, id, requireCaller(request).userId, input);
  });

  app.post('/v1/release-requests/:id/close', async (request) => {
    const { id } = parse(idParams, request.params);
    return closeReleaseRequest(sql, id, requireCaller(request).userId);
  });
}
