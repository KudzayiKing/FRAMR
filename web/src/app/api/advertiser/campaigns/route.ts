import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CampaignPayload = { name?: string; budgetCents?: number; category?: string; geography?: string; productId?: string; startDate?: string | null; endDate?: string | null };

function parsePayload(value: unknown): CampaignPayload | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const startDate = item.startDate === null || typeof item.startDate === "string" ? item.startDate : undefined;
  const endDate = item.endDate === null || typeof item.endDate === "string" ? item.endDate : undefined;
  return {
    name: typeof item.name === "string" ? item.name : undefined,
    budgetCents: typeof item.budgetCents === "number" ? item.budgetCents : undefined,
    category: typeof item.category === "string" ? item.category : undefined,
    geography: typeof item.geography === "string" ? item.geography : undefined,
    productId: typeof item.productId === "string" ? item.productId : undefined,
    startDate,
    endDate,
  };
}

function validDate(value: string | null | undefined) {
  return value == null || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

async function requireAdvertiser() {
  const client = await getServerClient();
  if (!client) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: "You must be signed in to manage campaigns." }, { status: 401 }) } as const;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "advertiser") return { error: NextResponse.json({ error: "Only advertiser accounts can manage campaigns." }, { status: 403 }) } as const;
  return { client, user } as const;
}

export async function GET() {
  const auth = await requireAdvertiser();
  if ("error" in auth) return auth.error;
  const [campaigns, products] = await Promise.all([
    auth.client.from("campaigns").select("id,name,status,budget_cents,category,geography,start_date,end_date,product_id,currency,created_at,updated_at").eq("advertiser_id", auth.user.id).order("created_at", { ascending: false }),
    auth.client.from("products").select("id,name,brand,image_key,description").eq("owner_id", auth.user.id).eq("kind", "advertiser").order("created_at", { ascending: false }),
  ]);
  if (campaigns.error || products.error) return NextResponse.json({ error: "Campaign data could not be loaded." }, { status: 500 });
  const campaignIds = (campaigns.data ?? []).map((campaign) => campaign.id);
  const { data: offers, error: offersError } = campaignIds.length
    ? await auth.client.from("campaign_placements").select("id,campaign_id,status,price_cents,currency,funding_status,delivery_status,preview_run_id,preview_version_id,payout_status,creator_response_at,submitted_at,updated_at,marketplace_listings(object_label,video_title),products(name,brand)").in("campaign_id", campaignIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (offersError) return NextResponse.json({ error: "Campaign offer data could not be loaded." }, { status: 500 });
  const counts = new Map<string, { offers: number; accepted: number; committedCents: number }>();
  for (const offer of offers ?? []) {
    const current = counts.get(offer.campaign_id) ?? { offers: 0, accepted: 0, committedCents: 0 };
    current.offers += 1;
    if (offer.status === "creator_approved") { current.accepted += 1; current.committedCents += offer.price_cents; }
    counts.set(offer.campaign_id, current);
  }
  const offersByCampaign = new Map<string, typeof offers>();
  for (const offer of offers ?? []) {
    const current = offersByCampaign.get(offer.campaign_id) ?? [];
    current.push(offer);
    offersByCampaign.set(offer.campaign_id, current);
  }
  return NextResponse.json({
    campaigns: (campaigns.data ?? []).map((campaign) => ({
      ...campaign,
      metrics: counts.get(campaign.id) ?? { offers: 0, accepted: 0, committedCents: 0 },
      offers: (offersByCampaign.get(campaign.id) ?? []).map((offer) => ({
        id: offer.id,
        status: offer.status,
        priceCents: offer.price_cents,
        currency: offer.currency,
        fundingStatus: offer.funding_status,
        deliveryStatus: offer.delivery_status,
        previewRunId: offer.preview_run_id,
        previewVersionId: offer.preview_version_id,
        payoutStatus: offer.payout_status,
        creatorRespondedAt: offer.creator_response_at,
        updatedAt: offer.updated_at,
        listing: Array.isArray(offer.marketplace_listings) ? offer.marketplace_listings[0] ?? null : offer.marketplace_listings ?? null,
        product: Array.isArray(offer.products) ? offer.products[0] ?? null : offer.products ?? null,
      })),
    })),
    products: products.data ?? [],
  });
}

export async function POST(request: Request) {
  const auth = await requireAdvertiser();
  if ("error" in auth) return auth.error;
  let payload: CampaignPayload | null;
  try { payload = parsePayload(await request.json()); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const name = payload?.name?.trim().slice(0, 160);
  const budgetCents = payload?.budgetCents;
  if (!name) return NextResponse.json({ error: "A campaign name is required." }, { status: 400 });
  if (typeof budgetCents !== "number" || !Number.isInteger(budgetCents) || budgetCents <= 0) return NextResponse.json({ error: "Set a campaign budget greater than zero." }, { status: 400 });
  if (!payload?.productId || !UUID.test(payload.productId)) return NextResponse.json({ error: "Choose one of your advertiser products." }, { status: 400 });
  if (!validDate(payload.startDate) || !validDate(payload.endDate) || payload.startDate && payload.endDate && payload.endDate < payload.startDate) return NextResponse.json({ error: "Use a valid campaign date range." }, { status: 400 });

  const { data: advertiser } = await auth.client.from("advertiser_profiles").select("brand_id").eq("profile_id", auth.user.id).maybeSingle();
  if (!advertiser?.brand_id) return NextResponse.json({ error: "Create your brand profile before creating a campaign." }, { status: 409 });
  const { data: product } = await auth.client.from("products").select("id").eq("id", payload.productId).eq("owner_id", auth.user.id).eq("kind", "advertiser").maybeSingle();
  if (!product) return NextResponse.json({ error: "Choose one of your advertiser products." }, { status: 400 });

  const { data: campaign, error } = await auth.client.from("campaigns").insert({
    advertiser_id: auth.user.id,
    brand_id: advertiser.brand_id,
    product_id: product.id,
    name,
    status: "active",
    budget_cents: budgetCents,
    currency: "usd",
    category: payload.category?.trim().slice(0, 100) || null,
    geography: payload.geography?.trim().slice(0, 80) || null,
    start_date: payload.startDate ?? null,
    end_date: payload.endDate ?? null,
    updated_at: new Date().toISOString(),
  }).select("id,name,status,budget_cents,category,geography,start_date,end_date,product_id,currency,created_at,updated_at").single();
  if (error || !campaign) return NextResponse.json({ error: "The campaign could not be created." }, { status: 500 });
  return NextResponse.json({ campaign }, { status: 201 });
}
