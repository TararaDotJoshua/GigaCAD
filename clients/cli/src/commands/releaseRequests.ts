import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathKey, type ItemChange, type PickAction, type PickRow, type Picks, type Replacement } from '@gigacad/core';
import type { Command } from 'commander';
import type { Api, BranchDetail, ReleaseDetail, ReleaseRequestDetail, ReleaseRequestSummary } from '../api.js';
import type { Bind, Runtime } from '../cli.js';
import { CliError } from '../errors.js';
import { describeBlocker, plural, shortId, table } from '../output.js';
import { findBranch, resolveProject, resolveReleaseRequestId } from '../resolve.js';
import { requireSignedIn, type Session } from '../session.js';

interface ProjectOption {
  readonly project?: string;
}

const RR_HELP = 'Release request number (e.g. 3 or #3) or id; default: the active request for this workspace’s branch';

export function registerReleaseRequestCommands(program: Command, bind: Bind): void {
  const rr = program
    .command('rr')
    .alias('release-request')
    .description('Release requests: diff pick, candidate, approvals, and release')
    .addHelpText(
      'after',
      `
Typical flow (inside a workspace):
  giga rr open --title "Swap the gripper"
  giga rr diff
  giga rr picks --file picks.json
  giga rr candidate
  giga rr approve
  giga rr release`,
    );
  const project = (command: Command) => command.option('--project <owner/project>', 'Project (default: this workspace’s project)');
  /** A subcommand that acts on one release request. */
  const onRequest = (name: string, description: string) =>
    project(rr.command(name).argument('[request]', RR_HELP).description(description));

  project(
    rr
      .command('open')
      .description('Open a release request for a branch; the branch freezes until it is released or closed')
      .option('--title <title>', 'Title (default: "Release <branch>")')
      .option('--body <text>', 'Description')
      .option('--branch <name>', 'Branch (default: this workspace’s branch)'),
  ).action(bind(openRequest));
  project(rr.command('list').description('Release requests in a project').option('--all', 'Include released and closed ones')).action(
    bind(listRequests),
  );
  onRequest('show', 'Status, candidate, approvals, and what blocks the release').action(bind(showRequest));
  onRequest('diff', 'The diff-pick table: every item changed on the branch or on main').action(bind(diffRequest));
  onRequest('picks', 'Replace the picks with a JSON file (discards any candidate)')
    .requiredOption('-f, --file <path>', 'Picks JSON file, or - for stdin')
    .addHelpText(
      'after',
      `
Picks file (items by path or item id):
  {
    "actions": { "parts/P1.SLDPRT": "keep_main", "parts/P2.SLDPRT": "take_branch" },
    "replacements": [{ "branchPath": "parts/P3.SLDPRT", "mainPath": "parts/P4.SLDPRT" }]
  }
Replacements may use "branchItemId"/"mainItemId" instead of paths.`,
    )
    .action(bind(setPicks));
  onRequest('candidate', 'Build the release candidate from the current picks').action(bind(candidate));
  onRequest('rebuild-report', 'Attach a rebuild report produced by a CAD rebuild (giga never runs one itself)')
    .requiredOption('-f, --file <path>', 'Report JSON file, or - for stdin')
    .option('--candidate <manifestId>', 'Candidate manifest the report is for (or "candidateManifestId" in the file)')
    .addHelpText(
      'after',
      `
Report file:
  {
    "candidateManifestId": "<from giga rr show --json>",
    "status": "passed" | "passed_with_warnings" | "failed",
    "messages": [{ "level": "warning", "message": "Mate is over-defined", "path": "Robot.SLDASM" }]
  }`,
    )
    .action(bind(rebuildReport));
  onRequest('approve', 'Approve the current candidate').action(bind(approve));
  onRequest('unapprove', 'Withdraw your approval').action(bind(unapprove));
  onRequest('release', 'Publish the approved candidate as the next permanent release')
    .option('--notes <text>', 'Release notes')
    .action(bind(release));
  onRequest('close', 'Close without releasing; the branch unfreezes').action(bind(close));
}

interface Target {
  readonly session: Session;
  readonly api: Api;
  readonly id: string;
}

/** Finds the request from an argument, or the active request of the workspace's branch. */
async function target(rt: Runtime, input: string | undefined, options: ProjectOption, signedIn = true): Promise<Target> {
  const session = await rt.session();
  if (signedIn) requireSignedIn(session);
  const workspace = await rt.workspace();
  let projectId: string | undefined;
  const getProjectId = async () => (projectId ??= (await resolveProject(session.api, options.project, workspace)).id);

  if (input) return { session, api: session.api, id: await resolveReleaseRequestId(session.api, input, getProjectId) };
  if (!workspace || options.project) {
    throw new CliError('release_request_required', 'Which release request?', { hint: 'Pass its number, e.g. `giga rr show 3`.' });
  }
  const requests = await session.api.get<ReleaseRequestSummary[]>(`/v1/projects/${await getProjectId()}/release-requests`);
  const active = requests.filter(
    (request) => request.branchName.toLowerCase() === workspace.state.branchName.toLowerCase() && (request.status === 'open' || request.status === 'candidate'),
  );
  if (active.length === 0) {
    throw new CliError('release_request_not_found', `Branch ${workspace.state.branchName} has no active release request`, {
      hint: 'Open one with `giga rr open`.',
    });
  }
  return { session, api: session.api, id: active[0]!.id };
}

