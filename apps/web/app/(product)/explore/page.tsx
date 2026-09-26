import Link from 'next/link';
import { EmptyState } from '../../../components/product/EmptyState';
import { PageHead } from '../../../components/product/PageHead';
import { ProjectCards } from '../../../components/product/ProjectCards';
import { Shell } from '../../../components/product/Shell';
import { SearchIcon } from '../../../components/icons';
import { getExplore } from '../../../lib/product';

export const metadata = { title: 'Explore' };

export default async function Explore({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string }> }) {
  const query = await searchParams;
  const q = (query.q ?? '').trim().slice(0, 100);
  const sort = query.sort === 'recent' ? 'recent' : 'stars';
  const projects = await getExplore(q, sort);
  const tab = (value: 'stars' | 'recent', label: string) => (
    <Link
      href={`/explore?${new URLSearchParams({ ...(q ? { q } : {}), ...(value === 'recent' ? { sort: value } : {}) })}`}
      className={`segment${sort === value ? ' is-selected' : ''}`}
      aria-current={sort === value ? 'page' : undefined}
    >
      {label}
    </Link>
  );
  return (
    <Shell>
      <div className="page">
        <PageHead crumbs={[{ label: 'GigaCAD' }]} title="Explore public projects." />
        <div className="explore-bar">
          <form action="/explore" className="app-search explore-search" role="search">
            <SearchIcon className="icon" />
            <label className="sr-only" htmlFor="explore-q">Search public projects</label>
            <input id="explore-q" name="q" defaultValue={q} placeholder="Search by name, owner, or description" />
            {sort === 'recent' && <input type="hidden" name="sort" value="recent" />}
          </form>
          <nav className="segmented interval-toggle" aria-label="Sort">
            {tab('stars', 'Most starred')}
            {tab('recent', 'Newest')}
          </nav>
        </div>
        {projects.length > 0 ? (
          <ProjectCards projects={projects} />
        ) : (
          <EmptyState title={q ? `No public projects match “${q}”.` : 'No public projects yet.'}>
            <p>Make a project public in its settings, and it shows up here for anyone to see, star, and fork.</p>
          </EmptyState>
        )}
      </div>
    </Shell>
  );
}
