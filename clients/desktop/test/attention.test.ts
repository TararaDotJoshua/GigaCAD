import { describe, expect, it } from 'vitest';
import { needsYouCount, notices, pauseEnd, snapshot } from '../src/main/attention.js';
import { FIXTURES } from '../src/renderer/preview/fixtures.js';
import type { Approval, ProjectState } from '../src/shared/types.js';

const base = FIXTURES.find((fixture) => fixture.name === 'project')!.state;
const all = { conflicts: true, approvals: true, checkouts: true, problems: true };
const change = (edit: (project: ProjectState) => ProjectState) => base.projects.map((project) => (project.id === 'rover' ? edit(project) : project));
const approval: Approval = { projectId: 'rover', number: 8, title: 'Mast camera', branchName: 'mast-camera' };

describe('notices', () => {
  it('sets a baseline first, without telling', () => {
    expect(notices(null, snapshot(base.projects, base.approvals), base.projects, base.approvals, all)).toEqual([]);
  });

  it('tells about new conflicts, approvals, and checkouts of branches you have', () => {
    const before = snapshot(base.projects, base.approvals);
    const projects = change((project) => ({
      ...project,
      conflicts: [{ path: 'bom.csv', copy: 'bom (conflict).csv', at: '2026-10-14T10:00:00Z' }],
      branches: project.branches.map((branch) => (branch.name === 'suspension-v3' ? branch : branch.name === 'gripper' ? { ...branch, downloaded: true, holder: 'other' as const, holderHandle: 'josh' } : branch)),
    }));
    const approvals = [...base.approvals, approval];
    const found = notices(before, snapshot(projects, approvals), projects, approvals, all);
    expect(found.map((notice) => notice.kind)).toEqual(['conflicts', 'approvals', 'checkouts']);
    expect(found[2]).toMatchObject({ title: '@josh checked out gripper', projectId: 'rover', branch: 'gripper' });
    // Nothing new the second time.
    expect(notices(snapshot(projects, approvals), snapshot(projects, approvals), projects, approvals, all)).toEqual([]);
  });

  it('leaves out the kinds turned off in Settings', () => {
    const approvals = [...base.approvals, approval];
    expect(notices(snapshot(base.projects, base.approvals), snapshot(base.projects, approvals), base.projects, approvals, { ...all, approvals: false })).toEqual([]);
  });
});

describe('needsYouCount', () => {
  it('adds conflicts, approvals, and failed setup steps', () => {
    expect(needsYouCount(base)).toBe(1);
    const projects = change((project) => ({ ...project, conflicts: [{ path: 'a', copy: 'b', at: '' }] }));
    const setup = base.setup.map((step) => (step.id === 'cli' ? { ...step, status: 'error' as const } : step));
    expect(needsYouCount({ projects, approvals: base.approvals, setup })).toBe(3);
  });
});

describe('pauseEnd', () => {
  it('ends in an hour, at 8 tomorrow, or never', () => {
    const now = new Date(2026, 9, 14, 15, 30);
    expect(pauseEnd('hour', now)).toBe(new Date(2026, 9, 14, 16, 30).toISOString());
    expect(pauseEnd('tomorrow', now)).toBe(new Date(2026, 9, 15, 8, 0).toISOString());
    expect(pauseEnd(null, now)).toBeNull();
  });
});
