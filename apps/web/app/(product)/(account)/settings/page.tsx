import Link from 'next/link';
import { formatBytes, getPlan, isPlaceholderHandle } from '@gigacad/core';
import { removeAvatar, restoreProject, saveProfile, signOutDevice, uploadAvatar } from '../../actions';
import { ActionButton } from '../../../../components/product/ActionButton';
import { ActionForm } from '../../../../components/product/ActionForm';
import { Avatar } from '../../../../components/product/Avatar';
import { BioField } from '../../../../components/product/BioField';
import { EmptyState } from '../../../../components/product/EmptyState';
import { HandleField } from '../../../../components/product/HandleField';
import { PageHead } from '../../../../components/product/PageHead';
import { RelativeTime } from '../../../../components/product/RelativeTime';
import { apiRequest, type DeletedProject, type DeviceToken } from '../../../../lib/api';
import { dashboardPath } from '../../../../lib/hosts';
import { getBilling, getMe } from '../../../../lib/product';
import { requireAccessToken } from '../../../../lib/session';

export const metadata = { title: 'Account' };

export default async function AccountSettings() {
  const token = await requireAccessToken();
  const [me, billing, devices, deleted] = await Promise.all([
    getMe(),
    getBilling(),
    apiRequest<DeviceToken[]>(token, '/v1/me/tokens'),
    apiRequest<DeletedProject[]>(token, '/v1/me/deleted-projects'),
  ]);
  return (
    <div className="page page-narrow">
      <PageHead crumbs={[{ label: 'Your projects', href: dashboardPath() }, { label: 'Account' }]} title="Account." />

      <section className="section">
        <h2>Profile</h2>
        <p className="section-intro">
          Anyone can see your profile{isPlaceholderHandle(me.handle) ? ' once you choose a handle' : <> at <Link href={`/${me.handle}`}>app.gigacad.site/{me.handle}</Link></>}.
        </p>
        <ActionForm action={saveProfile} submitLabel="Save profile">
          <HandleField defaultValue={isPlaceholderHandle(me.handle) ? '' : me.handle} />
          <label className="field">
            <span>Display name <em>optional</em></span>
            <input name="displayName" defaultValue={me.displayName ?? ''} maxLength={100} />
          </label>
          <BioField defaultValue={me.bio ?? ''} />
          <label className="field">
            <span>Location <em>optional</em></span>
            <input name="location" defaultValue={me.location ?? ''} maxLength={60} />
          </label>
          <label className="field">
            <span>Website <em>optional</em></span>
            <input name="website" type="text" inputMode="url" defaultValue={me.website ?? ''} maxLength={200} placeholder="https://" spellCheck={false} />
          </label>
        </ActionForm>
      </section>

      <section className="section">
        <h2>Avatar</h2>
        <div className="avatar-editor">
          <Avatar handle={me.handle} url={me.avatarUrl} size="lg" />
          <ActionForm action={uploadAvatar} submitLabel="Upload" pendingLabel="Uploading…" submitClassName="btn btn-secondary">
            <label className="field">
              <span>Image</span>
              <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp" required />
              <small className="field-hint">A square PNG, JPEG, or WebP of 1 MB or less.</small>
            </label>
          </ActionForm>
          {me.avatarUrl && (
            <ActionButton action={removeAvatar} className="btn btn-danger btn-small" confirm="Remove your avatar?">
              Remove
            </ActionButton>
          )}
        </div>
      </section>

      <section className="section">
        <h2>Plan and storage</h2>
        <p className="plan-current">
          <strong>{getPlan(billing.plan).name}</strong>
          <span className="muted"> · {formatBytes(billing.usedBytes)} of {formatBytes(billing.quotaBytes)} used</span>
        </p>
        <p>
          <Link className="btn btn-secondary" href="/settings/billing">
            Change plan
          </Link>
        </p>
      </section>

      {deleted.length > 0 && (
        <section className="section">
          <h2>Deleted projects</h2>
          <p className="section-intro">A deleted project can be restored for 30 days, with everything in it. After that it’s gone for good.</p>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Deleted</th>
                <th scope="col">Removed for good</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {deleted.map((project) => (
                <tr key={project.id}>
                  <td>
                    {project.name} <span className="mono muted">{project.slug}</span>
                  </td>
                  <td className="muted">
                    <RelativeTime value={project.deletedAt} />
                  </td>
                  <td className="muted">{daysLeft(project.purgeAt)}</td>
                  <td className="cell-action">
                    <ActionButton action={restoreProject.bind(null, project.id)} className="btn btn-secondary btn-small" pendingLabel="Restoring…">
                      Restore
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="section">
        <h2>Devices</h2>
        <p className="section-intro">The GigaCAD drive, the SolidWorks add-in, and the giga CLI sign in with a device token. Sign out any you don’t recognize.</p>
        {devices.length === 0 ? (
          <EmptyState title="No devices are signed in." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">Signed in</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td>{device.name}</td>
                  <td className="muted">
                    <RelativeTime value={device.createdAt} />
                  </td>
                  <td className="muted">{device.lastUsedAt ? <RelativeTime value={device.lastUsedAt} /> : 'Never'}</td>
                  <td className="cell-action">
                    <ActionButton
                      action={signOutDevice.bind(null, device.id)}
                      className="btn btn-danger btn-small"
                      confirm={`Sign out ${device.name}? It will need to sign in again.`}
                    >
                      Sign out
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function daysLeft(purgeAt: string): string {
  const days = Math.max(1, Math.ceil((new Date(purgeAt).getTime() - Date.now()) / 86_400_000));
  return days === 1 ? 'In 1 day' : `In ${days} days`;
}
