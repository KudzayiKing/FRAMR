-- Marketplace creator foundation.
-- This migration introduces creator-owned listing records and a durable creator offer
-- inbox without publishing source videos or enabling advertiser booking/payment actions.

create extension if not exists "pgcrypto";

-- A placement remains private by default. A marketplace listing is its separate,
-- creator-controlled commercial projection and carries only safe discovery metadata.
do $$ begin
  create type public.marketplace_listing_status as enum ('draft', 'published', 'paused', 'held', 'booked', 'archived');
exception when duplicate_object then null;
end $$;

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.placements(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  status public.marketplace_listing_status not null default 'draft',
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  availability_start timestamptz,
  availability_end timestamptz,
  allowed_categories text[] not null default '{}',
  excluded_categories text[] not null default '{}',
  creator_notes text,
  thumbnail_key text,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (availability_end is null or availability_start is null or availability_end > availability_start),
  unique (placement_id)
);

create index if not exists marketplace_listings_creator_idx
  on public.marketplace_listings(creator_id, status, created_at desc);
create index if not exists marketplace_listings_published_idx
  on public.marketplace_listings(status, created_at desc)
  where status = 'published';

-- Prepare campaign placements for the later advertiser implementation while
-- making creator offers explicit and queryable today. Existing rows are
-- backfilled from the underlying creator-owned placement.
alter table public.campaign_placements
  add column if not exists listing_id uuid references public.marketplace_listings(id) on delete set null,
  add column if not exists creator_id uuid references public.profiles(id) on delete set null,
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists status text not null default 'draft' check (status in ('draft', 'submitted', 'creator_approved', 'creator_declined', 'canceled', 'expired')),
  add column if not exists currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  add column if not exists creator_response_at timestamptz,
  add column if not exists decline_reason text,
  add column if not exists submitted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.campaign_placements cp
set creator_id = placement.owner_id
from public.placements placement
where placement.id = cp.placement_id
  and cp.creator_id is null;

create index if not exists campaign_placements_creator_status_idx
  on public.campaign_placements(creator_id, status, created_at desc);
create unique index if not exists campaign_placements_one_open_listing_idx
  on public.campaign_placements(listing_id)
  where status in ('submitted', 'creator_approved');

-- Keep listing and offer mutations owner-scoped in the browser. Advertiser-side
-- browsing and booking policies arrive with the advertiser implementation; the
-- private base table is intentionally not advertiser-readable in this phase.
alter table public.marketplace_listings enable row level security;

drop policy if exists marketplace_listings_creator_select on public.marketplace_listings;
drop policy if exists marketplace_listings_creator_insert on public.marketplace_listings;
drop policy if exists marketplace_listings_creator_update on public.marketplace_listings;
create policy marketplace_listings_creator_select on public.marketplace_listings
  for select using (creator_id = auth.uid());
create policy marketplace_listings_creator_insert on public.marketplace_listings
  for insert with check (
    creator_id = auth.uid()
    and exists (
      select 1 from public.placements placement
      where placement.id = placement_id and placement.owner_id = auth.uid()
    )
  );
create policy marketplace_listings_creator_update on public.marketplace_listings
  for update using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

-- Creator offer visibility already follows the placement owner under the base
-- migration. Explicit creator-id policies make the inbox stable after listing
-- publication and safely permit creator accept/decline transitions only.
drop policy if exists campaign_placements_select on public.campaign_placements;
drop policy if exists campaign_placements_creator_select on public.campaign_placements;
drop policy if exists campaign_placements_creator_respond on public.campaign_placements;
create policy campaign_placements_select on public.campaign_placements
  for select using (
    creator_id = auth.uid()
    or exists (
      select 1 from public.placements placement
      where placement.id = placement_id and placement.owner_id = auth.uid()
    )
  );
create policy campaign_placements_creator_respond on public.campaign_placements
  for update using (
    creator_id = auth.uid()
    and status = 'submitted'
  ) with check (
    creator_id = auth.uid()
    and status in ('creator_approved', 'creator_declined')
  );

drop policy if exists campaigns_creator_offer_select on public.campaigns;
create policy campaigns_creator_offer_select on public.campaigns
  for select using (
    exists (
      select 1 from public.campaign_placements offer
      where offer.campaign_id = campaigns.id
        and offer.creator_id = auth.uid()
    )
  );

-- Make creator listing updates and incoming offer updates available for scoped
-- realtime subscriptions. Duplicate publication errors are harmless.
do $$ begin
  alter publication supabase_realtime add table public.marketplace_listings;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.campaign_placements;
exception when duplicate_object then null;
end $$;
