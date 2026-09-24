import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testCli } from './context.js';

describe('command parsing', () => {
  it('prints help and the version', async () => {
    const cli = await testCli();
    const help = await cli.run(['--help']);
    expect(help.code).toBe(0);
    for (const command of ['login', 'clone', 'checkout', 'commit', 'rr', 'release']) expect(help.stdout).toContain(command);

    const version = await cli.run(['--version']);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects unknown commands and missing required options', async () => {
    const cli = await testCli();
    const unknown = await cli.run(['frobnicate']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("unknown command 'frobnicate'");

    const noMessage = await cli.run(['commit']);
    expect(noMessage.code).toBe(1);
    expect(noMessage.stderr).toContain("required option '-m, --message <message>'");

    const noBranch = await cli.run(['clone', 'alex/robot']);
    expect(noBranch.code).toBe(1);
    expect(noBranch.stderr).toContain('--branch');
  });

  it('validates project names and API URLs before calling the API', async () => {
    const cli = await testCli({ env: { GIGA_TOKEN: 'gcd_test' } });
    const badProject = await cli.run(['project', 'show', 'not-a-project', '--json', '--api-url', 'http://127.0.0.1:1']);
    expect(badProject.code).toBe(1);
    expect(badProject.errorJson().error.code).toBe('invalid_project');

    const badUrl = await cli.run(['whoami', '--api-url', 'ftp://example.com']);
    expect(badUrl.code).toBe(1);
    expect(badUrl.stderr).toContain('must start with http:// or https://');
  });

  it('asks for sign-in instead of calling the API without a token', async () => {
    const cli = await testCli();
    const result = await cli.run(['project', 'list', '--json', '--api-url', 'http://127.0.0.1:1']);
    expect(result.code).toBe(1);
    expect(result.errorJson().error).toMatchObject({ code: 'unauthorized', hint: expect.stringContaining('giga login') });
  });
});

describe('API error output', () => {
  let server: Server;
  let apiUrl: string;
  const token = 'gcd_super_secret_token_value';
  const seenAuth: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      seenAuth.push(request.headers.authorization ?? '');
      response.setHeader('content-type', 'application/json');
      if (request.url === '/v1/projects') {
        response.statusCode = 409;
        response.end(JSON.stringify({ error: { code: 'stale_head', message: 'The branch moved on; refresh and try again', details: { headCommitId: 'x' } } }));
      } else if (request.url === '/v1/me') {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: { code: 'unauthorized', message: 'Sign in to continue' } }));
      } else {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong' } }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('shows the server message with a recovery hint, and never the token', async () => {
    const cli = await testCli({ env: { GIGA_TOKEN: token, GIGA_API_URL: apiUrl } });
    const human = await cli.run(['project', 'list']);
    expect(human.code).toBe(1);
    expect(human.stderr).toContain('error: The branch moved on; refresh and try again');
    expect(human.stderr).toContain('hint: Someone committed to this branch');
    expect(seenAuth.at(-1)).toBe(`Bearer ${token}`);

    const json = await cli.run(['project', 'list', '--json']);
    expect(json.stdout).toBe('');
    expect(json.errorJson().error).toMatchObject({ code: 'stale_head', status: 409, details: { headCommitId: 'x' } });

    const revoked = await cli.run(['whoami']);
    expect(revoked.stderr).toContain('Your sign-in is no longer valid');
    expect(revoked.stderr).toContain('giga login');

    for (const output of [human, json, revoked]) expect(output.stdout + output.stderr).not.toContain(token);
  });

  it('reports an unreachable API without a stack trace', async () => {
    const cli = await testCli({ env: { GIGA_TOKEN: token } });
    const result = await cli.run(['project', 'list', '--api-url', 'http://127.0.0.1:1']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^error: Can't reach the GigaCAD API at http:\/\/127\.0\.0\.1:1/);
    expect(result.stderr).not.toContain('    at ');
  });
});
