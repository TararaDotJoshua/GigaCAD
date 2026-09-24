import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManifestEntry } from '@gigacad/core';
import { describe, expect, it } from 'vitest';
import { saveWorkspace, trackedFrom, type WorkspaceState } from '../src/workspace.js';
import { hashFile } from '../src/scan.js';
import { tempDir, testCli } from './context.js';

// Nothing listens here, so every API call fails fast; these tests cover what happens before the API.
const OFFLINE_API = 'http://127.0.0.1:1';

/** A workspace as `giga clone` would leave it, without a server. */
async function fakeWorkspace(files: Record<string, string>): Promise<string> {
  const root = await tempDir('giga-ws-');
  const base: ManifestEntry[] = [];
  let n = 0;
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split('/'));
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, content);
    base.push({ path, blob: await hashFile(absolute), itemId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });
  }
  const state: WorkspaceState = {
    version: 1,
    apiUrl: OFFLINE_API,
    projectId: '00000000-0000-4000-8000-00000000aaaa',
    owner: 'alex',
    slug: 'robot',
    branchId: '00000000-0000-4000-8000-00000000bbbb',
    branchName: 'dev',
    machine: 'test (giga 00000000)',
    headCommitId: '00000000-0000-4000-8000-00000000cccc',
    base,
    tracked: trackedFrom(base),
    cache: {},
  };
  await saveWorkspace(root, state);
  return root;
}

const readState = async (root: string) => JSON.parse(await readFile(join(root, '.giga', 'workspace.json'), 'utf8')) as WorkspaceState;

describe('giga mv', () => {
  it('moves the file and keeps its item id, from any subfolder', async () => {
    const root = await fakeWorkspace({ 'Robot.SLDASM': 'asm', 'parts/P1.SLDPRT': 'p1' });
    const cli = await testCli();
    const before = await readState(root);
    const p1Item = before.tracked['parts/P1.SLDPRT'];

    const moved = await cli.run(['mv', 'P1.SLDPRT', '../bought/Bracket.SLDPRT', '--json'], { cwd: join(root, 'parts') });
    expect(moved.code).toBe(0);
    expect(moved.json()).toMatchObject({ from: 'parts/P1.SLDPRT', to: 'bought/Bracket.SLDPRT' });
    expect(await readFile(join(root, 'bought', 'Bracket.SLDPRT'), 'utf8')).toBe('p1');

    const after = await readState(root);
    expect(after.tracked).toEqual({ 'Robot.SLDASM': before.tracked['Robot.SLDASM'], 'bought/Bracket.SLDPRT': p1Item });
    expect(after.base).toEqual(before.base);

    // status works offline (it says the server is unreachable) and shows the move with the same item.
    const status = await cli.run(['status', '--json'], { cwd: root });
    expect(status.code).toBe(0);
    expect(status.json().changes).toEqual([{ kind: 'moved', path: 'bought/Bracket.SLDPRT', from: 'parts/P1.SLDPRT', itemId: p1Item, modified: false }]);
    expect(status.json().remote).toBeNull();
  });

  it('moves whole folders and refuses to overwrite', async () => {
    const root = await fakeWorkspace({ 'parts/A.SLDPRT': 'a', 'parts/sub/B.SLDPRT': 'b', 'C.SLDPRT': 'c' });
    const cli = await testCli();
    const before = await readState(root);

    expect((await cli.run(['mv', 'parts', 'components'], { cwd: root })).code).toBe(0);
    const after = await readState(root);
    expect(after.tracked['components/A.SLDPRT']).toBe(before.tracked['parts/A.SLDPRT']);
    expect(after.tracked['components/sub/B.SLDPRT']).toBe(before.tracked['parts/sub/B.SLDPRT']);

    const clash = await cli.run(['mv', 'C.SLDPRT', 'components/A.SLDPRT'], { cwd: root });
    expect(clash.code).toBe(1);
    expect(clash.stderr).toContain('already exists');
  });
});

describe('dirty workspace protection', () => {
  it('will not check in over uncommitted changes without --force', async () => {
    const root = await fakeWorkspace({ 'A.SLDPRT': 'a' });
    await writeFile(join(root, 'A.SLDPRT'), 'edited');
    const cli = await testCli({ env: { GIGA_TOKEN: 'gcd_test' } });

    const blocked = await cli.run(['checkin', '--json'], { cwd: root });
    expect(blocked.code).toBe(1);
    expect(blocked.errorJson().error).toMatchObject({ code: 'uncommitted_changes', details: { paths: ['A.SLDPRT'] } });

    // With --force it goes on to the API (which is offline here).
    const forced = await cli.run(['checkin', '--force', '--json'], { cwd: root });
    expect(forced.errorJson().error.code).toBe('network');
  });

  it('has nothing to commit in a clean workspace', async () => {
    const root = await fakeWorkspace({ 'A.SLDPRT': 'a', '~$A.SLDPRT': 'lock file' });
    const cli = await testCli({ env: { GIGA_TOKEN: 'gcd_test' } });
    const result = await cli.run(['commit', '-m', 'nothing', '--json'], { cwd: root });
    expect(result.errorJson().error.code).toBe('nothing_to_commit');
  });

  it('refuses to use a workspace against a different API', async () => {
    const root = await fakeWorkspace({ 'A.SLDPRT': 'a' });
    const cli = await testCli({ env: { GIGA_API_URL: 'http://127.0.0.1:2' } });
    const result = await cli.run(['status', '--json'], { cwd: root });
    expect(result.errorJson().error.code).toBe('api_mismatch');
  });

  it('refuses to clone into a folder that is not empty, before calling the API', async () => {
    const cli = await testCli({ env: { GIGA_TOKEN: 'gcd_test' } });
    const parent = await tempDir();
    await mkdir(join(parent, 'robot'));
    await writeFile(join(parent, 'robot', 'keep.txt'), 'mine');
    const result = await cli.run(['clone', 'alex/robot', 'robot', '--branch', 'dev', '--json', '--api-url', OFFLINE_API], { cwd: parent });
    expect(result.errorJson().error.code).toBe('directory_not_empty');
    expect(await readFile(join(parent, 'robot', 'keep.txt'), 'utf8')).toBe('mine');
  });
});
