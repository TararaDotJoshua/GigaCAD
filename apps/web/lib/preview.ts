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

export function formatBytesShort(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}
