import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathKey } from '@gigacad/core';
import type { Command } from 'commander';
import type { Bind, Runtime } from '../cli.js';
import { CliError } from '../errors.js';
import { hashFile } from '../scan.js';
import { requireSignedIn } from '../session.js';
import { uploadBlobs } from '../transfer.js';
import { requireWorkspace, workspacePath } from '../workspace.js';

interface FileExport {
  readonly format: 'stl' | 'step';
  readonly sha256: string;
  readonly size: number;
}

export function registerExportCommands(program: Command, bind: Bind): void {
  program
    .command('export <file> <export>')
    .description('Attach a STEP or STL you exported from SolidWorks to a committed part or assembly')
    .addHelpText(
      'after',
      `
The export becomes the file's 3D preview and thumbnail, and people can download it
as STEP or STL. The file must be committed; the export applies to that version.

Example:
  giga export parts/Bracket.SLDPRT ~/exports/Bracket.step`,
    )
    .action(bind(attachExport));
}

function exportFormat(path: string): 'stl' | 'step' {
  if (/\.stl$/i.test(path)) return 'stl';
  if (/\.(step|stp)$/i.test(path)) return 'step';
  throw new CliError('unsupported_export', `${path} isn't a STEP or STL file`, { hint: 'Exports end in .step, .stp, or .stl.' });
}

async function attachExport(rt: Runtime, file: string, exportPath: string): Promise<void> {
  const workspace = await requireWorkspace(rt.ctx.cwd);
  const { root, state } = workspace;
  const path = workspacePath(root, rt.ctx.cwd, file);
  if (!/\.(sldprt|sldasm)$/i.test(path)) {
    throw new CliError('not_exportable', `${path} isn't a SolidWorks part or assembly`, { hint: 'Exports attach to .SLDPRT and .SLDASM files.' });
  }
  // The export belongs to the committed version of the file, whatever is on disk now.
  const committed = state.base.find((entry) => pathKey(entry.path) === pathKey(path));
  if (!committed) throw new CliError('not_committed', `${path} isn't committed on ${state.branchName}`, { hint: 'Commit it first with `giga commit`.' });

  const format = exportFormat(exportPath);
  const absolute = resolve(rt.ctx.cwd, exportPath);
  const info = await stat(absolute).catch(() => undefined);
  if (!info?.isFile()) throw new CliError('not_found', `${exportPath} does not exist`);

  const session = await rt.session();
  requireSignedIn(session);
  const blob = await hashFile(absolute);
  await uploadBlobs(session.api, state.projectId, [{ blob, size: info.size, absolutePath: absolute, path: exportPath }], (message) =>
    rt.out.progress(message),
  );
  const added = await session.api.put<FileExport>(`/v1/projects/${state.projectId}/exports`, { source: committed.blob, format, blob });
  rt.out.result(
    { path, ...added },
    `Attached ${format.toUpperCase()} to ${path}. It becomes the file's preview and thumbnail within a minute.`,
  );
}
