import Link from 'next/link';
import { formatBytes, getPlan, isPlaceholderHandle } from '@gigacad/core';
import { saveProfile, signOutDevice } from '../../actions';
import { ActionButton } from '../../../../components/product/ActionButton';
import { ActionForm } from '../../../../components/product/ActionForm';
import { EmptyState } from '../../../../components/product/EmptyState';
import { HandleField } from '../../../../components/product/HandleField';
import { PageHead } from '../../../../components/product/PageHead';
import { RelativeTime } from '../../../../components/product/RelativeTime';
import { apiRequest, type DeviceToken } from '../../../../lib/api';
import { dashboardPath } from '../../../../lib/hosts';
import { getBilling, getMe } from '../../../../lib/product';
import { requireAccessToken } from '../../../../lib/session';

export const metadata = { title: 'Account' };

export default async function AccountSettings() {
  const [me, billing, devices] = await Promise.all([getMe(), getBilling(), apiRequest<DeviceToken[]>(await requireAccessToken(), '/v1/me/tokens')]);
  return (
    <div className="page page-narrow">
      <PageHead crumbs={[{ label: 'Your projects', href: dashboardPath() }, { label: 'Account' }]} title="Account." />

      <section className="section">
        <h2>Profile</h2>
        <ActionForm action={saveProfile} submitLabel="Save profile">
          <HandleField defaultValue={isPlaceholderHandle(me.handle) ? '' : me.handle} />
          <label className="field">
            <span>Display name <em>optional</em></span>
            <input name="displayName" defaultValue={me.displayName ?? ''} maxLength={100} />
          </label>
        </ActionForm>
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
