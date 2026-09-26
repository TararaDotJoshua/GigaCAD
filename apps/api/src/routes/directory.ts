import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { idParams, parse, requireCaller, sha256Schema, viewerId } from '../http.js';
import {
  createFile,
  createFolder,
  createTag,
  deleteEntry,
  deleteTag,
  getEntry,
  listDirectory,
  listRootFolders,
  listTags,
  moveEntry,
  renameTag,
  replaceFile,
  searchFiles,
  setFavorite,
  setFileTags,
} from '../services/directory.js';

const paging = {
  sort: z.enum(['name', 'modified', 'size']).default('name'),
  order: z.enum(['asc', 'desc']).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
};
// Names are checked in full by the service, which explains what's wrong with them.
const name = z.string().min(1).max(255);
const parentId = z.uuid().nullable();
const entryParams = idParams.extend({ entryId: z.uuid() });
const itemParams = idParams.extend({ itemId: z.uuid() });
const tagParams = idParams.extend({ tagId: z.uuid() });
const tagName = z.string().min(1).max(50);

export function directoryRoutes(app: FastifyInstance, { sql }: AppDeps): void {
  /** One folder: the root (no path), a root folder, `Branches[/<name>[/...]]`, or `Releases[/v<n>[/...]]`. */
  app.get('/v1/projects/:id/directory', async (request) => {
    const { id } = parse(idParams, request.params);
    const { path, ...page } = parse(z.object({ path: z.string().max(2048).default(''), ...paging }), request.query);
    return listDirectory(sql, id, viewerId(request), path, page);
  });

  /** Files across the root, branch heads, and releases, by path text, tags, or the caller's favorites. `sort=modified` lists recent files. */
  app.get('/v1/projects/:id/files', async (request) => {
    const { id } = parse(idParams, request.params);
    const { q, tags, favorites, area, ...page } = parse(
      z.object({
        q: z.string().max(200).optional(),
        /** Comma-separated tag ids; a file must have all of them. */
        tags: z
          .string()
          .max(2000)
          .optional()
          .transform((value) => (value ? value.split(',').filter(Boolean) : []))
          .pipe(z.array(z.uuid()).max(20)),
        favorites: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
        area: z.enum(['root', 'branch', 'release']).optional(),
        ...paging,
      }),
      request.query,
    );
    return searchFiles(sql, id, viewerId(request), { q, tagIds: tags, favorites, area }, page);
  });

  app.get('/v1/projects/:id/directory/folders', async (request) => {
    const { id } = parse(idParams, request.params);
    return listRootFolders(sql, id, viewerId(request));
  });

  app.post('/v1/projects/:id/directory/folders', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(z.object({ parentId, name }), request.body);
    reply.status(201);
    return createFolder(sql, id, requireCaller(request).userId, input);
  });

  /** Adds a root file. Upload its contents to the project first, as for a commit. */
  app.post('/v1/projects/:id/directory/files', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(z.object({ parentId, name, blob: sha256Schema }), request.body);
    reply.status(201);
    return createFile(sql, id, requireCaller(request).userId, input);
  });

  app.get('/v1/projects/:id/directory/entries/:entryId', async (request) => {
    const { id, entryId } = parse(entryParams, request.params);
    return getEntry(sql, id, viewerId(request), entryId);
  });

  /** Renames and/or moves an entry. `parentId: null` moves it to the project root. */
  app.patch('/v1/projects/:id/directory/entries/:entryId', async (request) => {
    const { id, entryId } = parse(entryParams, request.params);
    const input = parse(z.object({ name: name.optional(), parentId: parentId.optional() }).strict(), request.body);
    return moveEntry(sql, id, requireCaller(request).userId, entryId, input);
  });

  app.delete('/v1/projects/:id/directory/entries/:entryId', async (request, reply) => {
    const { id, entryId } = parse(entryParams, request.params);
    await deleteEntry(sql, id, requireCaller(request).userId, entryId);
    reply.status(204);
  });

  /** Replaces a root file's contents, recording a new revision. */
  app.post('/v1/projects/:id/directory/entries/:entryId/revisions', async (request, reply) => {
    const { id, entryId } = parse(entryParams, request.params);
    const { blob } = parse(z.object({ blob: sha256Schema }), request.body);
    reply.status(201);
    return replaceFile(sql, id, requireCaller(request).userId, entryId, blob);
  });

  app.get('/v1/projects/:id/tags', async (request) => {
    const { id } = parse(idParams, request.params);
    return listTags(sql, id, viewerId(request));
  });

  app.post('/v1/projects/:id/tags', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const input = parse(z.object({ name: tagName }), request.body);
    reply.status(201);
    return createTag(sql, id, requireCaller(request).userId, input);
  });

  app.patch('/v1/projects/:id/tags/:tagId', async (request) => {
    const { id, tagId } = parse(tagParams, request.params);
    const input = parse(z.object({ name: tagName }), request.body);
    return renameTag(sql, id, requireCaller(request).userId, tagId, input);
  });

  app.delete('/v1/projects/:id/tags/:tagId', async (request, reply) => {
    const { id, tagId } = parse(tagParams, request.params);
    await deleteTag(sql, id, requireCaller(request).userId, tagId);
    reply.status(204);
  });

  /** Sets all of a file's tags at once. `itemId` is the file's identity, wherever it appears. */
  app.put('/v1/projects/:id/items/:itemId/tags', async (request) => {
    const { id, itemId } = parse(itemParams, request.params);
    const { tagIds } = parse(z.object({ tagIds: z.array(z.uuid()).max(50) }), request.body);
    return { tags: await setFileTags(sql, id, requireCaller(request).userId, itemId, tagIds) };
  });

  app.put('/v1/projects/:id/items/:itemId/favorite', async (request) => {
    const { id, itemId } = parse(itemParams, request.params);
    return setFavorite(sql, id, requireCaller(request).userId, itemId, true);
  });

  app.delete('/v1/projects/:id/items/:itemId/favorite', async (request) => {
    const { id, itemId } = parse(itemParams, request.params);
    return setFavorite(sql, id, requireCaller(request).userId, itemId, false);
  });
}
