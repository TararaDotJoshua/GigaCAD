import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, type TestUser } from '../../../apps/api/test/helpers.js';
import { loadConfig } from '../src/config.js';
import { tempDir, testCli, type TestCli } from './context.js';
import { newUser, signIn, startStack, type Stack } from './stack.js';

let stack: Stack;
let alex: TestUser;
let bea: TestUser;

beforeAll(async () => {
  stack = await startStack();
  [alex, bea] = await Promise.all([newUser(stack, 'alex'), newUser(stack, 'bea')]);
});

afterAll(async () => {
  await stack?.close();
});

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');

/** A signed-in CLI on its own "computer" (config folder) pointed at the test API. */
async function computer(user: TestUser): Promise<TestCli> {
  const cli = await testCli({ env: { GIGA_API_URL: stack.apiUrl } });
  await signIn(stack, cli, user);
  return cli;
}

async function ok(cli: TestCli, args: string[], cwd?: string) {
  const result = await cli.run([...args, '--json'], cwd ? { cwd } : {});
  if (result.code !== 0) throw new Error(`giga ${args.join(' ')} failed:\n${result.stderr}`);
  return result.json();
}

async function fails(cli: TestCli, args: string[], cwd?: string) {
  const result = await cli.run([...args, '--json'], cwd ? { cwd } : {});
  expect(result.code).toBe(1);
  return result.errorJson().error;
}

async function write(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split('/'));
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, content);
  }
}

const read = (root: string, path: string) => readFile(join(root, ...path.split('/')), 'utf8');
const readState = async (root: string) => readFile(join(root, '.giga', 'workspace.json'), 'utf8');

async function newProject(cli: TestCli, user: TestUser): Promise<string> {
  const slug = `robot-${randomUUID().slice(0, 8)}`;
  await ok(cli, ['project', 'create', slug, '--name', 'Robot']);
  return `${user.handle}/${slug}`;
}

describe('device sign-in', () => {
  it('signs in through the browser flow, saves the token privately, and revokes it on logout', async () => {
    const cli = await testCli({ env: { GIGA_API_URL: stack.apiUrl } });
    const login = await signIn(stack, cli, alex);
    expect(login.json()).toMatchObject({ apiUrl: stack.apiUrl, handle: alex.handle, userId: alex.id });

    const saved = (await loadConfig(cli.configDir)).credentials[stack.apiUrl]!;
    expect(saved.token).toMatch(/^gcd_/);
    expect(saved.tokenId).toMatch(/^[0-9a-f-]{36}$/);
    expect(login.stdout + login.stderr).not.toContain(saved.token);

    const whoami = await ok(cli, ['whoami']);
    expect(whoami).toMatchObject({ handle: alex.handle, tokenSource: 'config' });

    // The web session sees the new device token by name.
    const tokens = await client(stack, alex).get('/v1/me/tokens');
    expect(tokens.body.map((token: { id: string }) => token.id)).toContain(saved.tokenId);

    const logout = await ok(cli, ['logout']);
    expect(logout).toMatchObject({ signedOut: true, revoked: true });
    expect((await loadConfig(cli.configDir)).credentials[stack.apiUrl]).toBeUndefined();
    expect((await client(stack, { ...alex, token: saved.token }).get('/v1/me')).status).toBe(401);
    expect((await fails(cli, ['whoami'])).code).toBe('unauthorized');
  });

  it('uses GIGA_TOKEN without saving it', async () => {
    const signedIn = await computer(alex);
    const token = (await loadConfig(signedIn.configDir)).credentials[stack.apiUrl]!.token;
    const ci = await testCli({ env: { GIGA_API_URL: stack.apiUrl, GIGA_TOKEN: token } });
    expect(await ok(ci, ['whoami'])).toMatchObject({ handle: alex.handle, tokenSource: 'env' });
    expect((await loadConfig(ci.configDir)).credentials).toEqual({});
    expect((await fails(ci, ['logout'])).code).toBe('token_from_env');
  });
});

