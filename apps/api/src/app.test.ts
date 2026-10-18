import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { Sql } from './db.js';
import type { BlobStorage } from './storage.js';

describe('errors', () => {
  it('answers a number too large for the database as a bad request, not a server error', async () => {
    const app = buildApp({ sql: {} as Sql, storage: {} as BlobStorage, authenticate: async () => null, webOrigin: 'http://localhost:3000' });
    app.get('/too-large', async () => {
      throw Object.assign(new Error('value "1099511627776" is out of range for type integer'), { code: '22003' });
    });
    const response = await app.inject({ method: 'GET', url: '/too-large' });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: { code: 'out_of_range', message: 'A number in the request is too large' } });
    await app.close();
  });
});
