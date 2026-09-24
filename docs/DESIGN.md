# GigaCAD design system

This covers the marketing site at gigacad.site and the product at app.gigacad.site. The CSS tokens are in `apps/web/app/globals.css`. If you change a value here, change it there too.

## Idea

GigaCAD is version control for people who make physical things. The look comes from the engineering drawing: a drafting grid, line-art parts, and hidden edges drawn dashed. The page should feel like a clean drawing sheet printed on dark green stock. Colors, grids, and line work should all mean something. Avoid decoration.

The page layout follows t3.codes: a large centered headline, product UI that looks real, and sections that alternate text with visuals. The drawing-sheet treatment is what makes it GigaCAD's own.

## Color

Five base colors. They come from the brand sheet and should not be changed.

| Token | Hex | Name | Use |
|---|---|---|---|
| `--forest` | `#0A2922` | Forest | Page background, dark app chrome, text on Paper |
| `--moss` | `#134E41` | Moss | Raised surfaces on Forest: tiles, the app sidebar's active row, hover fills |
| `--paper` | `#F5F5F7` | Paper | Main text on Forest, primary buttons, light app panes |
| `--mist` | `#EBEBED` | Mist | Secondary surfaces inside light panes: table headers, inputs, segmented controls |
| `--signal` | `#34A853` | Signal | **State only**: released, rebuild passed, "take branch", your checkout |

Signal is not a decoration color. Use it only when something is in a good or final state. It should never color a headline word, a gradient, or an icon that has no state. If a screen shows no state, it shouldn't contain green.

Derived tokens (the only allowed tints):

| Token | Value | Use |
|---|---|---|
| `--forest-deep` | `#071E19` | Footer, insets, code wells |
| `--ink` | `#0A2922` | Text on Paper/Mist (the same value as Forest) |
| `--ink-muted` | `rgb(10 41 34 / 0.62)` | Secondary text on Paper |
| `--paper-muted` | `rgb(245 245 247 / 0.66)` | Secondary text on Forest |
| `--paper-faint` | `rgb(245 245 247 / 0.42)` | Tertiary text and captions on Forest |
| `--line` | `rgb(245 245 247 / 0.10)` | Hairlines on Forest |
| `--line-strong` | `rgb(245 245 247 / 0.18)` | Tile and window borders on Forest |
| `--line-ink` | `rgb(10 41 34 / 0.10)` | Hairlines on Paper |
| `--caution` | `#D9A441` | Changed on both sides, needs rebuild |
| `--danger` | `#E5484D` | Rebuild errors, force-released lock |

Contrast: Paper on Forest is about 15:1 and Paper-muted is about 8:1, both fine for body text. Paper-faint is only for text of 14px or larger. Signal on Forest is 4.6:1, so Signal text needs 14px+ at weight 500 or more.

## Type

