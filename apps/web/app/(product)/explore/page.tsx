import Form from 'next/form';
import Link from 'next/link';
import { EmptyState } from '../../../components/product/EmptyState';
import { PageHead } from '../../../components/product/PageHead';
import { ProjectCards } from '../../../components/product/ProjectCards';
import { Shell } from '../../../components/product/Shell';
import { SearchIcon } from '../../../components/icons';
import { getExplore, getViewer } from '../../../lib/product';

export const metadata = { title: 'Explore' };

const PAGE_SIZE = 30;

export default async function Explore({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; page?: string }> }) {
  const query = await searchParams;
  // Control characters can't match anything, and the API refuses them.
  const q = (query.q ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
  const sort = query.sort === 'recent' ? 'recent' : 'stars';
  // The API allows offsets up to 10,000.
  const page = Math.min(Math.max(1, Math.floor(Number(query.page)) || 1), Math.floor(10_000 / PAGE_SIZE) + 1);
  // One extra card says whether there's a next page.
  const [found, viewer] = await Promise.all([getExplore(q, sort, (page - 1) * PAGE_SIZE, PAGE_SIZE + 1), getViewer()]);
  const projects = found.slice(0, PAGE_SIZE);
  const hasNext = found.length > PAGE_SIZE;
  const pageHref = (to: number) => `/explore?${new URLSearchParams({ ...(q ? { q } : {}), ...(sort === 'recent' ? { sort } : {}), ...(to > 1 ? { page: String(to) } : {}) })}`;
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
        <PageHead crumbs={[]} title="Explore public projects" />
        <div className="explore-bar">
          <Form action="/explore" className="app-search explore-search" role="search">
            <SearchIcon className="icon" />
            <label className="sr-only" htmlFor="explore-q">Search public projects</label>
            <input id="explore-q" name="q" defaultValue={q} placeholder="Search by name, owner, or description" />
            {sort === 'recent' && <input type="hidden" name="sort" value="recent" />}
          </Form>
          <nav className="segmented interval-toggle" aria-label="Sort">
            {tab('stars', 'Most starred')}
            {tab('recent', 'Newest')}
          </nav>
        </div>
        {projects.length > 0 ? (
          <>
            <ProjectCards projects={projects} />
            {(page > 1 || hasNext) && (
              <nav className="pager" aria-label="Pages">
                {page > 1 && (
                  <Link href={pageHref(page - 1)} className="btn btn-secondary btn-small" rel="prev">
                    Previous
                  </Link>
                )}
                <span className="muted">Page {page}</span>
                {hasNext && (
                  <Link href={pageHref(page + 1)} className="btn btn-secondary btn-small" rel="next">
                    Next
                  </Link>
                )}
              </nav>
            )}
          </>
        ) : q ? (
          <EmptyState title={`No public projects match “${q.length > 40 ? `${q.slice(0, 40)}…` : q}”.`}>
            <p>Try a shorter word or an owner’s handle.</p>
            <Link href={sort === 'recent' ? '/explore?sort=recent' : '/explore'} className="btn btn-secondary btn-small">
              Clear search
            </Link>
          </EmptyState>
        ) : page > 1 ? (
          <EmptyState title="No more public projects.">
            <Link href={pageHref(1)} className="btn btn-secondary btn-small">
              Back to the first page
            </Link>
          </EmptyState>
        ) : (
          <EmptyState title={viewer ? 'No public projects yet.' : 'No public projects yet. Check back soon.'}>
            {viewer && <p>Make a project public in its settings, and it shows up here for anyone to see, star, and fork.</p>}
          </EmptyState>
        )}
      </div>
    </Shell>
  );
}
