-- The release review loop (web audit 2026-10-15): releases keep their exports, rebuild
-- reports say when and by whom they were filed, finished requests keep the review they
-- had, and release folders show when each file last changed.

-- Each release keeps the STEP and STL exports its SolidWorks files had when it was released.
-- `file_exports` holds the current export for a file's contents and can be replaced; a
-- release reads its own copy, so replacing an export later never changes what it serves.
create table release_exports (
  release_id uuid not null references releases (id) on delete cascade,
  project_id uuid not null,
  source_sha256 text not null,
  format text not null check (format in ('stl', 'step')),
  blob_sha256 text not null,
  primary key (release_id, source_sha256, format),
  foreign key (project_id, blob_sha256) references project_blobs (project_id, sha256)
);
create index release_exports_blob_idx on release_exports (project_id, blob_sha256);
alter table release_exports enable row level security;
-- release_exports: API only.

-- Locked like the releases they belong to; only a purge of a deleted project removes them.
create trigger release_exports_locked
  before update or delete on release_exports
  for each row execute function forbid_release_changes();

-- Releases made before now get the exports their files have today, the best record there is.
insert into release_exports (release_id, project_id, source_sha256, format, blob_sha256)
select distinct r.id, r.project_id, x.source_sha256, x.format, x.blob_sha256
from releases r
join manifest_entries me on me.manifest_id = r.manifest_id
join file_exports x on x.project_id = r.project_id and x.source_sha256 = me.blob_sha256
on conflict do nothing;

alter table release_requests
  -- When the current rebuild report was filed, and who filed it.
  add column rebuild_reported_at timestamptz,
  add column rebuild_reported_by uuid references profiles (id) on delete set null,
  -- The approval rules and their evaluation when the request was released or closed, so a
  -- finished request reads the way it was decided, whatever the rules say later.
  add column review_snapshot jsonb;

-- When a file in a release last changed: the first release of the unbroken run, ending at
-- this one, that has the file with its current contents, and who committed those contents
-- on the branch that release came from. The author is null when no commit has them, like
-- files a SolidWorks rebuild saved into the candidate.
create function release_file_changed(project uuid, release_number integer, item uuid, blob text)
returns table (changed_at timestamptz, author_id uuid, release_since integer)
language sql stable set search_path = public as $$
  select r.created_at, c.author_id, r.number
  from releases r
  left join release_requests rr on rr.id = r.release_request_id
  left join lateral (
    select c.author_id from commits c join manifest_entries me on me.manifest_id = c.manifest_id
    where c.branch_id = rr.branch_id and me.blob_sha256 = blob
    order by c.created_at
    limit 1
  ) c on true
  where r.project_id = project
    and r.number = (
      select min(r1.number) from releases r1
      where r1.project_id = project and r1.number <= release_number
        and r1.number > coalesce((
          select max(r2.number) from releases r2
          where r2.project_id = project and r2.number < release_number
            and not exists (
              select 1 from manifest_entries me2
              where me2.manifest_id = r2.manifest_id and me2.item_id = item and me2.blob_sha256 = blob
            )
        ), 0)
    )
$$;
revoke execute on function release_file_changed(uuid, integer, uuid, text) from public, anon, authenticated;
