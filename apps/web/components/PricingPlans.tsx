"use client";

import { formatBytes, PLANS, type BillingInterval } from "@gigacad/core";
import { useState } from "react";
import { APP_URL } from "./site";

// Paid plans open once Stripe is set up; see docs/DEPLOYMENT.md.
const PAID_OPEN = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";

export function PricingPlans() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  return (
    <div className="pricing">
      <div className="interval-switch" role="group" aria-label="Billing interval">
        {(["monthly", "yearly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={interval === option}
            onClick={() => setInterval(option)}
          >
            {option === "monthly" ? "Monthly" : "Yearly, two months free"}
          </button>
        ))}
      </div>
      <ul className="plan-grid">
        {PLANS.map((plan) => {
          const free = plan.id === "free";
          const amount = interval === "monthly" ? plan.monthlyUsd : plan.yearlyUsd;
          return (
            <li key={plan.id} className="plan">
              <h2 className="h3">{plan.name}</h2>
              <p className="plan-storage">{formatBytes(plan.storageBytes)}</p>
              <p className="plan-price">
                <span>${amount}</span>
                {!free && <span className="plan-per">{interval === "monthly" ? "per month" : "per year"}</span>}
              </p>
              <p className="plan-summary">{plan.summary}</p>
              {free ? (
                <a className="button" href={`${APP_URL}/signup`}>
                  Start a project
                </a>
              ) : PAID_OPEN ? (
                <a className="button button-outline" href={`${APP_URL}/billing/checkout?plan=${plan.id}&interval=${interval}`}>
                  Choose {plan.name}
                </a>
              ) : (
                <p className="plan-soon">Opens soon</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
