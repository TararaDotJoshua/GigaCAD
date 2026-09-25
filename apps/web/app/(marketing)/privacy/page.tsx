import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "../../../components/LegalPage";
import { PRIVACY_EMAIL } from "../../../components/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What GigaCAD collects, why, who can see it, and how to delete it.",
};

const sections: LegalSection[] = [
  {
    id: "scope",
    title: "What this covers",
    body: (
      <p>
        This policy explains how GigaCAD handles personal data when you use gigacad.site,
        app.gigacad.site, the Windows drive and tray app, the SolidWorks add-in, the command-line tool,
        and the API. The <Link href="/terms">Terms of Service</Link> cover the rest of our agreement
        with you.
      </p>
    ),
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    body: (
      <>
        <h3>Your account</h3>
        <p>
          Your email address, username, and password (stored only as a secure hash). If you sign in with
          GitHub or Google, we receive your name, email address, and profile picture from them.
        </p>
        <h3>Your projects</h3>
        <p>
          The files you upload and what we derive from them: thumbnails, 3D previews, and the list of
          files each assembly or drawing references. We also store the project history you create:
          branches, versions and their messages, release requests, picks, rebuild reports, and approvals.
        </p>
        <h3>Activity in a project</h3>
        <p>
          Who checked out which branch, when, and from which computer (by its Windows computer name), plus
          force-releases, approvals, and releases. These are kept in the project’s activity log.
        </p>
        <h3>Technical data</h3>
        <p>
          IP addresses, browser and operating system versions, desktop app versions, and error reports.
          We use these to keep the service secure and to fix problems.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use-it",
    title: "How we use it",
    body: (
      <>
        <ul>
          <li>to run GigaCAD: sync your files, show previews, enforce check-outs, and record releases;</li>
          <li>to sign you in and keep your account secure;</li>
          <li>to send emails about your account and projects, such as sign-in links and release requests awaiting your approval;</li>
          <li>to find and fix bugs, and to prevent abuse.</li>
        </ul>
        <p>
          We don’t sell personal data, we don’t show ads, and we don’t use your files to train machine
          learning models.
        </p>
      </>
    ),
  },
  {
    id: "who-can-see-it",
    title: "Who can see your data",
    body: (
      <>
        <ul>
          <li>
            <strong>Private projects</strong> are visible only to their members. Members see each other’s
            usernames, the project’s history, and who has each branch checked out, including the computer
            name.
          </li>
          <li>
            <strong>Public projects</strong> are visible to everyone, including their files, releases,
            history, and the usernames of the people who contributed.
          </li>
          <li>
            <strong>Your profile</strong> shows your username, profile picture, and public projects.
            Your email address is never shown publicly.
          </li>
        </ul>
        <p>
          GigaCAD staff access project content only when you ask us to help, or when we need to
          investigate abuse or a security problem.
        </p>
      </>
    ),
  },
  {
    id: "service-providers",
    title: "Service providers",
    body: (
      <>
        <p>We use a small number of companies to run GigaCAD. They process data only on our instructions:</p>
        <ul>
          <li>
            <strong>Cloudflare</strong> stores your files and previews, and hosts and protects our
            websites.
          </li>
          <li>
            <strong>Supabase</strong> hosts our database, handles sign-in, and delivers live updates.
          </li>
          <li>
            <strong>Our application host</strong> runs the GigaCAD API and the background jobs that
            generate previews.
          </li>
          <li>
            <strong>Stripe</strong> sells paid plans through Link and processes their payments under
            its own privacy policy. We never see your full card number; we keep your plan, billing
            status, and Stripe customer ID.
          </li>
          <li>
            <strong>GitHub and Google</strong>, only if you choose to sign in with them.
          </li>
        </ul>
        <p>
          These providers may process data in the United States and other countries. Where the law
          requires it, we use standard contractual safeguards for those transfers.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        We use cookies only to keep you signed in and to protect your session. We don’t use advertising
        or cross-site tracking cookies.
      </p>
    ),
  },
  {
    id: "retention",
    title: "How long we keep data",
    body: (
      <>
        <ul>
          <li>Autosaves are deleted when you commit the next version on that branch, or when the branch is released.</li>
          <li>Releases are kept for as long as their project exists. They can’t be deleted one at a time.</li>
          <li>
            A deleted project can be restored for 30 days, then it’s permanently deleted. Files no other
            project uses are removed from storage after that.
          </li>
          <li>Technical logs are kept for up to 90 days.</li>
          <li>Backups expire on a rolling schedule of up to 35 days after data is deleted.</li>
        </ul>
      </>
    ),
  },
  {
    id: "your-choices",
    title: "Your choices and rights",
    body: (
      <>
        <p>You can:</p>
        <ul>
          <li>update your email address, username, and profile picture in your settings;</li>
          <li>download any file or release from projects you can see;</li>
          <li>make a project private, or delete it;</li>
          <li>delete your account, which also deletes the projects you own.</li>
        </ul>
        <p>
          Depending on where you live, you may also have the right to access, correct, export, or delete
          your personal data, or to object to how we use it. Email us to use any of these rights. Some
          things stay by design: your username stays in the history of other people’s projects you
          contributed to, and existing forks of your public projects belong to the people who made them.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        Data is encrypted in transit and at rest. Files are stored under content hashes and reached only
        through short-lived signed links. Access to production systems is limited and logged. If a breach
        affects your data, we’ll tell you without undue delay.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        GigaCAD isn’t meant for children under 13, and we don’t knowingly collect their data. If you
        think a child has given us personal data, contact us and we’ll delete it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        If we change this policy in a way that matters, we’ll email you and show a notice in the app
        before the change takes effect.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Privacy questions and requests go to <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="September 25, 2026"
      summary={[
        "We collect what’s needed to run GigaCAD: your account, your projects, and a log of project activity.",
        "Private projects are visible only to their members. Public projects are visible to everyone.",
        "We don’t sell data, show ads, or train models on your files.",
        "You can delete a project or your whole account at any time.",
      ]}
      sections={sections}
    />
  );
}
