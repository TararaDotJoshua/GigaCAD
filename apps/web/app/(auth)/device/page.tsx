import { isPlaceholderHandle } from '@gigacad/core';
import { Suspense } from 'react';
import { DeviceApproval } from '../../../components/DeviceApproval';
import { getViewer } from '../../../lib/product';

export const metadata = { title: 'Approve a device' };

export default async function Page() {
  const me = await getViewer();
  return <Suspense><DeviceApproval handle={me && !isPlaceholderHandle(me.handle) ? me.handle : null} /></Suspense>;
}
