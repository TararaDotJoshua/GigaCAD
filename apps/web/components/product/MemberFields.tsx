'use client';

import type { ProjectRole } from '@gigacad/core';
import { useEffect, useId, useState, useTransition } from 'react';
import { changeMemberRole, findPeople, type ActionState } from '../../app/(product)/actions';
import { FormStatus } from './ActionButton';

/** What each role can do, one line each, said the same way wherever a role is picked. */
export const ROLE_DESCRIPTIONS: Readonly<Record<Exclude<ProjectRole, 'owner'>, string>> = {
  viewer: 'Sees and downloads files and releases.',
  contributor: 'Also uploads files, checks out branches, and opens release requests.',
  maintainer: 'Also changes settings, adds people, and can force-release someone’s lock.',
};

/** The handle and role fields for adding a member, suggesting people as the handle is typed. */
export function AddMemberFields({ canAddMaintainers }: { canAddMaintainers: boolean }) {
  const listId = useId();
  const hintId = useId();
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<keyof typeof ROLE_DESCRIPTIONS>('viewer');
  const [people, setPeople] = useState<{ handle: string; displayName: string | null }[]>([]);

  useEffect(() => {
    const query = handle.trim().replace(/^@/, '');
    if (!query) return setPeople([]);
    let current = true;
    const timer = setTimeout(async () => {
      const found = await findPeople(query);
      if (current) setPeople(found);
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [handle]);

  return (
    <>
      <label className="field">
        <span>Handle</span>
        <input name="handle" placeholder="@alex" required autoComplete="off" spellCheck={false} list={listId} value={handle} onChange={(event) => setHandle(event.target.value)} />
        <datalist id={listId}>
          {people.map((person) => (
            <option key={person.handle} value={person.handle}>
              {person.displayName ?? undefined}
            </option>
          ))}
        </datalist>
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
    </>
  );
}

/** A member's role, changed in place. */
export function MemberRole({ projectId, handle, role, canAddMaintainers }: { projectId: string; handle: string; role: keyof typeof ROLE_DESCRIPTIONS; canAddMaintainers: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  return (
    <span className="action member-role">
      <select
        aria-label={`Role for @${handle}`}
        defaultValue={role}
        disabled={pending}
        title={ROLE_DESCRIPTIONS[role]}
        onChange={(event) => {
          const select = event.target;
          start(async () => {
            const result = await changeMemberRole(projectId, handle, select.value);
            if (result.error) select.value = role;
            setState(result);
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

/** Making a project public is asked once, in the form: the box must be ticked to save. */
export function VisibilityField({ initial, mustStayPrivate, disabled }: { initial: 'public' | 'private'; mustStayPrivate: boolean; disabled: boolean }) {
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
