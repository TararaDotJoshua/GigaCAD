-- User pages: profile details, an avatar, and indexes for the contribution graph.

alter table profiles
  add column bio text check (length(bio) <= 160),
  add column location text check (length(location) <= 60),
  add column website text check (length(website) <= 200 and website ~ '^https?://'),
  -- The avatar's key in object storage. The API hands out short-lived links, so it isn't granted below.
  add column avatar_key text;

grant select (bio, location, website) on profiles to anon, authenticated;

-- A user's contributions: version commits, release requests, releases, and approvals.
create index commits_author_idx on commits (author_id, created_at) where kind = 'version' and parent_id is not null;
create index release_requests_requester_idx on release_requests (requester_id, created_at);
create index releases_created_by_idx on releases (created_by, created_at);
create index approvals_user_idx on approvals (user_id, created_at);
