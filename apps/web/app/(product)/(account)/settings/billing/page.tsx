import { formatBytes, getPlan } from '@gigacad/core';
import Link from 'next/link';
import { openBillingPortal } from '../../../actions';
import { ActionButton } from '../../../../../components/product/ActionButton';
import { BillingPlans } from '../../../../../components/product/BillingPlans';
import { PageHead } from '../../../../../components/product/PageHead';
import { RefreshSoon } from '../../../../../components/product/RefreshSoon';
import { StatusBadge } from '../../../../../components/product/StatusBadge';
import { getBilling } from '../../../../../lib/product';
import { safeReturnPath } from '../../../../../lib/return-path';

export const metadata = { title: 'Plan and storage' };

const date = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default async function BillingSettings({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string; from?: string }> }) {
  const [billing, query] = await Promise.all([getBilling(), searchParams]);
  const plan = getPlan(billing.plan);
  const paying = billing.plan !== 'free';
  const share = billing.quotaBytes > 0 ? Math.min(1, billing.usedBytes / billing.quotaBytes) : 1;
  const tone = share >= 1 ? 'is-full' : share >= 0.9 ? 'is-near' : '';
  const from = safeReturnPath(query.from, '') || undefined;
  const back = from && (
    <Link href={from} className="btn btn-secondary btn-small">
      Back to {placeName(from)}
    </Link>
  );
  return (
    <div className="page page-narrow">
      <PageHead crumbs={[{ label: 'Account', href: '/settings' }, { label: 'Plan and storage' }]} title="Plan and storage." />
      {query.checkout === 'done' &&
        (paying ? (
          <p className="notice notice-action" role="status">
            You’re on {plan.name}. {back}
          </p>
        ) : (
          <p className="notice" role="status">
            Payment received. Your plan changes as soon as Stripe confirms it, usually within a few seconds.
            <RefreshSoon after={<> Still processing. Refresh in a minute.</>} />
          </p>
        ))}
      {query.checkout === 'cancelled' && (
        <p className="notice notice-action" role="status">
          No changes were made. {back}
        </p>
      )}
      {!query.checkout && back && <p className="notice notice-action">{back}</p>}
      {query.error && <p className="notice" role="alert">{query.error === 'billing_unavailable' ? 'Paid plans aren’t available yet.' : 'That plan couldn’t be started. Try again.'}</p>}

      <section className="section">
        <h2>Storage</h2>
        <p className="section-intro">Every file version in the projects you own counts once, including branch and release history. Projects shared with you count against their owner.</p>
        <div className={`storage-meter ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={billing.quotaBytes} aria-valuenow={billing.usedBytes} aria-label="Storage used">
          <span style={{ width: `${Math.max(share * 100, billing.usedBytes > 0 ? 1 : 0)}%` }} />
        </div>
        <p className="storage-caption">
          {formatBytes(billing.usedBytes)} of {formatBytes(billing.quotaBytes)} used
          {share >= 1 && <> · <StatusBadge tone="danger">Full</StatusBadge> Uploads are paused until you free up space or upgrade.</>}
        </p>
      </section>

      {paying && (
        <section className="section">
          <h2>Your plan</h2>
          <p className="plan-current">
            <strong>{plan.name}</strong>
            {billing.interval && <span className="muted">, billed {billing.interval}</span>}
            {billing.status === 'past_due' && <> <StatusBadge tone="caution">Payment failed</StatusBadge></>}
          </p>
          {billing.currentPeriodEnd && (
            <p className="muted">
              {billing.cancelAtPeriodEnd ? `Ends ${date(billing.currentPeriodEnd)}, then moves to Free.` : `Renews ${date(billing.currentPeriodEnd)}.`}
              {billing.status === 'past_due' && ' Update your payment method to keep this plan.'}
            </p>
          )}
          {billing.canManage && (
            <p className="plan-manage">
              <ActionButton action={openBillingPortal.bind(null, from)}>Change or cancel in Stripe</ActionButton>
            </p>
          )}
        </section>
      )}

      <section className="section">
        <h2>Plans</h2>
        <p className="section-intro">
          Every plan includes every feature and unlimited collaborators. Plans differ only in storage.{paying ? ' Change or cancel your plan in Stripe.' : ' Paying happens on Stripe.'}
        </p>
        <BillingPlans current={billing.plan} currentInterval={billing.interval} paying={paying} billingEnabled={billing.billingEnabled} from={from} />
      </section>
    </div>
  );
}

/** A short name for the page someone came from: the project for project pages. */
function placeName(path: string): string {
  const [owner, project] = path.split(/[?#]/)[0]!.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (owner && project && !['settings', 'explore', 'new', 'app'].includes(owner)) return `${owner}/${project}`;
  return 'where you were';
}