| Role | Family | Notes |
|---|---|---|
| Everything | **Hanken Grotesk** (400, 500, 600) | Neo-grotesk, matches the wordmark |
| File names, paths, version tags inside product UI | **IBM Plex Mono** (400, 500) | Only for real data: `rear_arm_L.SLDPRT`, `branches\suspension\`. Never for labels or decoration |

Scale (a 1.25 ratio at body sizes, larger jumps for display):

| Token | Size / line-height | Tracking | Weight | Use |
|---|---|---|---|---|
| `--t-display` | clamp(3rem, 7.4vw, 6.25rem) / 0.95 | -0.055em | 600 | Hero headline only |
| `--t-h2` | clamp(2.25rem, 4.4vw, 3.5rem) / 1.02 | -0.045em | 600 | Section headlines |
| `--t-h3` | 1.5rem / 1.15 | -0.025em | 600 | Feature titles |
| `--t-lead` | clamp(1.125rem, 1.6vw, 1.375rem) / 1.5 | -0.01em | 400 | Hero and section subheads |
| `--t-body` | 1.0625rem / 1.6 | 0 | 400 | Paragraphs |
| `--t-small` | 0.875rem / 1.45 | 0 | 400/500 | UI text, captions |
| `--t-micro` | 0.75rem / 1.4 | 0.01em | 500 | Badges, table headers |

Rules:
- Headlines are set tight, like the T3 hero, in sentence case, and end with a period.
- Don't give one word a different color, italic, or weight to "accent" it. The whole headline is the statement.
- Don't use all caps anywhere, and don't put eyebrow labels above headings.
- Keep lines of text under about 65 characters (`max-width: 36ch` for leads, `60ch` for body).

## Layout

- Container: 1200px max width, with 24px gutters on mobile and 40px on desktop.
- Hero: centered. Every other section is left-aligned text next to a visual, alternating sides, and stacks to one column below 900px.
- Section rhythm: 160px vertical padding on desktop and 96px on mobile. Sections are separated by space, not by dividers.
- Background: a drafting grid behind the hero only (8px minor and 40px major lines at `--line` strength, radially masked). Don't repeat it in every section.

```
┌──────────────────────────────────────────────────────┐
│ G GigaCAD   Features  How it works   Log in [Start]  │
│                                                      │
│   [part]          drafting grid           [part]     │
│            Branches and releases                     │
│   [part]     for your SolidWorks files.     [part]   │
│              lead, 2 lines                           │
│              [ Start a project ]                     │
│              Download for Windows                    │
│ ┌──────────────────────────────────────────────────┐ │
│ │ sidebar │ release request diff pick (live demo)  │ │
│ └──────────────────────────────────────────────────┘ │
│  How it works: branch diagram + 5 numbered steps     │
│  text │ visual      (Explorer drive)                 │
│  visual │ text      (checkout lock)                  │
│  text │ visual      (replace a part)                 │
│  visual │ text      (locked releases)                │
│  three short extras, hairline-topped columns         │
│  closing headline + button                           │
│  footer                                              │
└──────────────────────────────────────────────────────┘
```

### Subpages

Every marketing page lives in `apps/web/app/(marketing)/`. That folder's layout adds the shared header and footer from `components/SiteChrome.tsx`. Shared URLs and contact addresses are in `components/site.ts`.

- **Page header** (`.page-head`): left-aligned, with `.page-title` (clamp 2.5–4.5rem, same tight tracking as the hero). The drafting grid appears again, masked toward the top left. Legal pages use `.page-head-compact` without the grid.
- **Download**: the hero is two columns, copy on the left and a product visual on the right. The sections below reuse `.extras`, `.steps`, and a `.spec-table` definition list.
- **Legal** (`components/LegalPage.tsx`): a sticky table of contents on the left and `.prose` text on the right. A Moss "short version" box at the top sums up the rules in plain language. Section titles are plain sentences, not "Section 4.2".
- **Docs** (`app/(marketing)/docs/`): the sidebar comes from `content.tsx`, and every page is statically generated from that list. On mobile the sidebar collapses into a `<details>` menu.
- **Unwritten docs pages** show their planned headings in dashed boxes (`.doc-pending`), the same dashed style as hidden edges in the part drawings. A page counts as written once it has a `body` in `content.tsx`.
- **Long-form text** (`.prose`): max width 68ch, Paper-muted body text, Paper headings, and underlined links in a faint underline color.

## Shape and depth

Radius depends on the size of the element. Don't use one radius for everything.

| Token | Value | Use |
|---|---|---|
| `--r-xs` | 4px | Badges, segmented-control segments |
| `--r-sm` | 8px | Buttons, inputs, table cells |
| `--r-md` | 12px | Panels inside a window |
| `--r-lg` | 18px | Floating part tiles, app windows |

Depth comes from contrast between surfaces (Forest → Moss → Paper), not from shadows. There are two exceptions. App windows get one large, soft shadow (`0 40px 120px -20px rgb(0 0 0 / 0.55)`) so the product image lifts off the page. Floating part tiles get an inner top highlight (`inset 0 1px 0 rgb(245 245 247 / 0.08)`) to look like the T3 icon tiles.

## Line art

Parts are drawn as isometric line art, never as rendered images or stock 3D.

- Stroke is Paper at 1.5px, with round joins, and there's no fill.
- Hidden edges are dashed (`3 3`) at 35% opacity. This is the drafting convention, and it's what makes the drawings read as CAD.
- The drawings are generated from geometry in `apps/web/components/parts.tsx` (prisms, cylinders, extruded profiles). Add new parts there instead of hand-drawing SVGs.

## Components

- **Primary button**: Paper background, Forest text, 600 weight, `--r-sm`, 48px tall in the hero and 40px elsewhere. The label says exactly what happens ("Start a project", "Download for Windows"). Don't add trailing arrows.
- **Secondary action**: a text link in Paper-muted with an icon in front. It turns Paper on hover.
- **Badge**: `--t-micro`, `--r-xs`, and a Moss or Mist fill depending on the surface. Use Signal/caution/danger fills only for state.
- **Segmented control** (pick controls): a Mist track with the selected segment on Paper. The selected "Take branch" segment gets a Signal dot, not a green fill.
- **Focus**: every interactive element shows a 2px Paper outline with a 2px offset (Forest on light panes).

## Motion

- The one orchestrated moment is on page load: the floating part tiles settle into place over 900ms, staggered. Nothing else animates on its own.
- Responsive motion is encouraged. Changing a pick in the demo resets approvals with a 200ms state change, showing a real product rule.
- `prefers-reduced-motion: reduce` turns off every non-essential transition.

## Voice

- Plain verbs, sentence case, second person. Say "check out a branch", not "leverage branching workflows".
- Use the product's real words consistently: Project, Branch, Check out / Check in, Version, Autosave, Release request, Release. A button that says "Release v8" results in "Released v8".
- Don't write fake testimonials, user counts, or claims we can't back up. If there's no proof yet, show the product instead.
- Don't write "A · B · C" meta strings in marketing copy. In product UI they're fine where the app would really show them.
