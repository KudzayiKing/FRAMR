-- Advertiser marketplace foundation.
-- Enables real brand/campaign ownership, safe listing discovery, and submitted offers.
-- Payment authorisation, payout, preview delivery, and source-media access remain out of scope.

alter table public.campaigns
  add column if not exists brand_id uuid references public.brands(id) on delete set null,
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  add column if not exists updated_at timestamptz not null default now();

-- These fields are copied at creator publication time and are the only placement
-- metadata an advertiser needs for discovery. They prevent marketplace browse
-- from querying the creator's private placement or original video records.
alter table public.marketplace_listings
  add column if not exists object_label text,
  add column if not exists category text,
  add column if not exists duration_seconds numeric(8,3),
  add column if not exists quality public.placement_quality,
  add column if not exists video_title text;

update public.marketplace_listings listing
set object_label = placement.object_label,
    category = placement.category,
    duration_seconds = greatest(0, placement.end_seconds - placement.start_seconds),
    quality = placement.quality,
    video_title = video.title
from public.placements placement
join public.videos video on video.id = placement.video_id
where placement.id = listing.placement_id
  and (listing.object_label is null or listing.duration_seconds is null or listing.quality is null or listing.video_title is null);

create index if not exists campaigns_brand_idx on public.campaigns(brand_id, created_at desc);
create index if not exists campaign_placements_advertiser_status_idx
  on public.campaign_placements(campaign_id, status, created_at desc);

-- A published listing is a curated metadata projection. Revoke historic broad
-- marketplace visibility from source videos, raw objects, and tracking data.
drop policy if exists "videos_select" on public.videos;
create policy "videos_select" on public.videos
  for select using (owner_id = auth.uid());

drop policy if exists "scenes_select" on public.video_scenes;
create policy "scenes_select" on public.video_scenes
  for select using (
    exists (select 1 from public.videos video where video.id = video_id and video.owner_id = auth.uid())
  );

drop policy if exists "objects_select" on public.video_objects;
create policy "objects_select" on public.video_objects
  for select using (
    exists (
      select 1 from public.video_scenes scene
      join public.videos video on video.id = scene.video_id
      where scene.id = scene_id and video.owner_id = auth.uid()
    )
  );

drop policy if exists "placements_select" on public.placements;
create policy "placements_select" on public.placements
  for select using (owner_id = auth.uid());

drop policy if exists "placement_tracks_select" on public.placement_tracks;
create policy "placement_tracks_select" on public.placement_tracks
  for select using (
    exists (select 1 from public.placements placement where placement.id = placement_id and placement.owner_id = auth.uid())
  );

-- Only a completed brand profile may discover the creator-approved listing
-- projection. The creator always retains access to every own listing.
drop policy if exists marketplace_listings_creator_select on public.marketplace_listings;
drop policy if exists marketplace_listings_advertiser_select on public.marketplace_listings;
create policy marketplace_listings_select on public.marketplace_listings
  for select using (
    creator_id = auth.uid()
    or (
      status = 'published'
      and exists (
        select 1 from public.advertiser_profiles advertiser
        where advertiser.profile_id = auth.uid()
          and advertiser.brand_id is not null
      )
    )
  );

-- Security-definer helpers avoid circular RLS evaluation between campaign rows and
-- their offers while checking only the authenticated advertiser's own campaign.
create or replace function public.is_campaign_advertiser(candidate_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.campaigns campaign
    where campaign.id = candidate_campaign_id
      and campaign.advertiser_id = auth.uid()
  );
$$;

create or replace function public.can_submit_offer_for_campaign(candidate_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.campaigns campaign
    where campaign.id = candidate_campaign_id
      and campaign.advertiser_id = auth.uid()
      and campaign.status in ('draft', 'active')
  );
$$;

-- Advertisers see their campaign offer pipeline; creators retain their inbox.
drop policy if exists campaign_placements_select on public.campaign_placements;
create policy campaign_placements_select on public.campaign_placements
  for select using (
    creator_id = auth.uid()
    or public.is_campaign_advertiser(campaign_id)
  );

drop policy if exists campaign_placements_insert on public.campaign_placements;
create policy campaign_placements_insert on public.campaign_placements
  for insert with check (
    status = 'submitted'
    and submitted_at is not null
    and creator_approved is null
    and public.can_submit_offer_for_campaign(campaign_id)
    and exists (
      select 1 from public.marketplace_listings listing
      where listing.id = listing_id
        and listing.placement_id = placement_id
        and listing.creator_id = creator_id
        and listing.status = 'published'
        and listing.price_cents = price_cents
        and listing.currency = currency
    )
    and exists (
      select 1 from public.products product
      where product.id = product_id
        and product.owner_id = auth.uid()
        and product.kind = 'advertiser'
    )
  );

-- A creator may read only the selected advertiser product after the advertiser
-- has submitted an offer for that product. Other advertiser assets remain private.
drop policy if exists products_creator_offer_select on public.products;
create policy products_creator_offer_select on public.products
  for select using (
    exists (
      select 1 from public.campaign_placements offer
      where offer.product_id = products.id
        and offer.creator_id = auth.uid()
    )
  );

-- Advertisement campaign metadata is visible to a creator only when an offer
-- is addressed to that creator. The advertiser retains the existing own policy.
drop policy if exists campaigns_creator_offer_select on public.campaigns;
create policy campaigns_creator_offer_select on public.campaigns
  for select using (
    exists (
      select 1 from public.campaign_placements offer
      where offer.campaign_id = campaigns.id
        and offer.creator_id = auth.uid()
    )
  );

-- Realtime offer status changes must reach both the advertiser pipeline and the
-- creator inbox. Marketplace listings were already added in migration 0014.
do $$ begin
  alter publication supabase_realtime add table public.campaigns;
exception when duplicate_object then null;
end $$;
