import { isPlaceholderHandle } from '@gigacad/core';
import { redirect } from 'next/navigation';
import { createProject } from '../../actions';
import { ActionForm } from '../../../../components/product/ActionForm';
import { NewProjectFields } from '../../../../components/product/NewProjectFields';
import { PageHead } from '../../../../components/product/PageHead';
import { dashboardPath } from '../../../../lib/hosts';
import { getMe } from '../../../../lib/product';

export const metadata = { title: 'New project' };

export default async function NewProject() {
  const me = await getMe();
  // Project addresses start with the owner's handle, so choose one first (on the dashboard).
  if (isPlaceholderHandle(me.handle)) redirect(dashboardPath());
  return (
    <div className="page page-narrow">
      <PageHead crumbs={[{ label: 'Your projects', href: dashboardPath() }, { label: 'New project' }]} title="New project." />
      <ActionForm action={createProject} submitLabel="Create project" pendingLabel="Creating…">
        <NewProjectFields owner={me.handle} />
        <label className="field">
          <span>Description <em>optional</em></span>
          <textarea name="description" rows={3} maxLength={2000} />
        </label>
        <fieldset className="field">
          <legend>Who can see it</legend>
          <div className="choice-list">
            <label className="choice">
              <input type="radio" name="visibility" value="private" defaultChecked />
              <span>
                <strong>Private</strong>
                <small>Only people you add as members.</small>
              </span>
            </label>
            <label className="choice">
              <input type="radio" name="visibility" value="public" />
              <span>
                <strong>Public</strong>
                <small>Anyone can view it and its releases. Only members can change it.</small>
              </span>
            </label>
          </div>
        </fieldset>
      </ActionForm>
    </div>
  );
}
