-- Fix Phase 2 worker queue claim: `processing_attempts` is also an OUT
-- parameter, so qualify the table column in the UPDATE expression.
create or replace function public.claim_next_video_for_analysis()
returns table (
  id uuid,
  owner_id uuid,
  title text,
  duration_seconds numeric,
  width integer,
  height integer,
  storage_key text,
  processing_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.videos%rowtype;
begin
  select * into candidate
  from public.videos
  where status = 'processing'
    and (
      processing_started_at is null
      or processing_started_at < now() - interval '30 minutes'
    )
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.videos
  set
    processing_started_at = now(),
    processing_attempts = public.videos.processing_attempts + 1,
    processing_error = null
  where public.videos.id = candidate.id
  returning
    public.videos.id,
    public.videos.owner_id,
    public.videos.title,
    public.videos.duration_seconds,
    public.videos.width,
    public.videos.height,
    public.videos.storage_key,
    public.videos.processing_attempts
  into id, owner_id, title, duration_seconds, width, height, storage_key, processing_attempts;

  return next;
end;
$$;

revoke all on function public.claim_next_video_for_analysis() from public;
grant execute on function public.claim_next_video_for_analysis() to service_role;
