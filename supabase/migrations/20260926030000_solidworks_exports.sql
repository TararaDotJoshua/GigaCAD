-- SolidWorks files get thumbnails from the preview picture saved inside them, and can carry
-- STEP and STL exports (made by the SolidWorks add-in, or uploaded by hand). An export
-- becomes the file's 3D preview and replaces its thumbnail.

alter table thumbnails drop constraint thumbnails_format_check;
alter table thumbnails add constraint thumbnails_format_check
  check (format in ('stl', 'obj', '3mf', 'step', 'iges', 'solidworks'));

-- When set, the thumbnail is drawn from this export instead of the file itself.
alter table thumbnails
  add column model_sha256 text references blobs (sha256) on delete set null,
  add column model_format text check (model_format in ('stl', 'step'));

create or replace function thumbnail_format(path text) returns text
language sql immutable as $$
  select case
    when path ~* '\.stl$' then 'stl'
    when path ~* '\.obj$' then 'obj'
    when path ~* '\.3mf$' then '3mf'
    when path ~* '\.(step|stp)$' then 'step'
    when path ~* '\.(iges|igs)$' then 'iges'
    when path ~* '\.(sldprt|sldasm|slddrw)$' then 'solidworks'
  end
$$;

-- SolidWorks files committed before now.
insert into thumbnails (blob_sha256, format)
select distinct on (blob_sha256) blob_sha256, 'solidworks'
from manifest_entries where path ~* '\.(sldprt|sldasm|slddrw)$'
order by blob_sha256
on conflict (blob_sha256) do nothing;

-- Exports belong to a project, like the files they're made from: both are that project's
-- stored files, count toward its owner's storage, and go when the source file does.
create table file_exports (
  project_id uuid not null,
  source_sha256 text not null,
  format text not null check (format in ('stl', 'step')),
  blob_sha256 text not null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, source_sha256, format),
  foreign key (project_id, source_sha256) references project_blobs (project_id, sha256) on delete cascade,
  foreign key (project_id, blob_sha256) references project_blobs (project_id, sha256) on delete cascade
);
create index file_exports_blob_idx on file_exports (project_id, blob_sha256);
alter table file_exports enable row level security;
-- file_exports: API only.
