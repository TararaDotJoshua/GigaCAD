// Finder icons, drawn from the web app's line icons (apps/web/components/icons.tsx) in the brand
// colors (docs/DESIGN.md). Pure functions: build scripts pre-render these to PNG, and the app
// renders the rare unknown file extension at run time.
//
// CoreSVG, which draws these on macOS, ignores `rgb(r g b / a)`: use hex colors with separate
// opacity attributes.

const FOREST = '#0A2922';
const MOSS = '#134E41';
const PAPER = '#F5F5F7';
const MIST = '#EBEBED';
const SIGNAL = '#34A853';

// 16×16 glyphs, stroke 1.4, from apps/web/components/icons.tsx.
const GLYPHS = {
  folder: '<path d="M1.8 4.2c0-.6.5-1 1-1h3.4l1.4 1.6h5.6c.6 0 1 .5 1 1v6.9c0 .6-.4 1-1 1H2.8c-.5 0-1-.4-1-1z"/>',
  branch: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 2.5-2 3-5.5 4"/>',
  cube: '<path d="M8 1.8 13.4 4.9v6.2L8 14.2 2.6 11.1V4.9L8 1.8Z"/><path d="M2.6 4.9 8 8l5.4-3.1M8 8v6.2"/>',
  lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  download: '<path d="M8 2.2v8M4.8 7.2 8 10.4l3.2-3.2M2.8 13.3h10.4"/>',
  assembly: '<path d="M8 1.8 13.5 4.9v6.2L8 14.2 2.5 11.1V4.9z"/><path d="M2.5 4.9 8 8l5.5-3.1M8 8v6.2"/>',
  part: '<rect x="2.5" y="4" width="11" height="8" rx="1"/><circle cx="8" cy="8" r="1.8"/>',
  drawing: '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M9 13.5v-3h5M5 5.5h3.5v3.5H5z"/>',
  file: '<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>',
} as const;
type Glyph = keyof typeof GLYPHS;

// The LogoMark (24×24, stroke 3.4) from apps/web/components/Logo.tsx.
const LOGO =
  '<path d="M18.2 6.1A8.5 8.5 0 1 0 12.4 20.5" stroke-width="3.4" stroke-linecap="butt"/><path d="M13.6 11.4h7.2v7.2M20.3 11.9l-6.6 6.6" stroke-width="3.4" stroke-linecap="butt" stroke-linejoin="miter"/>';

const glyph = (name: Glyph, cx: number, cy: number, size: number, color: string) => {
  const s = size / 16;
  return `<g transform="translate(${cx - 8 * s} ${cy - 8 * s}) scale(${s})" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</g>`;
};
const logo = (cx: number, cy: number, size: number, color: string) => {
  const s = size / 24;
  return `<g transform="translate(${cx - 12 * s} ${cy - 12 * s}) scale(${s})" fill="none" stroke="${color}">${LOGO}</g>`;
};
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>`;

const FOLDER_BACK = 'M120 250q0-50 50-50h226q25 0 42 18l44 44h372q50 0 50 50v468H120z';

interface FolderArt {
  readonly mark: Glyph | 'logo';
  readonly badge?: 'yours' | 'theirs' | undefined;
  readonly light?: boolean | undefined;
  /** Not downloaded: drawn as hidden edges (dashed, like a drafting view), with a download arrow. */
  readonly cloud?: boolean | undefined;
}

function folder({ mark, badge, light = false, cloud = false }: FolderArt): string {
  if (cloud) {
    const dash = `fill="none" stroke="${FOREST}" stroke-opacity="0.55" stroke-width="16" stroke-dasharray="48 32" stroke-linejoin="round"`;
    return svg(
      `<path d="${FOLDER_BACK}" ${dash}/><rect x="120" y="318" width="784" height="562" rx="48" fill="${PAPER}" fill-opacity="0.6" stroke="${FOREST}" stroke-opacity="0.55" stroke-width="16" stroke-dasharray="48 32"/>` +
        glyph(mark === 'logo' ? 'download' : mark, 512, 600, 290, FOREST),
    );
  }
  const back = light ? MIST : MOSS;
  const front = light ? PAPER : FOREST;
  const ink = light ? FOREST : PAPER;
  let body = `<path d="${FOLDER_BACK}" fill="${back}"/>`;
  body += `<rect x="120" y="318" width="784" height="562" rx="48" fill="${front}"${light ? ` stroke="${FOREST}" stroke-opacity="0.12" stroke-width="6"` : ''}/>`;
  if (!light) body += `<path d="M170 321h684" stroke="${PAPER}" stroke-opacity="0.10" stroke-width="6"/>`;
  body += mark === 'logo' ? logo(512, 600, light ? 330 : 290, ink) : glyph(mark, 512, 600, 290, ink);
  // Signal green marks your checkout, the only state it's used for here.
  if (badge === 'yours') body += `<circle cx="826" cy="806" r="74" fill="${SIGNAL}" stroke="${FOREST}" stroke-width="22"/>`;
  if (badge === 'theirs') body += `<circle cx="800" cy="790" r="100" fill="${PAPER}" stroke="${FOREST}" stroke-width="18"/>${glyph('lock', 800, 790, 124, FOREST)}`;
  return svg(body);
}

function document(kind: Glyph, ext: string): string {
  let body = `<path d="M264 96h376l168 168v616a48 48 0 0 1-48 48H264a48 48 0 0 1-48-48V144a48 48 0 0 1 48-48z" fill="${FOREST}" stroke="${PAPER}" stroke-opacity="0.2" stroke-width="8"/>`;
  body += `<path d="M640 96v120a48 48 0 0 0 48 48h120z" fill="${MOSS}"/>`;
  if (!ext) return svg(body + glyph(kind, 512, 540, 340, PAPER));
  body += glyph(kind, 512, 450, 300, PAPER);
  const label = ext.toUpperCase();
  const size = label.length > 5 ? 96 : 116;
  body += `<text x="512" y="800" font-family="SF Mono, Menlo, monospace" font-size="${size}" font-weight="700" letter-spacing="4" fill="${PAPER}" fill-opacity="0.72" text-anchor="middle">${label}</text>`;
  return svg(body);
}

/** The Dock and Finder icon of the app itself: the logo on a Forest tile. */
export function appIconSvg(): string {
  return svg(`<rect x="100" y="100" width="824" height="824" rx="185" fill="${FOREST}"/><rect x="100" y="100" width="824" height="824" rx="185" fill="none" stroke="${PAPER}" stroke-opacity="0.08" stroke-width="4"/>${logo(512, 512, 470, PAPER)}`);
}

/** The menu bar icon: the logo alone in black, used as a template image (macOS tints it). */
export function trayIconSvg(): string {
  const s = 1024 / 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><g transform="scale(${s})" fill="none" stroke="#000000">${LOGO}</g></svg>`;
}