describe('workspace round trip', () => {
  it('clones, checks out, commits edits and renames, and checks in', async () => {
    const cli = await computer(alex);
    const project = await newProject(cli, alex);
    await ok(cli, ['branch', 'create', 'dev', '--project', project]);

    const parent = await tempDir();
    const root = join(parent, 'robot');
    const cloned = await ok(cli, ['clone', project, 'robot', '--branch', 'dev'], parent);
    expect(cloned).toMatchObject({ directory: root, files: 0 });

    // Nobody holds the lock yet, so committing is refused and nothing changes locally.
    await write(root, { 'Robot.SLDASM': 'asm v1', 'parts/P1.SLDPRT': 'p1 v1', 'parts/~$P1.SLDPRT': 'lock file' });
    const stateBefore = await readState(root);
    expect((await fails(cli, ['commit', '-m', 'too early'], root)).code).toBe('not_checked_out');
    expect(await readState(root)).toBe(stateBefore);

    const checkout = await ok(cli, ['checkout'], root);
    expect(checkout.branch.checkedOutByHandle).toBe(alex.handle);

    const status = await ok(cli, ['status'], join(root, 'parts'));
    expect(status.changes.map((change: { kind: string; path: string }) => `${change.kind} ${change.path}`)).toEqual([
      'added parts/P1.SLDPRT',
      'added Robot.SLDASM',
    ]);
    expect(status.remote.checkedOut).toMatchObject({ here: true });

    const first = await ok(cli, ['commit', '-m', 'First version', '--label', 'rev A'], root);
    expect(first.commit).toMatchObject({ message: 'First version', versionLabel: 'rev A', kind: 'version' });
    expect(first.uploaded).toBe(2);
    expect((await ok(cli, ['status'], root)).changes).toEqual([]);

    const branchId = JSON.parse(await readState(root)).branchId as string;
    const head = await client(stack, alex).get(`/v1/branches/${branchId}`);
    expect(head.body.files.map((file: { path: string; blob: string }) => [file.path, file.blob])).toEqual([
      ['parts/P1.SLDPRT', sha256('p1 v1')],
      ['Robot.SLDASM', sha256('asm v1')],
    ]);
    const p1Item = head.body.files.find((file: { path: string }) => file.path === 'parts/P1.SLDPRT').itemId;

    // A rename with giga mv keeps the item; an unchanged file isn't uploaded again.
    await ok(cli, ['mv', 'parts/P1.SLDPRT', 'parts/Bracket.SLDPRT'], root);
    await write(root, { 'Robot.SLDASM': 'asm v2' });
    const second = await ok(cli, ['commit', '-m', 'Rename the bracket'], root);
    expect(second.uploaded).toBe(1);
    const renamed = await client(stack, alex).get(`/v1/branches/${branchId}`);
    expect(renamed.body.files.find((file: { path: string }) => file.path === 'parts/Bracket.SLDPRT')).toMatchObject({
      itemId: p1Item,
      blob: sha256('p1 v1'),
    });

    const checkin = await ok(cli, ['checkin'], root);
    expect(checkin.checkedOutBy).toBeNull();

    // A fresh clone gets exactly the committed bytes.
    const again = await tempDir();
    await ok(cli, ['clone', project, 'copy', '--branch', 'dev'], again);
    expect(await read(join(again, 'copy'), 'parts/Bracket.SLDPRT')).toBe('p1 v1');
    expect(await read(join(again, 'copy'), 'Robot.SLDASM')).toBe('asm v2');
  });
});

