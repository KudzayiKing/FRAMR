-- Correct safe discovery visibility.
-- The projection contains only intentionally publishable marketplace metadata.
-- Source video keys, placement rows, tracks, masks, artifacts, and product assets
-- remain private and continue to be protected by their existing RLS policies.
-- The prior auth.role() predicate filtered legitimate SSR-authenticated requests.

alter table public.marketplace_discovery enable row level security;
drop policy if exists marketplace_discovery_authenticated_select on public.marketplace_discovery;
drop policy if exists marketplace_discovery_select on public.marketplace_discovery;
create policy marketplace_discovery_select on public.marketplace_discovery
  for select using (true);
