import type { Api, BranchView, ProjectSummary, ReleaseRequestSummary } from './api.js';
import { CliError } from './errors.js';
import type { Workspace } from './workspace.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProjectRef {
  readonly owner: string;
  readonly slug: string;
}

export function parseProjectRef(input: string): ProjectRef {
  const match = input.trim().match(/^@?([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*)$/i);
  if (!match) {
    throw new CliError('invalid_project', `"${input}" is not a project`, { hint: 'Name projects as <owner>/<project>, e.g. alex/robot-arm.' });
  }
  return { owner: match[1]!.toLowerCase(), slug: match[2]!.toLowerCase() };
}

export async function findProject(api: Api, ref: ProjectRef): Promise<ProjectSummary> {
  return api.get<ProjectSummary>(`/v1/users/${encodeURIComponent(ref.owner)}/projects/${encodeURIComponent(ref.slug)}`);
}

/** `--project owner/slug`, or the project of the workspace you're in. */
export async function resolveProject(api: Api, input: string | undefined, workspace: Workspace | undefined): Promise<ProjectSummary> {
  if (input) return findProject(api, parseProjectRef(input));
  if (workspace) return api.get<ProjectSummary>(`/v1/projects/${workspace.state.projectId}`);
  throw new CliError('project_required', 'Which project?', { hint: 'Pass --project <owner>/<project>, or run this inside a cloned workspace.' });
}

export async function findBranch(api: Api, projectId: string, name: string): Promise<BranchView> {
  const branches = await api.get<BranchView[]>(`/v1/projects/${projectId}/branches`);
  const branch = branches.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  if (!branch) {
    throw new CliError('branch_not_found', `No branch named "${name}"`, {
      hint: branches.length > 0 ? `Branches: ${branches.map((b) => b.name).join(', ')}` : 'Create one with `giga branch create <name>`.',
    });
  }
  return branch;
}

/** A release request by id, or by number (`3` or `#3`) within the project. */
export async function resolveReleaseRequestId(api: Api, input: string, projectId: () => Promise<string>): Promise<string> {
  if (UUID.test(input)) return input.toLowerCase();
  const match = input.match(/^#?(\d+)$/);
  if (!match) throw new CliError('invalid_release_request', `"${input}" is not a release request number or id`);
  const number = Number(match[1]);
  const requests = await api.get<ReleaseRequestSummary[]>(`/v1/projects/${await projectId()}/release-requests`);
  const found = requests.find((request) => request.number === number);
  if (!found) throw new CliError('release_request_not_found', `Release request #${number} not found`);
  return found.id;
}

export function parseReleaseNumber(input: string): number {
  const match = input.match(/^v?(\d+)$/i);
  const number = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(number) || number < 1) throw new CliError('invalid_release', `"${input}" is not a release number (e.g. 3 or v3)`);
  return number;
}
