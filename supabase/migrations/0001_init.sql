-- FRAMR initial schema — Phase 1 (Foundation)
-- Entities per build prompt §24. Videos/assets stored as object-storage keys,
-- never as blobs. RLS enforces the creator-private / advertiser-isolated rules from §24.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create type user_role as enum ('creator', 'advertiser');

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null default 'creator',
  display_name text not null default '',
  handle text unique,
  created_at timestamptz not null default now()
);

create table creator_profiles (
  profile_id uuid primary key references profiles (id) on delete cascade,
  accepted_categories text[] not null default '{}',
  rejected_categories text[] not null default '{}',
  minimum_payout_cents integer,
  is_marketplace_enabled boolean not null default false
);

create table brands (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  website text,
  created_at timestamptz not null default now()
);

create table advertiser_profiles (
  profile_id uuid primary key references profiles (id) on delete cascade,
  brand_id uuid references brands (id) on delete set null,
  budget_cents integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Videos & analysis
-- ---------------------------------------------------------------------------
create type video_status as enum ('uploading', 'processing', 'ready', 'failed');

create table videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  title text not null,
  status video_status not null default 'uploading',
  duration_seconds numeric(6,2),
  width integer,
  height integer,
  storage_key text,          -- object-storage key (original); never store bytes here
  thumbnail_key text,
  is_marketplace_public boolean not null default false,
  created_at timestamptz not null default now()
);
create index videos_owner_idx on videos (owner_id);

create table video_scenes (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos (id) on delete cascade,
  start_seconds numeric(8,3) not null,
  end_seconds numeric(8,3) not null
);

create table video_objects (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references video_scenes (id) on delete cascade,
  label text not null,
  category text,
  confidence real not null default 0,
  box jsonb,                -- { left, top, width, height } normalized 0..1
  start_seconds numeric(8,3),
  end_seconds numeric(8,3)
);

-- ---------------------------------------------------------------------------
-- Placements & versions
-- ---------------------------------------------------------------------------
create type placement_quality as enum ('Excellent', 'Good', 'Limited', 'Fair');
create type placement_status as enum ('draft', 'available', 'reserved', 'active', 'completed');

create table placements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  video_id uuid not null references videos (id) on delete cascade,
  object_id uuid references video_objects (id) on delete set null,
  object_label text not null,
  category text,
  start_seconds numeric(8,3) not null,
  end_seconds numeric(8,3) not null,
  quality placement_quality not null default 'Good',
  confidence real not null default 0,
  box jsonb,
  status placement_status not null default 'draft',
  is_marketplace_public boolean not null default false,
  price_cents integer,
  estimated_views integer,
  audience_geo text,
  created_at timestamptz not null default now()
);
create index placements_owner_idx on placements (owner_id);
create index placements_video_idx on placements (video_id);
create index placements_market_idx on placements (is_marketplace_public) where is_marketplace_public;

-- per-frame tracking tracks produced by the analysis worker (Phase 3)
create table placement_tracks (
  placement_id uuid not null references placements (id) on delete cascade,
  frame_index integer not null,
  box jsonb not null,
  primary key (placement_id, frame_index)
);

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
create type product_kind as enum ('creator', 'advertiser');

create table products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  brand_id uuid references brands (id) on delete set null,
  kind product_kind not null default 'creator',
  name text not null,
  brand text,
  description text,
  website text,
  image_key text,            -- primary product image storage key
  created_at timestamptz not null default now()
);
create index products_owner_idx on products (owner_id);

-- ---------------------------------------------------------------------------
-- Versions
-- ---------------------------------------------------------------------------
create type version_status as enum ('draft', 'generating', 'ready', 'failed');

create table placement_versions (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references placements (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  label text not null,
  brand text,
  status version_status not null default 'draft',
  video_key text,            -- generated output storage key; null = original
  thumbnail_key text,
  is_active boolean not null default false,
  is_source boolean not null default false,
  earnings_cents integer,
  created_at timestamptz not null default now()
);
create index placement_versions_placement_idx on placement_versions (placement_id);

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
create type campaign_status as enum ('draft', 'pending_approval', 'active', 'paused', 'completed', 'rejected');

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  status campaign_status not null default 'draft',
  budget_cents integer not null default 0,
  start_date date,
  end_date date,
  category text,
  geography text,
  created_at timestamptz not null default now()
);
create index campaigns_advertiser_idx on campaigns (advertiser_id);

create table campaign_placements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns (id) on delete cascade,
  placement_id uuid not null references placements (id) on delete cascade,
  creator_approved boolean,          -- null = awaiting decision
  price_cents integer not null default 0,
  created_at timestamptz not null default now(),
  unique (campaign_id, placement_id)
);

-- ---------------------------------------------------------------------------
-- Generation jobs (§26: never block HTTP; queue -> worker -> result)
-- ---------------------------------------------------------------------------
create type generation_status as enum ('queued', 'analyzing', 'generating', 'finalizing', 'complete', 'failed', 'retrying', 'canceled');

create table generation_jobs (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references placements (id) on delete cascade,
  version_id uuid references placement_versions (id) on delete set null,
  product_id uuid references products (id) on delete set null,
  status generation_status not null default 'queued',
  provider text,                 -- e.g. 'decart', 'open-model'
  model text,                    -- e.g. 'lucy'
  cost_cents integer,            -- provider cost record (§28 cost tracking)
  started_at timestamptz,
  finished_at timestamptz,
  error text,                    -- internal detail; user-facing copy is sanitized (§29)
  created_at timestamptz not null default now()
);
create index generation_jobs_status_idx on generation_jobs (status);
create index generation_jobs_placement_idx on generation_jobs (placement_id);

