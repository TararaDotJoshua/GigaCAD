import Link from 'next/link';
import { sites } from '../../lib/hosts';
import { OpenUploadButton } from './OpenUploadButton';

/**
 * The three ways to get files into GigaCAD, for a project (or account) with none yet.
 * `project` is `owner/slug` when shown on a project the viewer can upload to.
 */
export function GettingStarted({ project, compact = false }: { project?: string; compact?: boolean }) {
  const { siteUrl } = sites();
  return (
    <section className={compact ? 'getting-started is-compact' : 'getting-started'} aria-label="Get your files in">
      {!compact && <h2 className="getting-started-title">Get your files in</h2>}
      <div className="getting-started-options">
        {project && (
          <div className="getting-started-option">
            <h3>Upload from the browser</h3>
            <p>Drop in a few files to start. Each upload of the same name is kept as a revision.</p>
            <OpenUploadButton />
          </div>
        )}
        <div className="getting-started-option">
          <h3>Work in the GigaCAD drive</h3>
          <p>Coming soon: your projects as folders on Windows and Mac. Open assemblies in SolidWorks, check out a branch, and save as usual.</p>
          <a className="muted" href={`${siteUrl}/download`}>
            About the desktop apps
          </a>
        </div>
        <div className="getting-started-option">
          <h3>Use the command line</h3>
          <p>Sync a folder of files with the <code className="mono">giga</code> CLI.</p>
          <pre className="getting-started-code mono">{project ? `giga login\ngiga root clone ${project}\n# add files, then\ngiga root push` : 'npm install -g @gigacad/cli\ngiga login'}</pre>
          <Link className="muted" href={`${siteUrl}/docs/cli`}>
            CLI docs
          </Link>
        </div>
      </div>
    </section>
  );
}