function heading(detail: ReleaseRequestDetail): string {
  const request = detail.releaseRequest;
  return `#${request.number} ${request.title} (${request.status}) — branch ${request.branchName}${request.requesterHandle ? ` by @${request.requesterHandle}` : ''}`;
}

function describeRequest(detail: ReleaseRequestDetail): string[] {
  const { releaseRequest: request, candidate, approvals, preview } = detail;
  const lines = [heading(detail)];
  if (request.body) lines.push(request.body);
  lines.push(`Main: ${detail.latestRelease ? `v${detail.latestRelease.number}` : 'no releases yet'}`);
  lines.push(`Diff: ${plural(preview.rows.length, 'changed item')}, ${plural(preview.warnings.length, 'warning')}, ${plural(preview.errors.length, 'error')}`);
  if (candidate) {
    lines.push(`Candidate: ${candidate.manifestId} (${plural(candidate.files.length, 'file')})${candidate.upToDate ? '' : ' — out of date: main has a newer release'}`);
    if (request.rebuildStatus && request.rebuildManifestId === candidate.manifestId) lines.push(`Rebuild report: ${request.rebuildStatus}`);
  } else if (request.status === 'open') {
    lines.push('Candidate: not generated yet. Run `giga rr candidate`.');
  }
  if (approvals.given.length > 0) {
    lines.push(
      `Approvals: ${approvals.given
        .map((approval) => `@${approval.handle}${candidate && approval.candidateManifestId !== candidate.manifestId ? ' (older candidate)' : ''}`)
        .join(', ')}`,
    );
  }
  const evaluation = approvals.evaluation;
  if (evaluation) {
    lines.push(evaluation.canRelease ? 'Ready to release.' : 'Blocked:', ...evaluation.blockers.map((blocker) => `  ${describeBlocker(blocker)}`));
  }
  return lines;
}

async function openRequest(rt: Runtime, options: ProjectOption & { title?: string; body?: string; branch?: string }): Promise<void> {
  const session = await rt.session();
  requireSignedIn(session);
  const workspace = await rt.workspace();
  let branchId: string;
  let branchName: string;
  if (options.branch || options.project || !workspace) {
    if (!options.branch) throw new CliError('branch_required', 'Which branch?', { hint: 'Pass --branch <name>, or run this inside a workspace.' });
    const project = await resolveProject(session.api, options.project, workspace);
    const branch = await findBranch(session.api, project.id, options.branch);
    branchId = branch.id;
    branchName = branch.name;
  } else {
    branchId = workspace.state.branchId;
    branchName = workspace.state.branchName;
  }
  const detail = await session.api.post<ReleaseRequestDetail>(`/v1/branches/${branchId}/release-requests`, {
    title: options.title ?? `Release ${branchName}`,
    ...(options.body ? { body: options.body } : {}),
  });
  rt.out.result(detail, [
    `Opened release request #${detail.releaseRequest.number} for ${branchName}. The branch is frozen until it is released or closed.`,
    ...diffLines(detail),
    'Next: review with `giga rr diff`, then `giga rr candidate`.',
  ]);
}

async function listRequests(rt: Runtime, options: ProjectOption & { all?: boolean }): Promise<void> {
  const session = await rt.session();
  const project = await resolveProject(session.api, options.project, await rt.workspace());
  const all = await session.api.get<ReleaseRequestSummary[]>(`/v1/projects/${project.id}/release-requests`);
  const requests = options.all ? all : all.filter((request) => request.status === 'open' || request.status === 'candidate');
  rt.out.result(
    requests,
    requests.length === 0
      ? options.all
        ? 'No release requests yet.'
        : 'No active release requests. Use --all to include released and closed ones.'
      : table(
          ['#', 'STATUS', 'BRANCH', 'BY', 'TITLE'],
          requests.map((request) => [String(request.number), request.status, request.branchName, request.requesterHandle ? `@${request.requesterHandle}` : '-', request.title]),
        ),
  );
}

async function showRequest(rt: Runtime, input: string | undefined, options: ProjectOption): Promise<void> {
  const { api, id } = await target(rt, input, options, false);
  const detail = await api.get<ReleaseRequestDetail>(`/v1/release-requests/${id}`);
  rt.out.result(detail, describeRequest(detail));
}

