import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownAsync } from 'react-markdown';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getMedia } from '../app/(product)/[owner]/[project]/media/[sha]/[name]/route';
import { ApiError, apiRequest, type DirectoryFile } from './api';
import { getReadme } from './product';
import { isMediaRequest, mediaKind, mediaPath, projectFilePath, readmeMarkdown, type ReadmeFile } from './readme';

vi.mock('./session', () => ({ getAccessToken: async () => 'token' }));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), apiRequest: vi.fn() }));

const BENCH = 'a'.repeat(64);
const CLIP = 'b'.repeat(64);
const NOTES_ENTRY = '11111111-1111-4111-8111-111111111111';

describe('projectFilePath', () => {
  it('reads relative paths from the project root', () => {
    expect(projectFilePath('photos/bench.jpg')).toBe('photos/bench.jpg');
    expect(projectFilePath('./Releases/v2/clip.mp4')).toBe('Releases/v2/clip.mp4');
    expect(projectFilePath('/renders/arm%20v2.png?raw=1#top')).toBe('renders/arm v2.png');
    expect(projectFilePath('../../a/../b.png')).toBe('b.png');
  });

  it('leaves web addresses and anchors alone', () => {
    expect(projectFilePath('https://example.com/a.png')).toBeNull();
    expect(projectFilePath('//cdn.example.com/a.png')).toBeNull();
    expect(projectFilePath('data:image/png;base64,AAAA')).toBeNull();
    expect(projectFilePath('#usage')).toBeNull();
    expect(projectFilePath('%E0%A4%A')).toBeNull();
  });
});

describe('mediaKind', () => {
  it('knows images and video, and nothing that could run script', () => {
    expect(mediaKind('a/b.PNG')).toBe('image');
    expect(mediaKind('shot.jpeg')).toBe('image');
    expect(mediaKind('clip.mov')).toBe('video');
    expect(mediaKind('logo.svg')).toBeNull();
    expect(mediaKind('page.html')).toBeNull();
  });
});

