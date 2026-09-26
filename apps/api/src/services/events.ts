import type postgres from 'postgres';
import type { Db } from '../db.js';

export type EventKind =
  | 'project_created'
  | 'project_updated'
  | 'project_deleted'
  | 'project_restored'
  | 'member_changed'
  | 'approval_rules_changed'
  | 'branch_created'
  | 'branch_checked_out'
  | 'branch_checked_in'
  | 'branch_lock_force_released'
  | 'branch_archived'
  | 'commit_created'
  | 'release_request_opened'
  | 'release_request_picks_changed'
  | 'release_request_candidate_generated'
  | 'release_request_candidate_updated'
  | 'release_request_rebuild_reported'
  | 'release_request_approved'
  | 'release_request_approval_withdrawn'
  | 'release_request_closed'
  | 'release_created'
  | 'directory_entry_created'
  | 'directory_entry_moved'
  | 'directory_entry_deleted'
  | 'root_file_replaced'
  | 'tag_created'
  | 'tag_renamed'
  | 'tag_deleted'
  | 'file_tags_changed';

/**
 * Every state change writes an event in the same transaction. The table is the
 * audit log, the drive clients' change feed, and the Supabase Realtime stream.
 */
export async function recordEvent(
  db: Db,
  event: {
    projectId: string;
    actorId: string | null;
    kind: EventKind;
    subjectId?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db`
    insert into project_events (project_id, actor_id, kind, subject_id, payload)
    values (
      ${event.projectId}, ${event.actorId}, ${event.kind}, ${event.subjectId ?? null},
      ${db.json((event.payload ?? {}) as postgres.JSONValue)}
    )
  `;
}
