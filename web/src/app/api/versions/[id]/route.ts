import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function ownedVersion(id: string) {
  const client = await getServerClient();
  if (!client) return { client: null, error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) };
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { client: null, error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  const { data: version, error } = await client.from("placement_versions").select("id,placement_id,status,video_key").eq("id", id).single();
  if (error || !version) return { client: null, error: NextResponse.json({ error: "The version is unavailable." }, { status: 404 }) };
  return { client, version, error: null };
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const owned = await ownedVersion(id);
  if (owned.error || !owned.client || !owned.version) return owned.error!;
  let action: string | null = null;
  try { const body = await request.json() as { action?: unknown }; action = typeof body.action === "string" ? body.action : null; } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (action !== "activate" && action !== "deactivate") return NextResponse.json({ error: "Unsupported version action." }, { status: 400 });
  if (owned.version.status !== "ready") return NextResponse.json({ error: "Only ready versions can be activated." }, { status: 409 });
  if (action === "activate") {
    const { error: clearError } = await owned.client.from("placement_versions").update({ is_active: false }).eq("placement_id", owned.version.placement_id);
    if (clearError) return NextResponse.json({ error: "The active version could not be updated." }, { status: 500 });
  }
  const { data, error } = await owned.client.from("placement_versions").update({ is_active: action === "activate" }).eq("id", id).select("id,is_active,status").single();
  if (error || !data) return NextResponse.json({ error: "The version could not be updated." }, { status: 500 });
  return NextResponse.json({ version: data });
}

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const owned = await ownedVersion(id);
  if (owned.error || !owned.client || !owned.version) return owned.error!;
  if (owned.version.status !== "ready" || !owned.version.video_key?.startsWith("generated/")) return NextResponse.json({ error: "This version is not ready for export." }, { status: 409 });
  const objectPath = owned.version.video_key.slice("generated/".length);
  const { data, error } = await owned.client.storage.from("generated").createSignedUrl(objectPath, 60 * 10, { download: `framr-${id}.mp4` });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "An export link could not be created." }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
