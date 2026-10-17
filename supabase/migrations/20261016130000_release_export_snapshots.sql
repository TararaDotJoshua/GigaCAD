-- Which releases have had their STEP/STL exports copied into release_exports. Releases the
-- previous API makes between `db push` and the API deploy get no copy; the background jobs
-- (snapshotMissingReleaseExports in apps/api/src/jobs.ts) copy their exports once, then mark them.
create table release_export_snapshots (
  release_id uuid primary key references releases (id) on delete cascade,
  taken_at timestamptz not null default now()
);
alter table release_export_snapshots enable row level security;
-- release_export_snapshots: API only.

create trigger release_export_snapshots_locked
  before update or delete on release_export_snapshots
  for each row execute function forbid_release_changes();

-- 20261016120000 copied the exports of every release that existed then.
insert into release_export_snapshots (release_id) select id from releases on conflict do nothing;

-- A file's thumbnail as a release shows it: drawn from the export the release was made with
-- (like file_thumbnail(), but from release_exports), so replacing an export never changes it.
create function release_file_thumbnail(release uuid, source text) returns text
language sql stable set search_path = public as $$
  select c.sha256 from (
    select x.blob_sha256 as sha256, case x.format when 'stl' then 0 else 1 end as rank
    from release_exports x where x.release_id = release and x.source_sha256 = source
    union all
    select source, 2
  ) c
  join thumbnails t on t.blob_sha256 = c.sha256 and t.status = 'ready'
  order by c.rank
  limit 1
$$;
revoke execute on function release_file_thumbnail(uuid, text) from public, anon, authenticated;

-- A project's cover, from its latest release as it was released, or from its most recent
-- commit before it has a release.
create or replace function project_thumbnail(project uuid) returns text
language sql stable set search_path = public as $$
  with latest as (select id, manifest_id from releases where project_id = project order by number desc limit 1)
  select shown.sha256
  from manifest_entries me
  join blobs b on b.sha256 = me.blob_sha256
  cross join lateral (
    select case when exists (select 1 from latest) then release_file_thumbnail((select id from latest), me.blob_sha256)
                else file_thumbnail(project, me.blob_sha256) end as sha256
  ) shown
  where me.manifest_id = coalesce(
    (select manifest_id from latest),
    (select c.manifest_id from commits c join branches br on br.id = c.branch_id
      where br.project_id = project order by c.created_at desc limit 1)
  )
  and shown.sha256 is not null
  order by b.size desc, me.path
  limit 1
$$;
