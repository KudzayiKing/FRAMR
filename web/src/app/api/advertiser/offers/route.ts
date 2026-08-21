import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type OfferPayload = { listingId?: string; campaignId?: string; productId?: string };

function parsePayload(value: unknown): OfferPayload | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return {
    listingId: typeof item.listingId === "string" ? item.listingId : undefined,
    campaignId: typeof item.campaignId === "string" ? item.campaignId : undefined,
    productId: typeof item.productId === "string" ? item.productId : undefined,
  };
}

async function requireAdvertiser() {
  const client = await getServerClient();
  if (!client) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: "You must be signed in to make an offer." }, { status: 401 }) } as const;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "advertiser") return { error: NextResponse.json({ error: "Only advertiser accounts can make marketplace offers." }, { status: 403 }) } as const;
  const { data: advertiser } = await client.from("advertiser_profiles").select("brand_id").eq("profile_id", user.id).maybeSingle();
  if (!advertiser?.brand_id) return { error: NextResponse.json({ error: "Create your brand profile before making an offer." }, { status: 409 }) } as const;
  return { client, user } as const;
}

export async function POST(request: Request) {
  const auth = await requireAdvertiser();
  if ("error" in auth) return auth.error;
  let payload: OfferPayload | null;
  try { payload = parsePayload(await request.json()); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!payload?.listingId || !payload.campaignId || !payload.productId || !UUID.test(payload.listingId) || !UUID.test(payload.campaignId) || !UUID.test(payload.productId)) {
    return NextResponse.json({ error: "Choose a listing, campaign, and product before making an offer." }, { status: 400 });
  }

  const [listingResult, campaignResult, productResult] = await Promise.all([
    auth.client.from("marketplace_listings").select("id,placement_id,creator_id,status,price_cents,currency,allowed_categories,excluded_categories").eq("id", payload.listingId).maybeSingle(),
    auth.client.from("campaigns").select("id,status,category,product_id").eq("id", payload.campaignId).eq("advertiser_id", auth.user.id).maybeSingle(),
    auth.client.from("products").select("id").eq("id", payload.productId).eq("owner_id", auth.user.id).eq("kind", "advertiser").maybeSingle(),
  ]);
  const listing = listingResult.data;
  const campaign = campaignResult.data;
  const product = productResult.data;
  if (!listing || listing.status !== "published") return NextResponse.json({ error: "This placement is no longer available." }, { status: 409 });
  if (!campaign || !["draft", "active"].includes(campaign.status)) return NextResponse.json({ error: "Choose an active campaign you own." }, { status: 400 });
  if (!product || campaign.product_id !== product.id) return NextResponse.json({ error: "Use the product attached to this campaign." }, { status: 400 });
  const campaignCategory = campaign.category?.trim();
  if (listing.allowed_categories.length && (!campaignCategory || !listing.allowed_categories.includes(campaignCategory))) return NextResponse.json({ error: "This creator has limited the placement to different product categories." }, { status: 409 });
  if (campaignCategory && listing.excluded_categories.includes(campaignCategory)) return NextResponse.json({ error: "This creator does not accept this product category for the placement." }, { status: 409 });

  const submittedAt = new Date().toISOString();
  const { data: offer, error } = await auth.client.from("campaign_placements").insert({
    campaign_id: campaign.id,
    listing_id: listing.id,
    placement_id: listing.placement_id,
    creator_id: listing.creator_id,
    product_id: product.id,
    status: "submitted",
    creator_approved: null,
    price_cents: listing.price_cents,
    currency: listing.currency,
    submitted_at: submittedAt,
    updated_at: submittedAt,
  }).select("id,status,price_cents,currency,submitted_at").single();
  if (error || !offer) {
    if (error?.code === "23505") return NextResponse.json({ error: "This placement already has an active offer. Choose another listing or check your campaign pipeline." }, { status: 409 });
    return NextResponse.json({ error: "Your offer could not be submitted." }, { status: 500 });
  }
  return NextResponse.json({ offer }, { status: 201 });
}
