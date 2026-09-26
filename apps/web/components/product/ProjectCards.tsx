import Link from 'next/link';
import type { ProjectCard } from '../../lib/api';
import { projectPath } from '../../lib/paths';
import { PartIcon, StarIcon } from '../icons';
import { RelativeTime } from './RelativeTime';
import { StatusBadge } from './StatusBadge';

/** Projects as Explore and profile pages list them. */
export function ProjectCards({ projects, showOwner = true }: { projects: readonly ProjectCard[]; showOwner?: boolean }) {
  return (
    <ul className="project-cards">
      {projects.map((project) => (
        <li key={project.id} className="project-card">
          <div className="project-card-cover" aria-hidden="true">
            {project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="" width={96} height={96} loading="lazy" decoding="async" /> : <PartIcon className="icon" />}
          </div>
          <div className="project-card-head">
            <Link href={projectPath(project.ownerHandle, project.slug)} className="project-card-name">
              {showOwner && <span className="muted">{project.ownerHandle}/</span>}
              {project.name}
            </Link>
            {project.visibility === 'private' && <StatusBadge tone="quiet">Private</StatusBadge>}
          </div>
          {project.description && <p className="project-card-description">{project.description}</p>}
          <p className="project-card-meta">
            <span className="project-card-stars" title={`${project.starCount} ${project.starCount === 1 ? 'star' : 'stars'}`}>
              <StarIcon className="icon" />
              {project.starCount}
            </span>
            <span>{project.latestReleaseNumber ? `v${project.latestReleaseNumber}` : 'No releases yet'}</span>
            {project.license && <span>{project.license}</span>}
            <span>
              Created <RelativeTime value={project.createdAt} />
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}
