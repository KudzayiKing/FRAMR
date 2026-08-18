import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";
import { buildPlacementReplacementPrompt } from "@/services/generation/prompt-builder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateGenerationPayload = { placementId: string; productId: string };
type PlacementRow = {
  id: string;
  video_id: string;
  object_label: string;
  category: string | null;
  start_seconds: number;
  end_seconds: number;
};
type VideoRow = { id: string; status: string; storage_key: string; duration_seconds: number | null };
type ProductRow = { id: string; name: string; brand: string | null; description: string | null; image_key: string | null };

function parsePayload(value: unknown): CreateGenerationPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.placementId !== "string" || typeof payload.productId !== "string") return null;
  return { placementId: payload.placementId, productId: payload.productId };
}

export async function POST(request: Request) {
  const client = await getServerClient();
  if (!client) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "You must be signed in to create a generation." }, { status: 401 });

  let payload: CreateGenerationPayload | null;
  try {
    payload = parsePayload(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!payload) return NextResponse.json({ error: "A placement and product are required." }, { status: 400 });

  const [{ data: placement, error: placementError }, { data: product, error: productError }] = await Promise.all([
    client.from("placements").select("id,video_id,object_label,category,start_seconds,end_seconds").eq("id", payload.placementId).single(),
    client.from("products").select("id,name,brand,description,image_key").eq("id", payload.productId).single(),
  ]);
  if (placementError || !placement) return NextResponse.json({ error: "The selected placement is unavailable." }, { status: 404 });
  if (productError || !product) return NextResponse.json({ error: "The selected product is unavailable." }, { status: 404 });
  if (!product.image_key?.startsWith(`products/${user.id}/`)) {
    return NextResponse.json({ error: "The selected product needs a private reference image before it can be generated." }, { status: 409 });
  }

  const { data: video, error: videoError } = await client
    .from("videos")
    .select("id,status,storage_key,duration_seconds")
    .eq("id", placement.video_id)
    .single();
  if (videoError || !video) return NextResponse.json({ error: "The source video is unavailable." }, { status: 404 });
  if (video.status !== "ready" || !video.storage_key.startsWith(`videos/${user.id}/`)) {
    return NextResponse.json({ error: "The source video is not ready for generation." }, { status: 409 });
  }
  if (Number(video.duration_seconds ?? 0) <= 0) return NextResponse.json({ error: "The source video has invalid duration metadata." }, { status: 409 });

  const typedPlacement = placement as PlacementRow;
  const typedProduct = product as ProductRow;
  const prompt = buildPlacementReplacementPrompt(
    {
      objectLabel: typedPlacement.object_label,
      category: typedPlacement.category,
      startSeconds: typedPlacement.start_seconds,
      endSeconds: typedPlacement.end_seconds,
    },
    typedProduct,
  );
  const estimatedCostCents = Math.round(Number(video.duration_seconds) * Number(process.env.LUCY_COST_CENTS_PER_SECOND ?? 4));
  const provider = process.env.FRAMR_GENERATION_MODE === "decart" ? "decart" : "mock";
  const model = provider === "decart" ? process.env.DECART_MODEL ?? "lucy-latest" : "mock-lucy";
  const label = `${typedProduct.brand ? `${typedProduct.brand} ` : ""}${typedProduct.name}`.slice(0, 160);

  const { data: version, error: versionError } = await client
    .from("placement_versions")
    .insert({ placement_id: typedPlacement.id, product_id: typedProduct.id, label, brand: typedProduct.brand, status: "generating", is_active: false, is_source: false })
    .select("id,status")
    .single();
  if (versionError || !version) return NextResponse.json({ error: "A version branch could not be created." }, { status: 500 });

  const { data: job, error: jobError } = await client
    .from("generation_jobs")
    .insert({ placement_id: typedPlacement.id, version_id: version.id, product_id: typedProduct.id, status: "queued", provider, model, prompt, cost_cents: estimatedCostCents })
    .select("id,status,version_id,provider,model,prompt,cost_cents,created_at")
    .single();
  if (jobError || !job) {
    await client.from("placement_versions").delete().eq("id", version.id);
    return NextResponse.json({ error: "The generation job could not be queued." }, { status: 500 });
  }

  return NextResponse.json({ generation: job }, { status: 201 });
}
