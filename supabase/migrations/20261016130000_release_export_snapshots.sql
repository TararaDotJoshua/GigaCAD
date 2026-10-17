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
