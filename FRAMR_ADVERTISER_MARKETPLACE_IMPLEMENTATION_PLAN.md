# FRAMR Advertiser Marketplace Implementation Plan

## Objective

Transform FRAMR from a creator-preview system with advertiser presentation screens into a **real two-sided marketplace**. Creators will decide which analysed placement opportunities to publish, advertisers will build campaigns around real products and browse only authorised marketplace listings, and both parties will progress through a controlled offer, approval, preview, delivery, and payout lifecycle.

The intended outcome is simple for each side. A creator publishes a safe placement opportunity from an analysed video, receives an offer, approves or declines it, makes a branded preview, approves the final version, and receives a payout. An advertiser creates a campaign, adds a product, searches qualified placement opportunities, makes an offer, funds an accepted booking, and receives the approved version. FRAMR never exposes an original source video, tracking masks, or private product media outside the authorised workflow.

> **Implementation principle:** Marketplace publication shares a curated placement listing and authorised signed preview media—not the creator's original video or any editable source assets.

## 1. Current State and Gap Assessment

The database already contains useful foundations: profiles, creator and advertiser profile tables, brands, videos, placements, products, campaigns, campaign placements, generation jobs, transactions, and subscriptions. `placements` already includes public-listing, price, estimated-view, and audience fields, while `campaign_placements` already expresses the advertiser-campaign-to-creator-placement relationship. The creator workspace is substantially database-backed, including videos, products, targets, placement runs, versions, and realtime updates.

The advertiser marketplace is not yet production-backed. The advertiser workspace initializes campaigns from `initialCampaigns`; marketplace listings, sponsor offers, and sponsor demand are all imported from `web/src/data/framr.ts`; `CampaignModal` and `ReserveModal` only create in-memory records or show toasts. The current policies also make videos and placements broadly readable when `is_marketplace_public = true`, which is too permissive for private creator media.

| Area | Available foundation | Required production work |
|---|---|---|
| Identity | Creator and advertiser roles, profiles, brands | Complete onboarding, organisation ownership, verification state, and role-specific profile data |
| Creator content | Private upload, analysis, placements, targets, runs, versions | Listing publication controls, audience data, pricing, availability, and creator offer inbox |
| Advertiser products | Products and multi-reference images | Advertiser-owned campaign products and controlled creator access after an offer |
| Campaigns | Campaign and campaign-placement tables | Real CRUD, targeting, attached products, funding state, commitments, and delivery status |
| Marketplace | Public flags and placeholder UI | Curated listing table, private marketplace media, search, filters, pagination, availability and holds |
| Commercial workflow | Boolean `creator_approved` and transaction stub | Explicit booking lifecycle, final-version approval, audit trail, payment authorisation, payout ledger |
| Realtime | Videos, versions, runs are subscribed | Offers, campaigns, bookings, payments, and notifications must stream to the correct party |

## 2. Product Scope and Operating Rules

The first production marketplace release should be a **managed, request-to-book marketplace** rather than an instant self-serve ad exchange. This is safer for source-media privacy, avoids double booking, preserves creator control, and maps naturally onto FRAMR's existing replacement preview workflow.

### 2.1 Roles

| Role | Core permissions | Must never receive |
|---|---|---|
| Creator | Own profile, source videos, placement publication, listing price and availability, offers, previews, delivery approval, payout records | Another creator's source media, private advertiser campaign data not attached to an offer |
| Advertiser | Own brand, campaign, products, marketplace search, offers, approved deliveries, invoices | Source videos, SAM masks, frame artifacts, private creator analytics, another advertiser's products or campaigns |
| Brand administrator | Advertiser permissions plus brand members, billing settings, and campaign ownership transfer | Creator private media except through an authorised listing or delivery |
| FRAMR operations | Dispute, verification, fraud, support, and payment reconciliation access through server-side administration | Browser-exposed service-role credentials or unrestricted customer download links |

### 2.2 Marketplace Lifecycle

The marketplace must use explicit states instead of booleans. A creator and advertiser should always see the same clear stage, while database transitions remain controlled by server-side routes or security-definer functions.

