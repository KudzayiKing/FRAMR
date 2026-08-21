import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrandPayload = { name?: string; website?: string };

function parsePayload(value: unknown): BrandPayload | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return { name: typeof item.name === "string" ? item.name : undefined, website: typeof item.website === "string" ? item.website : undefined };
}

function normaliseWebsite(value: string | undefined) {
  const website = value?.trim();
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch { return null; }
}

async function requireAdvertiser() {
  const client = await getServerClient();
  if (!client) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: "You must be signed in to manage your brand." }, { status: 401 }) } as const;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "advertiser") return { error: NextResponse.json({ error: "Only advertiser accounts can manage a brand." }, { status: 403 }) } as const;
  return { client, user } as const;
}

export async function GET() {
  const auth = await requireAdvertiser();
  if ("error" in auth) return auth.error;
  const { data: advertiser, error } = await auth.client
    .from("advertiser_profiles")
    .select("profile_id,brand_id,budget_cents")
    .eq("profile_id", auth.user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Your advertiser profile could not be loaded." }, { status: 500 });
  if (!advertiser?.brand_id) return NextResponse.json({ brand: null, budgetCents: advertiser?.budget_cents ?? 0 });
  const { data: brand, error: brandError } = await auth.client
    .from("brands")
    .select("id,name,website,created_at")
    .eq("id", advertiser.brand_id)
    .eq("profile_id", auth.user.id)
    .maybeSingle();
  if (brandError) return NextResponse.json({ error: "Your brand could not be loaded." }, { status: 500 });
  return NextResponse.json({ brand, budgetCents: advertiser.budget_cents });
}

export async function POST(request: Request) {
  const auth = await requireAdvertiser();
  if ("error" in auth) return auth.error;
  let payload: BrandPayload | null;
  try { payload = parsePayload(await request.json()); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const name = payload?.name?.trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "Your brand name is required." }, { status: 400 });
  const website = normaliseWebsite(payload?.website);
  if (payload?.website?.trim() && !website) return NextResponse.json({ error: "Enter a valid website URL." }, { status: 400 });

  const { data: advertiser, error: advertiserError } = await auth.client
    .from("advertiser_profiles")
    .select("brand_id")
    .eq("profile_id", auth.user.id)
    .maybeSingle();
  if (advertiserError) return NextResponse.json({ error: "Your advertiser profile could not be updated." }, { status: 500 });

  let brand;
  if (advertiser?.brand_id) {
    const result = await auth.client.from("brands").update({ name, website }).eq("id", advertiser.brand_id).eq("profile_id", auth.user.id).select("id,name,website,created_at").single();
    if (result.error || !result.data) return NextResponse.json({ error: "Your brand could not be updated." }, { status: 500 });
    brand = result.data;
  } else {
    const result = await auth.client.from("brands").insert({ profile_id: auth.user.id, name, website }).select("id,name,website,created_at").single();
    if (result.error || !result.data) return NextResponse.json({ error: "Your brand could not be created." }, { status: 500 });
    brand = result.data;
    const { error: profileError } = await auth.client.from("advertiser_profiles").upsert({ profile_id: auth.user.id, brand_id: brand.id, budget_cents: 0 }, { onConflict: "profile_id" });
    if (profileError) return NextResponse.json({ error: "Your brand was created but could not be linked to the advertiser profile." }, { status: 500 });
  }
  return NextResponse.json({ brand }, { status: advertiser?.brand_id ? 200 : 201 });
}
