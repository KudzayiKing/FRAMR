import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DiscoveryRow = {
  listing_id: string; creator_id: string; price_cents: number; currency: string; allowed_categories: string[]; excluded_categories: string[]; creator_notes: string | null;
  object_label: string; category: string | null; duration_seconds: number | null; quality: string | null; video_title: string | null; thumbnail_key: string | null; published_at: string | null; updated_at: string;
  creator_display_name: string | null; creator_handle: string | null;
};

const projectionColumns = "listing_id,creator_id,price_cents,currency,allowed_categories,excluded_categories,creator_notes,object_label,category,duration_seconds,quality,video_title,thumbnail_key,published_at,updated_at,creator_display_name,creator_handle";

async function requireAdvertiser() {
  const client = await getServerClient();
  if (!client) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: "You must be signed in to browse the marketplace." }, { status: 401 }) } as const;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "advertiser") return { error: NextResponse.json({ error: "Only advertiser accounts can browse the marketplace." }, { status: 403 }) } as const;
  const { data: advertiser } = await client.from("advertiser_profiles").select("brand_id").eq("profile_id", user.id).maybeSingle();
  if (!advertiser?.brand_id) return { error: NextResponse.json({ error: "Create your brand profile before browsing creator listings." }, { status: 409 }) } as const;
  return { client, user } as const;
}

function appendFilter(url: URL, query: string, category: string, minPrice: number | null, maxPrice: number | null, limit: number) {
  url.searchParams.set("select", projectionColumns);
  url.searchParams.set("order", "published_at.desc");
  url.searchParams.set("limit", String(limit));
  if (category) url.searchParams.set("category", `eq.${category}`);
  if (minPrice !== null && Number.isFinite(minPrice) && minPrice >= 0) url.searchParams.set("price_cents", `gte.${Math.round(minPrice)}`);
  if (maxPrice !== null && Number.isFinite(maxPrice) && maxPrice >= 0) url.searchParams.append("price_cents", `lte.${Math.round(maxPrice)}`);
  if (query) {
    const safe = query.replaceAll(",", " ").replaceAll("%", "");
    url.searchParams.set("or", `(object_label.ilike.*${safe}*,video_title.ilike.*${safe}*,category.ilike.*${safe}*,creator_display_name.ilike.*${safe}*)`);
  }
}

export async function GET(request: Request) {
  const auth = await requireAdvertiser();
  if ("error" in auth) return auth.error;
  const appUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!appUrl || !anonKey) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const category = requestUrl.searchParams.get("category")?.trim().slice(0, 100) ?? "";
  const rawMinPrice = requestUrl.searchParams.get("minPriceCents");
  const rawMaxPrice = requestUrl.searchParams.get("maxPriceCents");
  const minPrice = rawMinPrice?.trim() ? Number(rawMinPrice) : null;
  const maxPrice = rawMaxPrice?.trim() ? Number(rawMaxPrice) : null;
  const limit = Math.min(48, Math.max(1, Number(requestUrl.searchParams.get("limit") ?? 24) || 24));

  // This table is a creator-approved, source-free public projection. The advertiser
  // authorization above remains mandatory; the anonymous key here only avoids the
  // Supabase SSR client’s inconsistent role propagation for a bounded read.
  const projectionUrl = new URL("/rest/v1/marketplace_discovery", appUrl);
  appendFilter(projectionUrl, query, category, minPrice, maxPrice, limit);
  const response = await fetch(projectionUrl, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    cache: "no-store",
  });
  const raw = await response.text();
  const rows = (() => { try { return JSON.parse(raw) as DiscoveryRow[] | { message?: string }; } catch { return null; } })();
  if (!response.ok || !Array.isArray(rows)) {
    console.error("advertiser_marketplace_projection_failed", { advertiserId: auth.user.id, url: projectionUrl.toString(), status: response.status, response: raw.slice(0, 600) });
    return NextResponse.json({ error: "Marketplace listings could not be loaded. Apply the marketplace discovery projection migration and try again." }, { status: 500 });
  }

  console.info("advertiser_marketplace_projection_loaded", { advertiserId: auth.user.id, count: rows.length });
  const listings = await Promise.all(rows.map(async (listing) => {
    let thumbnailUrl: string | null = null;
    if (listing.thumbnail_key?.startsWith("thumbnails/")) {
      const { data } = await auth.client.storage.from("thumbnails").createSignedUrl(listing.thumbnail_key.slice("thumbnails/".length), 900);
      thumbnailUrl = data?.signedUrl ?? null;
    }
    return {
      id: listing.listing_id,
      price_cents: listing.price_cents,
      currency: listing.currency,
      allowed_categories: listing.allowed_categories,
      excluded_categories: listing.excluded_categories,
      creator_notes: listing.creator_notes,
      object_label: listing.object_label,
      category: listing.category,
      duration_seconds: listing.duration_seconds,
      quality: listing.quality,
      video_title: listing.video_title,
      published_at: listing.published_at,
      thumbnail_url: thumbnailUrl,
      creator: { display_name: listing.creator_display_name ?? "Creator", handle: listing.creator_handle ?? null },
    };
  }));
  return NextResponse.json({ listings });
}
