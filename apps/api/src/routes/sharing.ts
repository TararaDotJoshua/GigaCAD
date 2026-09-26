import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { idParams, parse, requireCaller, viewerId } from '../http.js';
import { exploreProjects, forkProject, starProject, starredProjects, userProfile } from '../services/sharing.js';
import { withCovers } from '../services/thumbnails.js';
import { slug, visibility } from './projects.js';

const handleParams = z.object({ handle: z.string().min(1).max(39) });

export function sharingRoutes(app: FastifyInstance, { sql, storage }: AppDeps): void {
  app.get('/v1/explore', async (request) => {
    const query = parse(
      z.object({
        q: z.string().trim().max(100).optional(),
        sort: z.enum(['stars', 'recent']).default('stars'),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
      }),
      request.query,
    );
    return withCovers(storage, await exploreProjects(sql, query));
  });

  app.get('/v1/users/:handle', async (request) => {
    const { handle } = parse(handleParams, request.params);
    const page = await userProfile(sql, storage, handle, viewerId(request));
    return { ...page, projects: await withCovers(storage, page.projects) };
  });

  app.get('/v1/users/:handle/stars', async (request) => {
    const { handle } = parse(handleParams, request.params);
    return withCovers(storage, await starredProjects(sql, handle, viewerId(request)));
  });

  app.put('/v1/projects/:id/star', async (request) => {
    const { id } = parse(idParams, request.params);
    return starProject(sql, id, requireCaller(request).userId, true);
  });

  app.delete('/v1/projects/:id/star', async (request) => {
    const { id } = parse(idParams, request.params);
    return starProject(sql, id, requireCaller(request).userId, false);
  });

  app.post('/v1/projects/:id/forks', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(
      z.object({ slug, name: z.string().min(1).max(100), releaseNumber: z.number().int().positive().optional(), visibility: visibility.optional() }),
      request.body,
    );
    reply.status(201);
    return forkProject(sql, id, requireCaller(request).userId, input);
  });
}
