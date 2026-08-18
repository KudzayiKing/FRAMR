-- Correct the Phase 3 claim function: `status` is an OUT parameter, so all
-- table references inside the SQL query must be qualified to avoid ambiguity.
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
    public.generation_jobs.output_key
  into id, placement_id, version_id, product_id, status, provider, model, provider_job_id, prompt, attempts, output_key;

  return next;
end;
$$;

revoke all on function public.claim_next_generation_job() from public;
grant execute on function public.claim_next_generation_job() to service_role;
