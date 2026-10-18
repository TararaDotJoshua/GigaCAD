import { formatBytes } from '@gigacad/core';
import Link from 'next/link';
import { MarkdownAsync } from 'react-markdown';
import type { Project } from '../../lib/api';
import { entryPath } from '../../lib/paths';
import { getReadmeFiles, type Readme } from '../../lib/product';
import { readmeMarkdown } from '../../lib/readme';
import { FileGlyph } from './FileGlyph';

/**
 * The README.md or README.txt at the project root, under the file list. Markdown may use a
 * little HTML, like `<details>` and `<img width>`; the rest is dropped, so an uploaded readme
 * can't put script on the page. Links to project files open their pages here. Images that name
 * project files, like `![](photos/bench.jpg)`, show those files, and videos named the same way,
 * like `![Assembly](renders/assembly.mp4)`, play in place.
 */
export async function ProjectReadme({ project, readme }: { project: Project; readme: Readme }) {
  const { file } = readme;
  const href = file.entryId ? entryPath(project.ownerHandle, project.slug, file.entryId) : null;
  const name = href ? (
    <Link href={href} className="mono">
      {file.name}
    </Link>
  ) : (
    <span className="mono">{file.name}</span>
  );
  return (
    <section className="readme" aria-label={file.name}>
      <header className="readme-head">
        <FileGlyph path={file.name} />
        {name}
      </header>
      {readme.tooLarge ? (
        <p className="readme-body readme-note">
          {href ? <Link href={href}>{file.name}</Link> : file.name} is too large to show here ({formatBytes(file.size)}).
        </p>
      ) : readme.markdown ? (
        <div className="readme-body readme-markdown">
          <MarkdownAsync
            {...readmeMarkdown(project, (paths) => getReadmeFiles(project.id, paths))}
            components={{
              // Links are already pointed at their pages; ones within the app navigate in place.
              a: ({ node: _node, href, ...props }) => (href?.startsWith('/') ? <Link href={href} {...props} /> : <a href={href} {...props} />),
            }}
          >
            {readme.text}
          </MarkdownAsync>
        </div>
      ) : (
        <pre className="readme-body readme-text">{readme.text}</pre>
      )}
    </section>
  );
}
