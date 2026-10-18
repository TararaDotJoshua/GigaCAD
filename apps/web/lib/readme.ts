/**
 * Rendering a project's README: the HTML it may use, its heading anchors, and the project files
 * it links to and embeds.
 */

import type { Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as Schema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import type { DirectoryFile, Project } from './api';
import { entryPath, projectPath, treePath } from './paths';

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

/**
 * Where a README's images and videos load from: the web app, which checks the visitor can see
 * the project and redirects to the stored file. Storage links expire, so the page never holds one.
 */
export const mediaPath = (owner: string, slug: string, sha256: string, name: string) => projectPath(owner, slug, 'media', sha256, name);

/** Whether a media address is one mediaPath makes: a file hash and an image or video file name. */
export function isMediaRequest(sha256: string, name: string): boolean {
  return /^[0-9a-f]{64}$/.test(sha256) && /^[^/\\\x00-\x1f]{1,255}$/.test(name) && mediaKind(name) !== null;
}

/** Like GitHub, a README's ids get a prefix so they can't clash with the page's own. A link to `#parts` finds `user-content-parts`. */
const ID_PREFIX = 'user-content-';

/**
 * The HTML a README may use: what Markdown makes, plus a few tags people write by hand, like
 * `<details>`, `<b>`, `<kbd>`, `<sub>` and `<img width>`. Other tags are dropped and their text
 * kept, except the ones below whose content isn't text, which go entirely. Ids get ID_PREFIX.
 */
export const readmeSchema: Schema = {
  ...defaultSchema,
  tagNames: [
    'a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'li', 'ol',
    'p', 'pre', 's', 'section', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
    'tfoot', 'th', 'thead', 'tr', 'ul',
  ],
  attributes: {
    ...defaultSchema.attributes,
    // `<a name>` is an old way to write an anchor.
    a: [...(defaultSchema.attributes?.a ?? []), 'name'],
    '*': ['align', 'alt', 'checked', 'colSpan', 'dir', 'height', 'id', 'lang', 'open', 'rowSpan', 'start', 'title', 'width'],
  },
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto'] },
  strip: ['script', 'style', 'template', 'noscript', 'textarea', 'title', 'iframe', 'object', 'svg', 'math'],
  clobberPrefix: ID_PREFIX,
};

/** The parts of a project file a README needs to link to or show it. */
export type ReadmeFile = Pick<DirectoryFile, 'path' | 'name' | 'blob' | 'entryId'>;
export type ReadmeProject = Pick<Project, 'ownerHandle' | 'slug' | 'visibility'>;
/** Looks up every project path a README names at once, returning the ones that are files. */
export type FindFiles = (paths: string[]) => Promise<Record<string, ReadmeFile>>;

/** How ProjectReadme renders Markdown: GFM, a little safe HTML, heading anchors, and project files. */
export function readmeMarkdown(project: ReadmeProject, find: FindFiles) {
  return {
    remarkPlugins: [remarkGfm],
    // Footnote ids get their prefix when sanitized, like every other id, so it isn't added twice.
    remarkRehypeOptions: { clobberPrefix: '' },
    rehypePlugins: [rehypeRaw, [rehypeSanitize, readmeSchema], [rehypeSlug, { prefix: ID_PREFIX }], rehypeProjectFiles(project, find)],
  } satisfies Pick<Options, 'remarkPlugins' | 'remarkRehypeOptions' | 'rehypePlugins'>;
}

interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}
type HastNode = HastElement | { type: string; value?: string; children?: HastNode[] };

/** Turns `node` into a muted note, like `Missing image: photos/bench.jpg`. */
function note(node: HastElement, text: string) {
  node.tagName = 'span';
  node.properties = { className: ['readme-missing'] };
  node.children = [{ type: 'text', value: text }];
}

const isWebAddress = (url: string) => /^https?:/i.test(url) || url.startsWith('//');

/**
 * A rehype plugin, run after sanitizing, that points a README's links and images at the project.
 * `#parts` finds the heading `user-content-parts`. Web links open in a new tab; project paths open
 * here, at a root file's own page or in the file list: a folder, or a file in Branches or Releases
 * by its folder. Images and videos that name project files show them, and ones that aren't there
 * say so. In a private project, web images become links, so reading it tells no outside server.
 * `find` gets every project path at once.
 */
