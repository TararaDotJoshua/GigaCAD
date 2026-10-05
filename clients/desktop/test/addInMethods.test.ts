import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { branchSignatures, changedFolders, fileState, registerAddInMethods, type AddInHost } from '../src/main/addInMethods.js';
import type { PluginPipeServer, RequestHandler } from '../src/main/plugins/pipeServer.js';
import { METHODS, RpcError } from '../src/main/plugins/protocol.js';
import type { BranchState, ProjectState } from '../src/shared/types.js';

const folder = mkdtempSync(join(tmpdir(), 'gigacad-addin-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const projectDir = join(folder, 'alex', 'arm');
const branchDir = (name: string) => join(projectDir, 'Branches', name);

function branch(name: string, extra: Partial<BranchState> = {}): BranchState {
  return { id: `b-${name}`, name, status: 'open', downloaded: true, dir: branchDir(name), holder: null, holderHandle: null, holderMachine: null, headCommitId: `c-${name}`, busy: false, ...extra };
}

const project = (role: ProjectState['role'] = 'owner'): ProjectState => ({
  id: 'p1',
  owner: 'alex',
  slug: 'arm',
  name: 'Arm',
  role,
  dir: projectDir,
  hidden: false,
  branches: [
    branch('mine', { holder: 'me', holderHandle: 'alex' }),
    branch('theirs', { holder: 'other', holderHandle: 'sam' }),
    branch('cloud', { downloaded: false, holder: 'me', holderHandle: 'alex' }),
    branch('frozen', { status: 'frozen', holder: 'me', holderHandle: 'alex' }),
  ],
  releases: [],
  error: null,
});

function setup(role: ProjectState['role'] = 'owner') {
  let projects = [project(role)];
  const host = {
    folder: () => folder,
    user: () => ({ handle: 'alex' }),
    projects: () => projects,
    checkout: vi.fn(async () => undefined),
    checkin: vi.fn(async () => undefined),
    commitVersion: vi.fn(async (_projectId: string, name: string) => {
      projects = projects.map((candidate) => ({ ...candidate, branches: candidate.branches.map((b) => (b.name === name ? { ...b, headCommitId: 'c-new' } : b)) }));
    }),
    giga: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
  } satisfies AddInHost;
  const handlers = new Map<string, RequestHandler>();
  registerAddInMethods({ handle: (method: string, handler: RequestHandler) => handlers.set(method, handler) } as unknown as PluginPipeServer, host);
  const session = { sessionId: 's', clientId: 'solidworks', clientVersion: '1', cadName: 'SolidWorks', cadVersion: '2025', processId: 1 };
  const call = (method: string, params: unknown) => Promise.resolve().then(() => handlers.get(method)!(params, session));
  return { host, call, handlers };
}

describe('fileState', () => {
  const { host } = setup();

  it('knows what can be written and who holds each branch', () => {
    expect(fileState(host, join(branchDir('mine'), 'Arm.SLDPRT'))).toEqual({
      path: join(branchDir('mine'), 'Arm.SLDPRT'),
      isGigaPath: true,
      project: 'alex/arm',
      branch: 'mine',
      writable: true,
      checkedOutBy: 'alex',
    });
    expect(fileState(host, join(branchDir('theirs'), 'Arm.SLDPRT'))).toMatchObject({ writable: false, checkedOutBy: 'sam' });
    expect(fileState(host, join(branchDir('cloud'), 'Arm.SLDPRT'))).toMatchObject({ writable: false });
    expect(fileState(host, join(branchDir('frozen'), 'Arm.SLDPRT'))).toMatchObject({ writable: false });
    expect(fileState(host, join(projectDir, 'Releases', 'v3', 'Arm.SLDPRT'))).toMatchObject({ isGigaPath: true, writable: false });
  });

  it('lets editors change root files, and nobody change things outside the folder', () => {
    expect(fileState(host, join(projectDir, 'Quotes', 'steel.pdf'))).toMatchObject({ writable: true });
    expect(fileState(setup('viewer').host, join(projectDir, 'Quotes', 'steel.pdf'))).toMatchObject({ writable: false });
    expect(fileState(host, join(tmpdir(), 'elsewhere.SLDPRT'))).toEqual({ path: join(tmpdir(), 'elsewhere.SLDPRT'), isGigaPath: false, writable: false });
  });
});

describe('add-in methods', () => {
  it('answers files.getState for each path', async () => {
    const { call } = setup();
    const states = (await call(METHODS.getFileState, { paths: [join(branchDir('mine'), 'a.SLDPRT'), join(branchDir('theirs'), 'b.SLDPRT')] })) as { writable: boolean }[];
    expect(states.map((state) => state.writable)).toEqual([true, false]);
    await expect(call(METHODS.getFileState, { paths: 'nope' })).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('checks branches out and in from any path inside them', async () => {
    const { host, call } = setup();
    expect(await call(METHODS.checkout, { path: join(branchDir('theirs'), 'parts', 'Arm.SLDPRT') })).toMatchObject({ branch: 'theirs' });
    expect(host.checkout).toHaveBeenCalledWith('p1', 'theirs');
    await call(METHODS.checkin, { path: branchDir('mine') });
    expect(host.checkin).toHaveBeenCalledWith('p1', 'mine');
  });

  it('refuses paths outside branches with a reason', async () => {
    const { call } = setup();
    await expect(call(METHODS.checkout, { path: join(projectDir, 'Releases', 'v1') })).rejects.toMatchObject({ code: 'not_a_branch' });
    await expect(call(METHODS.checkout, { path: join(tmpdir(), 'x') })).rejects.toMatchObject({ code: 'not_in_gigacad' });
    await expect(call(METHODS.checkout, {})).rejects.toBeInstanceOf(RpcError);
  });

  it('commits a version and returns its id', async () => {
    const { host, call } = setup();
    expect(await call(METHODS.commitVersion, { path: branchDir('mine'), message: 'Stronger', label: 'rev B' })).toEqual({ commitId: 'c-new' });
    expect(host.commitVersion).toHaveBeenCalledWith('p1', 'mine', 'Stronger', 'rev B');
    await expect(call(METHODS.commitVersion, { path: branchDir('mine') })).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('reports references inside the branch against the file’s hash', async () => {
    const { host, call } = setup();
    mkdirSync(branchDir('mine'), { recursive: true });
    const assembly = join(branchDir('mine'), 'Robot.SLDASM');
    writeFileSync(assembly, 'robot');
    const sha = createHash('sha256').update('robot').digest('hex');
    await call(METHODS.reportReferences, {
      path: assembly,
      references: [
        { path: join(branchDir('mine'), 'parts', 'Arm.SLDPRT'), type: 'component' },
        { path: join(tmpdir(), 'SOLIDWORKS Data', 'Toolbox', 'bolt.sldprt'), type: 'component' },
      ],
    });
    expect(host.put).toHaveBeenCalledWith(`/v1/projects/p1/blobs/${sha}/references`, { paths: ['parts/Arm.SLDPRT'] });
  });

  it('attaches STEP and STL exports with giga export', async () => {
    const { host, call } = setup();
    await call(METHODS.attachExport, { sourcePath: join(branchDir('mine'), 'parts', 'Arm.SLDPRT'), exportPath: join(tmpdir(), 'Arm.step'), format: 'step' });
    expect(host.giga).toHaveBeenCalledWith(['export', 'parts/Arm.SLDPRT', join(tmpdir(), 'Arm.step')], branchDir('mine'));
    await expect(call(METHODS.attachExport, { sourcePath: join(branchDir('mine'), 'Arm.SLDPRT'), exportPath: 'Arm.obj' })).rejects.toMatchObject({ code: 'unsupported_export' });
    await expect(call(METHODS.attachExport, { sourcePath: join(branchDir('mine'), 'Arm.SLDPRT'), exportPath: 'Arm.stl', format: 'step' })).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('says rebuild reports need giga for now', async () => {
    const { call } = setup();
    await expect(call(METHODS.submitRebuildReport, { path: branchDir('mine') })).rejects.toMatchObject({ code: 'not_implemented' });
  });
});

describe('announcing changes', () => {
  it('names the branch folders whose holder, status, head, or download changed', () => {
    const before = branchSignatures([project()]);
    const next = project();
    const after = branchSignatures([
      {
        ...next,
        branches: next.branches.filter((b) => b.name !== 'frozen').map((b) => (b.name === 'theirs' ? { ...b, holder: null, holderHandle: null } : b.name === 'mine' ? { ...b, busy: true } : b)),
      },
    ]);
    expect(changedFolders(before, after).sort()).toEqual([branchDir('frozen'), branchDir('theirs')].sort());
    expect(changedFolders(after, after)).toEqual([]);
  });
});
