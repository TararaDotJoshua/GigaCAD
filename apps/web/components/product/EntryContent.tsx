import { formatBytes } from '@gigacad/core';
import Link from 'next/link';
import { MarkdownAsync } from 'react-markdown';
import type { Project } from '../../lib/api';
import { getFileText, getReadmeFiles, isMarkdownFile, isTextFile, MAX_README_BYTES } from '../../lib/product';
import { mediaKind, mediaPath, readmeMarkdown } from '../../lib/readme';

/**
 * A root file's contents on its own page, when the browser can show them: an image or video,
 * Markdown rendered like the project README, or a small text file as it is.
 */
export async function EntryContent({ project, name, blob, size }: { project: Project; name: string; blob: string; size: number }) {
  const owner = project.ownerHandle;
  const kind = mediaKind(name);
  if (kind) {
    const src = mediaPath(owner, project.slug, blob, name);
    return (
      <section className="readme entry-content" aria-label={`Contents of ${name}`}>
        <div className="readme-body entry-media">
          {kind === 'image' ? <img src={src} alt={name} loading="lazy" /> : <video src={src} controls preload="metadata" playsInline title={name} />}
        </div>
      </section>
    );
  }
  const markdown = isMarkdownFile(name);
  if (!markdown && !isTextFile(name)) return null;
  const text = await getFileText(project.id, blob, size);
  // Like thumbnails, it's a nicety: a failure just leaves it out.
  if (text === null && size <= MAX_README_BYTES) return null;
  return (
    <section className="readme entry-content" aria-label={`Contents of ${name}`}>
      {text === null ? (
        <p className="readme-body readme-note">
          {name} is too large to show here ({formatBytes(size)}). Download it to read it.
        </p>
      ) : markdown ? (
        <div className="readme-body readme-markdown">
          {/* Paths in it are read from the project root, as in the README. */}
          <MarkdownAsync
            {...readmeMarkdown(project, (paths) => getReadmeFiles(project.id, paths))}
            components={{ a: ({ node: _node, href, ...props }) => (href?.startsWith('/') ? <Link href={href} {...props} /> : <a href={href} {...props} />) }}
          >
            {text}
          </MarkdownAsync>
        </div>
      ) : (
        <pre className="readme-body readme-text">{text}</pre>
      )}
    </section>
  );
}