// --- Which icon a path gets --------------------------------------------------------------

export const FOLDER_ICONS = {
  'folder-root': { mark: 'logo', light: true },
  'folder-owner': { mark: 'folder' },
  'folder-project': { mark: 'logo' },
  'folder-plain': { mark: 'folder' },
  'folder-branches': { mark: 'branch' },
  'folder-releases': { mark: 'cube' },
  'folder-branch': { mark: 'folder' },
  'folder-branch-yours': { mark: 'folder', badge: 'yours' },
  'folder-branch-theirs': { mark: 'folder', badge: 'theirs' },
  'folder-branch-cloud': { mark: 'download', cloud: true },
  'folder-release': { mark: 'lock' },
  'folder-release-cloud': { mark: 'download', cloud: true },
} as const satisfies Record<string, FolderArt>;
export type FolderIcon = keyof typeof FOLDER_ICONS;

// Same mapping as apps/web/components/product/FileGlyph.tsx.
const KINDS: readonly [RegExp, Glyph][] = [
  [/\.(sldasm|asm|iam|f3z)$/i, 'assembly'],
  [/\.(slddrw|drw|idw|dwg|dxf|pdf)$/i, 'drawing'],
  [/\.(sldprt|prt|ipt|f3d|fcstd|step|stp|iges|igs|stl|3mf|obj|x_t)$/i, 'part'],
];

/** Extensions whose icons ship pre-rendered; anything else is drawn on first use. */
export const KNOWN_EXTENSIONS = [
  ...'sldasm asm iam f3z slddrw drw idw dwg dxf pdf sldprt prt ipt f3d fcstd step stp iges igs stl 3mf obj x_t'.split(' '),
  ...'md txt csv json png jpg jpeg svg zip gcode'.split(' '),
];

/** `file-<kind>-<ext>`, e.g. `file-part-sldprt`. Long or odd extensions get the plain file icon without a label. */
export function fileIconKey(name: string): string {
  const kind = KINDS.find(([pattern]) => pattern.test(name))?.[1] ?? 'file';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return `file-${kind}-${/^[a-z0-9_]{1,6}$/.test(ext) ? ext : ''}`;
}

export function isFolderIcon(key: string): key is FolderIcon {
  return key in FOLDER_ICONS;
}

/** The SVG for any icon key. */
export function iconSvg(key: string): string {
  if (key === 'app') return appIconSvg();
  if (key === 'tray') return trayIconSvg();
  if (isFolderIcon(key)) return folder(FOLDER_ICONS[key]);
  const match = key.match(/^file-(assembly|drawing|part|file)-([a-z0-9_]*)$/);
  if (!match) throw new Error(`Unknown icon ${key}`);
  return document(match[1] as Glyph, match[2]!);
}

/** Every icon that ships pre-rendered. */
export function prerenderedKeys(): string[] {
  const files = new Set(KNOWN_EXTENSIONS.map((ext) => fileIconKey(`x.${ext}`)));
  files.add('file-file-');
  return [...Object.keys(FOLDER_ICONS), ...files];
}

/** Folders are few and large in Finder; files are many, so their icons are smaller to keep them light. */
export const iconPixels = (key: string) => (isFolderIcon(key) ? 512 : 256);
