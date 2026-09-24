import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Caller } from './auth.js';
import { badRequest, forbidden, unauthorized } from './errors.js';

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      'invalid_request',
      'The request is invalid',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export function requireCaller(request: FastifyRequest): Caller {
  if (!request.caller) throw unauthorized();
  return request.caller;
}

/** Actions that must come from a website login, never from a desktop token (e.g. minting more tokens). */
export function requireSessionCaller(request: FastifyRequest): Caller {
  const caller = requireCaller(request);
  if (caller.via !== 'session') throw forbidden('Do this from gigacad.site while signed in');
  return caller;
}

export const viewerId = (request: FastifyRequest): string | null => request.caller?.userId ?? null;

export const idParams = z.object({ id: z.uuid() });
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a lowercase hex SHA-256');
