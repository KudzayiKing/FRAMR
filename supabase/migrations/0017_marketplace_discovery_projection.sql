-- Marketplace discovery projection.
-- Published listings are copied into a purpose-built, safe metadata projection.
-- Discovery never queries creator-private placements, source videos, tracks, masks,
-- artifacts, or storage keys; authenticated users can read only these bounded fields.

create table if not exists public.marketplace_discovery (
  listing_id uuid primary key references public.marketplace_listings(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  price_cents integer not null check (price_cents >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  allowed_categories text[] not null default '{}',
  excluded_categories text[] not null default '{}',
  creator_notes text,
  object_label text,
  category text,
  duration_seconds numeric(8,3),
  quality text,
  video_title text,
  published_at timestamptz,
  creator_display_name text not null default 'Creator',
  creator_handle text,
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_discovery_recent_idx
  on public.marketplace_discovery(published_at desc nulls last, updated_at desc);
create index if not exists marketplace_discovery_category_idx
  on public.marketplace_discovery(category, price_cents);

create or replace function public.sync_marketplace_discovery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  creator public.profiles%rowtype;
begin
  if tg_op = 'DELETE' then
    delete from public.marketplace_discovery where listing_id = old.id;
    return old;
  end if;

  if new.status <> 'published' then
    delete from public.marketplace_discovery where listing_id = new.id;
    return new;
  end if;

  select * into creator from public.profiles where id = new.creator_id;
  insert into public.marketplace_discovery (
    listing_id, creator_id, price_cents, currency, allowed_categories, excluded_categories,
    creator_notes, object_label, category, duration_seconds, quality, video_title,
    published_at, creator_display_name, creator_handle, updated_at
  ) values (
    new.id, new.creator_id, new.price_cents, new.currency, new.allowed_categories, new.excluded_categories,
    new.creator_notes, new.object_label, new.category, new.duration_seconds, new.quality::text, new.video_title,
    new.published_at, coalesce(creator.display_name, 'Creator'), creator.handle, now()
  )
  on conflict (listing_id) do update set
    price_cents = excluded.price_cents,
    currency = excluded.currency,
    allowed_categories = excluded.allowed_categories,
    excluded_categories = excluded.excluded_categories,
    creator_notes = excluded.creator_notes,
    object_label = excluded.object_label,
    category = excluded.category,
    duration_seconds = excluded.duration_seconds,
    quality = excluded.quality,
    video_title = excluded.video_title,
    published_at = excluded.published_at,
    creator_display_name = excluded.creator_display_name,
    creator_handle = excluded.creator_handle,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketplace_listings_discovery_sync on public.marketplace_listings;
create trigger marketplace_listings_discovery_sync
  after insert or update or delete on public.marketplace_listings
  for each row execute function public.sync_marketplace_discovery();

-- Backfill every currently published listing.
insert into public.marketplace_discovery (
  listing_id, creator_id, price_cents, currency, allowed_categories, excluded_categories,
  creator_notes, object_label, category, duration_seconds, quality, video_title,
  published_at, creator_display_name, creator_handle, updated_at
)
select
  listing.id, listing.creator_id, listing.price_cents, listing.currency, listing.allowed_categories, listing.excluded_categories,
  listing.creator_notes, listing.object_label, listing.category, listing.duration_seconds, listing.quality::text, listing.video_title,
  listing.published_at, coalesce(profile.display_name, 'Creator'), profile.handle, now()
from public.marketplace_listings listing
join public.profiles profile on profile.id = listing.creator_id
where listing.status = 'published'
on conflict (listing_id) do update set
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  allowed_categories = excluded.allowed_categories,
  excluded_categories = excluded.excluded_categories,
  creator_notes = excluded.creator_notes,
  object_label = excluded.object_label,
  category = excluded.category,
  duration_seconds = excluded.duration_seconds,
  quality = excluded.quality,
  video_title = excluded.video_title,
  published_at = excluded.published_at,
  creator_display_name = excluded.creator_display_name,
  creator_handle = excluded.creator_handle,
  updated_at = now();

alter table public.marketplace_discovery enable row level security;
drop policy if exists marketplace_discovery_authenticated_select on public.marketplace_discovery;
create policy marketplace_discovery_authenticated_select on public.marketplace_discovery
  for select using (auth.role() = 'authenticated');

do $$ begin
  alter publication supabase_realtime add table public.marketplace_discovery;
exception when duplicate_object then null;
end $$;
