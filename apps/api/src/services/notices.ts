import { approverIneligibility, type ProjectRole } from '@gigacad/core';
import type { FastifyBaseLogger } from 'fastify';
import type { Sql } from '../db.js';
import { sendAll, type MailMessage, type Mailer } from '../mail.js';
import { loadApprovalRules } from './projects.js';

/**
 * Short emails telling people about changes someone else made to their access or work:
 * a new role, being removed from a project, a project deleted, and a release request moving
 * on. (Locks that someone else releases are told from branches.ts.)
 *
 * Routes send them with `sendLater`, after the change has committed and without making the
 * response wait. A failed email is logged; it never undoes the change or stops the others.
 */

const inFlight = new Set<Promise<void>>();

/** Starts a notice without waiting for it, and logs it if it fails. */
export function sendLater(log: FastifyBaseLogger, what: string, run: () => Promise<void>): void {
  const sending: Promise<void> = run()
    .catch((error: unknown) => log.warn(error, `${what} not sent`))
    .finally(() => inFlight.delete(sending));
  inFlight.add(sending);
}

/** Resolves once every notice started so far has been sent or has failed. For tests and shutdown. */
export async function noticesSettled(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

interface Place {
  projectName: string;
  ownerHandle: string;
  slug: string;
  actorHandle: string;
}

const link = (webOrigin: string, place: Place, ...rest: string[]) =>
  [webOrigin, place.ownerHandle, place.slug, ...rest.map(encodeURIComponent)].join('/');

/** Tells a member their role changed, since it changes what they can do. */
export async function notifyRoleChanged(sql: Sql, mailer: Mailer, webOrigin: string, change: { projectId: string; handle: string; role: string; actorId: string }): Promise<void> {
  const [row] = await sql<(Place & { email: string | null; userId: string })[]>`
    select u.email, m.id as user_id, p.name as project_name, o.handle as owner_handle, p.slug, a.handle as actor_handle
    from profiles m
    join projects p on p.id = ${change.projectId}
    join profiles o on o.id = p.owner_id
    join profiles a on a.id = ${change.actorId}
    left join auth.users u on u.id = m.id
    where m.handle = ${change.handle}
  `;
  if (!row?.email || row.userId === change.actorId) return;
  const role = change.role === 'viewer' ? 'a viewer' : `a ${change.role}`;
  await mailer.send({
    to: row.email,
    subject: `You're now ${role} on ${row.projectName}`,
    text: [`@${row.actorHandle} made you ${role} on ${row.projectName} on GigaCAD.`, '', link(webOrigin, row)].join('\n'),
  });
}

/** Tells someone they were removed from a project. */
export async function notifyMemberRemoved(sql: Sql, mailer: Mailer, webOrigin: string, removed: { projectId: string; handle: string; actorId: string }): Promise<void> {
  const [row] = await sql<(Place & { email: string | null; userId: string })[]>`
    select u.email, m.id as user_id, p.name as project_name, o.handle as owner_handle, p.slug, a.handle as actor_handle
    from profiles m
    join projects p on p.id = ${removed.projectId}
    join profiles o on o.id = p.owner_id
    join profiles a on a.id = ${removed.actorId}
    left join auth.users u on u.id = m.id
    where m.handle = ${removed.handle}
  `;
  if (!row?.email || row.userId === removed.actorId) return;
  await mailer.send({
    to: row.email,
    subject: `@${row.actorHandle} removed you from ${row.projectName}`,
    text: [`@${row.actorHandle} removed you from ${row.projectName} on GigaCAD. It no longer appears on your dashboard.`, '', 'If that looks like a mistake, ask them to add you again.'].join('\n'),
  });
}

/** Tells a deleted project's members, other than the person who deleted it. */
export async function notifyProjectDeleted(sql: Sql, mailer: Mailer, deleted: { projectId: string; actorId: string }): Promise<void> {
  const rows = await sql<(Place & { email: string | null })[]>`
    select u.email, p.name as project_name, o.handle as owner_handle, p.slug, a.handle as actor_handle
    from project_members m
    join projects p on p.id = m.project_id
    join profiles o on o.id = p.owner_id
    join profiles a on a.id = ${deleted.actorId}
    join auth.users u on u.id = m.user_id
    where m.project_id = ${deleted.projectId} and m.user_id <> ${deleted.actorId}
  `;
  await sendAll(
    mailer,
    rows.flatMap((row) =>
      row.email
        ? [{ to: row.email, subject: `@${row.actorHandle} deleted ${row.projectName}`, text: `@${row.actorHandle} deleted ${row.projectName} on GigaCAD. Its owner can restore it, with everything in it, for 30 days.` }]
        : [],
    ),
  );
}

export type RequestNotice = 'candidate' | 'approved' | 'released' | 'closed';

/**
 * Whether this person's approval of the request's current candidate still counts, so approving
 * again isn't news. One given before an export of a candidate file changed no longer does.
 */
export async function approvedAlready(sql: Sql, requestId: string, userId: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from approvals a join release_requests r on r.id = a.release_request_id
    where a.release_request_id = ${requestId} and a.user_id = ${userId} and a.candidate_manifest_id = r.candidate_manifest_id
      and not exists (
        select 1 from file_exports x
        where x.project_id = r.project_id and x.created_at > a.created_at
          and x.source_sha256 in (select me.blob_sha256 from manifest_entries me where me.manifest_id = r.candidate_manifest_id)
      )
  `;
  return Boolean(row);
}

/** A rebuilt candidate within this long of the last one doesn't email the approvers again. */
const CANDIDATE_QUIET_MINUTES = 30;

/**
 * Release request mail. A new candidate tells the people who can approve it; an approval,
 * a release, or a close by someone else tells the requester.
 */
export async function notifyReleaseRequest(sql: Sql, mailer: Mailer, webOrigin: string, notice: { kind: RequestNotice; requestId: string; actorId: string }): Promise<void> {
  const [request] = await sql<
    (Place & { projectId: string; number: number; title: string; requesterId: string | null; requesterEmail: string | null; requesterCanSee: boolean; status: string })[]
  >`
    select r.project_id, r.number, r.title, r.requester_id, r.status, ru.email as requester_email,
      p.name as project_name, o.handle as owner_handle, p.slug, a.handle as actor_handle,
      -- Someone removed from a private project hears nothing more about it.
      (p.visibility = 'public' or exists (select 1 from project_members m where m.project_id = r.project_id and m.user_id = r.requester_id)) as requester_can_see
    from release_requests r
    join projects p on p.id = r.project_id
    join profiles o on o.id = p.owner_id
    join profiles a on a.id = ${notice.actorId}
    left join auth.users ru on ru.id = r.requester_id
    where r.id = ${notice.requestId}
  `;
  if (!request) return;
  const url = link(webOrigin, request, 'release-requests', String(request.number));
  const name = `#${request.number} ${request.title}`;

  if (notice.kind === 'candidate') {
    if (request.status !== 'candidate') return;
    const [recent] = await sql<{ count: number }[]>`
      select count(*)::int as count from project_events
      where project_id = ${request.projectId} and subject_id = ${notice.requestId} and kind = 'release_request_candidate_generated'
        and created_at > now() - make_interval(mins => ${CANDIDATE_QUIET_MINUTES})
    `;
    if ((recent?.count ?? 0) > 1) return;
    const rules = await loadApprovalRules(sql, request.projectId);
    if (rules.requiredCount === 0) return;
    const members = await sql<{ userId: string; role: ProjectRole; email: string | null }[]>`
      select m.user_id, m.role, u.email from project_members m left join auth.users u on u.id = m.user_id
      where m.project_id = ${request.projectId}
    `;
    const messages: MailMessage[] = members.flatMap((member) =>
      member.email && member.userId !== notice.actorId && !approverIneligibility(rules, member.userId, member.role, request.requesterId ?? '')
        ? [
            {
              to: member.email,
              subject: `Review ${name} in ${request.projectName}`,
              text: [`The candidate for ${name} in ${request.projectName} is ready, and you can approve it.`, '', 'Check the files it will release, then approve it or leave it for now.', '', url].join('\n'),
            },
          ]
        : [],
    );
    return sendAll(mailer, messages);
  }

  if (!request.requesterEmail || request.requesterId === notice.actorId || !request.requesterCanSee) return;
  const said: Record<Exclude<RequestNotice, 'candidate'>, { subject: string; line: string }> = {
    approved: { subject: `@${request.actorHandle} approved ${name}`, line: `@${request.actorHandle} approved the candidate for ${name} in ${request.projectName}.` },
    released: { subject: `@${request.actorHandle} released ${name}`, line: `@${request.actorHandle} released ${name} in ${request.projectName}. Its files are now on main.` },
    closed: { subject: `@${request.actorHandle} closed ${name}`, line: `@${request.actorHandle} closed ${name} in ${request.projectName}. The branch is open for work again.` },
  };
  const { subject, line } = said[notice.kind];
  await mailer.send({ to: request.requesterEmail, subject, text: [line, '', url].join('\n') });
}
