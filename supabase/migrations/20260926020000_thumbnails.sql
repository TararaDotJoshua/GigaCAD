-- Thumbnails for 3D files. Adding a file to any manifest (a commit, a candidate, a fork)
-- queues one for its content; the API renders queued thumbnails in the background.

create type thumbnail_status as enum ('pending', 'ready', 'failed', 'skipped');

create table thumbnails (
  blob_sha256 text primary key references blobs (sha256) on delete cascade,
  format text not null check (format in ('stl', 'obj', '3mf', 'step', 'iges')),
  status thumbnail_status not null default 'pending',
  attempts integer not null default 0,
  -- Why a thumbnail failed or was skipped, in words for people.
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index thumbnails_pending_idx on thumbnails (created_at) where status = 'pending';
alter table thumbnails enable row level security;
-- thumbnails: API only.

create function thumbnail_format(path text) returns text
language sql immutable as $$
  select case
    when path ~* '\.stl$' then 'stl'
    when path ~* '\.obj$' then 'obj'
    when path ~* '\.3mf$' then '3mf'
    when path ~* '\.(step|stp)$' then 'step'
    when path ~* '\.(iges|igs)$' then 'iges'
  end
$$;

create function queue_thumbnails() returns trigger
language plpgsql set search_path = public as $$
begin
  insert into thumbnails (blob_sha256, format)
  select distinct on (blob_sha256) blob_sha256, thumbnail_format(path)
  from added where thumbnail_format(path) is not null
  order by blob_sha256
  on conflict (blob_sha256) do nothing;
  return null;
end;
$$;

create trigger manifest_entries_queue_thumbnails
  after insert on manifest_entries
  referencing new table as added
  for each statement execute function queue_thumbnails();

-- Files committed before thumbnails existed.
insert into thumbnails (blob_sha256, format)
select distinct on (blob_sha256) blob_sha256, thumbnail_format(path)
from manifest_entries where thumbnail_format(path) is not null
order by blob_sha256
on conflict (blob_sha256) do nothing;

-- A project's cover: the largest file with a thumbnail in its latest release, or in its
-- most recent commit before it has a release.
create function project_thumbnail(project uuid) returns text
language sql stable set search_path = public as $$
  select me.blob_sha256
  from manifest_entries me
  join thumbnails t on t.blob_sha256 = me.blob_sha256 and t.status = 'ready'
  join blobs b on b.sha256 = me.blob_sha256
  where me.manifest_id = coalesce(
    (select manifest_id from releases where project_id = project order by number desc limit 1),
    (select c.manifest_id from commits c join branches br on br.id = c.branch_id
      where br.project_id = project order by c.created_at desc limit 1)
  )
  order by b.size desc, me.path
  limit 1
$$;
