-- GigaCAD core schema.
-- The API (service role) is the only writer. Row-level security grants read access
-- to project members and, for public projects, everyone; Realtime relies on it.

create extension if not exists pgcrypto;

create type project_role as enum ('owner', 'maintainer', 'contributor', 'viewer');
create type project_visibility as enum ('public', 'private');
create type branch_status as enum ('open', 'frozen', 'released', 'archived');
create type commit_kind as enum ('autosave', 'version');
create type release_request_status as enum ('open', 'candidate', 'released', 'closed');
create type rebuild_status as enum ('passed', 'passed_with_warnings', 'failed');

-- People -------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$'),
  display_name text,
  quota_bytes bigint not null default 5368709120,
  created_at timestamptz not null default now()
);

create function create_profile_for_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, handle) values (new.id, 'user-' || substr(replace(new.id::text, '-', ''), 1, 12));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function create_profile_for_new_user();

-- Projects -----------------------------------------------------------------

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id),
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$'),
  name text not null check (length(name) between 1 and 100),
  description text not null default '' check (length(description) <= 2000),
  visibility project_visibility not null default 'private',
  license text,
  forked_from_release_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, slug)
);

create table project_members (
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role project_role not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on project_members (user_id);

create table approval_rules (
  project_id uuid primary key references projects (id) on delete cascade,
  required_count integer not null default 1 check (required_count >= 0),
  approver_user_ids uuid[] not null default '{}',
  approver_roles project_role[] not null default '{owner,maintainer}',
  allow_self_approval boolean not null default true,
  require_clean_rebuild boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Files --------------------------------------------------------------------

-- Stable identity of a logical file across releases, renames, and replacements.
create table items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index items_project_idx on items (project_id);

-- Content-addressed file contents, stored in R2 under blobs/<sha256>.
create table blobs (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  size bigint not null check (size >= 0),
  created_at timestamptz not null default now()
);

-- A project may only reference blobs that were uploaded into it (or copied in by a fork),
-- so knowing a hash is never enough to read another project's file.
create table project_blobs (
  project_id uuid not null references projects (id) on delete cascade,
  sha256 text not null references blobs (sha256),
  uploaded_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, sha256)
);

-- Uploads land in a per-upload staging key and are copied to blobs/<sha256> only after
-- the checksum-verified upload completes. This proves the uploader actually has the bytes.
create table blob_uploads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size bigint not null check (size >= 0),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Files a blob references (e.g. an assembly's parts), as project-relative paths.
-- Reported by the SolidWorks add-in from GetDependencies2.
create table blob_references (
  project_id uuid not null references projects (id) on delete cascade,
  sha256 text not null references blobs (sha256),
  referenced_path text not null,
  primary key (project_id, sha256, referenced_path)
);

create table manifests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index manifests_project_idx on manifests (project_id);

create table manifest_entries (
  manifest_id uuid not null references manifests (id) on delete cascade,
  item_id uuid not null references items (id),
  path text not null check (length(path) between 1 and 1024),
  path_key text generated always as (lower(path)) stored,
  blob_sha256 text not null references blobs (sha256),
  primary key (manifest_id, item_id),
  unique (manifest_id, path_key)
);
create index manifest_entries_blob_idx on manifest_entries (blob_sha256);

-- Main ---------------------------------------------------------------------

create table releases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  number integer not null check (number > 0),
  manifest_id uuid not null references manifests (id) on delete restrict,
  release_request_id uuid,
  notes text not null default '',
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);

alter table projects
  add constraint projects_forked_from_release_fk
  foreign key (forked_from_release_id) references releases (id) on delete set null;

-- Releases are permanently locked. Only a deliberate purge of a deleted project may remove them.
create function forbid_release_changes() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('gigacad.purge', true) = 'on' then
    return old;
  end if;
  raise exception 'Releases are permanently locked' using errcode = 'P0001';
end;
$$;

create trigger releases_locked
  before update or delete on releases
  for each row execute function forbid_release_changes();

create function forbid_manifest_entry_changes() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Manifest entries are immutable' using errcode = 'P0001';
  end if;
  if current_setting('gigacad.purge', true) is distinct from 'on'
     and exists (select 1 from releases where manifest_id = old.manifest_id) then
    raise exception 'Released files are permanently locked' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger manifest_entries_immutable
  before update or delete on manifest_entries
  for each row execute function forbid_manifest_entry_changes();

-- Branches -----------------------------------------------------------------

create table branches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null check (name ~ '^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$'),
  base_release_id uuid references releases (id),
  head_commit_id uuid,
  status branch_status not null default 'open',
  checked_out_by uuid references profiles (id) on delete set null,
  checked_out_machine text,
  checked_out_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((checked_out_by is null) = (checked_out_machine is null)),
  check (checked_out_by is null or status = 'open')
);
create unique index branches_project_name_idx on branches (project_id, lower(name));

