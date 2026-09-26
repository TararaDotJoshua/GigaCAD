import Link from 'next/link';
import { MarkdownAsync } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Project } from '../../lib/api';
import { entryPath } from '../../lib/paths';
import { getReadmeMedia, type Readme } from '../../lib/product';
import { rehypeProjectMedia } from '../../lib/readme';
import { FileGlyph } from './FileGlyph';

/**
 * The README.md or README.txt at the project root, under the file list. Markdown is
 * rendered without its raw HTML, so an uploaded readme can't put script on the page.
 * Images that name project files, like `![](photos/bench.jpg)`, show those files, and
 * videos named the same way, like `![Assembly](renders/assembly.mp4)`, play in place.
 */
export async function ProjectReadme({ project, readme }: { project: Project; readme: Readme }) {
  const { file } = readme;
  return (
    <section className="readme" aria-label={file.name}>
      <header className="readme-head">
        <FileGlyph path={file.name} />
        {file.entryId ? (
          <Link href={entryPath(project.ownerHandle, project.slug, file.entryId)} className="mono">
            {file.name}
          </Link>
        ) : (
          <span className="mono">{file.name}</span>
        )}
      </header>
      {readme.markdown ? (
        <div className="readme-body readme-markdown">
          <MarkdownAsync
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeProjectMedia((paths) => getReadmeMedia(project.id, paths))]}
            components={{
              a: ({ node: _node, href, ...props }) =>
                href?.startsWith('#') ? <a href={href} {...props} /> : <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...props} />,
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
