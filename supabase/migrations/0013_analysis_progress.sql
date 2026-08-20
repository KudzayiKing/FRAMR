-- Persist creator-facing analysis progress. Values are worker-reported milestones,
-- not estimated client-side timers.

alter table public.videos
  add column if not exists analysis_progress numeric(5,2) not null default 0
    check (analysis_progress >= 0 and analysis_progress <= 100),
  add column if not exists analysis_stage text;

update public.videos
set
  analysis_progress = case
    when status = 'ready' then 100
    when status = 'failed' then 0
    else analysis_progress
  end,
  analysis_stage = case
    when status = 'ready' then 'complete'
    when status = 'failed' then 'failed'
    else coalesce(analysis_stage, 'queued')
  end
where analysis_stage is null or status in ('ready', 'failed');

create index if not exists videos_analysis_status_progress_idx
  on public.videos (owner_id, status, analysis_progress, created_at desc);
