-- Phase 0: provider job bookkeeping and private Supabase Storage buckets.
-- All object paths must start with the authenticated user's UUID.

alter table public.generation_jobs
  add column if not exists provider_job_id text,
  add column if not exists prompt text,
  add column if not exists attempts integer not null default 0 check (attempts >= 0);

create index if not exists generation_jobs_provider_job_id_idx
  on public.generation_jobs (provider_job_id)
  where provider_job_id is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('videos', 'videos', false, 524288000, array['video/mp4', 'video/quicktime']::text[]),
  ('generated', 'generated', false, 524288000, array['video/mp4']::text[]),
  ('products', 'products', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']::text[]),
  ('thumbnails', 'thumbnails', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS is intentionally path-based rather than trusting client-supplied metadata.
-- A user's UUID must be the first folder in every private bucket object key.
do $$
declare
  bucket_name text;
begin
  foreach bucket_name in array array['videos', 'generated', 'products', 'thumbnails']
  loop
    execute format('drop policy if exists %I on storage.objects', bucket_name || '_select_own');
    execute format('drop policy if exists %I on storage.objects', bucket_name || '_insert_own');
    execute format('drop policy if exists %I on storage.objects', bucket_name || '_delete_own');

    execute format(
      'create policy %I on storage.objects for select to authenticated using (bucket_id = %L and (storage.foldername(name))[1] = (select auth.uid()::text))',
      bucket_name || '_select_own', bucket_name
    );
    execute format(
      'create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and (storage.foldername(name))[1] = (select auth.uid()::text))',
      bucket_name || '_insert_own', bucket_name
    );
    execute format(
      'create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and (storage.foldername(name))[1] = (select auth.uid()::text))',
      bucket_name || '_delete_own', bucket_name
    );
  end loop;
end
$$;
