-- Handles someone gave up. Without this, renaming freed the old handle at once, so another
-- account could take it and serve its own project at the old public links and in old emails.
-- The API refuses a handle another account gave up in the last 90 days, or at any time while
-- it owned public projects. The account that gave it up can take it back.
create table handle_history (
  handle text primary key,
  -- Null once the account that gave it up is deleted; the handle stays held.
  user_id uuid references profiles (id) on delete set null,
  had_public_projects boolean not null default false,
  released_at timestamptz not null default now()
);
alter table handle_history enable row level security;
-- handle_history: API only.

create function remember_released_handle() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Generated placeholder handles (user-<hex>) can't be chosen, so they needn't be held.
  if old.handle ~ '^user-[0-9a-f]{12}$' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' or new.handle is distinct from old.handle then
    insert into handle_history (handle, user_id, had_public_projects, released_at)
    values (
      old.handle,
      case when tg_op = 'DELETE' then null else old.id end,
      exists (select 1 from projects p where p.owner_id = old.id and p.visibility = 'public' and p.deleted_at is null),
      now()
    )
    on conflict (handle) do update
    set user_id = excluded.user_id, had_public_projects = handle_history.had_public_projects or excluded.had_public_projects,
        released_at = excluded.released_at;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke execute on function remember_released_handle() from public, anon, authenticated;

create trigger profiles_remember_released_handle
  before update of handle or delete on profiles
  for each row execute function remember_released_handle();

-- A root file's item never belongs in a manifest. The API refuses such commits; this keeps
-- any other path from making a root file (and its folders) impossible to delete.
create function forbid_root_items_in_manifests() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from added a join directory_entries e on e.item_id = a.item_id) then
    raise exception 'A root file can''t be part of a branch or release';
  end if;
  return null;
end;
$$;
revoke execute on function forbid_root_items_in_manifests() from public, anon, authenticated;

create trigger manifest_entries_forbid_root_items
  after insert on manifest_entries
  referencing new table as added
  for each statement execute function forbid_root_items_in_manifests();