function describeSide(change: ItemChange | undefined): string {
  if (!change) return '-';
  if (change.kind !== 'modified') return change.kind;
  if (change.moved && change.contentChanged) return `moved+edited from ${change.before.path}`;
  return change.moved ? `moved from ${change.before.path}` : 'edited';
}

function currentPick(row: PickRow, picks: Picks): PickAction {
  return picks.actions?.[row.itemId] ?? row.defaultAction;
}

function diffLines(detail: ReleaseRequestDetail): string[] {
  const { preview, releaseRequest } = detail;
  if (preview.rows.length === 0) return ['No changes between the branch and main.'];
  const lines = table(
    ['ITEM', 'PATH', 'BRANCH', 'MAIN', 'PICK'],
    preview.rows.map((row) => [
      shortId(row.itemId),
      row.path,
      describeSide(row.branchChange),
      describeSide(row.mainChange),
      `${currentPick(row, releaseRequest.picks)}${row.conflict ? ' (conflict)' : ''}`,
    ]),
  );
  for (const replacement of preview.replacements) lines.push(`replace: ${replacement.toPath} takes over ${replacement.fromPath}`);
  for (const warning of preview.warnings) lines.push(`warning: ${describeIssue(warning)}`);
  for (const error of preview.errors) lines.push(`error: ${describeIssue(error)}`);
  return lines;
}

function describeIssue(issue: { kind: string } & Record<string, unknown>): string {
  const detail = Object.entries(issue)
    .filter(([key]) => key !== 'kind' && !key.toLowerCase().endsWith('itemid') && key !== 'itemIds')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  return `${issue.kind.replace(/_/g, ' ')}${detail ? ` (${detail})` : ''}`;
}

async function diffRequest(rt: Runtime, input: string | undefined, options: ProjectOption): Promise<void> {
  const { api, id } = await target(rt, input, options, false);
  const detail = await api.get<ReleaseRequestDetail>(`/v1/release-requests/${id}`);
  rt.out.result(
    { releaseRequest: { id: detail.releaseRequest.id, number: detail.releaseRequest.number, picks: detail.releaseRequest.picks }, ...detail.preview },
    [heading(detail), ...diffLines(detail)],
  );
}

async function readJsonInput(rt: Runtime, file: string): Promise<unknown> {
  let text: string;
  try {
    text = file === '-' ? await readStdin() : await readFile(resolve(rt.ctx.cwd, file), 'utf8');
  } catch {
    throw new CliError('file_not_found', `Can't read ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError('invalid_json', `${file} is not valid JSON`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PicksFile {
  readonly actions?: Record<string, unknown>;
  readonly replacements?: readonly Record<string, unknown>[];
}

/** Turns a picks file that may name items by path into the API's item-id picks. */
export function resolvePicks(
  input: unknown,
  sides: { readonly branchFiles: readonly { path: string; itemId: string }[]; readonly mainFiles: readonly { path: string; itemId: string }[]; readonly rows: readonly PickRow[] },
): Picks {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new CliError('invalid_picks', 'The picks file must be a JSON object');
  const file = input as PicksFile;
  const index = (files: readonly { path: string; itemId: string }[]) => new Map(files.map((entry) => [pathKey(entry.path), entry.itemId]));
  const branchByPath = index(sides.branchFiles);
  const mainByPath = index(sides.mainFiles);
  const rowByPath = new Map<string, string>();
  for (const row of sides.rows) {
    for (const change of [row.branchChange, row.mainChange]) {
      if (change && change.kind !== 'added') rowByPath.set(pathKey(change.before.path), row.itemId);
      if (change && change.kind !== 'deleted') rowByPath.set(pathKey(change.after.path), row.itemId);
    }
    rowByPath.set(pathKey(row.path), row.itemId);
  }

  const item = (reference: unknown, lookup: ReadonlyMap<string, string>, what: string): string => {
    if (typeof reference !== 'string' || reference === '') throw new CliError('invalid_picks', `Expected a path or item id for ${what}`);
    if (UUID.test(reference)) return reference.toLowerCase();
    const found = lookup.get(pathKey(reference));
    if (!found) throw new CliError('invalid_picks', `${reference} is not a ${what}`);
    return found;
  };

  const actions: Record<string, PickAction> = {};
  for (const [key, action] of Object.entries(file.actions ?? {})) {
    if (action !== 'take_branch' && action !== 'keep_main') {
      throw new CliError('invalid_picks', `The action for ${key} must be "take_branch" or "keep_main"`);
    }
    actions[item(key, rowByPath, 'changed item in the diff')] = action;
  }
  const replacements: Replacement[] = (file.replacements ?? []).map((replacement, position) => {
    const branchRef = replacement.branchItemId ?? replacement.branchPath;
    const mainRef = replacement.mainItemId ?? replacement.mainPath;
    if (branchRef === undefined || mainRef === undefined) {
      throw new CliError('invalid_picks', `Replacement ${position + 1} needs branchPath (or branchItemId) and mainPath (or mainItemId)`);
    }
    return { branchItemId: item(branchRef, branchByPath, 'file on the branch'), mainItemId: item(mainRef, mainByPath, 'file in the latest release') };
  });
  return { actions, replacements };
}

async function setPicks(rt: Runtime, input: string | undefined, options: ProjectOption & { file: string }): Promise<void> {
  const { api, id } = await target(rt, input, options);
  const raw = await readJsonInput(rt, options.file);
  const detail = await api.get<ReleaseRequestDetail>(`/v1/release-requests/${id}`);
  const [branch, main] = await Promise.all([
    api.get<BranchDetail>(`/v1/branches/${detail.releaseRequest.branchId}`),
    detail.latestRelease
      ? api.get<ReleaseDetail>(`/v1/projects/${detail.releaseRequest.projectId}/releases/${detail.latestRelease.number}`)
      : Promise.resolve(undefined),
  ]);
  const picks = resolvePicks(raw, { branchFiles: branch.files, mainFiles: main?.files ?? [], rows: detail.preview.rows });
  const updated = await api.put<ReleaseRequestDetail>(`/v1/release-requests/${id}/picks`, picks);
  const ok = updated.preview.errors.length === 0;
  rt.out.result(updated, [
    `Saved picks for #${updated.releaseRequest.number}.`,
    ...diffLines(updated),
    ok ? 'Next: `giga rr candidate`.' : 'Fix the errors above before generating a candidate.',
  ]);
}

