import { approverIneligibility, type ProjectRole } from '@gigacad/core';
import type { Sql } from '../db.js';
import type { Mailer } from '../mail.js';
import { loadApprovalRules } from './projects.js';

/**
 * Short emails telling people about changes someone else made to their work or access:
 * a lock taken back, being removed from a project, a project deleted, and a release request
 * moving on. They're sent after the change commits, and a mail failure never undoes it.
 */

interface Place {
  projectName: string;
  ownerHandle: string;
  slug: string;
  actorHandle: string;
}

const link = (webOrigin: string, place: Place, ...rest: string[]) =>
  [webOrigin, place.ownerHandle, place.slug, ...rest.map(encodeURIComponent)].join('/');

/** Tells the person whose lock a maintainer force-released. */
export async function notifyLockForceReleased(sql: Sql, mailer: Mailer, webOrigin: string, released: { branchId: string; holderId: string; actorId: string }): Promise<void> {
  if (released.holderId === released.actorId) return;
  const [row] = await sql<(Place & { email: string | null; branchName: string })[]>`
    select u.email, b.name as branch_name, p.name as project_name, o.handle as owner_handle, p.slug, a.handle as actor_handle
    from branches b
    join projects p on p.id = b.project_id
    join profiles o on o.id = p.owner_id
    join profiles a on a.id = ${released.actorId}
    left join auth.users u on u.id = ${released.holderId}
    where b.id = ${released.branchId}
  `;
  if (!row?.email) return;
  await mailer.send({
    to: row.email,
    subject: `@${row.actorHandle} took back your lock on ${row.branchName}`,
    text: [
      `@${row.actorHandle} force-released your checkout of ${row.branchName} in ${row.projectName}, so you can't save to it until you check it out again.`,
      '',
      'Your autosaves and versions are still on the branch. Check it out again to keep working.',
      '',
      link(webOrigin, row, 'branches', row.branchName),
    ].join('\n'),
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
  for (const row of rows) {
    if (!row.email) continue;
    await mailer.send({
      to: row.email,
      subject: `@${row.actorHandle} deleted ${row.projectName}`,
      text: [`@${row.actorHandle} deleted ${row.projectName} on GigaCAD. Its owner can restore it, with everything in it, for 30 days.`].join('\n'),
    });
  }
}

export type RequestNotice = 'candidate' | 'approved' | 'released' | 'closed';

/** A rebuilt candidate within this long of the last one doesn't email the approvers again. */
const CANDIDATE_QUIET_MINUTES = 30;

/**
 * Release request mail. A new candidate tells the people who can approve it; an approval,
 * a release, or a close by someone else tells the requester.
 */
export async function notifyReleaseRequest(sql: Sql, mailer: Mailer, webOrigin: string, notice: { kind: RequestNotice; requestId: string; actorId: string }): Promise<void> {
  const [request] = await sql<(Place & { projectId: string; number: number; title: string; requesterId: string | null; requesterEmail: string | null; status: string })[]>`
    select r.project_id, r.number, r.title, r.requester_id, r.status, ru.email as requester_email,
      p.name as project_name, o.handle as owner_handle, p.slug, a.handle as actor_handle
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
      where subject_id = ${notice.requestId} and kind = 'release_request_candidate_generated'
        and created_at > now() - make_interval(mins => ${CANDIDATE_QUIET_MINUTES})
    `;
    if ((recent?.count ?? 0) > 1) return;
    const rules = await loadApprovalRules(sql, request.projectId);
    if (rules.requiredCount === 0) return;
    const members = await sql<{ userId: string; role: ProjectRole; email: string | null }[]>`
      select m.user_id, m.role, u.email from project_members m left join auth.users u on u.id = m.user_id
      where m.project_id = ${request.projectId}
    `;
    for (const member of members) {
      if (!member.email || member.userId === notice.actorId) continue;
      if (approverIneligibility(rules, member.userId, member.role, request.requesterId ?? '')) continue;
      await mailer.send({
        to: member.email,
        subject: `Review ${name} in ${request.projectName}`,
        text: [`The candidate for ${name} in ${request.projectName} is ready, and you can approve it.`, '', 'Check the files it will release, then approve it or leave it for now.', '', url].join('\n'),
      });
    }
    return;
  }

  if (!request.requesterEmail || request.requesterId === notice.actorId) return;
  const said: Record<Exclude<RequestNotice, 'candidate'>, { subject: string; line: string }> = {
    approved: { subject: `@${request.actorHandle} approved ${name}`, line: `@${request.actorHandle} approved the candidate for ${name} in ${request.projectName}.` },
    released: { subject: `@${request.actorHandle} released ${name}`, line: `@${request.actorHandle} released ${name} in ${request.projectName}. Its files are now on main.` },
    closed: { subject: `@${request.actorHandle} closed ${name}`, line: `@${request.actorHandle} closed ${name} in ${request.projectName}. The branch is open for work again.` },
  };
  const { subject, line } = said[notice.kind];
  await mailer.send({ to: request.requesterEmail, subject, text: [line, '', url].join('\n') });
}