describe('exports', () => {
  it('attaches a STEP exported from SolidWorks to a committed part', async () => {
    const cli = await computer(alex);
    const project = await newProject(cli, alex);
    await ok(cli, ['branch', 'create', 'dev', '--project', project]);
    const parent = await tempDir();
    const root = join(parent, 'bracket');
    await ok(cli, ['clone', project, 'bracket', '--branch', 'dev'], parent);
    await ok(cli, ['checkout'], root);
    await write(root, { 'parts/Bracket.SLDPRT': 'bracket v1', 'Notes.txt': 'notes' });
    await ok(cli, ['commit', '-m', 'Bracket'], root);

    // Exports usually live outside the workspace, next to wherever SolidWorks saved them.
    const exportsDir = await tempDir();
    await write(exportsDir, { 'Bracket.step': 'ISO-10303-21; bracket', 'Bracket.igs': 'iges' });
    const added = await ok(cli, ['export', 'parts/Bracket.SLDPRT', join(exportsDir, 'Bracket.step')], root);
    expect(added).toMatchObject({ path: 'parts/Bracket.SLDPRT', format: 'step', sha256: sha256('ISO-10303-21; bracket') });

    const projectId = JSON.parse(await readState(root)).projectId as string;
    const lookup = await client(stack, alex).post(`/v1/projects/${projectId}/exports/lookup`, { sha256s: [sha256('bracket v1')] });
    expect(lookup.body.exports[sha256('bracket v1')]).toEqual([expect.objectContaining({ format: 'step' })]);

    expect((await fails(cli, ['export', 'Notes.txt', join(exportsDir, 'Bracket.step')], root)).code).toBe('not_exportable');
    expect((await fails(cli, ['export', 'parts/Bracket.SLDPRT', join(exportsDir, 'Bracket.igs')], root)).code).toBe('unsupported_export');
    await write(root, { 'parts/New.SLDPRT': 'not committed yet' });
    expect((await fails(cli, ['export', 'parts/New.SLDPRT', join(exportsDir, 'Bracket.step')], root)).code).toBe('not_committed');
  });
});

describe('locks and stale heads', () => {
  it('rejects a second machine and a commit on top of an old head, leaving local state intact', async () => {
    const laptop = await computer(alex);
    const desktop = await computer(alex);
    const project = await newProject(laptop, alex);
    await ok(laptop, ['branch', 'create', 'dev', '--project', project]);

    const parent = await tempDir();
    await ok(laptop, ['clone', project, 'one', '--branch', 'dev'], parent);
    await ok(laptop, ['clone', project, 'two', '--branch', 'dev'], parent);
    await ok(desktop, ['clone', project, 'desk', '--branch', 'dev'], parent);
    const [one, two, desk] = ['one', 'two', 'desk'].map((name) => join(parent, name)) as [string, string, string];

    await ok(laptop, ['checkout'], one);
    const blocked = await fails(desktop, ['checkout'], desk);
    expect(blocked).toMatchObject({ code: 'checked_out', details: { handle: alex.handle } });
    expect(blocked.message).toContain('test-computer (giga ');

    // Folder "one" commits; folder "two" (same computer, so it shares the lock) is now behind.
    await write(one, { 'A.SLDPRT': 'a from one' });
    await ok(laptop, ['commit', '-m', 'one'], one);
    await write(two, { 'B.SLDPRT': 'b from two' });
    const stateBefore = await readState(two);
    expect((await fails(laptop, ['commit', '-m', 'two'], two)).code).toBe('stale_head');
    expect(await readState(two)).toBe(stateBefore);
    expect(await read(two, 'B.SLDPRT')).toBe('b from two');

    // Pulling keeps the unrelated local file; then the commit goes through.
    const pulled = await ok(laptop, ['pull'], two);
    expect(pulled.written).toEqual(['A.SLDPRT']);
    expect(await read(two, 'B.SLDPRT')).toBe('b from two');
    await ok(laptop, ['commit', '-m', 'two'], two);

    // Folder "one" edited the same file the branch just changed: pull refuses and changes nothing.
    await write(one, { 'B.SLDPRT': 'b from one' });
    const conflict = await fails(laptop, ['pull'], one);
    expect(conflict).toMatchObject({ code: 'pull_conflicts', details: [{ path: 'B.SLDPRT' }] });
    expect(await read(one, 'B.SLDPRT')).toBe('b from one');

    // Checking in with that edit pending needs --force.
    expect((await fails(laptop, ['checkin'], one)).code).toBe('uncommitted_changes');
    await ok(laptop, ['checkin', '--force'], one);
    expect(await read(one, 'B.SLDPRT')).toBe('b from one');
  });
});