-- ---------------------------------------------------------------------------
-- Assets, billing
-- ---------------------------------------------------------------------------
create table assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  kind text not null,            -- 'video' | 'thumbnail' | 'product_image' | 'generated'
  storage_key text not null,
  mime text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index assets_owner_idx on assets (owner_id);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  campaign_id uuid references campaigns (id) on delete set null,
  amount_cents integer not null,
  currency text not null default 'usd',
  stripe_ref text,
  kind text not null,            -- 'campaign_payment' | 'plan' | 'payout'
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  plan text not null,            -- 'free' | 'pro' | 'growth'
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security (§24 rules)
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table creator_profiles enable row level security;
alter table advertiser_profiles enable row level security;
alter table brands enable row level security;
alter table videos enable row level security;
alter table video_scenes enable row level security;
alter table video_objects enable row level security;
alter table placements enable row level security;
alter table placement_tracks enable row level security;
alter table products enable row level security;
alter table placement_versions enable row level security;
alter table campaigns enable row level security;
alter table campaign_placements enable row level security;
alter table generation_jobs enable row level security;
alter table assets enable row level security;
alter table transactions enable row level security;
alter table subscriptions enable row level security;

-- Profiles: users access their own; profiles are readable on marketplace interactions
create policy "profiles_select" on profiles for select using (true);
create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

create policy "creator_profiles_own" on creator_profiles for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "advertiser_profiles_own" on advertiser_profiles for all using (profile_id = auth.uid());

create policy "brands_select_public" on brands for select using (true);
create policy "brands_write_own" on brands for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Videos: creator-private unless intentionally marketplace-public
create policy "videos_select" on videos for select using (
  owner_id = auth.uid() or is_marketplace_public
);
create policy "videos_insert_own" on videos for insert with check (owner_id = auth.uid());
create policy "videos_update_own" on videos for update using (owner_id = auth.uid());

create policy "scenes_select" on video_scenes for select using (
  exists (select 1 from videos v where v.id = video_id and (v.owner_id = auth.uid() or v.is_marketplace_public))
);
create policy "scenes_insert_service" on video_scenes for insert with check (auth.role() = 'service_role');

create policy "objects_select" on video_objects for select using (
  exists (select 1 from video_scenes s join videos v on v.id = s.video_id where s.id = scene_id and (v.owner_id = auth.uid() or v.is_marketplace_public))
);
create policy "objects_insert_service" on video_objects for insert with check (auth.role() = 'service_role');

-- Placements: owner sees own; advertisers see marketplace-public
create policy "placements_select" on placements for select using (
  owner_id = auth.uid() or is_marketplace_public
);
create policy "placements_insert_own" on placements for insert with check (owner_id = auth.uid());
create policy "placements_update_own" on placements for update using (owner_id = auth.uid());

create policy "placement_tracks_select" on placement_tracks for select using (
  exists (select 1 from placements p where p.id = placement_id and (p.owner_id = auth.uid() or p.is_marketplace_public))
);
create policy "placement_tracks_insert_service" on placement_tracks for insert with check (auth.role() = 'service_role');

-- Products: owner-private
create policy "products_select" on products for select using (owner_id = auth.uid());
create policy "products_write_own" on products for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Versions: owner via placement
create policy "versions_select" on placement_versions for select using (
  exists (select 1 from placements p where p.id = placement_id and p.owner_id = auth.uid())
);
create policy "versions_write_own" on placement_versions for all using (
  exists (select 1 from placements p where p.id = placement_id and p.owner_id = auth.uid())
) with check (
  exists (select 1 from placements p where p.id = placement_id and p.owner_id = auth.uid())
);

-- Campaigns: advertiser sees own
create policy "campaigns_select_own" on campaigns for select using (advertiser_id = auth.uid());
create policy "campaigns_write_own" on campaigns for all using (advertiser_id = auth.uid()) with check (advertiser_id = auth.uid());

create policy "campaign_placements_select" on campaign_placements for select using (
  exists (select 1 from campaigns c where c.id = campaign_id and c.advertiser_id = auth.uid())
  or exists (select 1 from placements p where p.id = placement_id and p.owner_id = auth.uid())
);
create policy "campaign_placements_insert" on campaign_placements for insert with check (
  exists (select 1 from campaigns c where c.id = campaign_id and c.advertiser_id = auth.uid())
);

-- Generation jobs: owner via placement
create policy "generation_jobs_select" on generation_jobs for select using (
  exists (select 1 from placements p where p.id = placement_id and p.owner_id = auth.uid())
);
create policy "generation_jobs_insert" on generation_jobs for insert with check (
  exists (select 1 from placements p where p.id = placement_id and p.owner_id = auth.uid())
);

create policy "assets_select_own" on assets for select using (owner_id = auth.uid());
create policy "assets_write_own" on assets for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "transactions_select_own" on transactions for select using (owner_id = auth.uid());
create policy "subscriptions_select_own" on subscriptions for select using (profile_id = auth.uid());
create policy "subscriptions_write_own" on subscriptions for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime (§9/§13: job status must stream without browser polling)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table generation_jobs, videos, placement_versions;

-- ---------------------------------------------------------------------------
-- Auto-provision profile on signup (keeps RLS + demo flow consistent)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::text, 'creator')::user_role,
    coalesce((new.raw_user_meta_data->>'display_name')::text, split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
