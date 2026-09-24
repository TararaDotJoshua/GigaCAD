import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "../../../components/LegalPage";
import { SUPPORT_EMAIL } from "../../../components/site";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using GigaCAD, its website, and its desktop software.",
};

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "These terms",
    body: (
      <>
        <p>
          These terms cover your use of GigaCAD: the website at gigacad.site, the app at
          app.gigacad.site, the Windows drive and tray app, the SolidWorks add-in, the command-line
          tool, and the API (together, “the service”). By creating an account or using the service,
          you agree to them.
        </p>
        <p>
          If you use GigaCAD on behalf of a company or other organization, you agree to these terms for
          it, and you confirm you’re allowed to.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <>
        <p>
          You need an account to create projects or contribute to them. You must be at least 13 years
          old, and old enough where you live to agree to these terms yourself.
        </p>
        <ul>
          <li>Give accurate sign-up information and keep it current.</li>
          <li>
            Keep your password and signed-in devices secure. You’re responsible for what happens under
            your account, including from computers where the desktop app is signed in.
          </li>
          <li>One person per account. Don’t share logins; add people to a project instead.</li>
        </ul>
      </>
    ),
  },
  {
    id: "your-content",
    title: "Your files belong to you",
    body: (
      <>
        <p>
          You keep ownership of everything you upload: CAD files, drawings, previews, messages, and
          other content. We don’t claim any rights to your designs.
        </p>
        <p>
          To run the service, you give us permission to store, copy, process, and display your content
          only as needed to provide GigaCAD to you and the people you share with. That includes
          generating thumbnails and 3D previews, reading file references so assemblies stay intact,
          and keeping backups. This permission ends when your content is deleted, apart from backup
          copies that expire on their normal schedule.
        </p>
      </>
    ),
  },
  {
    id: "public-projects",
    title: "Public projects and forks",
    body: (
      <>
        <p>
          A public project can be viewed, downloaded, and forked by anyone, including people without an
          account. What others may do with your files beyond that is set by the license you choose in
          the project’s settings.
        </p>
        <p>
          A fork is a separate project owned by the person who made it. If you make your project private
          or delete it later, forks that already exist aren’t removed.
        </p>
      </>
    ),
  },
  {
    id: "releases",
    title: "Releases are permanent",
    body: (
      <>
        <p>
          A release is locked the moment it’s created. Nobody can edit or delete a single release,
          including the project owner and including us on your behalf. This is how GigaCAD guarantees a
          release is exactly what was approved.
        </p>
        <p>
          The only way to remove a release is to delete its whole project. A deleted project can be
          restored for 30 days. After that it’s permanently deleted, along with its releases, branches,
          and files. Check what you upload to a release before you release it.
        </p>
      </>
    ),
  },
  {
    id: "collaboration",
    title: "Check-outs and team projects",
    body: (
      <>
        <p>
          Checking out a branch gives one person write access to it. A project’s owners and maintainers
          can force-release a check-out, for example when someone is away. Force-releases are logged and
          the holder is notified. Changes the holder hasn’t uploaded yet stay on their computer.
        </p>
        <p>
          Project owners decide who can join, what role each member has, and who approves releases. We
          don’t settle disagreements between members of a project.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "What you can’t do",
    body: (
      <>
        <p>Don’t use GigaCAD to:</p>
        <ul>
          <li>upload content you don’t have the right to share, or that infringes someone else’s rights;</li>
          <li>store or spread malware, or files built to exploit CAD software;</li>
          <li>break the law, or help someone else break it;</li>
          <li>
            put export-controlled technical data (such as ITAR- or EAR-controlled designs) in a public
            project, or anywhere in GigaCAD if your obligations require certified hosting — GigaCAD is
            not certified for it;
          </li>
          <li>
            get around storage limits or access controls, scrape the service, or put an unreasonable
            load on it;
          </li>
          <li>harass other people through release requests, commit messages, or project content.</li>
        </ul>
        <p>
          We may remove content or suspend accounts that break these rules. Where it’s safe to, we’ll
          tell you what happened and why.
        </p>
      </>
    ),
  },
  {
    id: "limits-and-pricing",
    title: "Storage limits and pricing",
    body: (
      <>
        <p>
          Each account has a storage limit, shown in your settings. When you reach it, uploads pause
          until you free up space; your existing files stay available.
        </p>
        <p>
          If we introduce paid plans, we’ll tell you before anything changes for your account, and we
          won’t charge you without your agreement.
        </p>
      </>
    ),
  },
  {
    id: "software",
    title: "Desktop software",
    body: (
      <p>
        We give you a personal, non-transferable license to install and use the GigaCAD drive, tray app,
        SolidWorks add-in, and command-line tool with the service. They update themselves to stay
        compatible with the service. Don’t reverse-engineer them, except where the law allows it.
        SolidWorks is a product of Dassault Systèmes; GigaCAD isn’t affiliated with it.
      </p>
    ),
  },
  {
    id: "ending",
    title: "Closing your account",
    body: (
      <>
        <p>
          You can delete your account at any time in your settings. Projects you own are deleted with it,
          with the same 30-day restore window as a project deletion.
        </p>
        <p>
          We may suspend or close an account that seriously or repeatedly breaks these terms. If we ever
          shut GigaCAD down, we’ll give you at least 60 days’ notice so you can download your files.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers and liability",
    body: (
      <>
        <p>
          We work hard to keep your files safe and the service running, but GigaCAD is provided “as is”.
          We don’t promise it will be uninterrupted or error-free, or that rebuild reports catch every
          problem in a design. You’re responsible for checking that a design is correct and safe before
          you make or use it.
        </p>
        <p>
          To the extent the law allows, we aren’t liable for indirect or consequential losses, lost
          profits, or lost data, and our total liability for any claim is limited to the amount you paid
          us in the 12 months before it. Nothing in these terms limits liability that can’t be limited by
          law.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        If we change these terms in a way that matters, we’ll email you and show a notice in the app at
        least 30 days before the change takes effect. If you keep using GigaCAD after that, the new terms
        apply. Our <Link href="/privacy">Privacy Policy</Link> explains how we handle personal data.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about these terms go to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="September 23, 2026"
      summary={[
        "Your files are yours. We only use them to run GigaCAD for you and the people you share with.",
        "Public projects can be viewed and forked by anyone, under the license you choose.",
        "Releases can’t be edited or deleted. Deleting the whole project removes them after 30 days.",
        "Don’t upload things you don’t have rights to, malware, or export-controlled designs.",
      ]}
      sections={sections}
    />
  );
}
