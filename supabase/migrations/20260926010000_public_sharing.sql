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

-- A fork of a private project holds designs its owner was only shown as a member, so it
-- can never be made public, even after the original is deleted.
alter table projects add column must_stay_private boolean not null default false;
alter table projects add constraint projects_private_fork_check check (not (must_stay_private and visibility = 'public'));
