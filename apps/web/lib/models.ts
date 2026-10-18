import type { FileExport } from './api';
import { isSolidWorks, previewFormat, type PreviewFormat } from './preview';

/** What the 3D viewer opens for a file: the file itself, or for SolidWorks its STL export, else its STEP export. */
export interface ModelSource {
  readonly sha256: string;
  readonly format: PreviewFormat;
  /** Set when the model is a SolidWorks file's export rather than the file. */
  readonly source?: 'stl' | 'step';
  /** Bytes, when known, so files too large to preview say so up front. */
  readonly size?: number;
  /** Tried when the first model can't be read: a SolidWorks file's STEP export behind its STL. */
  readonly fallback?: { readonly sha256: string; readonly format: PreviewFormat };
}

export function modelFor(path: string, blob: string, exports: readonly FileExport[] = [], size?: number): ModelSource | null {
  const format = previewFormat(path);
  if (format) return { sha256: blob, format, ...(size === undefined ? {} : { size }) };
  if (!isSolidWorks(path)) return null;
  const stl = exports.find((entry) => entry.format === 'stl');
  const step = exports.find((entry) => entry.format === 'step');
  if (stl) return { sha256: stl.sha256, format: 'stl', source: 'stl', size: stl.size, ...(step ? { fallback: { sha256: step.sha256, format: 'step' as const } } : {}) };
  if (step) return { sha256: step.sha256, format: 'step', source: 'step', size: step.size };
  return null;
}

/** Files whose thumbnails or exports are worth looking up: ones the viewer opens, and SolidWorks files. */
export const hasModel = (path: string) => Boolean(previewFormat(path)) || isSolidWorks(path);

/**
 * A changed file's preview on a release request: the branch's version, beside main's when both
 * can be shown the same way. SolidWorks files compare through an export both versions have, STL
 * before STEP; when only the branch's version has one, it previews alone.
 */
export function pickModels(
  path: string,
  branchBlob: string,
  mainBlob: string | null,
  exports: Readonly<Record<string, readonly FileExport[]>>,
): { model: ModelSource; compare?: { sha256: string; path: string; size?: number } } | null {
  const format = previewFormat(path);
  const differs = mainBlob !== null && mainBlob !== branchBlob;
  if (format) return { model: { sha256: branchBlob, format }, ...(differs ? { compare: { sha256: mainBlob, path } } : {}) };
  const model = modelFor(path, branchBlob, exports[branchBlob]);
  if (!model) return null;
  if (!differs) return { model };
  for (const kind of ['stl', 'step'] as const) {
    const branch = exports[branchBlob]?.find((entry) => entry.format === kind);
    const main = exports[mainBlob]?.find((entry) => entry.format === kind);
    if (branch && main) return { model: { sha256: branch.sha256, format: kind, source: kind, size: branch.size }, compare: { sha256: main.sha256, path, size: main.size } };
  }
  return { model };
}
