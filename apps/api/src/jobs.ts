import type { Sql } from './db.js';
import type { Mailer } from './mail.js';
import { blobKey, stagingKey, type BlobStorage } from './storage.js';

/**
 * Background upkeep, run on a timer by the API (see server.ts). Every job is safe to run
 * again, and at most a batch of rows is handled per run so no pass holds locks for long.
 */

export interface JobOptions {
  /** How long an uploaded file may sit unused before it stops counting. Uploads are committed right after they finish. */
  readonly graceHours?: number;
  /** How long a deleted project waits before it's removed for good (the terms promise 30 days). */
  readonly purgeAfterDays?: number;
  /** How long a checkout may sit without a commit before its holder gets a reminder. */
  readonly staleCheckoutDays?: number;
  readonly batch?: number;
}

const DEFAULTS = { graceHours: 24, purgeAfterDays: 30, staleCheckoutDays: 7, batch: 500 };

export interface JobReport {
  purgedProjects: number;
  unlinkedBlobs: number;
  deletedBlobs: number;
  clearedUploads: number;
  staleNotices: number;
}

/**
 * Removes projects deleted longer than the grace period, with all their history. Releases
 * are otherwise permanently locked; `gigacad.purge` is the one switch that lets them go.
 */
export async function purgeDeletedProjects(sql: Sql, options: JobOptions = {}): Promise<number> {
  const { purgeAfterDays, batch } = { ...DEFAULTS, ...options };
  const due = await sql<{ id: string }[]>`
    select id from projects
    where deleted_at is not null and deleted_at < now() - make_interval(days => ${purgeAfterDays})
    order by deleted_at limit ${batch}
  `;
  for (const { id } of due) {
    // Postgres checks foreign keys after each cascaded table, so the history is removed
    // explicitly, children before the rows they point at.
    await sql.begin(async (tx) => {
      await tx`select set_config('gigacad.purge', 'on', true)`;
      await tx`update branches set head_commit_id = null, base_release_id = null where project_id = ${id}`;
      await tx`delete from approvals where release_request_id in (select id from release_requests where project_id = ${id})`;
      await tx`
        update release_requests
        set target_release_id = null, candidate_manifest_id = null, rebuild_manifest_id = null, released_release_id = null
        where project_id = ${id}
      `;
      await tx`delete from releases where project_id = ${id}`;
      await tx`delete from release_requests where project_id = ${id}`;
      await tx`delete from commits where branch_id in (select id from branches where project_id = ${id})`;
      await tx`delete from branches where project_id = ${id}`;
      await tx`delete from manifest_entries where manifest_id in (select id from manifests where project_id = ${id})`;
      await tx`delete from manifests where project_id = ${id}`;
      await tx`delete from projects where id = ${id}`;
    });
  }
  return due.length;
}

/**
 * Stops counting (and storing) file versions nothing uses anymore, like autosaves pruned
 * by a version commit or a release. A file stays while any manifest in its project uses it.
 */
export async function unlinkUnusedBlobs(sql: Sql, options: JobOptions = {}): Promise<number> {
  const { graceHours, batch } = { ...DEFAULTS, ...options };
  const unlinked = await sql`
    with unused as (
      select pb.project_id, pb.sha256 from project_blobs pb
      where pb.created_at < now() - make_interval(hours => ${graceHours})
        and not exists (
          select 1 from manifest_entries me join manifests m on m.id = me.manifest_id
          where m.project_id = pb.project_id and me.blob_sha256 = pb.sha256
        )
      limit ${batch}
    ),
    refs as (
      delete from blob_references r using unused u where r.project_id = u.project_id and r.sha256 = u.sha256
    )
    delete from project_blobs pb using unused u where pb.project_id = u.project_id and pb.sha256 = u.sha256
    returning pb.sha256
  `;
  return unlinked.length;
}

/** Deletes stored file contents no project links to anymore, from storage and the database. */
export async function deleteOrphanBlobs(sql: Sql, storage: BlobStorage, options: JobOptions = {}): Promise<number> {
  const { graceHours, batch } = { ...DEFAULTS, ...options };
  // An upload in progress keeps its hash alive, so a finishing upload never loses its object.
  const orphans = await sql<{ sha256: string }[]>`
    delete from blobs b
    where b.sha256 in (
      select b2.sha256 from blobs b2
      where b2.created_at < now() - make_interval(hours => ${graceHours})
        and not exists (select 1 from project_blobs pb where pb.sha256 = b2.sha256)
        and not exists (select 1 from manifest_entries me where me.blob_sha256 = b2.sha256)
        and not exists (select 1 from blob_references r where r.sha256 = b2.sha256)
        and not exists (select 1 from blob_uploads u where u.sha256 = b2.sha256)
      limit ${batch}
    )
    returning b.sha256
  `;
  for (const { sha256 } of orphans) await storage.remove(blobKey(sha256));
  return orphans.length;
}

