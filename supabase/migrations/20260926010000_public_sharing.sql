-- Public sharing: stars, and indexes for Explore, profiles, and forks.

create table stars (
  user_id uuid not null references profiles (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);
create index stars_project_idx on stars (project_id);
alter table stars enable row level security;
-- stars: API only.

create index projects_public_idx on projects (created_at desc) where visibility = 'public' and deleted_at is null;
create index projects_owner_idx on projects (owner_id);
create index projects_forked_from_idx on projects (forked_from_release_id) where forked_from_release_id is not null;
