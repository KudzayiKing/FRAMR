import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE_LENGTH = 500;
const MAX_CATEGORIES = 12;

type ListingAction = "save" | "publish" | "pause" | "archive";
type ListingPayload = {
  placementId?: string;
  listingId?: string;
  action?: ListingAction;
  priceCents?: number;
  creatorNotes?: string;
  allowedCategories?: string[];
  excludedCategories?: string[];
  availabilityStart?: string | null;
  availabilityEnd?: string | null;
};

type PlacementRow = {
  id: string;
  video_id: string;
  object_label: string;
  category: string | null;
  start_seconds: number;
  end_seconds: number;
  quality: string;
  confidence: number;
};

type VideoRow = { id: string; title: string; status: string; thumbnail_key: string | null };

function parsePayload(value: unknown): ListingPayload | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const categories = (field: "allowedCategories" | "excludedCategories") => {
    const raw = item[field];
    if (raw == null) return undefined;
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) return null;
    const normalized = [...new Set(raw.map((entry) => entry.trim()).filter(Boolean))].slice(0, MAX_CATEGORIES);
    return normalized;
  };
  const allowedCategories = categories("allowedCategories");
  const excludedCategories = categories("excludedCategories");
  if (allowedCategories === null || excludedCategories === null) return null;
  const action = typeof item.action === "string" ? item.action : undefined;
  if (action && !["save", "publish", "pause", "archive"].includes(action)) return null;
  const availabilityStart = item.availabilityStart === null || typeof item.availabilityStart === "string" ? item.availabilityStart : undefined;
  const availabilityEnd = item.availabilityEnd === null || typeof item.availabilityEnd === "string" ? item.availabilityEnd : undefined;
  return {
    placementId: typeof item.placementId === "string" ? item.placementId : undefined,
    listingId: typeof item.listingId === "string" ? item.listingId : undefined,
    action: action as ListingAction | undefined,
    priceCents: typeof item.priceCents === "number" ? item.priceCents : undefined,
    creatorNotes: typeof item.creatorNotes === "string" ? item.creatorNotes : undefined,
    allowedCategories: allowedCategories ?? undefined,
    excludedCategories: excludedCategories ?? undefined,
    availabilityStart,
    availabilityEnd,
  };
}

function validDate(value: string | null | undefined) {
  if (value == null) return true;
  return Number.isFinite(Date.parse(value));
}

function listingUpdate(payload: ListingPayload) {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (payload.priceCents !== undefined) update.price_cents = Math.round(payload.priceCents);
  if (payload.creatorNotes !== undefined) update.creator_notes = payload.creatorNotes.trim().slice(0, MAX_NOTE_LENGTH) || null;
  if (payload.allowedCategories !== undefined) update.allowed_categories = payload.allowedCategories;
  if (payload.excludedCategories !== undefined) update.excluded_categories = payload.excludedCategories;
  if (payload.availabilityStart !== undefined) update.availability_start = payload.availabilityStart;
  if (payload.availabilityEnd !== undefined) update.availability_end = payload.availabilityEnd;
  return update;
}

async function requireCreator() {
  const client = await getServerClient();
  if (!client) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: "You must be signed in to manage marketplace listings." }, { status: 401 }) } as const;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "creator") return { error: NextResponse.json({ error: "Only creator accounts can manage marketplace listings." }, { status: 403 }) } as const;
  return { client, user } as const;
}

async function loadListingCards(client: NonNullable<Awaited<ReturnType<typeof getServerClient>>>, creatorId: string) {
  const { data: listings, error: listingError } = await client
    .from("marketplace_listings")
    .select("id,placement_id,status,price_cents,currency,availability_start,availability_end,allowed_categories,excluded_categories,creator_notes,thumbnail_key,published_at,archived_at,created_at,updated_at")
    .eq("creator_id", creatorId)
    .order("updated_at", { ascending: false });
  if (listingError) throw listingError;
  const placementIds = (listings ?? []).map((listing) => listing.placement_id);
  if (!placementIds.length) return [];
  const { data: placements, error: placementError } = await client
    .from("placements")
    .select("id,video_id,object_label,category,start_seconds,end_seconds,quality,confidence")
    .in("id", placementIds)
    .eq("owner_id", creatorId);
  if (placementError) throw placementError;
  const placementById = new Map(((placements ?? []) as PlacementRow[]).map((placement) => [placement.id, placement]));
  const videoIds = [...new Set((placements ?? []).map((placement) => (placement as PlacementRow).video_id))];
  const { data: videos, error: videoError } = videoIds.length
    ? await client.from("videos").select("id,title,status,thumbnail_key").in("id", videoIds).eq("owner_id", creatorId)
    : { data: [], error: null };
  if (videoError) throw videoError;
  const videoById = new Map(((videos ?? []) as VideoRow[]).map((video) => [video.id, video]));
  return (listings ?? []).flatMap((listing) => {
    const placement = placementById.get(listing.placement_id);
    const video = placement ? videoById.get(placement.video_id) : null;
    if (!placement || !video) return [];
    return [{
      ...listing,
      thumbnail_key: listing.thumbnail_key ?? video.thumbnail_key,
      placement: {
        id: placement.id,
        object_label: placement.object_label,
        category: placement.category,
        start_seconds: placement.start_seconds,
        end_seconds: placement.end_seconds,
        duration_seconds: Math.max(0, placement.end_seconds - placement.start_seconds),
        quality: placement.quality,
        confidence: placement.confidence,
      },
      video: { id: video.id, title: video.title, status: video.status },
    }];
  });
}

