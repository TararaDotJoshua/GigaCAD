-- A SolidWorks file's thumbnail used to be drawn from an export written onto the file's one
-- global thumbnails row, keyed by its content. Any project holding the same bytes (a fork, or
-- an outsider who downloaded a public part) could set an export and replace the thumbnail and
-- Explore cover every other project shows for that file.
--
-- Now an export is drawn as its own file, under its own content hash, and a project shows the
-- image of its own export: its STL, then its STEP, then the preview picture inside the file.

-- Every export gets a thumbnail of its own content, like any STL or STEP file.
insert into thumbnails (blob_sha256, format)
select distinct on (blob_sha256) blob_sha256, format from file_exports
order by blob_sha256, format
on conflict (blob_sha256) do nothing;

-- Files drawn from an export go back to the preview picture saved inside them. The API no
-- longer reads or writes model_sha256 and model_format; they stay until a later migration so
-- the API running when this is applied keeps working.
update thumbnails set model_sha256 = null, model_format = null, status = 'pending', attempts = 0, error = null, updated_at = now()
where model_sha256 is not null;

-- The thumbnail that stands for a file in a project, if one is ready: the project's own STL
-- export of it, then its STEP export, then the file's own thumbnail.
create function file_thumbnail(project uuid, source text) returns text
language sql stable set search_path = public as $$
  select c.sha256 from (
    select x.blob_sha256 as sha256, case x.format when 'stl' then 0 else 1 end as rank
    from file_exports x where x.project_id = project and x.source_sha256 = source
    union all
    select source, 2
  ) c
  join thumbnails t on t.blob_sha256 = c.sha256 and t.status = 'ready'
  order by c.rank
  limit 1
$$;
revoke execute on function file_thumbnail(uuid, text) from public, anon, authenticated;

-- A project's cover: the largest file with a thumbnail in its latest release, or in its
-- most recent commit before it has a release. Returns the hash of the image to show.
create or replace function project_thumbnail(project uuid) returns text
language sql stable set search_path = public as $$
  select shown.sha256
  from manifest_entries me
  join blobs b on b.sha256 = me.blob_sha256
  cross join lateral (select file_thumbnail(project, me.blob_sha256) as sha256) shown
  where me.manifest_id = coalesce(
    (select manifest_id from releases where project_id = project order by number desc limit 1),
    (select c.manifest_id from commits c join branches br on br.id = c.branch_id
      where br.project_id = project order by c.created_at desc limit 1)
  )
  and shown.sha256 is not null
  order by b.size desc, me.path
  limit 1
$$;
