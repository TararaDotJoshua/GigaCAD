import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateManifest } from '@gigacad/core';
import type { Command } from 'commander';
import type { ReleaseDetail, ReleaseView } from '../api.js';
import type { Bind, Runtime } from '../cli.js';
import { CliError } from '../errors.js';
import { plural, shortId, table } from '../output.js';
import { parseReleaseNumber, resolveProject } from '../resolve.js';
import { downloadBlobs, placeDownloads, type DownloadTarget } from '../transfer.js';
import { absolutePath, findWorkspace } from '../workspace.js';

export function registerReleaseCommands(program: Command, bind: Bind): void {
  const release = program.command('release').description('Browse and export the permanent releases on main');
  const withProject = (command: Command) => command.option('--project <owner/project>', 'Project (default: this workspace’s project)');
  withProject(release.command('list').description('Releases, newest first')).action(bind(listReleases));
  withProject(release.command('show <number>').description('A release and its files')).action(bind(showRelease));
  withProject(
    release
      .command('export <number> [directory]')
      .description('Download a release’s files into a new folder (not a workspace), verifying every file'),
  ).action(bind(exportRelease));
}

async function listReleases(rt: Runtime, options: { project?: string }): Promise<void> {
  const session = await rt.session();
  const project = await resolveProject(session.api, options.project, await rt.workspace());
  const releases = await session.api.get<ReleaseView[]>(`/v1/projects/${project.id}/releases`);
  rt.out.result(
    releases,
    releases.length === 0
      ? 'No releases yet.'
      : table(
          ['RELEASE', 'DATE', 'BY', 'NOTES'],
          releases.map((r) => [`v${r.number}`, r.createdAt.slice(0, 10), r.createdByHandle ? `@${r.createdByHandle}` : '-', r.notes.split('\n')[0] ?? '']),
        ),
  );
}

async function showRelease(rt: Runtime, number: string, options: { project?: string }): Promise<void> {
  const session = await rt.session();
  const project = await resolveProject(session.api, options.project, await rt.workspace());
  const detail = await session.api.get<ReleaseDetail>(`/v1/projects/${project.id}/releases/${parseReleaseNumber(number)}`);
  const { release, files } = detail;
  rt.out.result(detail, [
    `v${release.number} of ${project.ownerHandle}/${project.slug}, released ${release.createdAt.slice(0, 10)}${release.createdByHandle ? ` by @${release.createdByHandle}` : ''}`,
    ...(release.notes ? [release.notes] : []),
    '',
    ...(files.length === 0 ? ['No files.'] : table(['PATH', 'ITEM', 'SHA-256'], files.map((file) => [file.path, shortId(file.itemId), file.blob.slice(0, 12)]))),
  ]);
}

async function exportRelease(rt: Runtime, number: string, directory: string | undefined, options: { project?: string }): Promise<void> {
  const session = await rt.session();
  const project = await resolveProject(session.api, options.project, await rt.workspace());
  const releaseNumber = parseReleaseNumber(number);
  const { release, files } = await session.api.get<ReleaseDetail>(`/v1/projects/${project.id}/releases/${releaseNumber}`);
  if (validateManifest(files).length > 0) throw new CliError('invalid_snapshot', 'The release contains paths this computer can’t store');

  const root = resolve(rt.ctx.cwd, directory ?? `${project.slug}-v${release.number}`);
  const existing = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (existing && existing.length > 0) throw new CliError('directory_not_empty', `${root} already exists and is not empty`);
  if (await findWorkspace(root)) throw new CliError('nested_workspace', `${root} is inside a workspace; export somewhere else`);

  await mkdir(root, { recursive: true });
  // Staged inside the export folder so moving files into place never crosses disks.
  const staging = join(root, '.giga-export');
  try {
    const targets: DownloadTarget[] = files.map((file) => ({ blob: file.blob, path: file.path, absolutePath: absolutePath(root, file.path) }));
    if (targets.length > 0) {
      const downloaded = await downloadBlobs(session.api, project.id, targets, staging, rt.out.progress.bind(rt.out));
      await placeDownloads(targets, downloaded);
    }
  } catch (error) {
    if (!existing) await rm(root, { recursive: true, force: true });
    else for (const entry of await readdir(root)) await rm(join(root, entry), { recursive: true, force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  rt.out.result(
    { release: release.number, directory: root, files: files.map((file) => ({ path: file.path, itemId: file.itemId, sha256: file.blob })) },
    `Exported v${release.number} of ${project.ownerHandle}/${project.slug} to ${root} (${plural(files.length, 'file')}, all checksums verified)`,
  );
}
