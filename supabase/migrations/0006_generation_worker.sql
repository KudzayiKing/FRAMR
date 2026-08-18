-- Phase 3: durable generation-job coordination for the Lucy video-editing pipeline.
-- These fields make submission, provider polling, and media finalization recoverable
-- across worker restarts. Originals remain immutable; outputs live on placement_versions.
alter table public.generation_jobs
  add column if not exists worker_claimed_at timestamptz,
  add column if not exists provider_status text,
  add column if not exists next_poll_at timestamptz,
  add column if not exists output_key text,
  add column if not exists output_thumbnail_key text;

create index if not exists generation_jobs_worker_queue_idx
  on public.generation_jobs (created_at)
  where status in ('queued', 'retrying') and worker_claimed_at is null;

create index if not exists generation_jobs_poll_queue_idx
  on public.generation_jobs (next_poll_at)
  where status in ('analyzing', 'generating', 'finalizing', 'retrying');

-- One service-role worker claims a job at a time. Claims automatically become
-- eligible after 30 minutes, allowing restart recovery without manual repair.
create or replace function public.claim_next_generation_job()
returns table (
  id uuid,
  placement_id uuid,
  version_id uuid,
  product_id uuid,
  status public.generation_status,
  provider text,
  model text,
  provider_job_id text,
  prompt text,
  attempts integer,
  output_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.generation_jobs%rowtype;
begin
  select * into candidate
  from public.generation_jobs
  where (
    status in ('queued', 'retrying')
    or (
      status in ('analyzing', 'generating', 'finalizing')
      and (next_poll_at is null or next_poll_at <= now())
    )
  )
  and (
    worker_claimed_at is null
    or worker_claimed_at < now() - interval '30 minutes'
  )
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.generation_jobs
  set
    worker_claimed_at = now(),
    attempts = public.generation_jobs.attempts + case when candidate.status in ('queued', 'retrying') then 1 else 0 end,
    error = null
  where public.generation_jobs.id = candidate.id
  returning
    public.generation_jobs.id,
    public.generation_jobs.placement_id,
    public.generation_jobs.version_id,
    public.generation_jobs.product_id,
    public.generation_jobs.status,
    public.generation_jobs.provider,
    public.generation_jobs.model,
    public.generation_jobs.provider_job_id,
    public.generation_jobs.prompt,
    public.generation_jobs.attempts,
    public.generation_jobs.output_key
  into id, placement_id, version_id, product_id, status, provider, model, provider_job_id, prompt, attempts, output_key;

  return next;
end;
$$;

revoke all on function public.claim_next_generation_job() from public;
grant execute on function public.claim_next_generation_job() to service_role;
