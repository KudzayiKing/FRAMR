-- Phase 2: video-analysis worker coordination and lifecycle metadata.
-- `processing` remains the externally visible state. The timestamps below make
-- worker claims observable and allow stale claims to be recovered safely.

alter table public.videos
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_attempts integer not null default 0 check (processing_attempts >= 0),
  add column if not exists processing_error text,
  add column if not exists processed_at timestamptz;

create index if not exists videos_analysis_queue_idx
  on public.videos (created_at)
  where status = 'processing' and processing_started_at is null;

-- Atomically claim one queued (or stale) video. `FOR UPDATE SKIP LOCKED` lets
-- multiple worker processes coexist without analysing the same video twice.
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
    processing_attempts = processing_attempts + 1,
    processing_error = null
  where videos.id = candidate.id
  returning
    videos.id,
    videos.owner_id,
    videos.title,
    videos.duration_seconds,
    videos.width,
    videos.height,
    videos.storage_key,
    videos.processing_attempts
  into id, owner_id, title, duration_seconds, width, height, storage_key, processing_attempts;

  return next;
end;
$$;

revoke all on function public.claim_next_video_for_analysis() from public;
grant execute on function public.claim_next_video_for_analysis() to service_role;
