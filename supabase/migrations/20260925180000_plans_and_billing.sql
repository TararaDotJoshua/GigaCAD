-- Plans and billing.
-- An account's plan sets its storage limit (profiles.quota_bytes, which the API keeps in
-- step). Payment details live in billing_accounts, which only the API can read.

create type plan_id as enum ('free', 'maker', 'builder', 'workshop', 'studio');
create type billing_interval as enum ('monthly', 'yearly');

create table billing_accounts (
  user_id uuid primary key references profiles (id) on delete cascade,
  plan plan_id not null default 'free',
  interval billing_interval,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  -- Stripe's subscription status, e.g. active, past_due, canceled.
  subscription_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table billing_accounts enable row level security;
-- billing_accounts: API only.

-- Profiles stay public, but the storage limit would reveal the plan.
revoke select on profiles from anon, authenticated;
grant select (id, handle, display_name, created_at) on profiles to anon, authenticated;

-- Bytes an account stores: each distinct file version once, across the projects it
-- owns (soft-deleted projects no longer count).
create function storage_used_bytes(owner uuid) returns bigint
language sql stable set search_path = public as $$
  select coalesce(sum(b.size), 0)::bigint
  from blobs b
  where b.sha256 in (
    select pb.sha256 from project_blobs pb
    join projects p on p.id = pb.project_id
    where p.owner_id = owner and p.deleted_at is null
  );
$$;
revoke execute on function storage_used_bytes(uuid) from public, anon, authenticated;
