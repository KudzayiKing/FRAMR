import { NextResponse } from "next/server";
import { buildPlacementReplacementPrompt } from "@/services/generation/prompt-builder";
import { getServerClient } from "@/lib/supabase-server";
import { getMarketplaceWebhookProof } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ offerId: string }> };

type ConfirmPayload = { confirm?: boolean };

async function requireAdvertiser() {
  const client = await getServerClient();
  if (!client) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: "You must be signed in to request a marketplace preview." }, { status: 401 }) } as const;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "advertiser") return { error: NextResponse.json({ error: "Only advertisers can request marketplace previews." }, { status: 403 }) } as const;
  return { client, user } as const;
}

export async function POST(request: Request, { params }: Context) {
  const auth = await requireAdvertiser();
  if ("error" in auth) return auth.error;
  const { offerId } = await params;
  if (!UUID.test(offerId)) return NextResponse.json({ error: "The offer is invalid." }, { status: 400 });
  let payload: ConfirmPayload | null = null;
  try { payload = await request.json() as ConfirmPayload; } catch { return NextResponse.json({ error: "A preview confirmation is required." }, { status: 400 }); }
  if (payload?.confirm !== true) return NextResponse.json({ error: "Confirm preview creation before FRAMR starts paid video processing." }, { status: 400 });
  const proof = getMarketplaceWebhookProof();
  if (!proof) return NextResponse.json({ error: "Marketplace preview controls are not configured." }, { status: 503 });

  const { data: offer, error: offerError } = await auth.client
    .from("campaign_placements")
    .select("id,campaign_id,placement_id,product_id,status,funding_status,preview_run_id")
    .eq("id", offerId)
    .maybeSingle();
  if (offerError || !offer) return NextResponse.json({ error: "The funded offer is unavailable." }, { status: 404 });
  if (offer.status !== "creator_approved" || offer.funding_status !== "funded") return NextResponse.json({ error: "This offer must be creator-approved and funded before a preview can start." }, { status: 409 });
  if (!offer.product_id) return NextResponse.json({ error: "The accepted offer has no advertiser product." }, { status: 409 });

  const [{ data: campaign }, { data: placement }, { data: product }] = await Promise.all([
    auth.client.from("campaigns").select("id,advertiser_id").eq("id", offer.campaign_id).maybeSingle(),
    auth.client.from("placements").select("id,object_label,category,start_seconds,end_seconds").eq("id", offer.placement_id).maybeSingle(),
    auth.client.from("products").select("id,name,brand").eq("id", offer.product_id).maybeSingle(),
  ]);
  if (!campaign || campaign.advertiser_id !== auth.user.id || !placement || !product) return NextResponse.json({ error: "The accepted placement or advertiser product is unavailable." }, { status: 409 });
  const prompt = buildPlacementReplacementPrompt({
    objectLabel: placement.object_label,
    category: placement.category,
    startSeconds: placement.start_seconds,
    endSeconds: placement.end_seconds,
  }, {
    name: product.name,
    brand: product.brand,
  });
  const { data: rows, error: queueError } = await auth.client.rpc("queue_marketplace_preview", {
    p_offer_id: offer.id,
    p_prompt: prompt,
    p_idempotency_key: `marketplace:${offer.id}`,
    p_proof: proof,
  });
  const queued = Array.isArray(rows) ? rows[0] : null;
  if (queueError || !queued) return NextResponse.json({ error: "The funded preview could not be queued. Ensure object tracking is ready and try again." }, { status: 409 });
  return NextResponse.json({ runId: queued.run_id, versionId: queued.version_id, reused: Boolean(offer.preview_run_id) }, { status: offer.preview_run_id ? 200 : 201 });
}
