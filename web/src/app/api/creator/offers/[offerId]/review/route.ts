import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE_LENGTH = 500;
type Context = { params: Promise<{ offerId: string }> };
type ReviewPayload = { action?: "approve" | "request_changes"; note?: string };

async function requireCreator() {
  const client = await getServerClient();
  if (!client) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: "You must be signed in to review this preview." }, { status: 401 }) } as const;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "creator") return { error: NextResponse.json({ error: "Only creators can review funded placement previews." }, { status: 403 }) } as const;
  return { client, user } as const;
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireCreator();
  if ("error" in auth) return auth.error;
  const { offerId } = await params;
  if (!UUID.test(offerId)) return NextResponse.json({ error: "The offer is invalid." }, { status: 400 });
  let payload: ReviewPayload | null = null;
  try { payload = await request.json() as ReviewPayload; } catch { return NextResponse.json({ error: "Choose how to review this preview." }, { status: 400 }); }
  if (payload?.action !== "approve" && payload?.action !== "request_changes") return NextResponse.json({ error: "Choose whether to approve or request changes." }, { status: 400 });
  const note = typeof payload.note === "string" ? payload.note.trim() : "";
  if (note.length > MAX_NOTE_LENGTH) return NextResponse.json({ error: "Keep your review note under 500 characters." }, { status: 400 });

  const { data: offer, error: offerError } = await auth.client
    .from("campaign_placements")
    .select("id,status,funding_status,delivery_status,preview_version_id")
    .eq("id", offerId)
    .eq("creator_id", auth.user.id)
    .maybeSingle();
  if (offerError || !offer) return NextResponse.json({ error: "This funded offer is unavailable." }, { status: 404 });
  if (offer.status !== "creator_approved" || offer.funding_status !== "funded" || offer.delivery_status !== "creator_review" || !offer.preview_version_id) return NextResponse.json({ error: "This preview is not ready for review." }, { status: 409 });
  const { data: version } = await auth.client.from("placement_versions").select("id,status").eq("id", offer.preview_version_id).maybeSingle();
  if (!version || version.status !== "ready") return NextResponse.json({ error: "The preview video is not ready to review yet." }, { status: 409 });

  const { data: rows, error } = await auth.client.rpc("creator_review_marketplace_delivery", {
    p_offer_id: offerId,
    p_action: payload.action,
    p_note: note || null,
  });
  const reviewed = Array.isArray(rows) ? rows[0] : null;
  if (error || !reviewed) return NextResponse.json({ error: "Your delivery review could not be saved." }, { status: 500 });
  return NextResponse.json({ offer: reviewed });
}
