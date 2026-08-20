-- FRAMR automatic target preparation
-- This migration follows 0008, which is already applied. It keeps manual refinement
-- available but makes a detected placement box sufficient to start automatic SAM work.

do $$ begin
  create type public.placement_target_job_type as enum ('segment_and_track');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.placement_target_job_status as enum ('queued', 'running', 'complete', 'needs_review', 'failed', 'canceled');
exception when duplicate_object then null;
end $$;

create table if not exists public.placement_target_jobs (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.placement_targets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  job_type public.placement_target_job_type not null default 'segment_and_track',
  status public.placement_target_job_status not null default 'queued',
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  worker_id text,
  lease_expires_at timestamptz,
  input_manifest_key text,
  output_manifest_key text,
  metrics jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  unique (target_id, job_type)
);

create index if not exists placement_target_jobs_queue_idx
  on public.placement_target_jobs(created_at)
  where status = 'queued';
create index if not exists placement_target_jobs_lease_idx
  on public.placement_target_jobs(lease_expires_at)
  where status = 'running';

-- The browser-authenticated target route writes seed metadata. Service-role
-- workers write automated frame masks. Both paths remain owner-scoped.
drop policy if exists placement_masks_insert_own on public.placement_masks;
drop policy if exists placement_masks_update_own on public.placement_masks;
create policy placement_masks_insert_own on public.placement_masks
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy placement_masks_update_own on public.placement_masks
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

alter table public.placement_target_jobs enable row level security;
drop policy if exists placement_target_jobs_select_own on public.placement_target_jobs;
drop policy if exists placement_target_jobs_insert_own on public.placement_target_jobs;
drop policy if exists placement_target_jobs_update_own on public.placement_target_jobs;
create policy placement_target_jobs_select_own on public.placement_target_jobs
  for select using (owner_id = auth.uid());
create policy placement_target_jobs_insert_own on public.placement_target_jobs
  for insert with check (owner_id = auth.uid());
create policy placement_target_jobs_update_own on public.placement_target_jobs
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- A service-role worker atomically leases an independent target job before a
-- product is selected. A stale lease is safe to reclaim after its expiry.
create or replace function public.claim_next_placement_target_job(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table (
  id uuid,
  target_id uuid,
  owner_id uuid,
  job_type public.placement_target_job_type,
  attempt integer,
  placement_id uuid,
  source_video_id uuid,
  source_storage_key text,
  frame_rate real,
  frame_count integer,
  seed_frame integer,
  start_frame integer,
  end_frame integer,
  seed_bbox jsonb,
  seed_mask_key text,
  manual_revision integer,
  tracking_provider text,
  tracking_model text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.placement_target_jobs%rowtype;
begin
  select job.* into candidate
  from public.placement_target_jobs job
  join public.placement_targets target on target.id = job.target_id
  where target.status in ('draft', 'tracking', 'needs_review')
    and (
      job.status = 'queued'
      or (job.status = 'running' and job.lease_expires_at < now())
    )
    and job.attempt < job.max_attempts
  order by job.created_at asc
  for update of job skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.placement_target_jobs job
  set
    status = 'running',
    attempt = job.attempt + 1,
    worker_id = p_worker_id,
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    started_at = coalesce(job.started_at, now()),
    error = null
  where job.id = candidate.id;

  update public.placement_targets target
  set status = 'tracking', updated_at = now()
  where target.id = candidate.target_id
    and target.status in ('draft', 'needs_review');

  return query
  select
    candidate.id,
    target.id,
    target.owner_id,
    candidate.job_type,
    candidate.attempt + 1,
    target.placement_id,
    placement.video_id,
    video.storage_key,
    video.frame_rate::real,
    video.frame_count,
    target.seed_frame,
    target.start_frame,
    target.end_frame,
    target.seed_bbox,
    target.seed_mask_key,
    target.manual_revision,
    coalesce(target.tracking_provider, 'sam2'),
    coalesce(target.tracking_model, 'sam2.1-hiera-tiny')
  from public.placement_targets target
  join public.placements placement on placement.id = target.placement_id
  join public.videos video on video.id = placement.video_id
  where target.id = candidate.target_id;
end;
$$;

revoke all on function public.claim_next_placement_target_job(text, integer) from public;
grant execute on function public.claim_next_placement_target_job(text, integer) to service_role;

-- Workspace status updates are event-driven as well as reload-safe.
do $$ begin
  alter publication supabase_realtime add table public.placement_targets;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.placement_target_jobs;
exception when duplicate_object then null;
end $$;