| Entity | Recommended lifecycle |
|---|---|
| Listing | `draft` → `published` → `held` → `booked` → `paused` / `archived` |
| Campaign | `draft` → `active` → `paused` → `completed` / `archived` |
| Booking request | `draft` → `submitted` → `creator_approved` or `creator_declined` → `funding_required` → `funded` → `preview_requested` → `preview_ready` → `creator_approved_final` → `delivered` → `completed`; terminal alternatives are `expired`, `canceled`, and `disputed` |
| Payment | `not_required` → `authorisation_pending` → `authorised` → `captured` → `payout_pending` → `paid`; terminal alternatives are `refunded` and `failed` |

A hold is not a booking. When an advertiser submits an offer, the selected listing is held only for a short configurable period, such as 48 hours. It becomes booked only after creator acceptance and funding authorisation. Expired holds return the listing to `published` automatically.

### 2.3 Creator-Centred Commercial Flow

1. The creator uploads and analyses a video as today, then selects which detected placement opportunities may be listed.
2. The creator chooses a per-placement price, availability, category, audience geography, estimated views, allowed product categories, and a curated marketplace thumbnail. The source video remains private.
3. An advertiser creates a campaign, uploads at least one campaign product with reference views, defines an offer and targeting, then browses qualifying listings.
4. The advertiser submits one booking request tied to one campaign, one advertiser product, one listing, one price, and one expiration timestamp.
5. The creator accepts, declines, or later counteroffers. Version one should support accept and decline first; counteroffers can follow after the core lifecycle is reliable.
6. After acceptance and funding, the creator creates a preview using the advertiser-selected product. FRAMR links that placement run and generated version to the booking request.
7. The creator approves the final version before advertiser delivery. The advertiser can approve delivery, request a revision within a defined policy, or allow auto-completion after a delivery window.
8. FRAMR captures payment, records the platform fee, makes the payout eligible, and exposes the final approved version only to the authorised advertiser and creator.

## 3. Production Data Model

The plan extends existing tables rather than replacing the video-analysis pipeline. New SQL begins at migration `0014`; all migrations are additive, reversible where practical, and backfilled only from real existing records.

### 3.1 Organisation and Profile Enhancements

| Table | Change | Purpose |
|---|---|---|
| `brands` | Add `slug`, `logo_key`, `description`, `verification_status`, `owner_profile_id`, and timestamps | Make a brand a real advertiser-facing identity |
| `brand_memberships` | New: `brand_id`, `profile_id`, `role`, `created_at`, unique pair | Support future advertiser teams without weakening ownership rules |
| `creator_profiles` | Add `bio`, `country_code`, `audience_summary`, `audience_metrics_updated_at`, `marketplace_status`, and `payout_profile_status` | Store real creator discovery and eligibility data |
| `advertiser_profiles` | Keep as the user-level bridge to a brand; add onboarding and billing status | Avoid treating a browser role switch as onboarding |

Use `brands.profile_id` as the initial owner compatibility field, but route all new campaign ownership and permissions through brand membership checks. This keeps single-user brands simple while making teams possible later.

### 3.2 Marketplace Listings

Do not use `videos.is_marketplace_public` as the primary marketplace mechanism. Original videos must remain private. Create a dedicated `marketplace_listings` table that publishes a safe placement snapshot.

| Column group | Required fields |
|---|---|
| Identity | `id`, `placement_id`, `creator_id`, `status`, `created_at`, `updated_at` |
| Commercial data | `price_cents`, `currency`, `minimum_offer_cents`, `availability_start`, `availability_end`, `hold_expires_at` |
| Discovery snapshot | `object_label`, `category`, `placement_duration_seconds`, `quality`, `estimated_views`, `audience_geo`, optional `audience_summary` |
| Safe media | `thumbnail_key`, optional `preview_clip_key`, `media_review_status` |
| Controls | `allowed_categories`, `excluded_categories`, `creator_notes`, `published_at`, `archived_at` |

Add one active-listing uniqueness constraint per placement. The `placement` remains creator-owned and private; the listing is the marketplace projection. Any change to a placement's timing or status should invalidate or require republishing of its listing snapshot.

### 3.3 Campaigns, Products, and Booking Requests

