-- Safe advertiser marketplace discovery.
-- PostgREST evaluates cross-table RLS policy predicates under the invoker role.
-- This dedicated security-definer function performs the eligibility check once,
-- then returns only the creator-approved listing snapshot, never source media,
-- private placements, masks, tracks, or video storage keys.

create or replace function public.advertiser_marketplace_listings(
  query_text text default null,
  category_filter text default null,
  min_price_cents integer default null,
  max_price_cents integer default null,
  result_limit integer default 24
)
returns table (
  id uuid,
  creator_id uuid,
  price_cents integer,
  currency text,
  allowed_categories text[],
  excluded_categories text[],
  creator_notes text,
  object_label text,
  category text,
  duration_seconds numeric,
  quality text,
  video_title text,
  published_at timestamptz,
  created_at timestamptz,
  creator_display_name text,
  creator_handle text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join public.advertiser_profiles advertiser on advertiser.profile_id = profile.id
    where profile.id = auth.uid()
      and profile.role = 'advertiser'
      and advertiser.brand_id is not null
  ) then
    raise exception 'advertiser brand profile required';
  end if;

  return query
  select
    listing.id,
    listing.creator_id,
    listing.price_cents,
    listing.currency,
    listing.allowed_categories,
    listing.excluded_categories,
    listing.creator_notes,
    listing.object_label,
    listing.category,
    listing.duration_seconds,
    listing.quality::text,
    listing.video_title,
    listing.published_at,
    listing.created_at,
    profile.display_name,
    profile.handle
  from public.marketplace_listings listing
  join public.profiles profile on profile.id = listing.creator_id
  where listing.status = 'published'
    and (category_filter is null or listing.category = category_filter)
    and (min_price_cents is null or listing.price_cents >= min_price_cents)
    and (max_price_cents is null or listing.price_cents <= max_price_cents)
    and (
      query_text is null
      or listing.object_label ilike '%' || query_text || '%'
      or listing.video_title ilike '%' || query_text || '%'
      or listing.category ilike '%' || query_text || '%'
      or profile.display_name ilike '%' || query_text || '%'
    )
  order by listing.published_at desc nulls last, listing.created_at desc
  limit greatest(1, least(coalesce(result_limit, 24), 48));
end;
$$;

grant execute on function public.advertiser_marketplace_listings(text, text, integer, integer, integer) to authenticated;
