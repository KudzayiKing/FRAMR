import { NextResponse } from "next/server";
import { buildPlacementReplacementPrompt } from "@/services/generation/prompt-builder";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LUCY_PIPELINE = "lucy-shot-aware-v1";
const STAGES = [
  "prepare_source",
  "segment_target",
  "track_target",
  "select_keyframes",
  "edit_keyframes",
  "propagate_frames",
  "composite_frames",
  "quality_check",
  "render_video",
] as const;

type CreateGenerationPayload = {
  placementId: string;
  productId: string;
  targetId: string;
  startFrame?: number;
  endFrame?: number;
  idempotencyKey?: string;
};
type CancelPayload = { runId: string; action: "cancel" };
type PlacementRow = {
  id: string;
  video_id: string;
  owner_id: string;
  object_label: string;
  category: string | null;
  start_seconds: number;
  end_seconds: number;
  box: Record<string, number> | null;
};
type VideoRow = {
  id: string;
  status: string;
  storage_key: string;
  duration_seconds: number | null;
  frame_rate: number | null;
  frame_count: number | null;
};
type ProductRow = { id: string; name: string; brand: string | null; image_key: string | null };
type TargetRow = { id: string; placement_id: string; start_frame: number; end_frame: number; seed_mask_key: string | null; manual_revision: number; status: string };

function isWholeFrame(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseCreatePayload(value: unknown): CreateGenerationPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.placementId !== "string" || typeof payload.productId !== "string") return null;
  if (typeof payload.targetId !== "string") return null;
  if (payload.idempotencyKey != null && (typeof payload.idempotencyKey !== "string" || payload.idempotencyKey.length > 160)) return null;
  if (payload.startFrame != null && !isWholeFrame(payload.startFrame)) return null;
  if (payload.endFrame != null && !isWholeFrame(payload.endFrame)) return null;
  if (payload.startFrame != null && payload.endFrame != null && payload.endFrame < payload.startFrame) return null;
  return {
    placementId: payload.placementId,
    productId: payload.productId,
    targetId: payload.targetId,
    startFrame: payload.startFrame as number | undefined,
    endFrame: payload.endFrame as number | undefined,
    idempotencyKey: payload.idempotencyKey as string | undefined,
  };
}

function parseCancelPayload(value: unknown): CancelPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  return typeof payload.runId === "string" && payload.action === "cancel" ? { runId: payload.runId, action: "cancel" } : null;
}

function asRunResponse(run: { id: string; status: string; version_id: string | null; progress: number | null; current_stage: string | null; error: string | null; estimated_cost_cents: number | null }) {
  return {
    id: run.id,
    status: run.status,
    version_id: run.version_id,
    progress: Number(run.progress ?? 0),
    current_stage: run.current_stage,
    error: run.error,
    cost_cents: run.estimated_cost_cents,
  };
}

