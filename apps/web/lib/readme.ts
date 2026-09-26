/** Embedding project files in a README: which images and videos it points at, and how to show them. */

export type MediaKind = 'image' | 'video';

const KINDS: [RegExp, MediaKind][] = [
  [/\.(png|jpe?g|gif|webp|avif|bmp)$/i, 'image'],
  [/\.(mp4|m4v|webm|mov|ogv)$/i, 'video'],
];

/** Whether a file can be embedded, by its name. The API serves the same types inline. */
export function mediaKind(path: string): MediaKind | null {
  return KINDS.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

/**
 * The project path a README at the root points at with a relative URL, like `photos/bench.jpg`,
 * `./Releases/v2/clip.mp4`, or `/renders/arm%20v2.png`. Web addresses and anchors aren't project files.
 */
export function projectFilePath(url: string): string | null {
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('#')) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.replace(/[?#].*$/, ''));
  } catch {
    return null;
  }
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.length ? segments.join('/') : null;
}

export interface EmbeddedFile {
  url: string;
  kind: MediaKind;
}

interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}
type HastNode = HastElement | { type: string; children?: HastNode[] };

/**
 * A rehype plugin that points a README's images at the project files they name, turning
 * videos into players. `resolve` gets every project path at once and returns links for the
 * ones it found; images it can't find are left as written.
 */
export function rehypeProjectMedia(resolve: (paths: string[]) => Promise<Record<string, EmbeddedFile>>) {
  return () => async (tree: HastNode) => {
    const images: { node: HastElement; path: string }[] = [];
    const walk = (node: HastNode) => {
      if (node.type === 'element' && (node as HastElement).tagName === 'img') {
        const element = node as HastElement;
        const path = typeof element.properties.src === 'string' ? projectFilePath(element.properties.src) : null;
        if (path && mediaKind(path)) images.push({ node: element, path });
      }
      node.children?.forEach(walk);
    };
    walk(tree);
    if (images.length === 0) return;
    const found = await resolve([...new Set(images.map((image) => image.path))]);
    for (const { node, path } of images) {
      const file = found[path];
      if (!file) continue;
      if (file.kind === 'video') {
        const title = node.properties.alt || node.properties.title;
        node.tagName = 'video';
        node.properties = { src: file.url, controls: true, preload: 'metadata', playsInline: true, ...(title ? { title } : {}) };
      } else {
        node.properties = { ...node.properties, src: file.url, loading: 'lazy' };
      }
    }
  };
}
