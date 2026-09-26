/** File types the browser viewer can open. SolidWorks files need previews exported by the add-in. */
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

/** Larger files would stall the browser, so they're download-only. */
export const MAX_PREVIEW_BYTES = 150 * 1024 * 1024;

export function formatBytesShort(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}