async function candidate(rt: Runtime, input: string | undefined, options: ProjectOption): Promise<void> {
  const { api, id } = await target(rt, input, options);
  const detail = await api.post<ReleaseRequestDetail>(`/v1/release-requests/${id}/candidate`);
  rt.out.result(detail, [`Generated the candidate for #${detail.releaseRequest.number}.`, ...describeRequest(detail).slice(1)]);
}

async function rebuildReport(rt: Runtime, input: string | undefined, options: ProjectOption & { file: string; candidate?: string }): Promise<void> {
  const { api, id } = await target(rt, input, options);
  const raw = await readJsonInput(rt, options.file);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new CliError('invalid_report', 'The report file must be a JSON object');
  const report = raw as { candidateManifestId?: unknown; status?: unknown; messages?: unknown };
  const candidateManifestId = options.candidate ?? report.candidateManifestId;
  if (typeof candidateManifestId !== 'string') {
    throw new CliError('invalid_report', 'The report must say which candidate it is for', {
      hint: 'Add "candidateManifestId" to the file or pass --candidate; `giga rr show --json` shows the current one.',
    });
  }
  const detail = await api.post<ReleaseRequestDetail>(`/v1/release-requests/${id}/rebuild-report`, {
    candidateManifestId,
    status: report.status,
    messages: report.messages ?? [],
  });
  rt.out.result(detail, [`Recorded a ${String(report.status)} rebuild report for #${detail.releaseRequest.number}.`, ...describeRequest(detail).slice(1)]);
}

async function approve(rt: Runtime, input: string | undefined, options: ProjectOption): Promise<void> {
  const { api, id } = await target(rt, input, options);
  const detail = await api.post<ReleaseRequestDetail>(`/v1/release-requests/${id}/approvals`);
  rt.out.result(detail, [`Approved the candidate of #${detail.releaseRequest.number}.`, ...describeRequest(detail).slice(1)]);
}

async function unapprove(rt: Runtime, input: string | undefined, options: ProjectOption): Promise<void> {
  const { api, id } = await target(rt, input, options);
  const detail = await api.delete<ReleaseRequestDetail>(`/v1/release-requests/${id}/approvals`);
  rt.out.result(detail, `Withdrew your approval of #${detail.releaseRequest.number}.`);
}

async function release(rt: Runtime, input: string | undefined, options: ProjectOption & { notes?: string }): Promise<void> {
  const { api, id } = await target(rt, input, options);
  const result = await api.post<{ release: { id: string; number: number }; releaseRequest: ReleaseRequestDetail }>(
    `/v1/release-requests/${id}/release`,
    options.notes ? { notes: options.notes } : {},
  );
  rt.out.result(result, `Released v${result.release.number} from #${result.releaseRequest.releaseRequest.number}. It is permanently locked.`);
}

async function close(rt: Runtime, input: string | undefined, options: ProjectOption): Promise<void> {
  const { api, id } = await target(rt, input, options);
  const detail = await api.post<ReleaseRequestDetail>(`/v1/release-requests/${id}/close`);
  rt.out.result(detail, `Closed #${detail.releaseRequest.number}. Branch ${detail.releaseRequest.branchName} is open again.`);
}
