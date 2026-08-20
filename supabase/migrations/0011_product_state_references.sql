-- FRAMR product-state references for state-aware Lucy windows.
-- Existing products and primary references remain valid without any migration of media.

alter table public.product_references
  drop constraint if exists product_references_view_type_check;

alter table public.product_references
  add constraint product_references_view_type_check
  check (
    view_type in (
      'primary',
      'front',
      'side',
      'rear',
      'transparent',
      'packaging',
      'detail',
      'closed',
      'open',
      'other'
    )
  );

-- Metadata has always been JSONB. These indexes support state-aware lookups
-- without forcing a fragile fixed product taxonomy onto all categories.
create index if not exists product_references_product_state_idx
  on public.product_references (product_id, view_type, sort_order, created_at);

comment on column public.product_references.view_type is
  'Product reference view or visual state. Use closed/open for stateful products such as cookware.';
comment on column public.product_references.metadata is
  'Optional product-state metadata. FRAMR uses state, preferred_for, and source fields for automatic Lucy guidance.';

-- All existing product primary references are valid for the state-aware path.
insert into public.product_references (product_id, owner_id, storage_key, view_type, sort_order, metadata)
select p.id, p.owner_id, p.image_key, 'primary', 0, jsonb_build_object('state', 'canonical', 'source', 'backfill')
from public.products p
where p.image_key is not null
  and p.image_key like 'products/%'
on conflict (product_id, storage_key) do nothing;

-- Product references are private creator/advertiser assets; retain the same
-- ownership model as products for any project where the foundational policy
-- was applied before this table was introduced.
alter table public.product_references enable row level security;

drop policy if exists product_references_select_own on public.product_references;
create policy product_references_select_own on public.product_references
  for select using (owner_id = auth.uid());

drop policy if exists product_references_write_own on public.product_references;
create policy product_references_write_own on public.product_references
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter publication supabase_realtime add table public.product_references;
