'use client';

import { formatBytes, PLANS, type BillingInterval, type PlanId } from '@gigacad/core';
import { useState } from 'react';
import { choosePlan, openBillingPortal } from '../../app/(product)/actions';
import { ActionButton } from './ActionButton';

/** Every plan with its price for the chosen interval. Buttons go to Stripe Checkout or the billing portal. */
export function BillingPlans({ current, currentInterval, paying, billingEnabled }: { current: PlanId; currentInterval: BillingInterval | null; paying: boolean; billingEnabled: boolean }) {
  const [interval, setInterval] = useState<BillingInterval>(currentInterval ?? 'monthly');
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
              const isCurrent = plan.id === current && (plan.id === 'free' || currentInterval === interval);
              const price = plan.id === 'free' ? '$0' : interval === 'monthly' ? `$${plan.monthlyUsd} / month` : `$${plan.yearlyUsd} / year`;
              return (
                <tr key={plan.id}>
                  <td>
                    <strong>{plan.name}</strong>
                    <span className="plan-summary">{plan.summary}</span>
                  </td>
                  <td>{formatBytes(plan.storageBytes)}</td>
                  <td>{price}</td>
                  <td className="cell-action">
                    {isCurrent ? (
                      <span className="badge">Current plan</span>
                    ) : plan.id === 'free' ? (
                      paying && <ActionButton action={openBillingPortal}>Switch to Free</ActionButton>
                    ) : billingEnabled ? (
                      <ActionButton action={() => choosePlan(plan.id, interval)} className={paying ? 'btn btn-secondary' : 'btn btn-primary'}>
                        {paying ? `Switch to ${plan.name}` : `Choose ${plan.name}`}
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
