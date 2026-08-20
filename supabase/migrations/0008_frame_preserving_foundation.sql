-- Frame-preserving placement foundation.
-- This migration is additive: legacy Lucy jobs and completed versions remain readable.
-- New primary work is represented by placement_runs and explicit durable stages.

create extension if not exists "pgcrypto";

-- Source frame metadata makes every target range and artifact deterministic.
alter table public.videos
  add column if not exists frame_rate numeric(10,4),
  add column if not exists frame_count integer,
  add column if not exists has_audio boolean;

-- Keep schema evolution flexible while preserving strict statuses for the durable queue.
do $$ begin
  create type public.placement_run_status as enum ('queued', 'running', 'needs_review', 'ready', 'failed', 'canceled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.placement_job_status as enum ('queued', 'running', 'complete', 'failed', 'canceled', 'blocked');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.placement_job_type as enum (
    'prepare_source',
    'segment_target',
    'track_target',
    'select_keyframes',
    'edit_keyframes',
    'propagate_frames',
    'composite_frames',
    'quality_check',
    'render_video'
  );
exception when duplicate_object then null;
end $$;

-- A product may have multiple views. The existing products.image_key stays the
-- backwards-compatible primary reference until the product UI is expanded.
create table if not exists public.product_references (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_key text not null,
  view_type text not null default 'primary' check (view_type in ('primary', 'front', 'side', 'rear', 'transparent', 'packaging', 'detail', 'other')),
  sort_order smallint not null default 0 check (sort_order >= 0),
  width integer,
  height integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (product_id, storage_key)
);
create index if not exists product_references_product_idx on public.product_references(product_id, sort_order, created_at);

-- Backfill every existing verified product image as its primary reference. Future
-- multi-view upload UI can add references without changing the worker contract.
insert into public.product_references (product_id, owner_id, storage_key, view_type, sort_order)
select product.id, product.owner_id, product.image_key, 'primary', 0
from public.products product
where product.image_key is not null
  and product.image_key like 'products/%'
on conflict (product_id, storage_key) do nothing;