export async function GET() {
  const auth = await requireCreator();
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json({ listings: await loadListingCards(auth.client, auth.user.id) });
  } catch {
    return NextResponse.json({ error: "Marketplace listings could not be loaded. Apply the marketplace foundation migration and try again." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireCreator();
  if ("error" in auth) return auth.error;
  let payload: ListingPayload | null;
  try { payload = parsePayload(await request.json()); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!payload?.placementId || !UUID.test(payload.placementId)) return NextResponse.json({ error: "Choose one of your detected placements." }, { status: 400 });
  const priceCents = payload.priceCents;
  if (typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents <= 0) return NextResponse.json({ error: "Set a marketplace price greater than zero." }, { status: 400 });
  if (!validDate(payload.availabilityStart) || !validDate(payload.availabilityEnd)) return NextResponse.json({ error: "Use valid availability dates." }, { status: 400 });
  if (payload.availabilityStart && payload.availabilityEnd && Date.parse(payload.availabilityEnd) <= Date.parse(payload.availabilityStart)) return NextResponse.json({ error: "Availability must end after it starts." }, { status: 400 });

  const { data: placement } = await auth.client
    .from("placements")
    .select("id,video_id,object_label,category,start_seconds,end_seconds,quality")
    .eq("id", payload.placementId)
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (!placement) return NextResponse.json({ error: "That placement is unavailable." }, { status: 404 });
  const { data: video } = await auth.client
    .from("videos")
    .select("status,thumbnail_key,title")
    .eq("id", placement.video_id)
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (!video || video.status !== "ready") return NextResponse.json({ error: "Your video must finish analysis before you publish a placement." }, { status: 409 });

  const now = new Date().toISOString();
  const { data: listing, error } = await auth.client.from("marketplace_listings").insert({
    placement_id: placement.id,
    creator_id: auth.user.id,
    status: "published",
    price_cents: priceCents,
    currency: "usd",
    availability_start: payload.availabilityStart ?? null,
    availability_end: payload.availabilityEnd ?? null,
    allowed_categories: payload.allowedCategories ?? [],
    excluded_categories: payload.excludedCategories ?? [],
    creator_notes: payload.creatorNotes?.trim().slice(0, MAX_NOTE_LENGTH) || null,
    thumbnail_key: video.thumbnail_key,
    object_label: placement.object_label,
    category: placement.category,
    duration_seconds: Math.max(0, placement.end_seconds - placement.start_seconds),
    quality: placement.quality,
    video_title: video.title,
    published_at: now,
    updated_at: now,
  }).select("id,status,price_cents,currency").single();
  if (error || !listing) {
    if (error?.code === "23505") return NextResponse.json({ error: "This placement already has a marketplace listing. Manage it from Marketplace." }, { status: 409 });
    return NextResponse.json({ error: "The placement could not be published." }, { status: 500 });
  }
  await auth.client.from("creator_profiles").upsert({ profile_id: auth.user.id, is_marketplace_enabled: true }, { onConflict: "profile_id" });
  return NextResponse.json({ listing }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireCreator();
  if ("error" in auth) return auth.error;
  let payload: ListingPayload | null;
  try { payload = parsePayload(await request.json()); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!payload?.listingId || !UUID.test(payload.listingId) || !payload.action) return NextResponse.json({ error: "Listing and action are required." }, { status: 400 });
  if (payload.priceCents !== undefined && (!Number.isInteger(payload.priceCents) || payload.priceCents < 0)) return NextResponse.json({ error: "Use a valid whole-number price in cents." }, { status: 400 });
  if (!validDate(payload.availabilityStart) || !validDate(payload.availabilityEnd)) return NextResponse.json({ error: "Use valid availability dates." }, { status: 400 });
  if (payload.availabilityStart && payload.availabilityEnd && Date.parse(payload.availabilityEnd) <= Date.parse(payload.availabilityStart)) return NextResponse.json({ error: "Availability must end after it starts." }, { status: 400 });

  const { data: current } = await auth.client.from("marketplace_listings")
    .select("id,status,price_cents")
    .eq("id", payload.listingId)
    .eq("creator_id", auth.user.id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "That marketplace listing is unavailable." }, { status: 404 });

  const update = listingUpdate(payload);
  if (payload.action === "publish") {
    const price = (update.price_cents as number | undefined) ?? current.price_cents;
    if (!Number.isInteger(price) || price <= 0) return NextResponse.json({ error: "Set a marketplace price greater than zero before publishing." }, { status: 400 });
    update.status = "published";
    update.published_at = new Date().toISOString();
    update.archived_at = null;
  }
  if (payload.action === "pause") update.status = "paused";
  if (payload.action === "archive") { update.status = "archived"; update.archived_at = new Date().toISOString(); }

  const { data: listing, error } = await auth.client.from("marketplace_listings")
    .update(update)
    .eq("id", current.id)
    .eq("creator_id", auth.user.id)
    .select("id,status,price_cents,currency,updated_at")
    .single();
  if (error || !listing) return NextResponse.json({ error: "The marketplace listing could not be updated." }, { status: 500 });
  return NextResponse.json({ listing });
}
