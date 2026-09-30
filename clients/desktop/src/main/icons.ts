import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { iconPixels, iconSvg } from './iconArt.js';

const run = promisify(execFile);

/**
 * JavaScript for Automation, run by the built-in `osascript`, so the app needs no native code.
 * It renders SVGs into real bitmaps of a fixed size (a vector image or a large bitmap makes
 * Finder store a much bigger icon with every file) and sets custom Finder icons.
 */
export const ICON_SCRIPT = `
ObjC.import('AppKit');
ObjC.import('Foundation');
function run(argv) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js;
  const job = JSON.parse(text);
  const out = { rendered: 0, applied: 0, failed: [] };
  for (const item of job.render || []) {
    const source = $.NSImage.alloc.initWithContentsOfFile(item.svg);
    if (source.isNil()) { out.failed.push(item.png); continue; }
    const n = item.pixels;
    const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, n, n, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
    rep.setSize($.NSMakeSize(n, n));
    $.NSGraphicsContext.saveGraphicsState;
    $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
    source.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, n, n), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);
    $.NSGraphicsContext.restoreGraphicsState;
    const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
    if (png.writeToFileAtomically(item.png, true)) out.rendered++; else out.failed.push(item.png);
  }
  const images = {};
  for (const item of job.apply || []) {
    const image = images[item.png] || (images[item.png] = $.NSImage.alloc.initWithContentsOfFile(item.png));
    if (!image.isNil() && $.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, item.target, 0)) out.applied++;
    else out.failed.push(item.target);
  }
  return JSON.stringify(out);
}
`;

export interface IconJob {
  readonly target: string;
  readonly key: string;
}

export interface IconResult {
  readonly rendered: number;
  readonly applied: number;
  readonly failed: readonly string[];
}

async function runScript(job: { render?: unknown[]; apply?: unknown[] }): Promise<IconResult> {
  const dir = await mkdtemp(join(tmpdir(), 'gigacad-icons-'));
  try {
    const script = join(dir, 'icons.js');
    const input = join(dir, 'job.json');
    await writeFile(script, ICON_SCRIPT);
    await writeFile(input, JSON.stringify(job));
    const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', script, input], { maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(stdout) as IconResult;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Renders icon keys to PNG files in `outDir` (build time for known icons, run time for new extensions). */
export async function renderIcons(keys: readonly string[], outDir: string, pixels: (key: string) => number = iconPixels): Promise<IconResult> {
  await mkdir(outDir, { recursive: true });
  const svgDir = await mkdtemp(join(tmpdir(), 'gigacad-svg-'));
  try {
    const render = [];
    for (const key of keys) {
      const svg = join(svgDir, `${key}.svg`);
      await writeFile(svg, iconSvg(key));
      render.push({ svg, png: join(outDir, `${key}.png`), pixels: pixels(key) });
    }
    return await runScript({ render });
  } finally {
    await rm(svgDir, { recursive: true, force: true });
  }
}

/**
 * Sets Finder icons. Icons come pre-rendered from the bundle; an icon it doesn't have (a new
 * file extension) is drawn into `cacheDir` once. If that fails, the plain file icon is used.
 */
export async function applyIcons(jobs: readonly IconJob[], bundleIconsDir: string, cacheDir: string): Promise<IconResult> {
  if (jobs.length === 0) return { rendered: 0, applied: 0, failed: [] };
  const pngFor = new Map<string, string>();
  const missing: string[] = [];
  for (const key of new Set(jobs.map((job) => job.key))) {
    const shipped = join(bundleIconsDir, `${key}.png`);
    const cached = join(cacheDir, `${key}.png`);
    if (existsSync(shipped)) pngFor.set(key, shipped);
    else if (existsSync(cached)) pngFor.set(key, cached);
    else missing.push(key);
  }
  let rendered = 0;
  if (missing.length > 0) {
    const result = await renderIcons(missing, cacheDir).catch(() => ({ rendered: 0, applied: 0, failed: missing }));
    rendered = result.rendered;
    for (const key of missing) {
      const cached = join(cacheDir, `${key}.png`);
      pngFor.set(key, existsSync(cached) ? cached : join(bundleIconsDir, 'file-file-.png'));
    }
  }
  const result = await runScript({ apply: jobs.map((job) => ({ target: job.target, png: pngFor.get(job.key) })) });
  return { ...result, rendered };
}
