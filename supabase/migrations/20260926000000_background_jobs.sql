-- Background jobs: storage cleanup, the 30-day purge of deleted projects, and stale
-- checkout notices.

-- Which checkout a stale notice was sent for, so each checkout gets one notice.
alter table branches add column stale_notice_for timestamptz;

create index blob_uploads_created_idx on blob_uploads (created_at);
create index blob_uploads_sha256_idx on blob_uploads (sha256);
create index projects_deleted_idx on projects (deleted_at) where deleted_at is not null;
