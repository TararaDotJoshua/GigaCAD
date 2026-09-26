import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { idParams, parse, requireCaller, sha256Schema, viewerId } from '../http.js';
import { completeUploads, planDownloads, planUploads, setReferences } from '../services/blobs.js';
import { projectThumbnails } from '../services/thumbnails.js';

export function blobRoutes(app: FastifyInstance, { sql, storage }: AppDeps): void {
  app.post('/v1/projects/:id/blobs/uploads', async (request) => {
    const { id } = parse(idParams, request.params);
    const { blobs } = parse(
      z.object({ blobs: z.array(z.object({ sha256: sha256Schema, size: z.number().int().min(0) })).min(1).max(1000) }),
      request.body,
    );
    return planUploads(sql, storage, id, requireCaller(request).userId, blobs);
  });

  app.post('/v1/projects/:id/blobs/complete', async (request) => {
    const { id } = parse(idParams, request.params);
    const { uploadIds } = parse(z.object({ uploadIds: z.array(z.uuid()).min(1).max(1000) }), request.body);
    return completeUploads(sql, storage, id, requireCaller(request).userId, uploadIds);
  });

  app.post('/v1/projects/:id/thumbnails', async (request) => {
    const { id } = parse(idParams, request.params);
    const { sha256s } = parse(z.object({ sha256s: z.array(sha256Schema).max(1000) }), request.body);
    return projectThumbnails(sql, storage, id, viewerId(request), sha256s);
  });

  app.post('/v1/projects/:id/blobs/downloads', async (request) => {
    const { id } = parse(idParams, request.params);
    const { sha256s, filenames } = parse(
      z.object({
        sha256s: z.array(sha256Schema).min(1).max(1000),
        /** Optional download names, e.g. from the web app, so browsers save `P1.SLDPRT` rather than a hash. */
        filenames: z.record(sha256Schema, z.string().min(1).max(255).regex(/^[^/\\\x00-\x1f]+$/, 'A file name, not a path')).optional(),
      }),
      request.body,
    );
    return planDownloads(sql, storage, id, viewerId(request), sha256s, filenames);
  });

  app.put('/v1/projects/:id/blobs/:sha256/references', async (request) => {
    const { id, sha256 } = parse(idParams.extend({ sha256: sha256Schema }), request.params);
    const { paths } = parse(z.object({ paths: z.array(z.string().min(1).max(1024)).max(5000) }), request.body);
    return { paths: await setReferences(sql, id, requireCaller(request).userId, sha256, paths) };
  });
}
