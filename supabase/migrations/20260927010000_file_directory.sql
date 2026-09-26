-- The project file directory. A project's root holds ordinary files and folders that sit
-- outside branches and releases, next to the virtual Branches and Releases folders (which
-- the API derives from branches and releases; nothing about them is stored here). Root
-- files keep their own revision history. Tags and favorites attach to items, so they
-- follow a file wherever it appears: at the root, at a branch head, or in a release.

create type directory_entry_kind as enum ('file', 'folder');

create table directory_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  -- Null for entries at the project root.
  parent_id uuid,
  kind directory_entry_kind not null,
  -- A file's stable identity, shared with manifests; folders have none.
  item_id uuid unique references items (id),
  name text not null check (length(name) between 1 and 255 and name !~ '[\x01-\x1f<>:"/\\|?*]' and name not in ('.', '..')),
  name_key text generated always as (lower(name)) stored,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, id),
  foreign key (project_id, parent_id) references directory_entries (project_id, id) on delete cascade,
  check ((kind = 'file') = (item_id is not null)),
  check (parent_id is distinct from id),
  -- The root's Branches and Releases folders are virtual.
  check (parent_id is not null or name_key not in ('branches', 'releases'))
);
-- Windows treats names case-insensitively, so siblings can't differ only in case.
create unique index directory_entries_sibling_name_idx
  on directory_entries (project_id, parent_id, name_key) nulls not distinct;
create index directory_entries_parent_idx on directory_entries (parent_id);

-- Each upload or replacement of a root file. The latest is the file's current content.
-- Renames and moves change the entry, not its revisions.
create table root_file_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  entry_id uuid not null,
  number integer not null check (number > 0),
  blob_sha256 text not null,
  author_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entry_id, number),
  foreign key (project_id, entry_id) references directory_entries (project_id, id) on delete cascade,
  -- The content must have been uploaded to this project, which also counts it toward storage.
  foreign key (project_id, blob_sha256) references project_blobs (project_id, sha256)
);
create index root_file_revisions_blob_idx on root_file_revisions (project_id, blob_sha256);
create index root_file_revisions_created_idx on root_file_revisions (project_id, created_at desc);

create table project_tags (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null check (length(name) between 1 and 50 and name = btrim(name)),
  name_key text generated always as (lower(name)) stored,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, id),
  unique (project_id, name_key)
);

create table file_tags (
  project_id uuid not null,
  tag_id uuid not null,
  item_id uuid not null references items (id) on delete cascade,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tag_id, item_id),
  foreign key (project_id, tag_id) references project_tags (project_id, id) on delete cascade
);
create index file_tags_item_idx on file_tags (item_id);

create table file_favorites (
  user_id uuid not null references profiles (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  item_id uuid not null references items (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index file_favorites_project_idx on file_favorites (user_id, project_id);

-- Root files get thumbnails like committed ones.
create function queue_root_thumbnails() returns trigger
language plpgsql set search_path = public as $$
begin
  insert into thumbnails (blob_sha256, format)
  select distinct on (a.blob_sha256) a.blob_sha256, thumbnail_format(e.name)
  from added a join directory_entries e on e.id = a.entry_id
  where thumbnail_format(e.name) is not null
  order by a.blob_sha256
  on conflict (blob_sha256) do nothing;
  return null;
end;
$$;

create trigger root_file_revisions_queue_thumbnails
  after insert on root_file_revisions
  referencing new table as added
  for each statement execute function queue_root_thumbnails();

-- Read access, like the rest of a project. Writes go through the API.
alter table directory_entries enable row level security;
alter table root_file_revisions enable row level security;
alter table project_tags enable row level security;
alter table file_tags enable row level security;
alter table file_favorites enable row level security;

create policy "readable directory entries" on directory_entries for select using (private.can_read_project(project_id));
create policy "readable root file revisions" on root_file_revisions for select using (private.can_read_project(project_id));
create policy "readable project tags" on project_tags for select using (private.can_read_project(project_id));
create policy "readable file tags" on file_tags for select using (private.can_read_project(project_id));
create policy "own file favorites" on file_favorites for select using (user_id = auth.uid() and private.can_read_project(project_id));

-- When a file at a branch head last changed: the first commit on the branch that has the
-- file with its current content, and who made it.
create function branch_file_changed(branch uuid, item uuid, blob text)
returns table (changed_at timestamptz, author_id uuid)
language sql stable set search_path = public as $$
  select c.created_at, c.author_id
  from commits c join manifest_entries me on me.manifest_id = c.manifest_id and me.item_id = item
  where c.branch_id = branch and me.blob_sha256 = blob
  order by c.created_at
  limit 1
$$;
revoke execute on function branch_file_changed(uuid, uuid, text) from public, anon, authenticated;