export function rehypeProjectFiles(project: ReadmeProject, find: FindFiles) {
  const { ownerHandle: owner, slug } = project;
  return () => async (tree: HastNode) => {
    const links: { node: HastElement; path: string }[] = [];
    const images: { node: HastElement; path: string }[] = [];

    const visitLink = (node: HastElement): boolean => {
      const href = typeof node.properties.href === 'string' ? node.properties.href.trim() : '';
      if (!href || (/^[a-z][a-z0-9+.-]*:/i.test(href) && !isWebAddress(href) && !/^mailto:/i.test(href))) {
        // Sanitizing drops `javascript:` and other unsafe addresses. What's left isn't a link, unless it's a named anchor.
        delete node.properties.href;
        if (node.properties.id === undefined && node.properties.name === undefined) {
          node.tagName = 'span';
          return false;
        }
      } else if (href.startsWith('#')) {
        const id = href.slice(1);
        node.properties.href = id && !id.startsWith(ID_PREFIX) ? `#${ID_PREFIX}${id}` : href;
      } else if (isWebAddress(href)) {
        node.properties.target = '_blank';
        node.properties.rel = ['noopener', 'noreferrer', 'nofollow'];
      } else if (!/^mailto:/i.test(href)) {
        links.push({ node, path: projectFilePath(href) ?? '' });
      }
      return true;
    };

    const visitImage = (node: HastElement, inLink: boolean) => {
      const src = typeof node.properties.src === 'string' ? node.properties.src : '';
      const alt = typeof node.properties.alt === 'string' ? node.properties.alt : '';
      const path = projectFilePath(src);
      if (path) {
        if (mediaKind(path)) images.push({ node, path });
        else note(node, `Can’t show ${path} here`);
      } else if (isWebAddress(src) && project.visibility === 'public') {
        node.properties = { ...node.properties, loading: 'lazy', referrerPolicy: 'no-referrer' };
      } else if (isWebAddress(src)) {
        // A link can't hold another link, so an image inside one (a badge) shows its text.
        node.tagName = inLink ? 'span' : 'a';
        node.properties = inLink ? {} : { href: src, target: '_blank', rel: ['noopener', 'noreferrer', 'nofollow'] };
        node.children = [{ type: 'text', value: alt || src }];
      } else {
        note(node, alt ? `Missing image: ${alt}` : 'Missing image');
      }
    };

    const walk = (node: HastNode, inLink: boolean) => {
      let isLink = false;
      if (node.type === 'element') {
        const element = node as HastElement;
        if (element.tagName === 'a') isLink = visitLink(element);
        else if (element.tagName === 'img') visitImage(element, inLink);
      }
      node.children?.forEach((child) => walk(child, inLink || isLink));
    };
    walk(tree, false);

    // Images first, so they're looked up even when a README names more paths than `find` takes.
    const paths = [...new Set([...images.map((image) => image.path), ...links.flatMap((link) => (link.path ? [link.path] : []))])];
    const found = paths.length ? await find(paths) : {};

    for (const { node, path } of images) {
      const file = found[path];
      const kind = file && mediaKind(file.name);
      if (!file || !kind) {
        note(node, `Missing image: ${path}`);
      } else if (kind === 'video') {
        const title = node.properties.alt || node.properties.title;
        node.tagName = 'video';
        node.properties = { src: mediaPath(owner, slug, file.blob, file.name), controls: true, preload: 'metadata', playsInline: true, ...(title ? { title } : {}) };
      } else {
        node.properties = { ...node.properties, src: mediaPath(owner, slug, file.blob, file.name), loading: 'lazy' };
      }
    }
    for (const { node, path } of links) {
      const file = path ? found[path] : undefined;
      node.properties.href = file?.entryId
        ? entryPath(owner, slug, file.entryId)
        : treePath(owner, slug, file ? file.path.slice(0, Math.max(0, file.path.lastIndexOf('/'))) : path);
    }
  };
}

/**
 * The page already has an h1, so a README's or Markdown file's headings move down a level: `# Name`
 * renders as an h2.
 * A rehype plugin, so headings written as HTML move too.
 */
export function rehypeDemoteHeadings() {
  type Node = { type?: string; tagName?: string; children?: Node[] };
  const walk = (node: Node) => {
    const level = node.type === 'element' && /^h([1-5])$/.exec(node.tagName ?? '')?.[1];
    if (level) node.tagName = `h${Number(level) + 1}`;
    node.children?.forEach(walk);
  };
  return walk;
}