Retain `campaigns` and evolve `campaign_placements` into the durable booking record, rather than creating a competing join table.

| Existing object | Production extension |
|---|---|
| `campaigns` | Add `brand_id`, `objective`, `targeting jsonb`, `currency`, `reserved_cents`, `committed_cents`, `spent_cents`, `funding_status`, and `updated_at` |
| `campaign_products` | New linking table with `campaign_id`, `product_id`, `is_primary`, `usage_notes`, and immutable product-reference snapshot metadata |
| `campaign_placements` | Add `listing_id`, `product_id`, `creator_id`, `status`, `offer_cents`, `currency`, `platform_fee_cents`, `creator_payout_cents`, `hold_expires_at`, `creator_response_at`, `decline_reason`, `placement_run_id`, `placement_version_id`, `delivery_approved_at`, and `completed_at` |
| `booking_events` | New immutable event log: actor, event type, old status, new status, metadata, timestamp |
| `notifications` | New audience-scoped records for offer, approval, funding, preview, delivery, expiry, and dispute events |

Replace the nullable `creator_approved` field only after a backfill migration maps its prior values to explicit statuses. Keep legacy rows readable during the transition, then remove the boolean only in a later cleanup migration.

### 3.4 Payments and Payouts

The current `transactions` table is not enough to safely model payment state. Introduce the following separate source-of-truth records before enabling money movement.

| Table | Responsibility |
|---|---|
| `payment_intents` | Payment provider reference, authorised/captured amount, currency, booking, and failure reason |
| `payout_accounts` | Creator payment-provider account reference and onboarding status; never store bank details directly |
| `payouts` | Creator payout amount, provider transfer reference, status, and booked-to-paid timestamps |
| `ledger_entries` | Immutable double-entry or event-ledger rows for gross amount, platform fee, refund, chargeback, and creator amount |

The existing `transactions` table can remain as a simple user-facing activity projection during migration, but it must not be the only accounting record. Payment-provider webhooks, not browser callbacks, are the authoritative source for payment state.

## 4. Security, Privacy, and Storage Design

### 4.1 Access Rules

Marketplace visibility must be converted from broad public reads to relationship-based visibility.

| Resource | Creator | Advertiser | Access mechanism |
|---|---|---|---|
| Original source video | Owner only | Never | Creator/private storage policy only |
| Analysed placement and masks | Owner only | Never | Creator-scoped RLS only |
| Marketplace listing metadata | Own listings | Authenticated advertisers with active access | Listing RLS and parameterised API |
| Marketplace thumbnail or short preview | Owner | Advertiser viewing an authorised listing | Time-limited signed URL from a server route |
| Advertiser product images | Owner brand members | Creator only after a submitted booking is visible to that creator | Offer-scoped signed URL route |
| Generated delivery version | Creator | Advertiser only after authorised delivery | Booking-scoped signed URL route |

The browser must never receive the Supabase service-role key. All state transitions that affect another party, money, delivery, or visibility should pass through authenticated Next.js route handlers with ownership checks and a database transaction or RPC.

### 4.2 Storage Buckets

Keep existing `videos`, `products`, `generated`, `thumbnails`, and `artifacts` private. Add a dedicated private `marketplace` bucket only if distinct safe listing media is necessary. The browser receives signed URLs after the route verifies the requester's relationship to the listing or booking.

Do not place originals in a public bucket. Do not derive marketplace clips directly from arbitrary source paths without a creator publication decision and content-safety review state.

## 5. API and Realtime Surface

All endpoints should return typed, minimal DTOs rather than raw joined Supabase rows. Route handlers own validation, actor checks, idempotency, and audit events.

