import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Short Markdown someone typed, like a release request's description or a release's notes.
 * Raw HTML and images are left out, links open in a new tab without passing on who sent
 * them, and task lists show as read-only checkboxes.
 */
export function MarkdownText({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`${className} readme-markdown markdown-text`.trim()}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        unwrapDisallowed
        components={{
          a: ({ node: _node, href, ...props }) =>
            href?.startsWith('#') ? <a href={href} {...props} /> : <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...props} />,
          input: ({ node: _node, ...props }) => <input {...props} disabled readOnly />,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
