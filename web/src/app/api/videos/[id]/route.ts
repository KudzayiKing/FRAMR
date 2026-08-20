import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

type RetryPayload = { action?: unknown };

async function ownedVideo(id: string) {
  const client = await getServerClient();
  if (!client) return { client: null, video: null, error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) };

  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { client: null, video: null, error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };

  const { data: video, error } = await client
    .from("videos")
    .select("id,status,storage_key")
    .eq("id", id)
    .maybeSingle();
  if (error || !video) return { client: null, video: null, error: NextResponse.json({ error: "The video is unavailable." }, { status: 404 }) };

  return { client, video, error: null };
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const owned = await ownedVideo(id);
  if (owned.error || !owned.client || !owned.video) return owned.error!;

  let payload: RetryPayload;
  try {
    payload = await request.json() as RetryPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (payload.action !== "retry_analysis") return NextResponse.json({ error: "Unsupported video action." }, { status: 400 });
  if (owned.video.status !== "failed") return NextResponse.json({ error: "Only failed analyses can be retried." }, { status: 409 });

  const { data, error } = await owned.client
    .from("videos")
    .update({
      status: "processing",
      processing_started_at: null,
      processing_error: null,
      processed_at: null,
      analysis_stage: "queued",
      analysis_progress: 0,
    })
    .eq("id", id)
    .select("id,status,processing_started_at,processing_error,analysis_stage,analysis_progress")
    .single();
  if (error || !data) return NextResponse.json({ error: "The analysis could not be requeued." }, { status: 500 });

  return NextResponse.json({ video: data });
}
