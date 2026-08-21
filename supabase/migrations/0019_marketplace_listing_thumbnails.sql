-- Creator-approved marketplace thumbnail delivery.
-- Listing thumbnails are separate low-resolution preview derivatives. They may be
-- signed only when the exact object is attached to a published marketplace row;
-- original source videos, generated outputs, masks, and arbitrary thumbnails are
-- never made readable by this policy.

alter table public.marketplace_discovery
  add column if not exists thumbnail_key text;

update public.marketplace_discovery discovery
set thumbnail_key = listing.thumbnail_key,
    updated_at = now()
from public.marketplace_listings listing
where listing.id = discovery.listing_id
  and discovery.thumbnail_key is distinct from listing.thumbnail_key;

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
    thumbnail_key, published_at, creator_display_name, creator_handle, updated_at
  ) values (
    new.id, new.creator_id, new.price_cents, new.currency, new.allowed_categories, new.excluded_categories,
    new.creator_notes, new.object_label, new.category, new.duration_seconds, new.quality::text, new.video_title,
    new.thumbnail_key, new.published_at, coalesce(creator.display_name, 'Creator'), creator.handle, now()
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
    thumbnail_key = excluded.thumbnail_key,
    published_at = excluded.published_at,
    creator_display_name = excluded.creator_display_name,
    creator_handle = excluded.creator_handle,
    updated_at = now();
  return new;
end;
$$;

-- Storage object paths omit the bucket name. The only matching records are
-- published discovery rows whose approved key exactly points to the thumbnail.
drop policy if exists marketplace_listing_thumbnail_select on storage.objects;
create policy marketplace_listing_thumbnail_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'thumbnails'
    and exists (
      select 1
      from public.marketplace_discovery discovery
      where discovery.thumbnail_key = 'thumbnails/' || name
    )
  );
