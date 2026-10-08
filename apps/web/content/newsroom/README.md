# Newsroom articles

Each Markdown file here is one article at `gigacad.site/newsroom/<file name>`. The loader is `apps/web/lib/newsroom.ts`.

## Publishing an article

1. Add `content/newsroom/<slug>.md`. The slug is lowercase words joined by dashes, like `git-and-scrum-for-hardware`.
2. Start it with this header:

   ```
   ---
   title: Git and Scrum for hardware
   summary: One or two sentences for the list, search results, and the RSS feed.
   kind: essay
   date: 2026-10-08
   author: GigaCAD Team
   draft: true
   ---
   ```

   `kind` is `essay`, `roadmap`, or `news`. `date` is the day it goes out. `author` is a person for signed pieces and `GigaCAD Team` for everything else. When several articles share a date, an optional `order: <number>` sorts them, higher first.
3. Write the body in Markdown, starting with `##` section headings (the title is the page's only top-level heading). Tables, lists, links, and code all work. Raw HTML is not rendered.
4. Preview it with `pnpm --filter @gigacad/web dev` at `localhost:3000/newsroom`. Drafts show there with a Draft badge.
5. Remove `draft: true` (or set it to `false`) to publish. The next web deploy adds it to the newsroom and the RSS feed.

A header that's missing a field or has a bad date fails the build with the file's name, so a broken article can't go live.

## Writing

Follow the voice rules in [the design system](../../../../docs/design/README.md#voice): plain verbs, sentence case, the product's real words, and no claims we can't back up. Mark anything that isn't built yet as planned. Titles don't end with a period.