export async function POST(request: Request) {
  const client = await getServerClient();
  if (!client) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "You must be signed in to create a placement run." }, { status: 401 });

  let payload: CreateGenerationPayload | null;
  try {
    payload = parseCreatePayload(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!payload) return NextResponse.json({ error: "A placement and product are required. Frame ranges must use non-negative whole frames." }, { status: 400 });

  const [{ data: placement, error: placementError }, { data: product, error: productError }] = await Promise.all([
    client.from("placements").select("id,video_id,owner_id,object_label,category,start_seconds,end_seconds,box").eq("id", payload.placementId).single(),
    client.from("products").select("id,name,brand,image_key").eq("id", payload.productId).single(),
  ]);
  if (placementError || !placement) return NextResponse.json({ error: "The selected placement is unavailable." }, { status: 404 });
  if (productError || !product) return NextResponse.json({ error: "The selected product is unavailable." }, { status: 404 });
  if (!(product as ProductRow).image_key?.startsWith(`products/${user.id}/`)) {
    return NextResponse.json({ error: "The selected product needs a private reference image before it can be rendered." }, { status: 409 });
  }

  const typedPlacement = placement as PlacementRow;
  const { data: video, error: videoError } = await client
    .from("videos")
    .select("id,status,storage_key,duration_seconds,frame_rate,frame_count")
    .eq("id", typedPlacement.video_id)
    .single();
  if (videoError || !video) return NextResponse.json({ error: "The source video is unavailable." }, { status: 404 });
  const typedVideo = video as VideoRow;
  if (typedVideo.status !== "ready" || !typedVideo.storage_key.startsWith(`videos/${user.id}/`)) {
    return NextResponse.json({ error: "The source video is not ready for placement rendering." }, { status: 409 });
  }

  const { data: activeRun } = await client
    .from("placement_runs")
    .select("id,status,version_id,progress,current_stage,error,estimated_cost_cents")
    .eq("owner_id", user.id)
    .eq("placement_id", typedPlacement.id)
    .eq("product_id", payload.productId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeRun) return NextResponse.json({ run: asRunResponse(activeRun), reused: true }, { status: 200 });

  const frameRate = Number(typedVideo.frame_rate ?? 30);
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const inferredEndFrame = typedVideo.frame_count ?? Math.max(0, Math.round(Number(typedVideo.duration_seconds ?? 0) * safeFrameRate) - 1);
  let target: TargetRow | null = null;
  if (payload.targetId) {
    const { data, error } = await client
      .from("placement_targets")
      .select("id,placement_id,start_frame,end_frame,seed_mask_key,manual_revision,status")
      .eq("id", payload.targetId)
      .eq("placement_id", typedPlacement.id)
      .single();
    if (error || !data) return NextResponse.json({ error: "The selected placement target is unavailable." }, { status: 404 });
    target = data as TargetRow;
    if (target.status !== "ready") {
      return NextResponse.json({ error: "FRAMR is still mapping this object through the video. Your version can start as soon as automatic tracking is ready." }, { status: 409 });
    }
  } else {
    const startFrame = payload.startFrame ?? Math.max(0, Math.floor(typedPlacement.start_seconds * safeFrameRate));
    const endFrame = payload.endFrame ?? Math.max(startFrame, Math.min(inferredEndFrame, Math.ceil(typedPlacement.end_seconds * safeFrameRate)));
    const seedFrame = Math.floor((startFrame + endFrame) / 2);
    const { data, error } = await client
      .from("placement_targets")
      .insert({
        placement_id: typedPlacement.id,
        owner_id: user.id,
        start_frame: startFrame,
        end_frame: endFrame,
        seed_frame: seedFrame,
        seed_bbox: typedPlacement.box,
        status: "draft",
      })
      .select("id,placement_id,start_frame,end_frame,manual_revision")
      .single();
    if (error || !data) return NextResponse.json({ error: "The placement target could not be prepared." }, { status: 500 });
    target = data as TargetRow;
  }

  const typedProduct = product as ProductRow;
  const useLucy = process.env.FRAMR_VIDEO_EDITOR === "lucy";
  const label = `${typedProduct.brand ? `${typedProduct.brand} ` : ""}${typedProduct.name}`.slice(0, 160);
  const idempotencyKey = payload.idempotencyKey?.trim() || crypto.randomUUID();
  const { data: version, error: versionError } = await client
    .from("placement_versions")
    .insert({
      placement_id: typedPlacement.id,
      product_id: typedProduct.id,
      label,
      brand: typedProduct.brand,
      status: "generating",
      is_active: false,
      is_source: false,
      pipeline_version: useLucy ? LUCY_PIPELINE : "frame-preserving-v1",
      review_status: "pending",
    })
    .select("id")
    .single();
  if (versionError || !version) return NextResponse.json({ error: "A placement version branch could not be created." }, { status: 500 });

  const settings = useLucy
    ? {
        frameMode: "SHOT_AWARE",
        originalAudio: "preserve",
        targetRevision: target.manual_revision,
        frameRange: { start: target.start_frame, end: target.end_frame },
        pipeline: LUCY_PIPELINE,
      }
    : {
        frameMode: "ADAPTIVE",
        originalAudio: "preserve",
        targetRevision: target.manual_revision,
        frameRange: { start: target.start_frame, end: target.end_frame },
        pipeline: "frame-preserving-v1",
      };
  const { data: run, error: runError } = await client
    .from("placement_runs")
    .insert({
      owner_id: user.id,
      placement_id: typedPlacement.id,
      target_id: target.id,
      product_id: typedProduct.id,
      source_video_id: typedVideo.id,
      version_id: version.id,
      idempotency_key: idempotencyKey,
      image_editor_provider: useLucy ? "decart" : "nvidia-nim",
      image_editor_model: useLucy ? "lucy-latest" : "flux.2-klein-4b",
      settings,
      status: "queued",
      current_stage: useLucy ? "prepare_source" : "prepare_source",
      progress: 0,
      estimated_cost_cents: 0,
    })
    .select("id,status,version_id,progress,current_stage,error,estimated_cost_cents")
    .single();
  if (runError || !run) {
    await client.from("placement_versions").delete().eq("id", version.id);
    return NextResponse.json({ error: "The frame-preserving run could not be queued." }, { status: 500 });
  }

  const { error: versionLinkError } = await client.from("placement_versions").update({ placement_run_id: run.id }).eq("id", version.id);
  if (versionLinkError) {
    await client.from("placement_runs").update({ status: "failed", error: "Version branch linkage failed.", finished_at: new Date().toISOString() }).eq("id", run.id);
    return NextResponse.json({ error: "The placement version could not be linked to its run." }, { status: 500 });
  }

  if (useLucy) {
    const prompt = buildPlacementReplacementPrompt(
      {
        objectLabel: typedPlacement.object_label,
        category: typedPlacement.category,
        startSeconds: typedPlacement.start_seconds,
        endSeconds: typedPlacement.end_seconds,
      },
      {
        name: typedProduct.name,
        brand: typedProduct.brand,
      },
    );
    const { error: lucyJobError } = await client.from("generation_jobs").insert({
      placement_id: typedPlacement.id,
      version_id: version.id,
      product_id: typedProduct.id,
      status: "queued",
      provider: "decart",
      model: "lucy-latest",
      prompt,
    });
    if (lucyJobError) {
      await Promise.all([
        client.from("placement_runs").update({ status: "failed", error: "The Lucy preview job could not be queued.", finished_at: new Date().toISOString() }).eq("id", run.id),
        client.from("placement_versions").update({ status: "failed", review_status: "needs_review" }).eq("id", version.id),
      ]);
      return NextResponse.json({ error: "The Lucy preview could not be queued." }, { status: 500 });
    }
    return NextResponse.json({ run: asRunResponse(run), reused: false }, { status: 201 });
  }

  const { error: stageError } = await client.from("placement_job_steps").insert(
    STAGES.map((jobType, sequence) => ({
      run_id: run.id,
      owner_id: user.id,
      job_type: jobType,
      sequence,
      status: "queued",
      max_attempts: 3,
    })),
  );
  if (stageError) {
    await Promise.all([
      client.from("placement_runs").update({ status: "failed", error: "Pipeline stages could not be created.", finished_at: new Date().toISOString() }).eq("id", run.id),
      client.from("placement_versions").update({ status: "failed", review_status: "needs_review" }).eq("id", version.id),
    ]);
    return NextResponse.json({ error: "The frame-preserving pipeline could not be initialized." }, { status: 500 });
  }

  return NextResponse.json({ run: asRunResponse(run), reused: false }, { status: 201 });
}

