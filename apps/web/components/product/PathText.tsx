/** A file path on one line. When it doesn't fit, the folders are cut short so the file name stays readable. */
export function PathText({ path, className = 'mono' }: { path: string; className?: string }) {
  const slash = path.lastIndexOf('/');
  return (
    <span className={`${className} path-text`} title={path}>
      {slash >= 0 && <span className="path-dir">{path.slice(0, slash + 1)}</span>}
      <span className="path-name">{path.slice(slash + 1)}</span>
    </span>
  );
}
