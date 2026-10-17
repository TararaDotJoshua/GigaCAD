'use client';

import type { ApprovalRules, ProjectRole } from '@gigacad/core';
import Link from 'next/link';
import { useActionState, useEffect, useId, useState, useTransition } from 'react';
import { changeMemberRole, findPeople, leaveProject, removeMember, type ActionState } from '../../app/(product)/actions';
import type { Member } from '../../lib/api';
import { safeAction } from '../../lib/safe-action';
import { ActionButton, FormStatus, LogInAgain } from './ActionButton';
import { Avatar } from './Avatar';

/** What each role can do, one line each, said the same way wherever a role is picked. */
export const ROLE_DESCRIPTIONS: Readonly<Record<Exclude<ProjectRole, 'owner'>, string>> = {
  viewer: 'Sees and downloads files and releases.',
  contributor: 'Also uploads files, checks out branches, and opens release requests.',
  maintainer: 'Also edits project details, adds people, and can force-release someone’s lock. Only the owner changes visibility and approval rules.',
};

/**
 * The members table and the form to add someone, with one status line for both, so a
 * removal never leaves an old "Added" message behind.
 */
export function MembersSection({
  projectId,
  members,
  viewerId,
  isOwner,
  canManage,
  addMember,
}: {
  projectId: string;
  members: readonly Member[];
  viewerId: string | null;
  isOwner: boolean;
  canManage: boolean;
  addMember: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [status, setStatus] = useState<ActionState>({});
  return (
    <>
      <div className="table-wrap">
        <table className="data-table members-table">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              // Owners manage everyone; maintainers manage contributors and viewers. Anyone but the owner can leave.
              const isYou = member.userId === viewerId;
              const manageable = !isYou && member.role !== 'owner' && (isOwner || (canManage && member.role !== 'maintainer'));
              return (
                <tr key={member.userId}>
                  <td>
                    <span className="member-cell" title={`@${member.handle}`}>
                      <Avatar handle={member.handle} url={member.avatarUrl} />
                      <span className="member-handle">@{member.handle}</span>
                    </span>
                  </td>
                  <td className="role">
                    {manageable && member.role !== 'owner' ? (
                      <MemberRole projectId={projectId} handle={member.handle} role={member.role} canAddMaintainers={isOwner} onResult={setStatus} />
                    ) : (
                      member.role
                    )}
                  </td>
                  <td className="cell-action">
                    {isYou && member.role !== 'owner' ? (
                      <ActionButton
                        action={() => leaveProject(projectId, member.handle)}
                        className="btn btn-secondary btn-small"
                        confirm="Leave this project? You lose access unless someone adds you again."
                        onResult={setStatus}
                      >
                        Leave
                      </ActionButton>
                    ) : (
                      manageable && (
                        <ActionButton
                          action={() => removeMember(projectId, member.handle)}
                          className="btn btn-danger btn-small"
                          confirm={`Remove @${member.handle} from this project?`}
                          ariaLabel={`Remove @${member.handle}`}
                          onResult={setStatus}
                        >
                          Remove
                        </ActionButton>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="members-status">
        <FormStatus state={status} />
      </p>
      {canManage && <AddMemberForm action={addMember} canAddMaintainers={isOwner} onResult={setStatus} />}
    </>
  );
}

/** The handle and role fields for adding a member, suggesting people as the handle is typed. Both reset after an add. */
function AddMemberForm({
  action,
  canAddMaintainers,
  onResult,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  canAddMaintainers: boolean;
  onResult: (state: ActionState) => void;
}) {
  const listId = useId();
  const handleHintId = useId();
  const hintId = useId();
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<keyof typeof ROLE_DESCRIPTIONS>('viewer');
  const [people, setPeople] = useState<{ handle: string; displayName: string | null }[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [, formAction, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    // A failed request (offline, say) shows in the status line instead of the error page.
    const result = await safeAction(() => action(previous, form));
    onResult(result);
    if (!result.error) {
      setHandle('');
      setRole('viewer');
    }
    return result;
  }, {});

  useEffect(() => {
    const query = handle.trim().replace(/^@/, '');
    if (!query || query.includes('@')) return setPeople([]);
    let current = true;
    const timer = setTimeout(async () => {
      const found = await findPeople(query);
      if (!current) return;
      // Without a session there are no suggestions, which would look like nobody has that handle.
      setSignedOut(!Array.isArray(found));
      setPeople(Array.isArray(found) ? found : []);
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [handle]);

  return (
    <form action={formAction} className="form member-add">
      <div className="member-add-fields">
        <label className="field">
          <span>Handle</span>
          <input
            name="handle"
            aria-label="Handle"
            placeholder="@alex"
            required
            maxLength={40}
            pattern="@?[A-Za-z0-9](?:[A-Za-z0-9\-]{0,37}[A-Za-z0-9])?"
            title="A handle: up to 39 letters, digits, or dashes"
            autoComplete="off"
            spellCheck={false}
            list={listId}
            aria-describedby={handleHintId}
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
          />
          <datalist id={listId}>
            {people.map((person) => (
              <option key={person.handle} value={person.handle}>
                {person.displayName ?? undefined}
              </option>
            ))}
          </datalist>
          <small className="field-hint" id={handleHintId}>
            They need a GigaCAD account with a handle. New to GigaCAD? Send them to <Link href="/signup">sign up</Link>.
          </small>
          {signedOut && (
            <small className="field-hint is-error" role="alert">
              You’ve been signed out, so people can’t be suggested. <LogInAgain />
            </small>
          )}
        </label>
        <label className="field">
          <span>Role</span>
          <select name="role" aria-label="Role" aria-describedby={hintId} value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="viewer">Viewer</option>
            <option value="contributor">Contributor</option>
            {canAddMaintainers && <option value="maintainer">Maintainer</option>}
          </select>
          <small className="field-hint" id={hintId}>
            {ROLE_DESCRIPTIONS[role]}
          </small>
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add member'}
        </button>
      </div>
    </form>
  );
}

/** A member's role, changed in place. The select follows the saved role, so a change made elsewhere shows at once. */
export function MemberRole({
  projectId,
  handle,
  role,
  canAddMaintainers,
  onResult,
}: {
  projectId: string;
  handle: string;
  role: keyof typeof ROLE_DESCRIPTIONS;
  canAddMaintainers: boolean;
  onResult?: (state: ActionState) => void;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  const [value, setValue] = useState(role);
  useEffect(() => setValue(role), [role]);
  return (
    <span className="action member-role">
      <select
        aria-label={`Role for @${handle}`}
        value={value}
        disabled={pending}
        title={ROLE_DESCRIPTIONS[value]}
        onChange={(event) => {
          const next = event.target.value as typeof role;
          setValue(next);
          start(async () => {
            const result = await safeAction(() => changeMemberRole(projectId, handle, next));
            if (result.error) setValue(role);
            if (onResult) onResult(result);
            else setState(result);
          });
        }}
      >
        <option value="viewer">Viewer</option>
        <option value="contributor">Contributor</option>
        {(canAddMaintainers || role === 'maintainer') && <option value="maintainer">Maintainer</option>}
      </select>
      <FormStatus state={state} />
    </span>
  );
}

/**
 * Making a project public is asked once, in the form: the box must be ticked to save.
 * Making it private says what happens to its forks and links.
 */
export function VisibilityField({
  initial,
  mustStayPrivate,
  disabled,
  forkCount = 0,
  hint,
}: {
  initial: 'public' | 'private';
  mustStayPrivate: boolean;
  disabled: boolean;
  forkCount?: number;
  hint?: string;
}) {
  const [visibility, setVisibility] = useState(initial);
  return (
    <>
      <label className="field">
        <span>Visibility</span>
        <select name="visibility" value={visibility} disabled={disabled} onChange={(event) => setVisibility(event.target.value as typeof initial)}>
          <option value="private">Private</option>
          <option value="public" disabled={mustStayPrivate}>
            Public
          </option>
        </select>
        {mustStayPrivate && <span className="field-hint">A fork of a private project stays private.</span>}
        {hint && <span className="field-hint">{hint}</span>}
        {initial === 'public' && visibility === 'private' && (
          <span className="field-hint">
            It leaves Explore and your profile, and only members can open it.
            {forkCount > 0 && ` Its ${forkCount === 1 ? 'public fork keeps its copy' : `${forkCount} public forks keep their copies`}.`}
          </span>
        )}
      </label>
      {initial === 'private' && visibility === 'public' && (
        <label className="choice">
          <input type="checkbox" name="confirmPublic" required />
          Make it public. Anyone will be able to see it, download its files, and fork its releases.
        </label>
      )}
    </>
  );
}

const ROLES = ['owner', 'maintainer', 'contributor', 'viewer'] as const;

/**
 * The approval rules, checked as they're edited: a count no one can meet, or 0, which
 * turns review off, is said before saving.
 */
export function ApprovalRulesFields({ rules, members, disabled }: { rules: ApprovalRules; members: readonly Member[]; disabled: boolean }) {
  const countHintId = useId();
  const [count, setCount] = useState(String(rules.requiredCount));
  const [roles, setRoles] = useState<ReadonlySet<string>>(new Set(rules.approverRoles));
  const [people, setPeople] = useState<ReadonlySet<string>>(new Set(rules.approverUserIds));
  const [allowSelf, setAllowSelf] = useState(rules.allowSelfApproval);
  const toggle = (set: ReadonlySet<string>, value: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };
  const required = /^\d+$/.test(count) ? Number(count) : null;
  const eligible = members.filter((member) => people.has(member.userId) || roles.has(member.role)).length;
  const short = required !== null && required > eligible;
  return (
    <>
      <label className="field">
        <span>Required approvals</span>
        <input
          type="number"
          name="requiredCount"
          min="0"
          max="20"
          required
          value={count}
          onChange={(event) => setCount(event.target.value)}
          aria-describedby={countHintId}
          disabled={disabled}
        />
        <small className="field-hint" id={countHintId}>
          {required === 0
            ? 'With 0, anyone who can open a release request can release it without review.'
            : !allowSelf && required !== null && required > 0 && required === eligible
              ? `${eligible === 1 ? 'Only one person can approve' : `Exactly ${eligible} people can approve`}, so a request one of them opens can’t get enough approvals.`
              : 'How many eligible people must approve before a release.'}
        </small>
      </label>
      <fieldset className="field">
        <legend>Eligible roles</legend>
        <div className="choice-list">
          {ROLES.map((role) => (
            <label key={role} className="choice">
              <input
                type="checkbox"
                name="approverRoles"
                value={role}
                checked={roles.has(role)}
                onChange={(event) => setRoles(toggle(roles, role, event.target.checked))}
                disabled={disabled}
              />
              <span className="role">{role}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>Eligible people</legend>
        <p className="field-hint">These people can approve in addition to everyone with a role checked above.</p>
        <div className="choice-list">
          {members.map((member) => (
            <label key={member.userId} className="choice">
              <input
                type="checkbox"
                name="approverUserIds"
                value={member.userId}
                checked={people.has(member.userId)}
                onChange={(event) => setPeople(toggle(people, member.userId, event.target.checked))}
                disabled={disabled}
              />
              @{member.handle}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="choice">
        <input type="checkbox" name="allowSelfApproval" checked={allowSelf} onChange={(event) => setAllowSelf(event.target.checked)} disabled={disabled} />
        Allow requester to approve
      </label>
      <label className="choice">
        <input type="checkbox" name="requireCleanRebuild" defaultChecked={rules.requireCleanRebuild} disabled={disabled} aria-describedby="rebuild-rule-hint" />
        Require a clean SolidWorks rebuild
      </label>
      <p className="field-hint" id="rebuild-rule-hint">
        Releases wait for a rebuild report without errors for the exact candidate. Reports come from the GigaCAD add-in for SolidWorks (coming soon) or from your own rebuild with <code className="mono">giga rr rebuild-report</code>, so leave this off until you have one of those.
      </p>
      {short && !disabled && (
        <label className="choice notice-caution confirm-short" role="alert">
          <input type="checkbox" name="confirmShort" required />
          Save anyway. Only {eligible === 1 ? 'one person' : `${eligible} people`} can approve, but a release needs {required}, so no release request can be approved until you change this.
        </label>
      )}
    </>
  );
}
