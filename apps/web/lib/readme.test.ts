import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownAsync } from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { mediaKind, projectFilePath, rehypeProjectMedia } from './readme';

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

describe('rehypeProjectMedia', () => {
  const render = async (markdown: string) => {
    const asked: string[][] = [];
    const plugin = rehypeProjectMedia(async (paths) => {
      asked.push(paths);
      return {
        'photos/bench.jpg': { url: 'https://files.test/bench', kind: 'image' as const },
        'clip.mp4': { url: 'https://files.test/clip', kind: 'video' as const },
      };
    });
    const html = renderToStaticMarkup(await MarkdownAsync({ children: markdown, rehypePlugins: [plugin] }));
    return { html, asked };
  };

  it('points images at project files and plays videos in place', async () => {
    const { html, asked } = await render('![Bench](photos/bench.jpg)\n\n![Assembly](./clip.mp4)\n\n![Again](photos/bench.jpg)');
    expect(asked).toEqual([['photos/bench.jpg', 'clip.mp4']]);
    expect(html).toContain('<img src="https://files.test/bench" alt="Bench" loading="lazy"/>');
    expect(html).toContain('<video src="https://files.test/clip" controls="" preload="metadata" playsInline="" title="Assembly"></video>');
  });

  it('leaves web images and missing files as written, without asking when there is nothing to find', async () => {
    const { html, asked } = await render('![Web](https://example.com/a.png) ![Gone](missing.png)');
    expect(asked).toEqual([['missing.png']]);
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain('src="missing.png"');
    expect((await render('No pictures.')).asked).toEqual([]);
  });
});