| Endpoint family | Operations |
|---|---|
| `/api/creator/profile` | Read and update creator marketplace profile and publication settings |
| `/api/creator/listings` | List own listings; create draft from own placement; publish, pause, archive, and update price/availability |
| `/api/creator/offers` | Read incoming booking requests; accept, decline, and later counteroffer |
| `/api/advertiser/brand` | Brand onboarding, member management, verification state |
| `/api/advertiser/products` | Create, update, archive advertiser product assets and reference views |
| `/api/advertiser/campaigns` | Create, update, activate, pause, archive campaigns; attach campaign products |
| `/api/marketplace/listings` | Cursor-paginated search with verified filters for category, geography, price, duration, quality, availability, and audience band |
| `/api/bookings` | Submit offer with idempotency key; reserve or release a listing; fetch booking details |
| `/api/bookings/[id]/preview` | Creator requests a preview only after funding; links the existing placement-run flow to the booking |
| `/api/bookings/[id]/delivery` | Creator final approval, advertiser delivery approval, revision request, or policy-controlled completion |
| `/api/media/[resource]` | Relationship-checked signed URLs for listing preview, advertiser product reference, and delivery asset |
| `/api/webhooks/payments` | Verify provider signature, then update payment and payout records transactionally |

Add realtime publication and client subscriptions for `marketplace_listings`, `campaigns`, `campaign_placements`, `notifications`, `payment_intents`, and `payouts`. Subscribe with narrowly scoped filters; do not use a global marketplace stream for private booking state.

## 6. UI Replacement Plan: No Runtime Dummy Data

When Supabase is configured, the workspace must render only fetched production data or an intentional empty state. Remove `initialCampaigns`, `listings`, `sponsorDemand`, and `sponsorOffers` from all authenticated creator and advertiser paths. Static images may remain in public marketing pages and tests, but not as workspace records or marketplace results.

| Surface | Production replacement |
|---|---|
| Advertiser overview | Real campaign totals, booking status counts, budget balance, and recent notifications; show honest zero states instead of synthetic metrics |
| Advertiser campaigns | Campaign list and detail pages backed by `campaigns`, attached products, targeting, spend, and booking records |
| Advertiser marketplace | Filtered cursor-paginated listing cards, safe signed thumbnail, transparent pricing, availability, and "Make offer" action |
| Reserve modal | Real campaign selection, product selection, offer amount, hold expiry, consent statement, submit endpoint, idempotent button state |
| Advertiser placements | Booking pipeline grouped by status: awaiting creator, funding required, generating preview, ready for delivery, completed |
| Advertiser products | Brand-owned product CRUD with multi-reference images; no seeded products |
| Creator marketplace | Listing publisher, real listing performance, active holds, campaign demand matching, and visibility controls |
| Creator campaigns/offers | Incoming offer inbox with advertiser identity, product reference, payout, terms, expiry, accept or decline controls |
| Creator analytics | Real zero-safe results from accepted and completed bookings; do not display invented views or earnings |

## 7. Build Sequence and Acceptance Criteria

### Phase 0 — Marketplace Decisions and Data Contract

Write the product decision record before coding. It must define supported countries and currency, the buyer-of-record model, platform fee policy, creator payout schedule, refund/revision rules, marketplace content policy, and whether creators can counteroffer in v1. Convert every decision into enum values, validation rules, and acceptance tests.

**Acceptance criteria:** The lifecycle diagram is approved, every user-visible status has a corresponding database status, and no transition depends on ambiguous booleans or browser-only state.

### Phase 1 — Schema, RLS, and Safe Listing Media

Create migrations `0014_marketplace_core.sql` and `0015_marketplace_rls.sql`. Add organisation/membership support, marketplace listings, campaign products, expanded booking records, event logs, notifications, indexes, and relationship-based RLS. Backfill no public listing from existing private placements; creators must opt in. Create safe media policies and signed URL routes.

**Acceptance criteria:** A creator can create and publish one listing; an authenticated advertiser can discover its metadata but cannot access the source video, mask, artifact, or raw storage key.

### Phase 2 — Creator Publishing and Offer Inbox

Replace creator-side sponsor-demand and sponsor-offer fixtures with loaders and APIs. Implement listing drafts, publishing, pause/archive, pricing, availability, incoming offer list, accept, and decline. Add realtime offer notifications and expiration handling.

**Acceptance criteria:** A published creator listing appears in advertiser search; a submitted offer appears in the creator inbox without refresh; decline or expiry restores availability; a duplicate active hold is rejected atomically.

### Phase 3 — Advertiser Onboarding, Products, Campaigns, and Discovery

