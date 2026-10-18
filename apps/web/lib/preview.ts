import { formatBytes } from '@gigacad/core';

/** File types the browser viewer can open. SolidWorks files open through their STL or STEP export. */
export type PreviewFormat = 'stl' | 'obj' | '3mf' | 'step' | 'iges';

const FORMATS: [RegExp, PreviewFormat][] = [
  [/\.stl$/i, 'stl'],
  [/\.obj$/i, 'obj'],
  [/\.3mf$/i, '3mf'],
  [/\.(step|stp)$/i, 'step'],
  [/\.(iges|igs)$/i, 'iges'],
];

export function previewFormat(path: string): PreviewFormat | null {
  return FORMATS.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

/** SolidWorks files get thumbnails from the picture saved inside them, and can carry STEP and STL exports. */
export const isSolidWorks = (path: string) => /\.(sldprt|sldasm|slddrw)$/i.test(path);

/** "parts/Bracket.SLDPRT" as a STEP export: "Bracket.step". */
export function exportFilename(path: string, format: 'stl' | 'step'): string {
  const name = path.split('/').pop() ?? path;
  return `${name.replace(/\.[^.]+$/, '')}.${format}`;
}

/** Larger files would stall the browser, so they're download-only. */
export const MAX_PREVIEW_BYTES = 150 * 1024 * 1024;

/** Above this, the viewer asks before downloading, since building the model takes a while. */
export const CONFIRM_PREVIEW_BYTES = 50 * 1024 * 1024;

/** Whether a file of this size previews straight away, after a confirmation, or not at all. Unknown sizes go ahead. */
export function previewGate(size: number | undefined, confirmed: boolean): 'ok' | 'confirm' | 'too-large' {
  if (size === undefined || !Number.isFinite(size)) return 'ok';
  if (size > MAX_PREVIEW_BYTES) return 'too-large';
  return size > CONFIRM_PREVIEW_BYTES && !confirmed ? 'confirm' : 'ok';
}

const LABELS: Record<PreviewFormat, string> = { stl: 'STL', obj: 'OBJ', '3mf': '3MF', step: 'STEP', iges: 'IGES' };
/** "an STL file", "a STEP file": the article follows how the letters are said. */
const A_FILE: Record<PreviewFormat | 'zip', string> = {
  stl: 'an STL file',
  obj: 'an OBJ file',
  '3mf': 'a 3MF file',
  step: 'a STEP file',
  iges: 'an IGES file',
  zip: 'a ZIP archive',
};

/** What a file's first bytes say it is. `null` when they don't say (OBJ has no signature). */
export function sniffContent(bytes: Uint8Array): Exclude<PreviewFormat, 'obj' | '3mf'> | 'zip' | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip';
  const head = String.fromCharCode(...bytes.subarray(0, 96));
  const text = head.replace(/^(ï»¿)?\s*/, '');
  if (text.startsWith('ISO-10303-21')) return 'step';
  // Binary STL: an 80-byte header, a triangle count, then 50 bytes per triangle. Checked before
  // "solid", because many binary headers start with that word too.
  if (bytes.length >= 84) {
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    if (84 + 50 * count === bytes.length) return 'stl';
  }
  if (text.startsWith('solid')) return 'stl';
  // IGES: 80-column lines, the first in the Start section ("S" in column 73, then its sequence number).
  if (/^.{72}S[ \d]{7}\r?\n/.test(head)) return 'iges';
  return null;
}

/** Kinds of preview failure, each with its own plain message. */
export type PreviewProblem =
  | 'empty'
  | 'unreadable'
  | 'mismatch'
  | 'no-geometry'
  | 'too-large'
  | 'download'
  | 'reader'
  | 'reader-timeout'
  | 'viewer';

export class PreviewError extends Error {
  constructor(
    readonly problem: PreviewProblem,
    readonly detail: { actual?: PreviewFormat | 'zip'; size?: number; message?: string } = {},
  ) {
    super(problem);
    this.name = 'PreviewError';
  }
}

/** Failures of the file itself, where another copy of the model (a SolidWorks file's STEP export) may still show. */
export const isFileProblem = (error: unknown) =>
  error instanceof PreviewError && ['empty', 'unreadable', 'mismatch', 'no-geometry', 'too-large'].includes(error.problem);

/** Checks a file's bytes before parsing, so empty and misnamed files get a plain message rather than a parser's. */
export function contentProblem(bytes: Uint8Array, format: PreviewFormat): PreviewError | null {
  if (bytes.length === 0) return new PreviewError('empty');
  const actual = sniffContent(bytes);
  if (format === '3mf') return actual === 'zip' ? null : actual ? new PreviewError('mismatch', { actual }) : new PreviewError('unreadable');
  return actual && actual !== format ? new PreviewError('mismatch', { actual }) : null;
}

/** "This STL file" or, for a SolidWorks file's export, "This STL export". */
function subject(format: PreviewFormat, source: boolean) {
  return `This ${LABELS[format]} ${source ? 'export' : 'file'}`;
}

/**
 * The message for a failed preview. `source` says the file is a SolidWorks file's export, so the
 * copy can say so; unexpected errors (a parser's, WebGL's) never reach the page as they are.
 */
export function previewMessage(error: unknown, format: PreviewFormat, source = false): string {
  if (!(error instanceof PreviewError)) {
    const text = error instanceof Error ? error.message : '';
    return /webgl/i.test(text) ? 'This browser can’t show 3D previews. Download the file instead.' : 'The preview failed. Download the file instead.';
  }
  const { actual, size, message } = error.detail;
  switch (error.problem) {
    case 'empty':
      return source ? `${subject(format, true)} is empty.` : 'This file is empty.';
    case 'unreadable':
      return `${subject(format, source)} couldn’t be read. It may be damaged.`;
    case 'mismatch':
      return `${source ? subject(format, true) : 'This file'} isn’t really ${A_FILE[format]}. It looks like ${A_FILE[actual ?? format]}.`;
    case 'no-geometry':
      return `${source ? subject(format, true) : 'This file'} has no geometry to show.`;
    case 'too-large':
      return `${source ? subject(format, true) : 'This file'} is ${size === undefined ? 'too large to preview' : `${formatBytes(size)}, too large to preview`}. Download it instead.`;
    case 'download':
      return message ?? 'The file couldn’t be loaded.';
    case 'reader':
      return 'The CAD reader failed to load. Download the file instead.';
    case 'reader-timeout':
      return 'The CAD reader stopped responding. Download the file instead.';
    case 'viewer':
      return 'The 3D viewer failed to load. Download the file instead.';
  }
}

/** Shown before a large file downloads, so the wait is a choice. */
export function confirmMessage(size: number, format: PreviewFormat, source = false): string {
  return `${source ? subject(format, true) : 'This file'} is ${formatBytes(size)}. Previewing it may take a while.`;
}
