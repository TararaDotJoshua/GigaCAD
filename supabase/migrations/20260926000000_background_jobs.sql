-- Background jobs: storage cleanup, the 30-day purge of deleted projects, and stale
-- checkout notices.

-- A purge deletes a whole project in one statement. RESTRICT is checked row by row, so
-- a cascading delete could remove a release's manifest before the release itself and
-- fail. NO ACTION is checked at the end of the statement, so it still stops a released
-- manifest from being deleted on its own but lets a project go as a whole.
alter table releases drop constraint releases_manifest_id_fkey;
alter table releases add constraint releases_manifest_id_fkey
  foreign key (manifest_id) references manifests (id);

-- Which checkout a stale notice was sent for, so each checkout gets one notice.
alter table branches add column stale_notice_for timestamptz;

create index blob_uploads_created_idx on blob_uploads (created_at);
create index blob_uploads_sha256_idx on blob_uploads (sha256);
create index projects_deleted_idx on projects (deleted_at) where deleted_at is not null;