/** Clears uploads that were started but never completed, and their staged bytes. */
export async function clearAbandonedUploads(sql: Sql, storage: BlobStorage, options: JobOptions = {}): Promise<number> {
  const { graceHours, batch } = { ...DEFAULTS, ...options };
  const abandoned = await sql<{ id: string }[]>`
    delete from blob_uploads where id in (
      select id from blob_uploads where created_at < now() - make_interval(hours => ${graceHours}) order by created_at limit ${batch}
    )
    returning id
  `;
  for (const { id } of abandoned) await storage.remove(stagingKey(id));
  return abandoned.length;
}

/**
 * Reminds whoever holds a checkout that nobody has committed to for a while. Each checkout
 * gets one reminder; checking out again starts over.
 */
export async function notifyStaleCheckouts(sql: Sql, mailer: Mailer, webOrigin: string, options: JobOptions = {}): Promise<number> {
  const { staleCheckoutDays, batch } = { ...DEFAULTS, ...options };
  const stale = await sql<{ branchId: string; branchName: string; ownerHandle: string; slug: string; projectName: string; email: string | null; days: number }[]>`
    select b.id as branch_id, b.name as branch_name, o.handle as owner_handle, p.slug, p.name as project_name,
      u.email, floor(extract(epoch from now() - b.checked_out_at) / 86400)::int as days
    from branches b
    join projects p on p.id = b.project_id and p.deleted_at is null
    join profiles o on o.id = p.owner_id
    join auth.users u on u.id = b.checked_out_by
    where b.checked_out_at < now() - make_interval(days => ${staleCheckoutDays})
      and b.stale_notice_for is distinct from b.checked_out_at
      and not exists (
        select 1 from commits c where c.branch_id = b.id and c.created_at > now() - make_interval(days => ${staleCheckoutDays})
      )
    limit ${batch}
  `;
  let sent = 0;
  for (const branch of stale) {
    // Claim the notice first, so two runs never both send it.
    const [claimed] = await sql`
      update branches set stale_notice_for = checked_out_at
      where id = ${branch.branchId} and checked_out_at is not null and stale_notice_for is distinct from checked_out_at
      returning id
    `;
    if (!claimed || !branch.email) continue;
    const url = `${webOrigin}/${branch.ownerHandle}/${branch.slug}/branches/${encodeURIComponent(branch.branchName)}`;
    await mailer.send({
      to: branch.email,
      subject: `${branch.branchName} in ${branch.projectName} is still checked out`,
      text: [
        `You checked out ${branch.branchName} in ${branch.projectName} ${branch.days} days ago, and nothing has been committed to it since.`,
        '',
        'While you hold the checkout, nobody else can change the branch. If you are done, check it in. If you are still working, commit a version so your changes are safe.',
        '',
        url,
      ].join('\n'),
    });
    sent++;
  }
  return sent;
}

/** One pass of every job. Holds an advisory lock so two API instances never run at once. */
export async function runJobs(deps: { sql: Sql; storage: BlobStorage; mailer?: Mailer; webOrigin: string }, options: JobOptions = {}): Promise<JobReport | null> {
  const { sql } = deps;
  const reserved = await sql.reserve();
  try {
    const [lock] = await reserved<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext('gigacad.jobs')) as locked`;
    if (!lock?.locked) return null;
    try {
      const purgedProjects = await purgeDeletedProjects(sql, options);
      const unlinkedBlobs = await unlinkUnusedBlobs(sql, options);
      const deletedBlobs = await deleteOrphanBlobs(sql, deps.storage, options);
      const clearedUploads = await clearAbandonedUploads(sql, deps.storage, options);
      const staleNotices = deps.mailer ? await notifyStaleCheckouts(sql, deps.mailer, deps.webOrigin, options) : 0;
      return { purgedProjects, unlinkedBlobs, deletedBlobs, clearedUploads, staleNotices };
    } finally {
      await reserved`select pg_advisory_unlock(hashtext('gigacad.jobs'))`;
    }
  } finally {
    reserved.release();
  }
}
