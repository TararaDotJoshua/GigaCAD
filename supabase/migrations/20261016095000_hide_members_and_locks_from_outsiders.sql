-- The API stopped showing people outside a project its members' ids and roles, the named
-- approvers, who holds a branch lock and on which computer, and the rebuild report's device
-- name. The anon key reads the same tables through the Data API and Realtime, so this closes
-- those too. Only LiveRefresh reads these tables directly, and only project_events.

create function private.is_project_member(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from project_members m where m.project_id = target and m.user_id = auth.uid());
$$;
revoke execute on function private.is_project_member(uuid) from public;
grant execute on function private.is_project_member(uuid) to anon, authenticated;

-- Members and approval rules: for members only.
drop policy "readable members" on project_members;
create policy "members see members" on project_members for select using (private.is_project_member(project_id));
drop policy "readable approval rules" on approval_rules;
create policy "members see approval rules" on approval_rules for select using (private.is_project_member(project_id));

-- Events about membership, rules, and lock holders: for members only. Everyone who can read
-- the project still gets the rest, which is what LiveRefresh needs to update public pages.
drop policy "readable events" on project_events;
create policy "readable events" on project_events for select using (
  private.can_read_project(project_id)
  and (
    kind <> all (array['member_changed', 'approval_rules_changed', 'branch_checked_out', 'branch_lock_force_released'])
    or private.is_project_member(project_id)
  )
);

-- Lock holders and rebuild reports: column grants, since a policy can't hide one column.
-- Nothing reads these tables through the Data API; the API (as postgres) is unaffected.
revoke select on branches from anon, authenticated;
grant select (id, project_id, name, base_release_id, head_commit_id, status, checked_out_at, created_by, created_at, stale_notice_for)
  on branches to anon, authenticated;
revoke select on release_requests from anon, authenticated;
grant select (id, project_id, number, branch_id, requester_id, title, body, status, picks, target_release_id,
              candidate_manifest_id, rebuild_manifest_id, rebuild_status, released_release_id, created_at, updated_at)
  on release_requests to anon, authenticated;
