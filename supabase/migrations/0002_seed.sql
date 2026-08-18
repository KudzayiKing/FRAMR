-- Seed/demo data — Phase 1 (§37: realistic demo content, clearly labeled)
-- Demo users are created in auth.users directly (standard Supabase SQL seeding),
-- satisfying the profiles FK and making the demo accounts sign-inable.
-- Credentials: lena.cooks@framr.demo / framr-demo · auris@framr.demo / framr-demo

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'lena.cooks@framr.demo', crypt('framr-demo', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"role":"creator"}', now(), now(), '', '', '', '', '')
on conflict (id) do nothing;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
values
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'auris@framr.demo', crypt('framr-demo', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"role":"advertiser"}', now(), now(), '', '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, id, last_sign_in_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   format('{"sub":"11111111-1111-1111-1111-111111111111","email":"lena.cooks@framr.demo","email_verified":true}')::jsonb,
   'email', gen_random_uuid(), now(), now(), now())
on conflict (provider, provider_id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, id, last_sign_in_at, created_at, updated_at)
values
  ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   format('{"sub":"22222222-2222-2222-2222-222222222222","email":"auris@framr.demo","email_verified":true}')::jsonb,
   'email', gen_random_uuid(), now(), now(), now())
on conflict (provider, provider_id) do nothing;

insert into profiles (id, role, display_name, handle) values
  ('11111111-1111-1111-1111-111111111111', 'creator',   'Lena Kovač',  'lena.cooks'),
  ('22222222-2222-2222-2222-222222222222', 'advertiser', 'Auris Home', 'auris')
on conflict (id) do nothing;

insert into creator_profiles (profile_id, accepted_categories, rejected_categories, minimum_payout_cents, is_marketplace_enabled) values
  ('11111111-1111-1111-1111-111111111111',
    array['Kitchen appliances','Food','Coffee','Cooking utensils'],
    array['Gambling','Alcohol','Political'],
    15000, true)
on conflict (profile_id) do nothing;

insert into brands (id, profile_id, name, website) values
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Auris', 'https://auris.example')
on conflict (id) do nothing;

insert into advertiser_profiles (profile_id, brand_id, budget_cents) values
  ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 1000000)
on conflict (profile_id) do nothing;

insert into videos (id, owner_id, title, status, duration_seconds, width, height, storage_key, thumbnail_key, is_marketplace_public) values
  ('44444444-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Perfect Fried Rice', 'ready', 34.0, 1080, 1920, 'videos/perfect-fried-rice.mp4', '/images/framr_hero_original.png', true),
  ('44444444-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Espresso Routine', 'ready', 28.0, 1080, 1920, 'videos/espresso-routine.mp4', '/images/framr_video_espresso-routine.png', false)
on conflict (id) do nothing;

insert into placements (id, owner_id, video_id, object_label, category, start_seconds, end_seconds, quality, confidence, status, is_marketplace_public, price_cents, estimated_views, audience_geo) values
  ('55555555-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '44444444-1111-1111-1111-111111111111', 'Rice cooker', 'Kitchen appliances', 6, 18, 'Excellent', 0.94, 'available', true, 32000, 180000, 'US'),
  ('55555555-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '44444444-1111-1111-1111-111111111111', 'Microwave', 'Kitchen appliances', 20, 28, 'Good', 0.81, 'draft', false, null, null, 'US'),
  ('55555555-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '44444444-2222-2222-2222-222222222222', 'Coffee machine', 'Coffee', 8, 16, 'Good', 0.77, 'available', true, 18000, 90000, 'UK')
on conflict (id) do nothing;

insert into products (id, owner_id, brand_id, kind, name, brand, image_key) values
  ('66666666-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'advertiser', 'Model A Rice Cooker', 'Auris', '/images/framr_product_auris_model-a.png'),
  ('66666666-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'advertiser', 'Kaffa Uno Espresso Blend', 'Auris', '/images/framr_product_kaffa-uno.png')
on conflict (id) do nothing;

insert into placement_versions (id, placement_id, product_id, label, brand, status, is_active, is_source, earnings_cents) values
  ('77777777-1111-1111-1111-111111111111', '55555555-1111-1111-1111-111111111111', null, 'Original', 'Source', 'ready', true, true, null),
  ('77777777-2222-2222-2222-222222222222', '55555555-1111-1111-1111-111111111111', '66666666-1111-1111-1111-111111111111', 'Auris Model A', 'Auris', 'ready', false, false, 32000)
on conflict (id) do nothing;

insert into campaigns (id, advertiser_id, name, status, budget_cents, start_date, end_date, category, geography) values
  ('88888888-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Auris Spring Launch', 'active', 500000, '2026-03-01', '2026-04-30', 'Kitchen appliances', 'US')
on conflict (id) do nothing;