describe('readmeMarkdown', () => {
  const files: Record<string, ReadmeFile> = {
    'photos/bench.jpg': { path: 'photos/bench.jpg', name: 'bench.jpg', blob: BENCH, entryId: '22222222-2222-4222-8222-222222222222' },
    'clip.mp4': { path: 'clip.mp4', name: 'clip.mp4', blob: CLIP, entryId: '33333333-3333-4333-8333-333333333333' },
    'Docs/assembly-notes.txt': { path: 'Docs/assembly-notes.txt', name: 'assembly-notes.txt', blob: 'c'.repeat(64), entryId: NOTES_ENTRY },
    'Branches/main/parts/P1.SLDPRT': { path: 'Branches/main/parts/P1.SLDPRT', name: 'P1.SLDPRT', blob: 'd'.repeat(64), entryId: null },
  };
  const render = async (markdown: string, visibility: 'public' | 'private' = 'public') => {
    const asked: string[][] = [];
    const options = readmeMarkdown({ ownerHandle: 'josh', slug: 'rig', visibility }, async (paths) => {
      asked.push(paths);
      return Object.fromEntries(paths.flatMap((path) => (files[path] ? [[path, files[path]]] : [])));
    });
    const html = renderToStaticMarkup(await MarkdownAsync({ ...options, children: markdown }));
    return { html, asked };
  };

  it('shows project images and plays videos through the web app, never a storage link', async () => {
    const { html, asked } = await render('![Bench](photos/bench.jpg)\n\n![Assembly](./clip.mp4)\n\n![Again](photos/bench.jpg)');
    expect(asked).toEqual([['photos/bench.jpg', 'clip.mp4']]);
    expect(html).toContain(`<img src="/josh/rig/media/${BENCH}/bench.jpg" alt="Bench" loading="lazy"/>`);
    expect(html).toContain(`<video src="/josh/rig/media/${CLIP}/clip.mp4" controls="" preload="metadata" playsInline="" title="Assembly"></video>`);
  });

  it('says when an image isn’t in the project, instead of a broken picture', async () => {
    const { html } = await render('![Gone](photos/missing.png) ![Logo](logo.svg)');
    expect(html).toContain('<span class="readme-missing">Missing image: photos/missing.png</span>');
    expect(html).toContain('<span class="readme-missing">Can’t show logo.svg here</span>');
    expect(html).not.toContain('<img');
    expect((await render('No pictures.')).asked).toEqual([]);
  });

  it('opens project paths here: root files at their page, folders and other files in the file list', async () => {
    const { html, asked } = await render(
      '[notes](Docs/assembly-notes.txt) [v2](Releases/v2) [part](Branches/main/parts/P1.SLDPRT) [docs](./Docs/) [home](./) [space](My%20Parts/a.txt#top)',
    );
    expect(asked).toEqual([['Docs/assembly-notes.txt', 'Releases/v2', 'Branches/main/parts/P1.SLDPRT', 'Docs', 'My Parts/a.txt']]);
    expect(html).toContain(`<a href="/josh/rig/entries/${NOTES_ENTRY}">notes</a>`);
    expect(html).toContain('<a href="/josh/rig/tree/Releases/v2">v2</a>');
    expect(html).toContain('<a href="/josh/rig/tree/Branches/main/parts">part</a>');
    expect(html).toContain('<a href="/josh/rig/tree/Docs">docs</a>');
    expect(html).toContain('<a href="/josh/rig">home</a>');
    expect(html).toContain('<a href="/josh/rig/tree/My%20Parts/a.txt">space</a>');
    expect(html).not.toContain('target=');
  });

  it('opens web links in a new tab, and keeps unsafe ones from being links at all', async () => {
    const { html, asked } = await render(
      '[site](https://example.com/a) [mail](mailto:jo@example.com) [bad](javascript:alert(1)) <a href="javascript:alert(2)">raw</a> [data](data:text/html,hi)',
    );
    expect(asked).toEqual([]);
    expect(html).toContain('<a href="https://example.com/a" target="_blank" rel="noopener noreferrer nofollow">site</a>');
    expect(html).toContain('<a href="mailto:jo@example.com">mail</a>');
    expect(html).toContain('<span>bad</span>');
    expect(html).toContain('<span>raw</span>');
    expect(html).toContain('<span>data</span>');
    expect(html).not.toMatch(/javascript|data:/);
  });

  it('gives headings GitHub’s anchors, which #links find', async () => {
    const { html } = await render(
      'See [the parts](#parts-table), [notes](#notes-1) and [x](#user-content-parts-table).\n\n## Parts table\n\n## Notes\n\n## Notes\n\nA note.[^1]\n\n[^1]: Footnote.',
    );
    expect(html).toContain('<h2 id="user-content-parts-table">Parts table</h2>');
    expect(html).toContain('<h2 id="user-content-notes">Notes</h2>');
    expect(html).toContain('<h2 id="user-content-notes-1">Notes</h2>');
    expect(html).toContain('<a href="#user-content-parts-table">the parts</a>');
    expect(html).toContain('<a href="#user-content-notes-1">notes</a>');
    expect(html).toContain('<a href="#user-content-parts-table">x</a>');
    // Footnote links and their targets get the prefix once.
    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain('id="user-content-fn-1"');
    expect(html).toContain('href="#user-content-fnref-1"');
    expect(html).toContain('id="user-content-fnref-1"');
  });

  it('renders a little hand-written HTML and drops the rest', async () => {
    const { html } = await render(
      [
        '<details open><summary>Specs</summary>',
        '',
        'Press <kbd>Ctrl</kbd>+<kbd>S</kbd>. H<sub>2</sub>O, x<sup>2</sup>, <b>bold</b><br>next',
        '',
        '</details>',
        '',
        '<p align="center"><img src="photos/bench.jpg" width="200" onerror="alert(1)" style="border:9px"></p>',
        '',
        '<a name="anchor"></a><script>alert(1)</script><style>body{display:none}</style><iframe src="https://example.com"></iframe>',
        '',
        '<div onclick="alert(1)" class="x" id="box"><form action="/x"><button name="go">kept</button></form></div>',
      ].join('\n'),
    );
    expect(html).toContain('<details open=""><summary>Specs</summary>');
    expect(html).toContain('<kbd>Ctrl</kbd>+<kbd>S</kbd>');
    expect(html).toContain('H<sub>2</sub>O, x<sup>2</sup>, <b>bold</b><br/>next');
    expect(html).toContain(`<p align="center"><img src="/josh/rig/media/${BENCH}/bench.jpg" width="200" loading="lazy"/></p>`);
    expect(html).toContain('<a name="user-content-anchor"></a>');
    expect(html).toContain('<div id="user-content-box">kept</div>');
    expect(html).not.toMatch(/script|alert|style|display|iframe|onclick|onerror|class="x"|<form|<button|name="go"/);
  });

  it('keeps web images in public projects, without telling their servers where they’re shown', async () => {
    const { html } = await render('![Logo](https://example.com/logo.png)');
    expect(html).toContain('<img src="https://example.com/logo.png" alt="Logo" loading="lazy" referrerPolicy="no-referrer"/>');
  });

  it('turns web images in private projects into links, so reading the README tells no one', async () => {
    const { html } = await render('![Logo](https://example.com/logo.png) ![](https://example.com/a.png) [![build](https://ci.example.com/badge.png)](https://ci.example.com)', 'private');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://example.com/logo.png" target="_blank" rel="noopener noreferrer nofollow">Logo</a>');
    expect(html).toContain('<a href="https://example.com/a.png" target="_blank" rel="noopener noreferrer nofollow">https://example.com/a.png</a>');
    expect(html).toContain('<a href="https://ci.example.com" target="_blank" rel="noopener noreferrer nofollow"><span>build</span></a>');
  });

  it('tables keep their cells and alignment', async () => {
    const { html } = await render('| Part | Qty |\n| :-- | --: |\n| Bracket | 2 |');
    expect(html).toContain('<thead><tr><th style="text-align:left">Part</th><th style="text-align:right">Qty</th></tr></thead>');
  });
});

