import type { Command } from 'commander';
import type { BranchView, ProjectSummary, ReleaseView } from '../api.js';
import type { Bind, Runtime } from '../cli.js';
import { CliError } from '../errors.js';
import { table } from '../output.js';
import { resolveProject } from '../resolve.js';
import { requireSignedIn } from '../session.js';

export function registerProjectCommands(program: Command, bind: Bind): void {
  const project = program.command('project').description('List, create, and inspect projects');
  project.command('list').description('Projects you are a member of').action(bind(listProjects));
  project
    .command('create <slug>')
    .description('Create a project you own (private unless --public)')
    .option('--name <name>', 'Display name (default: the slug)')
    .option('--description <text>', 'Short description')
    .option('--public', 'Anyone can view it')
    .action(bind(createProject));
  project
    .command('show [project]')
    .description('Show a project, its branches, and its latest release (default: this workspace’s project)')
    .action(bind(showProject));

  const branch = program.command('branch').description('List and create branches');
  branch
    .command('list')
    .description('Branches of a project')
    .option('--project <owner/project>', 'Project (default: this workspace’s project)')
    .action(bind(listBranches));
  branch
    .command('create <name>')
    .description('Create a branch from the latest release (or --from-release)')
    .option('--project <owner/project>', 'Project (default: this workspace’s project)')
    .option('--from-release <number>', 'Start from this release instead of the latest')
    .action(bind(createBranch));
}

export const projectName = (project: Pick<ProjectSummary, 'ownerHandle' | 'slug'>) => `${project.ownerHandle}/${project.slug}`;

async function listProjects(rt: Runtime): Promise<void> {
  const session = await rt.session();
  requireSignedIn(session);
  const projects = await session.api.get<ProjectSummary[]>('/v1/projects');
  rt.out.result(
    projects,
    projects.length === 0
      ? 'No projects yet. Create one with `giga project create <slug>`.'
      : table(
          ['PROJECT', 'ROLE', 'VISIBILITY', 'LATEST'],
          projects.map((p) => [projectName(p), p.role ?? '-', p.visibility, p.latestReleaseNumber ? `v${p.latestReleaseNumber}` : '-']),
        ),
  );
}

async function createProject(rt: Runtime, slug: string, options: { name?: string; description?: string; public?: boolean }): Promise<void> {
  const session = await rt.session();
  requireSignedIn(session);
  const project = await session.api.post<ProjectSummary>('/v1/projects', {
    slug,
    name: options.name ?? slug,
    ...(options.description ? { description: options.description } : {}),
    visibility: options.public ? 'public' : 'private',
  });
  rt.out.result(project, [
    `Created ${projectName(project)} (${project.visibility})`,
    `Next: giga branch create <name> --project ${projectName(project)}`,
  ]);
}

async function showProject(rt: Runtime, input: string | undefined): Promise<void> {
  const session = await rt.session();
  const project = await resolveProject(session.api, input, await rt.workspace());
  const [branches, releases] = await Promise.all([
    session.api.get<BranchView[]>(`/v1/projects/${project.id}/branches`),
    session.api.get<ReleaseView[]>(`/v1/projects/${project.id}/releases`),
  ]);
  rt.out.result({ project, branches, releases }, [
    `${projectName(project)}: ${project.name}`,
    ...(project.description ? [project.description] : []),
    `Visibility: ${project.visibility}   Your role: ${project.role ?? 'none'}   Latest release: ${
      project.latestReleaseNumber ? `v${project.latestReleaseNumber}` : 'none'
    }`,
    '',
    ...(branches.length === 0 ? ['No branches yet.'] : branchTable(branches)),
  ]);
}

function branchTable(branches: readonly BranchView[]): string[] {
  return table(
    ['BRANCH', 'STATUS', 'FROM', 'CHECKED OUT'],
    branches.map((b) => [
      b.name,
      b.status,
      b.baseReleaseNumber ? `v${b.baseReleaseNumber}` : '-',
      b.checkedOutByHandle ? `@${b.checkedOutByHandle} on ${b.checkedOutMachine}` : '-',
    ]),
  );
}

async function listBranches(rt: Runtime, options: { project?: string }): Promise<void> {
  const session = await rt.session();
  const project = await resolveProject(session.api, options.project, await rt.workspace());
  const branches = await session.api.get<BranchView[]>(`/v1/projects/${project.id}/branches`);
  rt.out.result(branches, branches.length === 0 ? 'No branches yet.' : branchTable(branches));
}

async function createBranch(rt: Runtime, name: string, options: { project?: string; fromRelease?: string }): Promise<void> {
  const session = await rt.session();
  requireSignedIn(session);
  const project = await resolveProject(session.api, options.project, await rt.workspace());
  const fromRelease = options.fromRelease === undefined ? undefined : Number(options.fromRelease.replace(/^v/i, ''));
  if (fromRelease !== undefined && (!Number.isInteger(fromRelease) || fromRelease < 1)) {
    throw new CliError('invalid_release', `"${options.fromRelease}" is not a release number`);
  }
  const branch = await session.api.post<BranchView>(`/v1/projects/${project.id}/branches`, { name, ...(fromRelease ? { fromRelease } : {}) });
  rt.out.result(branch, [
    `Created branch ${branch.name} in ${projectName(project)}${branch.baseReleaseNumber ? ` from v${branch.baseReleaseNumber}` : ''}`,
    `Next: giga clone ${projectName(project)} --branch ${branch.name}`,
  ]);
}