create table commits (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches (id) on delete cascade,
  parent_id uuid references commits (id),
  manifest_id uuid not null references manifests (id),
  kind commit_kind not null,
  message text not null default '',
  version_label text,
  author_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index commits_branch_idx on commits (branch_id, created_at);

alter table branches
  add constraint branches_head_commit_fk
  foreign key (head_commit_id) references commits (id);

-- Release requests ---------------------------------------------------------

create table release_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  number integer not null check (number > 0),
  branch_id uuid not null references branches (id) on delete cascade,
  requester_id uuid references profiles (id) on delete set null,
  title text not null check (length(title) between 1 and 200),
  body text not null default '',
  status release_request_status not null default 'open',
  -- core `Picks`: { actions: { [itemId]: 'take_branch' | 'keep_main' }, replacements: [...] }
  picks jsonb not null default '{}',
  target_release_id uuid references releases (id),
  candidate_manifest_id uuid references manifests (id),
  rebuild_manifest_id uuid references manifests (id),
  rebuild_status rebuild_status,
  rebuild_report jsonb,
  released_release_id uuid references releases (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create unique index release_requests_one_active_per_branch
  on release_requests (branch_id) where status in ('open', 'candidate');

alter table releases
  add constraint releases_release_request_fk
  foreign key (release_request_id) references release_requests (id);

create table approvals (
  release_request_id uuid not null references release_requests (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  -- An approval only counts for the exact candidate it was given on.
  candidate_manifest_id uuid not null references manifests (id),
  created_at timestamptz not null default now(),
  primary key (release_request_id, user_id)
);

-- Events: audit log, change feed for drive clients, and Realtime stream --------

create table project_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references projects (id) on delete cascade,
  actor_id uuid references profiles (id) on delete set null,
  kind text not null,
  subject_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index project_events_project_idx on project_events (project_id, id);

-- Desktop sign-in ----------------------------------------------------------

create table device_codes (
  device_code_hash text primary key,
  user_code text not null unique,
  client_name text not null,
  approved_by uuid references profiles (id) on delete cascade,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  token_hash text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index device_tokens_user_idx on device_tokens (user_id);

-- Read access --------------------------------------------------------------

create function can_read_project(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = target
      and p.deleted_at is null
      and (
        p.visibility = 'public'
        or exists (select 1 from project_members m where m.project_id = p.id and m.user_id = auth.uid())
      )
  );
$$;

alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table approval_rules enable row level security;
alter table items enable row level security;
alter table blobs enable row level security;
alter table project_blobs enable row level security;
alter table blob_uploads enable row level security;
alter table blob_references enable row level security;
alter table manifests enable row level security;
alter table manifest_entries enable row level security;
alter table releases enable row level security;
alter table branches enable row level security;
alter table commits enable row level security;
alter table release_requests enable row level security;
alter table approvals enable row level security;
alter table project_events enable row level security;
alter table device_codes enable row level security;
alter table device_tokens enable row level security;

create policy "profiles are public" on profiles for select using (true);
create policy "readable projects" on projects for select using (can_read_project(id));
create policy "readable members" on project_members for select using (can_read_project(project_id));
create policy "readable approval rules" on approval_rules for select using (can_read_project(project_id));
create policy "readable items" on items for select using (can_read_project(project_id));
create policy "readable manifests" on manifests for select using (can_read_project(project_id));
create policy "readable manifest entries" on manifest_entries for select using (
  exists (select 1 from manifests m where m.id = manifest_id and can_read_project(m.project_id))
);
create policy "readable releases" on releases for select using (can_read_project(project_id));
create policy "readable branches" on branches for select using (can_read_project(project_id));
create policy "readable commits" on commits for select using (
  exists (select 1 from branches b where b.id = branch_id and can_read_project(b.project_id))
);
create policy "readable release requests" on release_requests for select using (can_read_project(project_id));
create policy "readable approvals" on approvals for select using (
  exists (select 1 from release_requests r where r.id = release_request_id and can_read_project(r.project_id))
);
create policy "readable events" on project_events for select using (can_read_project(project_id));
-- blobs, project_blobs, blob_uploads, blob_references, device_codes, device_tokens: API only.

alter publication supabase_realtime add table project_events;
