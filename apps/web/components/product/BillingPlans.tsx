'use client';

import { formatBytes, PLANS, type BillingInterval, type PlanId } from '@gigacad/core';
import { useState } from 'react';
import { choosePlan } from '../../app/(product)/actions';
import { ActionButton } from './ActionButton';

/**
 * Every plan with its price for the chosen interval. Before paying, a plan's button goes to
 * Stripe Checkout; once paying, plan changes happen in Stripe, from the button above.
 */
export function BillingPlans({
  current,
  currentInterval,
  paying,
  billingEnabled,
  from,
  chosen,
  initialInterval,
}: {
  current: PlanId;
  currentInterval: BillingInterval | null;
  paying: boolean;
  billingEnabled: boolean;
  from?: string;
  /** A plan picked for a checkout that didn't finish, marked so it's easy to find again. */
  chosen?: PlanId;
  initialInterval?: BillingInterval;
}) {
  const [interval, setInterval] = useState<BillingInterval>(initialInterval ?? currentInterval ?? 'monthly');
  return (
    <div className="billing-plans">
      <div className="segmented interval-toggle" role="group" aria-label="Billing interval">
        {(['monthly', 'yearly'] as const).map((option) => (
          <button key={option} type="button" className={`segment${interval === option ? ' is-selected' : ''}`} aria-pressed={interval === option} onClick={() => setInterval(option)}>
            {option === 'monthly' ? 'Monthly' : 'Yearly, two months free'}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Storage</th>
              <th scope="col">Price</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {PLANS.map((plan) => {
              // Your plan stays marked whichever interval the table shows; the other one says how you're billed.
              const isCurrent = plan.id === current;
              const billedOtherwise = isCurrent && plan.id !== 'free' && currentInterval !== null && currentInterval !== interval;
              const price = plan.id === 'free' ? '$0' : interval === 'monthly' ? `$${plan.monthlyUsd} / month` : `$${plan.yearlyUsd} / year`;
              return (
                <tr key={plan.id} className={plan.id === chosen && !isCurrent ? 'is-chosen' : undefined} aria-current={plan.id === chosen && !isCurrent ? 'true' : undefined}>
                  <td>
                    <strong>{plan.name}</strong>
                    <span className="plan-summary">{plan.summary}</span>
                  </td>
                  <td className="nowrap">{formatBytes(plan.storageBytes)}</td>
                  <td className="nowrap">{price}</td>
                  <td className="cell-action">
                    {isCurrent ? (
                      <span className="badge">{billedOtherwise ? `Current plan (billed ${currentInterval})` : 'Current plan'}</span>
                    ) : paying || plan.id === 'free' ? null : billingEnabled ? (
                      <ActionButton action={() => choosePlan(plan.id, interval, from)} className="btn btn-primary">
                        Choose {plan.name}
                      </ActionButton>
                    ) : (
                      <span className="muted">Opens soon</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