describe('getReadme', () => {
  it('says a README is too large to show rather than leaving it out', async () => {
    const file = { kind: 'file', name: 'README.md', path: 'README.md', size: 2 * 1024 * 1024, location: { area: 'root' } } as unknown as DirectoryFile;
    expect(await getReadme('p', [file], true)).toEqual({ file, tooLarge: true });
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe('the README media route', () => {
  const request = (sha: string, name: string) => getMedia(new Request('http://app.test/'), { params: Promise.resolve({ owner: 'josh', project: 'rig', sha, name }) });
  const api = vi.mocked(apiRequest);
  beforeEach(() => api.mockReset());

  it('only takes a file hash and an image or video name', async () => {
    expect(isMediaRequest(BENCH, 'bench.jpg')).toBe(true);
    expect(mediaPath('josh', 'rig', BENCH, 'arm v2.png')).toBe(`/josh/rig/media/${BENCH}/arm%20v2.png`);
    for (const [sha, name] of [['../../v1/me', 'a.png'], [BENCH.toUpperCase(), 'a.png'], [BENCH, 'logo.svg'], [BENCH, 'a/b.png'], [BENCH, 'page.html']] as const) {
      expect(isMediaRequest(sha, name)).toBe(false);
      expect((await request(sha, name)).status).toBe(404);
    }
    expect(api).not.toHaveBeenCalled();
  });

  it('checks access with the session and redirects to a fresh link, cached briefly', async () => {
    api.mockResolvedValueOnce({ id: 'project-id' }).mockResolvedValueOnce({ downloads: [{ sha256: BENCH, url: 'https://files.test/bench' }] });
    const response = await request(BENCH, 'bench.jpg');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://files.test/bench');
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(api.mock.calls[0]).toEqual(['token', '/v1/users/josh/projects/rig']);
    expect(api.mock.calls[1]?.[1]).toBe('/v1/projects/project-id/blobs/downloads');
    expect(JSON.parse(String(api.mock.calls[1]?.[2]?.body))).toEqual({ sha256s: [BENCH], filenames: { [BENCH]: 'bench.jpg' }, inline: true });
  });

  it('is not found when the project or file isn’t there for this visitor, and says so when the API is down', async () => {
    api.mockRejectedValueOnce(new ApiError(404, 'not_found', 'Not found'));
    expect((await request(BENCH, 'bench.jpg')).status).toBe(404);
    api.mockResolvedValueOnce({ id: 'project-id' }).mockResolvedValueOnce({ downloads: [] });
    expect((await request(BENCH, 'bench.jpg')).status).toBe(404);
    api.mockRejectedValueOnce(new ApiError(0, 'network', 'Unreachable'));
    expect((await request(BENCH, 'bench.jpg')).status).toBe(502);
  });
});
