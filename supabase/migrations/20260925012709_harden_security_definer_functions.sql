-- Keep policy and Auth trigger helpers outside the exposed Data API schema.
-- Moving a function preserves its identity, so existing policies and triggers
-- continue to reference the same functions.
create schema if not exists private;
revoke all on schema private from public;

alter function public.can_read_project(uuid) set schema private;
revoke execute on function private.can_read_project(uuid) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.can_read_project(uuid) to anon, authenticated;

alter function public.create_profile_for_new_user() set schema private;
revoke execute on function private.create_profile_for_new_user() from public, anon, authenticated;

-- Pin search paths for the two trigger helpers that do not run as definer.
alter function public.forbid_release_changes() set search_path = public;
alter function public.forbid_manifest_entry_changes() set search_path = public;