describe('release scenario through giga', () => {
  it('v1 -> v2 on branch A -> v3 from branch B with keep-main and replacement picks', async () => {
    const cli = await computer(alex);
    const project = await newProject(cli, alex);
    const parent = await tempDir();

    /** Clone, check out, write files (null deletes), commit, check in, and release through a release request. */
    async function releaseFrom(branch: string, files: Record<string, string | null>, picks?: object) {
      const root = join(parent, branch);
      await ok(cli, ['clone', project, branch, '--branch', branch], parent);
      await ok(cli, ['checkout'], root);
      for (const [path, content] of Object.entries(files)) {
        if (content === null) await rm(join(root, ...path.split('/')));
        else await write(root, { [path]: content });
      }
      await ok(cli, ['commit', '-m', `work on ${branch}`], root);
      await ok(cli, ['checkin'], root);

      const opened = await ok(cli, ['rr', 'open', '--title', `Release ${branch}`], root);
      if (picks) {
        const picksFile = join(parent, `${branch}-picks.json`);
        await writeFile(picksFile, JSON.stringify(picks));
        const picked = await ok(cli, ['rr', 'picks', '--file', picksFile], root);
        expect(picked.preview.errors).toEqual([]);
      }
      await ok(cli, ['rr', 'candidate'], root);
      await ok(cli, ['rr', 'approve'], root);
      const released = await ok(cli, ['rr', 'release', `#${opened.releaseRequest.number}`, '--notes', `from ${branch}`], root);
      return { root, opened, released };
    }

    await ok(cli, ['branch', 'create', 'initial', '--project', project]);
    const v1 = await releaseFrom('initial', {
      'Robot.SLDASM': 'asm v1',
      'parts/P1.SLDPRT': 'p1 v1',
      'parts/P2.SLDPRT': 'p2 v1',
      'parts/P4.SLDPRT': 'p4 v1',
    });
    expect(v1.released.release.number).toBe(1);
    const v1Files = (await ok(cli, ['release', 'show', '1', '--project', project])).files as { path: string; itemId: string }[];
    const itemId = (path: string) => v1Files.find((file) => file.path === path)!.itemId;

    // Both branches start from v1.
    await ok(cli, ['branch', 'create', 'A', '--project', project]);
    await ok(cli, ['branch', 'create', 'B', '--project', project]);

    const v2 = await releaseFrom('A', { 'parts/P1.SLDPRT': 'p1 from A' });
    expect(v2.released.release.number).toBe(2);

    // B edits P1 and P2 and adds P3 to replace P4; the release keeps main's P1 and assembly.
    const v3 = await releaseFrom(
      'B',
      { 'Robot.SLDASM': 'asm from B', 'parts/P1.SLDPRT': 'p1 from B', 'parts/P2.SLDPRT': 'p2 from B', 'parts/P3.SLDPRT': 'p3 from B', 'parts/P4.SLDPRT': null },
      {
        actions: { 'Robot.SLDASM': 'keep_main', 'parts/P1.SLDPRT': 'keep_main' },
        replacements: [{ branchPath: 'parts/P3.SLDPRT', mainPath: 'parts/P4.SLDPRT' }],
      },
    );
    expect(v3.released.release.number).toBe(3);

    const diff = await ok(cli, ['rr', 'diff', `${v3.opened.releaseRequest.number}`, '--project', project]);
    expect(diff.releaseRequest.picks.replacements).toEqual([{ branchItemId: expect.any(String), mainItemId: itemId('parts/P4.SLDPRT') }]);

    const released = await ok(cli, ['release', 'show', 'v3', '--project', project]);
    expect(released.files).toEqual([
      { itemId: itemId('parts/P1.SLDPRT'), path: 'parts/P1.SLDPRT', blob: sha256('p1 from A') },
      { itemId: itemId('parts/P2.SLDPRT'), path: 'parts/P2.SLDPRT', blob: sha256('p2 from B') },
      { itemId: itemId('parts/P4.SLDPRT'), path: 'parts/P3.SLDPRT', blob: sha256('p3 from B') },
      { itemId: itemId('Robot.SLDASM'), path: 'Robot.SLDASM', blob: sha256('asm v1') },
    ]);

    // Exported bytes match the released hashes.
    const exported = await ok(cli, ['release', 'export', '3', join(parent, 'v3'), '--project', project]);
    expect(exported.files).toHaveLength(4);
    expect(await read(join(parent, 'v3'), 'parts/P1.SLDPRT')).toBe('p1 from A');
    expect(await read(join(parent, 'v3'), 'parts/P3.SLDPRT')).toBe('p3 from B');
    expect(await read(join(parent, 'v3'), 'Robot.SLDASM')).toBe('asm v1');

    const list = await ok(cli, ['release', 'list', '--project', project]);
    expect(list.map((release: { number: number }) => release.number)).toEqual([3, 2, 1]);
  });

  it('attaches a rebuild report from a file and never invents one', async () => {
    const cli = await computer(alex);
    const project = await newProject(cli, alex);
    await client(stack, alex).put(`/v1/projects/${(await ok(cli, ['project', 'show', project])).project.id}/approval-rules`, {
      requiredCount: 1,
      approverUserIds: [],
      approverRoles: ['owner'],
      allowSelfApproval: true,
      requireCleanRebuild: true,
    });
    await ok(cli, ['branch', 'create', 'dev', '--project', project]);
    const parent = await tempDir();
    const root = join(parent, 'dev');
    await ok(cli, ['clone', project, 'dev', '--branch', 'dev'], parent);
    await ok(cli, ['checkout'], root);
    await write(root, { 'Robot.SLDASM': 'asm' });
    await ok(cli, ['commit', '-m', 'asm'], root);
    await ok(cli, ['checkin'], root);
    await ok(cli, ['rr', 'open'], root);
    const candidate = await ok(cli, ['rr', 'candidate'], root);
    await ok(cli, ['rr', 'approve'], root);

    const blocked = await fails(cli, ['rr', 'release'], root);
    expect(blocked).toMatchObject({ code: 'approval_required', details: { blockers: [{ kind: 'rebuild_missing' }] } });

    const reportFile = join(parent, 'report.json');
    await writeFile(reportFile, JSON.stringify({ status: 'passed', messages: [] }));
    expect((await fails(cli, ['rr', 'rebuild-report', '--file', reportFile], root)).code).toBe('invalid_report');

    await writeFile(reportFile, JSON.stringify({ candidateManifestId: candidate.candidate.manifestId, status: 'passed', messages: [] }));
    const reported = await ok(cli, ['rr', 'rebuild-report', '--file', reportFile], root);
    expect(reported.releaseRequest.rebuildStatus).toBe('passed');
    expect((await ok(cli, ['rr', 'release'], root)).release.number).toBe(1);
  });
});

describe('private projects', () => {
  it('hides a private project from people who are not members', async () => {
    const alexCli = await computer(alex);
    const beaCli = await computer(bea);
    const project = await newProject(alexCli, alex);
    await ok(alexCli, ['branch', 'create', 'dev', '--project', project]);
    const error = await fails(beaCli, ['clone', project, 'x', '--branch', 'dev'], await tempDir());
    expect(error.code).toBe('not_found');
  });
});
