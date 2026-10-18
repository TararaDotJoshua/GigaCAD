import { isPlaceholderHandle } from '@gigacad/core';
import { DeviceApproval } from '../../../components/DeviceApproval';
import { getViewer } from '../../../lib/product';

export const metadata = { title: 'Approve a device' };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [me, params] = await Promise.all([getViewer(), searchParams]);
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  return <DeviceApproval handle={me && !isPlaceholderHandle(me.handle) ? me.handle : null} initialCode={code ?? ''} />;
}
