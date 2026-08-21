import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DECLINE_REASON = 300;

type OfferPayload = { offerId?: string; action?: "accept" | "decline"; declineReason?: string };

type OfferRow = {
  id: string;
  campaign_id: string;
  listing_id: string | null;
  placement_id: string;
  product_id: string | null;
  status: string;
  price_cents: number;
  currency: string;
  funding_status: "awaiting_payment" | "checkout_pending" | "funded" | "payment_failed" | "refunded";
  delivery_status: "not_started" | "preview_queued" | "preview_generating" | "creator_review" | "creator_approved" | "changes_requested" | "delivered" | "payout_eligible";
  preview_version_id: string | null;
  payout_status: "not_eligible" | "eligible" | "paid" | "held";
  creator_review_note: string | null;
  creator_response_at: string | null;
  decline_reason: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

function parsePayload(value: unknown): OfferPayload | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const action = typeof item.action === "string" ? item.action : undefined;
  if (action && action !== "accept" && action !== "decline") return null;
  return {
    offerId: typeof item.offerId === "string" ? item.offerId : undefined,
    action: action as OfferPayload["action"],
    declineReason: typeof item.declineReason === "string" ? item.declineReason : undefined,
  };
}

async function requireCreator() {
  const client = await getServerClient();
  if (!client) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: "You must be signed in to manage offers." }, { status: 401 }) } as const;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "creator") return { error: NextResponse.json({ error: "Only creator accounts can respond to marketplace offers." }, { status: 403 }) } as const;
  return { client, user } as const;
}

export async function GET() {
  const auth = await requireCreator();
  if ("error" in auth) return auth.error;
  const { data: offers, error } = await auth.client
    .from("campaign_placements")
    .select("id,campaign_id,listing_id,placement_id,product_id,status,price_cents,currency,funding_status,delivery_status,preview_version_id,payout_status,creator_review_note,creator_response_at,decline_reason,submitted_at,created_at,updated_at")
    .eq("creator_id", auth.user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Marketplace offers could not be loaded. Apply the marketplace foundation migration and try again." }, { status: 500 });

  const typedOffers = (offers ?? []) as OfferRow[];
  const campaignIds = [...new Set(typedOffers.map((offer) => offer.campaign_id))];
  const listingIds = [...new Set(typedOffers.flatMap((offer) => offer.listing_id ? [offer.listing_id] : []))];
  const productIds = [...new Set(typedOffers.flatMap((offer) => offer.product_id ? [offer.product_id] : []))];
  const placementIds = [...new Set(typedOffers.map((offer) => offer.placement_id))];
  const [campaigns, listings, products, placements] = await Promise.all([
    campaignIds.length ? auth.client.from("campaigns").select("id,name").in("id", campaignIds) : Promise.resolve({ data: [], error: null }),
    listingIds.length ? auth.client.from("marketplace_listings").select("id,placement_id").in("id", listingIds).eq("creator_id", auth.user.id) : Promise.resolve({ data: [], error: null }),
    productIds.length ? auth.client.from("products").select("id,name,brand").in("id", productIds) : Promise.resolve({ data: [], error: null }),
    placementIds.length ? auth.client.from("placements").select("id,video_id,object_label").in("id", placementIds).eq("owner_id", auth.user.id) : Promise.resolve({ data: [], error: null }),
  ]);
  if (campaigns.error || listings.error || products.error || placements.error) return NextResponse.json({ error: "Offer details could not be loaded." }, { status: 500 });
  const videoIds = [...new Set((placements.data ?? []).map((placement) => placement.video_id))];
  const { data: videos, error: videosError } = videoIds.length
    ? await auth.client.from("videos").select("id,title").in("id", videoIds).eq("owner_id", auth.user.id)
    : { data: [], error: null };
  if (videosError) return NextResponse.json({ error: "Offer video details could not be loaded." }, { status: 500 });
  const campaignById = new Map((campaigns.data ?? []).map((campaign) => [campaign.id, campaign]));
  const listingById = new Map((listings.data ?? []).map((listing) => [listing.id, listing]));
  const productById = new Map((products.data ?? []).map((product) => [product.id, product]));
  const placementById = new Map((placements.data ?? []).map((placement) => [placement.id, placement]));
  const videoById = new Map((videos ?? []).map((video) => [video.id, video]));

  return NextResponse.json({
    offers: typedOffers.map((offer) => ({
      ...offer,
      campaign: campaignById.get(offer.campaign_id) ?? { id: offer.campaign_id, name: "Campaign" },
      listing: offer.listing_id ? listingById.get(offer.listing_id) ?? null : null,
      placement: (() => {
        const placement = placementById.get(offer.placement_id);
        const video = placement ? videoById.get(placement.video_id) : null;
        return placement && video ? { object_label: placement.object_label, video_title: video.title } : null;
      })(),
      product: offer.product_id ? productById.get(offer.product_id) ?? null : null,
    })),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireCreator();
  if ("error" in auth) return auth.error;
  let payload: OfferPayload | null;
  try { payload = parsePayload(await request.json()); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!payload?.offerId || !UUID.test(payload.offerId) || !payload.action) return NextResponse.json({ error: "Offer and response are required." }, { status: 400 });
  if (payload.action === "decline" && payload.declineReason && payload.declineReason.trim().length > MAX_DECLINE_REASON) return NextResponse.json({ error: "Keep the decline note under 300 characters." }, { status: 400 });

  const { data: current } = await auth.client.from("campaign_placements")
    .select("id,status")
    .eq("id", payload.offerId)
    .eq("creator_id", auth.user.id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "That offer is unavailable." }, { status: 404 });
  if (current.status !== "submitted") return NextResponse.json({ error: "This offer has already been resolved." }, { status: 409 });

  const respondedAt = new Date().toISOString();
  const approved = payload.action === "accept";
  const { data: offer, error } = await auth.client.from("campaign_placements")
    .update({
      status: approved ? "creator_approved" : "creator_declined",
      creator_approved: approved,
      creator_response_at: respondedAt,
      decline_reason: approved ? null : payload.declineReason?.trim().slice(0, MAX_DECLINE_REASON) || null,
      updated_at: respondedAt,
    })
    .eq("id", current.id)
    .eq("creator_id", auth.user.id)
    .select("id,status,creator_approved,creator_response_at,decline_reason,updated_at")
    .single();
  if (error || !offer) return NextResponse.json({ error: "Your offer response could not be saved." }, { status: 500 });
  return NextResponse.json({ offer });
}