export async function PATCH(request: Request) {
  const client = await getServerClient();
  if (!client) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "You must be signed in to cancel a placement run." }, { status: 401 });
  let payload: CancelPayload | null;
  try {
    payload = parseCancelPayload(await request.json());
  } catch {
    payload = null;
  }
  if (!payload) return NextResponse.json({ error: "A placement run cancellation request is required." }, { status: 400 });

  const { data: run, error: runError } = await client
    .from("placement_runs")
    .select("id,status,version_id")
    .eq("id", payload.runId)
    .eq("owner_id", user.id)
    .single();
  if (runError || !run) return NextResponse.json({ error: "The placement run is unavailable." }, { status: 404 });
  if (["ready", "failed", "canceled"].includes(run.status)) return NextResponse.json({ error: "This placement run can no longer be canceled." }, { status: 409 });

  const now = new Date().toISOString();
  const [runUpdate, stageUpdate, versionUpdate, lucyJobUpdate] = await Promise.all([
    client.from("placement_runs").update({ status: "canceled", error: "Canceled by creator.", canceled_at: now, finished_at: now, progress: 0 }).eq("id", run.id),
    client.from("placement_job_steps").update({ status: "canceled", completed_at: now, lease_expires_at: null }).eq("run_id", run.id).in("status", ["queued", "running"]),
    run.version_id ? client.from("placement_versions").update({ status: "failed", review_status: "needs_review" }).eq("id", run.version_id) : Promise.resolve({ error: null }),
    run.version_id
      ? client.from("generation_jobs").update({ status: "canceled", error: "Canceled by creator.", finished_at: now, worker_claimed_at: null, next_poll_at: null }).eq("version_id", run.version_id).in("status", ["queued", "analyzing", "generating", "finalizing", "retrying"])
      : Promise.resolve({ error: null }),
  ]);
  if (runUpdate.error || stageUpdate.error || versionUpdate.error || lucyJobUpdate.error) return NextResponse.json({ error: "The placement run could not be canceled safely." }, { status: 500 });
  return NextResponse.json({ canceled: true, runId: run.id });
}
