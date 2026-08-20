-- Store the continuous source-shot boundary separately from the frames where
-- SAM sees the selected product. Lucy receives a visibility window padded only
-- within these safe cut boundaries, preventing red-to-yellow product reversions
-- and avoiding splices through an active shot.

alter table public.placement_targets
  add column if not exists shot_start_frame integer,
  add column if not exists shot_end_frame integer;

alter table public.placement_targets
  drop constraint if exists placement_targets_shot_window_check;

alter table public.placement_targets
  add constraint placement_targets_shot_window_check
  check (
    (shot_start_frame is null and shot_end_frame is null)
    or (
      shot_start_frame >= 0
      and shot_end_frame >= shot_start_frame
      and start_frame >= shot_start_frame
      and end_frame <= shot_end_frame
    )
  );

comment on column public.placement_targets.shot_start_frame is
  'First frame of the continuous source shot containing the tracked target.';
comment on column public.placement_targets.shot_end_frame is
  'Last frame of the continuous source shot containing the tracked target.';