-- A placement target is the creator-approved object/time span. Masks are stored
-- as private artifacts rather than large Postgres blobs.
create table if not exists public.placement_targets (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.placements(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  start_frame integer not null check (start_frame >= 0),
  end_frame integer not null check (end_frame >= start_frame),
  seed_frame integer not null check (seed_frame >= 0),
  seed_bbox jsonb,
  seed_mask_key text,
  manual_revision integer not null default 0 check (manual_revision >= 0),
  tracking_provider text,
  tracking_model text,
  status text not null default 'draft' check (status in ('draft', 'tracking', 'ready', 'needs_review', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists placement_targets_placement_idx on public.placement_targets(placement_id, created_at desc);

create table if not exists public.placement_masks (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.placement_targets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  frame_index integer not null check (frame_index >= 0),
  kind text not null check (kind in ('target', 'foreground', 'occluder', 'adjustment')),
  storage_key text not null,
  bbox jsonb,
  confidence real,
  is_occluded boolean not null default false,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  unique (target_id, frame_index, kind, revision)
);
create index if not exists placement_masks_target_frame_idx on public.placement_masks(target_id, frame_index);

-- A run is immutable configuration for one commercial layer. Provider/model are
-- recorded here and must be honored by workers; workers may not substitute an
-- environment default silently.
create table if not exists public.placement_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  placement_id uuid not null references public.placements(id) on delete cascade,
  target_id uuid references public.placement_targets(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  source_video_id uuid not null references public.videos(id) on delete restrict,
  version_id uuid references public.placement_versions(id) on delete set null unique,
  pipeline_version text not null default 'frame-preserving-v1',
  segmentation_provider text not null default 'dev-mask',
  segmentation_model text not null default 'dev-mask-v1',
  image_editor_provider text not null default 'dev-localized-editor',
  image_editor_model text not null default 'source-preserving-v1',
  propagation_provider text not null default 'dev-propagation',
  propagation_model text not null default 'identity-v1',
  idempotency_key text not null,
  settings jsonb not null default '{}'::jsonb,
  status public.placement_run_status not null default 'queued',
  current_stage public.placement_job_type not null default 'prepare_source',
  progress numeric(5,2) not null default 0 check (progress >= 0 and progress <= 100),
  error text,
  quality_summary jsonb not null default '{}'::jsonb,
  estimated_cost_cents integer,
  actual_cost_cents integer,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  canceled_at timestamptz,
  unique (owner_id, idempotency_key)
);
create index if not exists placement_runs_owner_created_idx on public.placement_runs(owner_id, created_at desc);
create unique index if not exists placement_runs_one_active_product_idx
  on public.placement_runs(owner_id, placement_id, product_id)
  where status in ('queued', 'running');

alter table public.placement_versions
  add column if not exists placement_run_id uuid references public.placement_runs(id) on delete set null,
  add column if not exists pipeline_version text,
  add column if not exists quality_summary jsonb not null default '{}'::jsonb,
  add column if not exists review_status text not null default 'not_required' check (review_status in ('not_required', 'pending', 'approved', 'needs_review', 'rejected'));
create unique index if not exists placement_versions_run_idx on public.placement_versions(placement_run_id) where placement_run_id is not null;

-- A run advances through one leased stage at a time. Input/output manifests are
-- private artifact keys and make retries auditable and resumable.
create table if not exists public.placement_job_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.placement_runs(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  job_type public.placement_job_type not null,
  status public.placement_job_status not null default 'queued',
  sequence smallint not null check (sequence >= 0),
  progress numeric(5,2) not null default 0 check (progress >= 0 and progress <= 100),
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
  unique (run_id, job_type)
);
create index if not exists placement_job_steps_queue_idx
  on public.placement_job_steps(sequence, created_at)
  where status = 'queued';
create index if not exists placement_job_steps_lease_idx
  on public.placement_job_steps(lease_expires_at)
  where status = 'running';

create table if not exists public.placement_keyframes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.placement_runs(id) on delete cascade,
  target_id uuid references public.placement_targets(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  frame_index integer not null check (frame_index >= 0),
  reason text not null,
  importance_score real,
  source_crop_key text,
  mask_key text,
  generated_crop_key text,
  composite_key text,
  status text not null default 'pending' check (status in ('pending', 'editing', 'ready', 'failed', 'rejected')),
  provider text,
  model text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, frame_index)
);
create index if not exists placement_keyframes_run_idx on public.placement_keyframes(run_id, frame_index);

create table if not exists public.generated_frame_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.placement_runs(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  frame_index integer,
  stage text not null check (stage in ('source_frame', 'source_crop', 'mask', 'generated_crop', 'propagated_crop', 'composite', 'manifest')),
  storage_key text not null,
  parent_storage_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, frame_index, stage, storage_key)
);
create index if not exists generated_frame_artifacts_run_idx on public.generated_frame_artifacts(run_id, frame_index);

create table if not exists public.quality_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.placement_runs(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  frame_start integer,
  frame_end integer,
  metric text not null check (metric in ('scene_preservation', 'product_identity', 'mask_quality', 'temporal_stability', 'edge_quality', 'occlusion_quality', 'render_integrity')),
  score numeric(6,3),
  threshold numeric(6,3),
  result text not null check (result in ('pass', 'warn', 'fail', 'not_run')),
  evidence_key text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quality_checks_run_idx on public.quality_checks(run_id, metric);

-- Explicitly mark old whole-video jobs for auditability without changing their behavior.
alter table public.generation_jobs
  add column if not exists generation_path text not null default 'legacy_whole_video';

-- A service-role worker atomically claims either a queued stage or a stale lease.
create or replace function public.claim_next_placement_job(p_worker_id text, p_lease_seconds integer default 300)
returns table (
  id uuid,
  run_id uuid,
  owner_id uuid,
  job_type public.placement_job_type,
  sequence smallint,
  attempt integer,
  input_manifest_key text,
  run_settings jsonb,
  source_video_id uuid,
  placement_id uuid,
  target_id uuid,
  product_id uuid,
  segmentation_provider text,
  segmentation_model text,
  image_editor_provider text,
  image_editor_model text,
  propagation_provider text,
  propagation_model text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.placement_job_steps%rowtype;
begin
  select step.* into candidate
  from public.placement_job_steps step
  join public.placement_runs run on run.id = step.run_id
  where run.status in ('queued', 'running')
    and (
      step.status = 'queued'
      or (step.status = 'running' and step.lease_expires_at < now())
    )
    and not exists (
      select 1
      from public.placement_job_steps previous
      where previous.run_id = step.run_id
        and previous.sequence < step.sequence
        and previous.status not in ('complete', 'canceled')
    )
    and step.attempt < step.max_attempts
  order by step.sequence asc, step.created_at asc
  for update of step skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.placement_job_steps step
  set
    status = 'running',
    attempt = step.attempt + 1,
    worker_id = p_worker_id,
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    started_at = coalesce(step.started_at, now()),
    error = null
  where step.id = candidate.id;

  update public.placement_runs run
  set status = 'running', started_at = coalesce(run.started_at, now()), current_stage = candidate.job_type
  where run.id = candidate.run_id and run.status = 'queued';

  return query
  select
    candidate.id,
    run.id,
    run.owner_id,
    candidate.job_type,
    candidate.sequence,
    candidate.attempt + 1,
    candidate.input_manifest_key,
    run.settings,
    run.source_video_id,
    run.placement_id,
    run.target_id,
    run.product_id,
    run.segmentation_provider,
    run.segmentation_model,
    run.image_editor_provider,
    run.image_editor_model,
    run.propagation_provider,
    run.propagation_model
  from public.placement_runs run
  where run.id = candidate.run_id;
end;
$$;
revoke all on function public.claim_next_placement_job(text, integer) from public;
grant execute on function public.claim_next_placement_job(text, integer) to service_role;

-- Private mixed-media artifacts. Browser access remains owner-scoped and workers
-- use the service role; no bucket is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artifacts', 'artifacts', false, 524288000, null)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists artifacts_select_own on storage.objects;
drop policy if exists artifacts_insert_own on storage.objects;
drop policy if exists artifacts_delete_own on storage.objects;
create policy artifacts_select_own on storage.objects for select to authenticated
  using (bucket_id = 'artifacts' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy artifacts_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'artifacts' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy artifacts_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'artifacts' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- RLS keeps every new record scoped to the originating creator. Worker writes
-- bypass RLS through the existing service-role key; browsers get read-only job
-- visibility plus controlled run/target creation through authenticated routes.
alter table public.product_references enable row level security;
alter table public.placement_targets enable row level security;
alter table public.placement_masks enable row level security;
alter table public.placement_runs enable row level security;
alter table public.placement_job_steps enable row level security;
alter table public.placement_keyframes enable row level security;
alter table public.generated_frame_artifacts enable row level security;
alter table public.quality_checks enable row level security;

drop policy if exists product_references_select_own on public.product_references;
drop policy if exists product_references_write_own on public.product_references;
create policy product_references_select_own on public.product_references for select using (owner_id = auth.uid());
create policy product_references_write_own on public.product_references for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists placement_targets_select_own on public.placement_targets;
drop policy if exists placement_targets_write_own on public.placement_targets;
create policy placement_targets_select_own on public.placement_targets for select using (owner_id = auth.uid());
create policy placement_targets_write_own on public.placement_targets for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists placement_masks_select_own on public.placement_masks;
create policy placement_masks_select_own on public.placement_masks for select using (owner_id = auth.uid());

drop policy if exists placement_runs_select_own on public.placement_runs;
drop policy if exists placement_runs_insert_own on public.placement_runs;
drop policy if exists placement_runs_update_own on public.placement_runs;
create policy placement_runs_select_own on public.placement_runs for select using (owner_id = auth.uid());
create policy placement_runs_insert_own on public.placement_runs for insert with check (owner_id = auth.uid());
create policy placement_runs_update_own on public.placement_runs for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists placement_job_steps_select_own on public.placement_job_steps;
drop policy if exists placement_job_steps_insert_own on public.placement_job_steps;
create policy placement_job_steps_select_own on public.placement_job_steps for select using (owner_id = auth.uid());
create policy placement_job_steps_insert_own on public.placement_job_steps for insert with check (owner_id = auth.uid());

drop policy if exists placement_keyframes_select_own on public.placement_keyframes;
create policy placement_keyframes_select_own on public.placement_keyframes for select using (owner_id = auth.uid());

drop policy if exists generated_frame_artifacts_select_own on public.generated_frame_artifacts;
create policy generated_frame_artifacts_select_own on public.generated_frame_artifacts for select using (owner_id = auth.uid());

drop policy if exists quality_checks_select_own on public.quality_checks;
create policy quality_checks_select_own on public.quality_checks for select using (owner_id = auth.uid());

-- Workspace can receive durable stage transitions without browser polling.
do $$ begin
  alter publication supabase_realtime add table public.placement_runs;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.placement_job_steps;
exception when duplicate_object then null;
end $$;