Replace advertiser demo state completely. Implement brand onboarding, advertiser product upload, real campaign wizard, product attachment, campaign activation, marketplace filters, listing detail, and offer submission. Rework the current `CampaignModal` and `ReserveModal` into API-backed forms with server-side validation.

**Acceptance criteria:** A new advertiser with no data sees clear empty states, creates a brand, uploads a product, creates a campaign, searches real listings, and submits a real creator-visible offer.

### Phase 4 — Booking-to-Preview Integration

Link an accepted and funded booking to FRAMR's existing `placement_targets`, `placement_runs`, Lucy generation jobs, and `placement_versions`. The creator can request the preview with the advertiser campaign product; the booking stores the run and version IDs. Prevent unauthorised product selection and ensure the existing source video remains protected.

**Acceptance criteria:** A creator accepts one funded booking, produces a preview using the advertiser product, and both parties observe truthful realtime progress and final delivery status.

### Phase 5 — Delivery, Reporting, Notifications, and Auditability

Implement creator final approval, advertiser delivery approval, revision/dispute policy states, delivery signed URLs, event timeline, inbox notifications, campaign budget accounting, and real zero-safe reporting. Add admin support views only after core permission tests exist.

**Acceptance criteria:** Every booking transition emits one immutable event and one scoped notification; delivery media is accessible only to the creator and authorised advertiser; dashboard totals are derived from actual booking and payment records.

### Phase 6 — Payments and Creator Payouts

Integrate payment authorisation, capture, payout onboarding, provider webhooks, refunds, and ledger records. This phase requires legal, tax, and regional compliance review before enabling live transfers. Until it is complete, the UI must clearly label funding as test or managed payment—not show fake invoice or payout states.

**Acceptance criteria:** A payment webhook can be replayed safely; duplicate webhook events are idempotent; a completed booking produces reconcilable gross, fee, and creator payout ledger entries; no payout is exposed as paid before provider confirmation.

### Phase 7 — Hardening and Launch Controls

Add rate limiting, cursor pagination, observability, dead-letter and expiry jobs, load tests, RLS integration tests, webhook signature tests, audit export, moderation/verification tools, and a staged feature flag. Run a private pilot with selected creators and advertisers before opening publication.

**Acceptance criteria:** Permission tests cover all cross-party reads and writes; expired holds recover automatically; source-media access tests fail for advertisers; marketplace search stays responsive under representative listing volume; rollback procedures are documented.

## 8. Test Strategy

| Layer | Required tests |
|---|---|
| Database | Migration forward/backward checks, RLS actor matrix, uniqueness and hold-expiry constraints, status-transition RPC tests |
| API | Authentication, ownership, idempotency, payload validation, signed-media authorization, webhook replay tests |
| UI | Empty states, onboarding, publishing, search/filtering, offer accept/decline, realtime updates, duplicate-submit protection |
| Pipeline | Booking-to-placement-run association, advertiser product reference access, generation cancellation, delivery access boundaries |
| Security | No browser service-role access, no advertiser original-video access, no listing access after archive, no cross-brand campaign access |
| Operations | Worker retry and stale-hold recovery, payment event retries, structured audit logs, error monitoring |

## 9. Recommended First Build Milestone

Start with **Phase 1 plus the creator half of Phase 2**. This creates a real, safe supply side before advertisers can make irreversible commercial actions.

The first implementation slice should deliver: a marketplace listing schema and RLS, creator publication controls for a detected placement, real listing media signed URLs, a creator listing management page, and honest empty states. Once a creator can publish and pause a genuine listing without exposing original video media, build the advertiser campaign and offer workflow on top of that stable contract.

> Do not begin Stripe payments or public marketplace browsing before listing privacy, actor permissions, availability holds, and explicit lifecycle states are tested.

## 10. Definition of Done

The marketplace is ready for a controlled pilot when a creator and advertiser can complete one end-to-end booking using only real rows and real media: creator onboarding → private upload and analysis → creator-published placement listing → advertiser brand/product/campaign → advertiser offer → creator acceptance → funding → advertiser-product preview → creator final approval → advertiser delivery → recorded payout eligibility. At every point, dashboard values derive from the database, access is relationship-scoped, and no workspace screen falls back to demo campaigns, listings, products, offers, views, earnings, or payments.
