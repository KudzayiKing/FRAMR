-- Durable state-aware Lucy workflow.
-- A single creator version may consist of several short, source-aligned Lucy edits,
-- each driven by one private product-state reference image.

alter table public.generation_jobs
  add column if not exists state_plan jsonb not null default '[]'::jsonb,
  add column if not exists state_outputs jsonb not null default '{}'::jsonb,
  add column if not exists current_window_index integer not null default 0 check (current_window_index >= 0);

comment on column public.generation_jobs.state_plan is
  'Ordered state-aware Lucy windows: source frame/time bounds, reference key, state, and locked prompt.';
comment on column public.generation_jobs.state_outputs is
  'Private generated storage keys indexed by completed state-window position.';
comment on column public.generation_jobs.current_window_index is
  'Zero-based current state-window position. A job advances only after its provider output is persisted privately.';

create index if not exists generation_jobs_state_progress_idx
  on public.generation_jobs (status, current_window_index)
  where status in ('queued', 'generating', 'finalizing', 'retrying');

-- PostgreSQL does not permit CREATE OR REPLACE to change a function's OUT-column
-- row type. This function has no arguments and is re-granted below after replacement.
drop function if exists public.claim_next_generation_job();

-- Return the durable state-window fields to the existing single-worker claim loop.
create function public.claim_next_generation_job()
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
  output_key text,
  state_plan jsonb,
  state_outputs jsonb,
  current_window_index integer
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
    public.generation_jobs.status in ('queued', 'retrying')
    or (
      public.generation_jobs.status in ('analyzing', 'generating', 'finalizing')
      and (public.generation_jobs.next_poll_at is null or public.generation_jobs.next_poll_at <= now())
    )
  )
  and (
    public.generation_jobs.worker_claimed_at is null
    or public.generation_jobs.worker_claimed_at < now() - interval '30 minutes'
  )
  order by public.generation_jobs.created_at asc
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
    public.generation_jobs.output_key,
    public.generation_jobs.state_plan,
    public.generation_jobs.state_outputs,
    public.generation_jobs.current_window_index
  into id, placement_id, version_id, product_id, status, provider, model, provider_job_id, prompt, attempts, output_key, state_plan, state_outputs, current_window_index;

  return next;
end;
$$;

revoke all on function public.claim_next_generation_job() from public;
grant execute on function public.claim_next_generation_job() to service_role;
