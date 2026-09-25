import type { Metadata } from "next";
import Link from "next/link";
import { PricingPlans } from "../../../components/PricingPlans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Every GigaCAD plan includes every feature and unlimited collaborators. Plans differ only in storage, from 5 GB free to 2 TB.",
};

const questions = [
  ["Changing plans", "Switch plans any time from Account settings. Stripe charges or credits the difference for the rest of the billing period."],
  ["Canceling", "Your plan stays until the end of the period you paid for, then moves to Free. Nothing is deleted; if you store more than Free allows, uploads pause until you’re under it."],
  ["Paying", "Stripe sells paid plans for us through Link, and adds sales tax or VAT at checkout where it applies. Pay by card, Link, or a local payment method. Your statement shows LINK.COM* GIGACAD."],
  ["Teams", "There are no seats. Invite as many collaborators as you like; their uploads to your projects use your storage."],
];

export default function PricingPage() {
  return (
    <>
      <section className="page-head">
        <div className="hero-grid" aria-hidden="true" />
        <div className="container page-head-inner">
          <div className="page-head-copy">
            <h1 className="page-title">Pay for storage, not seats.</h1>
            <p className="lead">
              Every plan includes every feature and unlimited collaborators. Plans differ only in how
              much you can store.
            </p>
          </div>
          <PricingPlans />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2 className="h2 section-title">How storage counts</h2>
          <div className="extras">
            <div>
              <h3 className="h3">Each version once</h3>
              <p className="body">
                A file version counts once, no matter how many branches, releases, or of your projects
                use it. Unchanged parts cost nothing extra.
              </p>
            </div>
            <div>
              <h3 className="h3">Owners pay</h3>
              <p className="body">
                Everything in a project counts against its owner, including collaborators’ uploads.
                Projects shared with you use their owner’s storage.
              </p>
            </div>
            <div>
              <h3 className="h3">When you’re full</h3>
              <p className="body">
                Uploads pause, and everything stays readable and downloadable. Delete a project or
                upgrade to keep going.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section closing">
        <div className="container feature-inner is-top">
          <div className="feature-copy">
            <h2 className="h2">Billing</h2>
            <p className="body">
              The <Link className="text-link" href="/terms#limits-and-pricing">terms</Link> cover plans and storage limits in full.
            </p>
          </div>
          <dl className="spec-table">
            {questions.map(([term, detail]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
