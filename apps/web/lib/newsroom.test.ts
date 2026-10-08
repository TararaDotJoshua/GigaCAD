import { describe, expect, it } from 'vitest';
import { formatArticleDate, headingId, parseArticle, sortArticles, type Article } from './newsroom';

const header = (extra = '') => `---
title: Git and Scrum for hardware
summary: Why GigaCAD exists.
kind: essay
date: 2026-10-08
author: Joshua Tarara
${extra}---

## Why

Body: with a colon.
`;

describe('parseArticle', () => {
  it('reads the header and keeps the body', () => {
    expect(parseArticle('manifesto', header())).toEqual({
      slug: 'manifesto',
      title: 'Git and Scrum for hardware',
      summary: 'Why GigaCAD exists.',
      kind: 'essay',
      date: '2026-10-08',
      author: 'Joshua Tarara',
      order: 0,
      draft: false,
      body: '## Why\n\nBody: with a colon.',
    });
    expect(parseArticle('manifesto', header('draft: true\n')).draft).toBe(true);
    expect(parseArticle('manifesto', header('order: 2\n')).order).toBe(2);
  });

  it('names the file and the problem when the header is wrong', () => {
    expect(() => parseArticle('Bad_Name', header())).toThrow('content/newsroom/Bad_Name.md');
    expect(() => parseArticle('a', '## No header')).toThrow('header between --- lines');
    expect(() => parseArticle('a', header().replace('kind: essay', 'kind: memo'))).toThrow('kind must be one of essay, roadmap, news');
    expect(() => parseArticle('a', header().replace('2026-10-08', 'Oct 8'))).toThrow('date must look like');
    expect(() => parseArticle('a', header().replace('author: Joshua Tarara\n', ''))).toThrow('the header is missing "author"');
    expect(() => parseArticle('a', header('draft: yes\n'))).toThrow('draft must be true or false');
    expect(() => parseArticle('a', header('order: first\n'))).toThrow('order must be a whole number');
  });
});

describe('sortArticles', () => {
  const article = (slug: string, date: string, draft = false, order = 0) => ({ slug, title: slug, date, draft, order }) as Article;

  it('puts the newest first and leaves drafts out unless asked', () => {
    const list = [article('old', '2026-01-01'), article('new', '2026-10-08'), article('wip', '2026-12-01', true)];
    expect(sortArticles(list, false).map((a) => a.slug)).toEqual(['new', 'old']);
    expect(sortArticles(list, true).map((a) => a.slug)).toEqual(['wip', 'new', 'old']);
  });

  it('uses order to break ties on the same day', () => {
    const list = [article('a', '2026-10-08'), article('b', '2026-10-08', false, 2), article('c', '2026-10-08', false, 1)];
    expect(sortArticles(list, false).map((a) => a.slug)).toEqual(['b', 'c', 'a']);
  });
});

describe('formatting', () => {
  it('shows the calendar day whatever the time zone', () => {
    expect(formatArticleDate('2026-10-08')).toBe('October 8, 2026');
  });

  it('makes heading anchors', () => {
    expect(headingId('What we’re building, and why')).toBe('what-were-building-and-why');
  });
});
