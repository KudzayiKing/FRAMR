-- Stripe test-mode marketplace funding.
-- Checkout and webhook endpoints never receive a Supabase service-role key. Instead,
-- server-only routes call the narrowly scoped security-definer functions below with
-- an internal proof token whose one-way hash is embedded here.

create extension if not exists pgcrypto;

create table if not exists public.marketplace_payments (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.campaign_placements(id) on delete cascade,
  advertiser_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  provider text not null default 'stripe' check (provider = 'stripe'),
  status text not null default 'checkout_pending' check (status in ('checkout_pending', 'paid', 'failed', 'expired', 'refunded')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_event_id text unique,
  checkout_expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.campaign_placements
  add column if not exists funding_status text not null default 'awaiting_payment'
    check (funding_status in ('awaiting_payment', 'checkout_pending', 'funded', 'payment_failed', 'refunded')),
  add column if not exists payment_id uuid references public.marketplace_payments(id) on delete set null,
  add column if not exists preview_run_id uuid references public.placement_runs(id) on delete set null,
  add column if not exists preview_version_id uuid references public.placement_versions(id) on delete set null,
  add column if not exists delivery_status text not null default 'not_started'
    check (delivery_status in ('not_started', 'preview_queued', 'preview_generating', 'creator_review', 'creator_approved', 'changes_requested', 'delivered', 'payout_eligible')),
  add column if not exists creator_reviewed_at timestamptz,
  add column if not exists creator_review_note text,
  add column if not exists payout_status text not null default 'not_eligible'
    check (payout_status in ('not_eligible', 'eligible', 'paid', 'held'));

create index if not exists marketplace_payments_advertiser_idx
  on public.marketplace_payments(advertiser_id, created_at desc);
create index if not exists campaign_placements_funding_idx
  on public.campaign_placements(creator_id, funding_status, delivery_status, created_at desc);

alter table public.marketplace_payments enable row level security;
drop policy if exists marketplace_payments_select on public.marketplace_payments;
create policy marketplace_payments_select on public.marketplace_payments
  for select using (
    advertiser_id = auth.uid()
    or exists (select 1 from public.campaign_placements offer where offer.id = offer_id and offer.creator_id = auth.uid())
  );

create or replace function public.assert_marketplace_webhook_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or encode(digest(p_token, 'sha256'), 'hex') <> '0a24da66a1b211d0b27c9737191643e7fd2ffa028bfbccfae555d50e97bba896' then
    raise exception 'invalid marketplace payment proof';
  end if;
end;
$$;

create or replace function public.create_marketplace_payment_attempt(
  p_offer_id uuid,
  p_proof text
)
returns table (payment_id uuid, amount_cents integer, currency text, offer_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  offer public.campaign_placements%rowtype;
  campaign_owner uuid;
  payment public.marketplace_payments%rowtype;
begin
  perform public.assert_marketplace_webhook_token(p_proof);
  select offer_row.* into offer from public.campaign_placements offer_row where offer_row.id = p_offer_id for update;
  if not found then raise exception 'offer not found'; end if;
  select advertiser_id into campaign_owner from public.campaigns where id = offer.campaign_id;
  if campaign_owner is distinct from auth.uid() then raise exception 'not campaign owner'; end if;
  if offer.status <> 'creator_approved' then raise exception 'offer is not creator approved'; end if;
  if offer.funding_status = 'funded' then raise exception 'offer is already funded'; end if;

  select * into payment from public.marketplace_payments where offer_id = offer.id for update;
  if found and payment.status = 'checkout_pending' then
    return query select payment.id, payment.amount_cents, payment.currency, payment.offer_id;
    return;
  end if;
  if found then
    update public.marketplace_payments
      set status = 'checkout_pending', stripe_checkout_session_id = null, stripe_payment_intent_id = null,
          stripe_event_id = null, checkout_expires_at = null, paid_at = null, updated_at = now()
      where id = payment.id
      returning * into payment;
  else
    insert into public.marketplace_payments (offer_id, advertiser_id, amount_cents, currency)
      values (offer.id, campaign_owner, offer.price_cents, offer.currency)
      returning * into payment;
  end if;
  update public.campaign_placements
    set payment_id = payment.id, funding_status = 'checkout_pending', updated_at = now()
    where id = offer.id;
  return query select payment.id, payment.amount_cents, payment.currency, payment.offer_id;
end;
$$;

create or replace function public.attach_marketplace_checkout_session(
  p_payment_id uuid,
  p_session_id text,
  p_expires_at timestamptz,
  p_proof text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_marketplace_webhook_token(p_proof);
  update public.marketplace_payments
    set stripe_checkout_session_id = p_session_id, checkout_expires_at = p_expires_at, updated_at = now()
    where id = p_payment_id and status = 'checkout_pending';
  if not found then raise exception 'payment cannot accept checkout session'; end if;
end;
$$;

create or replace function public.mark_marketplace_payment_paid(
  p_payment_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_event_id text,
  p_proof text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  payment public.marketplace_payments%rowtype;
begin
  perform public.assert_marketplace_webhook_token(p_proof);
  select * into payment from public.marketplace_payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found'; end if;
  if payment.status = 'paid' then return false; end if;
  if payment.stripe_checkout_session_id is distinct from p_session_id then raise exception 'checkout session mismatch'; end if;
  update public.marketplace_payments
    set status = 'paid', stripe_payment_intent_id = p_payment_intent_id, stripe_event_id = p_event_id,
        paid_at = now(), updated_at = now()
    where id = payment.id;
  update public.campaign_placements
    set funding_status = 'funded', delivery_status = 'not_started', updated_at = now()
    where id = payment.offer_id and status = 'creator_approved';
  return true;
end;
$$;

create or replace function public.queue_marketplace_preview(
  p_offer_id uuid,
  p_prompt text,
  p_idempotency_key text,
  p_proof text
)
returns table (run_id uuid, version_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  offer public.campaign_placements%rowtype;
  placement public.placements%rowtype;
  video public.videos%rowtype;
  product public.products%rowtype;
  target public.placement_targets%rowtype;
  campaign_owner uuid;
  new_version_id uuid;
  new_run_id uuid;
begin
  perform public.assert_marketplace_webhook_token(p_proof);
  select offer_row.* into offer from public.campaign_placements offer_row where offer_row.id = p_offer_id for update;
  if not found then raise exception 'offer not found'; end if;
  select advertiser_id into campaign_owner from public.campaigns where id = offer.campaign_id;
  if campaign_owner is distinct from auth.uid() then raise exception 'not campaign owner'; end if;
  if offer.status <> 'creator_approved' or offer.funding_status <> 'funded' then raise exception 'offer is not funded'; end if;
  if offer.preview_run_id is not null then
    return query select offer.preview_run_id, offer.preview_version_id;
    return;
  end if;
  select * into placement from public.placements where id = offer.placement_id;
  select * into video from public.videos where id = placement.video_id;
  select * into product from public.products where id = offer.product_id;
  select * into target from public.placement_targets where placement_id = placement.id and status = 'ready' order by updated_at desc nulls last, created_at desc limit 1;
  if not found then raise exception 'placement target is not ready'; end if;
  if video.status <> 'ready' then raise exception 'source video is not ready'; end if;

  insert into public.placement_versions (placement_id, product_id, label, brand, status, is_active, is_source, pipeline_version, review_status)
  values (placement.id, product.id, left(coalesce(product.brand || ' ', '') || product.name, 160), product.brand, 'generating', false, false, 'lucy-shot-aware-v1', 'pending')
  returning id into new_version_id;

  insert into public.placement_runs (
    owner_id, placement_id, target_id, product_id, source_video_id, version_id,
    idempotency_key, image_editor_provider, image_editor_model, settings,
    status, current_stage, progress, estimated_cost_cents
  ) values (
    offer.creator_id, placement.id, target.id, product.id, video.id, new_version_id,
    p_idempotency_key, 'decart', 'lucy-latest',
    jsonb_build_object('frameMode','SHOT_AWARE','originalAudio','preserve','targetRevision',target.manual_revision,
      'frameRange',jsonb_build_object('start',target.start_frame,'end',target.end_frame),'pipeline','lucy-shot-aware-v1','marketplaceOfferId',offer.id),
    'queued', 'prepare_source', 0, 0
  ) returning id into new_run_id;

  update public.placement_versions set placement_run_id = new_run_id where id = new_version_id;
  insert into public.generation_jobs (placement_id, version_id, product_id, status, provider, model, prompt)
  values (placement.id, new_version_id, product.id, 'queued', 'decart', 'lucy-latest', left(p_prompt, 900));
  update public.campaign_placements
    set preview_run_id = new_run_id, preview_version_id = new_version_id,
        delivery_status = 'preview_queued', updated_at = now()
    where id = offer.id;
  return query select new_run_id, new_version_id;
end;
$$;

revoke all on function public.assert_marketplace_webhook_token(text) from public;
grant execute on function public.create_marketplace_payment_attempt(uuid, text) to authenticated;
grant execute on function public.attach_marketplace_checkout_session(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.mark_marketplace_payment_paid(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.queue_marketplace_preview(uuid, text, text, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.marketplace_payments;
exception when duplicate_object then null;
end $$;

-- A run created by queue_marketplace_preview stays associated with its marketplace
-- offer. The worker updates placement_runs, and this trigger turns a completed run
-- into a creator-review item without exposing source media or worker internals.
create or replace function public.sync_marketplace_preview_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'running' then
    update public.campaign_placements
      set delivery_status = 'preview_generating', updated_at = now()
      where preview_run_id = new.id
        and funding_status = 'funded'
        and delivery_status in ('preview_queued', 'not_started');
  elsif new.status = 'ready' then
    update public.campaign_placements
      set delivery_status = 'creator_review', updated_at = now()
      where preview_run_id = new.id
        and funding_status = 'funded'
        and delivery_status in ('preview_queued', 'preview_generating', 'not_started');
  elsif new.status in ('failed', 'canceled') then
    update public.campaign_placements
      set delivery_status = 'not_started', preview_run_id = null, preview_version_id = null, updated_at = now()
      where preview_run_id = new.id
        and funding_status = 'funded'
        and delivery_status in ('preview_queued', 'preview_generating', 'not_started');
  end if;
  return new;
end;
$$;

drop trigger if exists marketplace_preview_delivery_sync on public.placement_runs;
create trigger marketplace_preview_delivery_sync
  after update of status on public.placement_runs
  for each row
  when (old.status is distinct from new.status)
  execute function public.sync_marketplace_preview_delivery();

create or replace function public.creator_review_marketplace_delivery(
  p_offer_id uuid,
  p_action text,
  p_note text default null
)
returns table (offer_id uuid, delivery_status text, payout_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  offer public.campaign_placements%rowtype;
  approved boolean;
begin
  if p_action not in ('approve', 'request_changes') then raise exception 'invalid delivery review action'; end if;
  select * into offer from public.campaign_placements where id = p_offer_id for update;
  if not found or offer.creator_id is distinct from auth.uid() then raise exception 'offer unavailable'; end if;
  if offer.status <> 'creator_approved' or offer.funding_status <> 'funded' then raise exception 'funded offer required'; end if;
  if offer.delivery_status <> 'creator_review' then raise exception 'preview is not ready for creator review'; end if;
  approved := p_action = 'approve';
  update public.campaign_placements
    set delivery_status = case when approved then 'creator_approved' else 'changes_requested' end,
        payout_status = case when approved then 'eligible' else 'not_eligible' end,
        creator_reviewed_at = now(),
        creator_review_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
        updated_at = now()
    where id = offer.id
    returning id, campaign_placements.delivery_status, campaign_placements.payout_status
    into offer_id, delivery_status, payout_status;
  return next;
end;
$$;

grant execute on function public.creator_review_marketplace_delivery(uuid, text, text) to authenticated;
