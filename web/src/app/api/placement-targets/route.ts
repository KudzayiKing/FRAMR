import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreatePayload = { placementId: string };
type SaveMaskPayload = { action: "save_mask"; targetId: string; maskKey: string; mimeType: string; sizeBytes: number };
type PlacementRow = { id: string; video_id: string; start_seconds: number; end_seconds: number; box: Record<string, number> | null };
type VideoRow = { id: string; status: string; storage_key: string; duration_seconds: number | null; frame_rate: number | null; frame_count: number | null };
type TargetRow = {
  id: string;
  seed_frame: number;
  seed_bbox: Record<string, number> | null;
  manual_revision: number;
  status: string;
  tracking_model: string | null;
};
type TargetJobRow = { id: string; status: string };
const FULL_SHOT_TRACKING_MODEL = "sam2.1-hiera-tiny-shot-v1";

function parseCreate(value: unknown): CreatePayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  return typeof payload.placementId === "string" ? { placementId: payload.placementId } : null;
}

function parseSaveMask(value: unknown): SaveMaskPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.action !== "save_mask" || typeof payload.targetId !== "string" || typeof payload.maskKey !== "string" || typeof payload.mimeType !== "string" || typeof payload.sizeBytes !== "number") return null;
  return { action: "save_mask", targetId: payload.targetId, maskKey: payload.maskKey, mimeType: payload.mimeType, sizeBytes: payload.sizeBytes };
}

function validMaskKey(key: string, ownerId: string, targetId: string) {
  const escapedTargetId = targetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^artifacts/${ownerId}/targets/${escapedTargetId}/masks/[0-9a-f-]{36}\\.png$`, "i").test(key);
}

async function queueAutomaticTargetPreparation(client: NonNullable<Awaited<ReturnType<typeof getServerClient>>>, ownerId: string, targetId: string, forceRetry = false) {
  const { data: existing, error: existingError } = await client
    .from("placement_target_jobs")
    .select("id,status")
    .eq("target_id", targetId)
    .eq("job_type", "segment_and_track")
    .maybeSingle();
  if (existingError) throw new Error("Target preparation is unavailable. Apply migration 0009 before using automatic tracking.");

  const typedExisting = existing as TargetJobRow | null;
  if (!typedExisting) {
    const { data: created, error: createError } = await client
      .from("placement_target_jobs")
      .insert({ target_id: targetId, owner_id: ownerId, job_type: "segment_and_track", status: "queued" })
      .select("id,status")
      .single();
    if (createError || !created) throw new Error("FRAMR could not start automatic object tracking.");
    return created as TargetJobRow;
  }

  if (forceRetry || ["complete", "failed", "needs_review", "canceled"].includes(typedExisting.status)) {
    const { data: restarted, error: restartError } = await client
      .from("placement_target_jobs")
      .update({ status: "queued", attempt: 0, worker_id: null, lease_expires_at: null, started_at: null, completed_at: null, canceled_at: null, error: null })
      .eq("id", typedExisting.id)
      .select("id,status")
      .single();
    if (restartError || !restarted) throw new Error("FRAMR could not restart automatic object tracking.");
    return restarted as TargetJobRow;
  }
  return typedExisting;
}

export async function POST(request: Request) {
  const client = await getServerClient();
  if (!client) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "You must be signed in to prepare a placement target." }, { status: 401 });
  let payload: CreatePayload | null;
  try { payload = parseCreate(await request.json()); } catch { payload = null; }
  if (!payload) return NextResponse.json({ error: "A placement is required." }, { status: 400 });

  const { data: placement, error: placementError } = await client
    .from("placements")
    .select("id,video_id,start_seconds,end_seconds,box")
    .eq("id", payload.placementId)
    .single();
  if (placementError || !placement) return NextResponse.json({ error: "The selected placement is unavailable." }, { status: 404 });
  const typedPlacement = placement as PlacementRow;

  const { data: video, error: videoError } = await client
    .from("videos")
    .select("id,status,storage_key,duration_seconds,frame_rate,frame_count")
    .eq("id", typedPlacement.video_id)
    .single();
  if (videoError || !video) return NextResponse.json({ error: "The source video is unavailable." }, { status: 404 });
  const typedVideo = video as VideoRow;
  if (typedVideo.status !== "ready" || !typedVideo.storage_key.startsWith(`videos/${user.id}/`)) {
    return NextResponse.json({ error: "The source video is not ready for automatic tracking." }, { status: 409 });
  }
  if (!typedPlacement.box) return NextResponse.json({ error: "This placement has no usable detection box. Choose another object or request review." }, { status: 409 });

  const { data: existing, error: existingError } = await client
    .from("placement_targets")
    .select("id,placement_id,start_frame,end_frame,seed_frame,seed_bbox,seed_mask_key,manual_revision,status,tracking_model")
    .eq("placement_id", typedPlacement.id)
    .in("status", ["draft", "tracking", "ready", "needs_review"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: "FRAMR could not load the selected placement target." }, { status: 500 });

  let target = existing;
  let reused = Boolean(existing);
  const requiresFullShotRetrack = Boolean(
    target
      && (target as TargetRow).status === "ready"
      && (target as TargetRow).tracking_model !== FULL_SHOT_TRACKING_MODEL,
  );
  const retryRecoverableTarget = Boolean(target && (target as TargetRow).status === "needs_review");
  if (requiresFullShotRetrack || retryRecoverableTarget) {
    const { data: retrackTarget, error: retrackError } = await client
      .from("placement_targets")
      .update({
        status: "tracking",
        tracking_provider: "sam2",
        tracking_model: FULL_SHOT_TRACKING_MODEL,
      })
      .eq("id", String((target as TargetRow).id))
      .select("id,placement_id,start_frame,end_frame,seed_frame,seed_bbox,seed_mask_key,manual_revision,status,tracking_model")
      .single();
    if (retrackError || !retrackTarget) return NextResponse.json({ error: "FRAMR could not restart automatic object tracking." }, { status: 500 });
    target = retrackTarget;
    reused = false;
  }
  if (!target) {
    const frameRate = Number(typedVideo.frame_rate ?? 30);
    const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
    const totalFrames = Number(typedVideo.frame_count ?? Math.max(1, Math.round(Number(typedVideo.duration_seconds ?? 0) * safeFrameRate)));
    const startFrame = Math.max(0, Math.floor(typedPlacement.start_seconds * safeFrameRate));
    const endFrame = Math.max(startFrame, Math.min(Math.max(0, totalFrames - 1), Math.ceil(typedPlacement.end_seconds * safeFrameRate)));
    const seedFrame = Math.floor((startFrame + endFrame) / 2);
    const { data: created, error: targetError } = await client
      .from("placement_targets")
      .insert({
        placement_id: typedPlacement.id,
        owner_id: user.id,
        start_frame: startFrame,
        end_frame: endFrame,
        seed_frame: seedFrame,
        seed_bbox: typedPlacement.box,
        tracking_provider: "sam2",
        tracking_model: FULL_SHOT_TRACKING_MODEL,
        status: "tracking",
      })
      .select("id,placement_id,start_frame,end_frame,seed_frame,seed_bbox,seed_mask_key,manual_revision,status,tracking_model")
      .single();
    if (targetError || !created) return NextResponse.json({ error: "The automatic placement target could not be created." }, { status: 500 });
    target = created;
    reused = false;
  }

  try {
    const job = await queueAutomaticTargetPreparation(
      client,
      user.id,
      String((target as TargetRow).id),
      requiresFullShotRetrack || retryRecoverableTarget,
    );
    return NextResponse.json({ target, job, reused, automatic: true }, { status: reused ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FRAMR could not start automatic object tracking.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const client = await getServerClient();
  if (!client) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "You must be signed in to save a refined mask." }, { status: 401 });
  let payload: SaveMaskPayload | null;
  try { payload = parseSaveMask(await request.json()); } catch { payload = null; }
  if (!payload) return NextResponse.json({ error: "A valid refined mask is required." }, { status: 400 });
  if (payload.mimeType !== "image/png" || payload.sizeBytes <= 0 || payload.sizeBytes > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "Mask artifacts must be PNG files no larger than 20 MB." }, { status: 400 });
  }
  if (!validMaskKey(payload.maskKey, user.id, payload.targetId)) {
    return NextResponse.json({ error: "The private mask path is invalid for this target." }, { status: 403 });
  }

  const { data: target, error: targetError } = await client
    .from("placement_targets")
    .select("id,seed_frame,seed_bbox,manual_revision,status,tracking_model")
    .eq("id", payload.targetId)
    .single();
  if (targetError || !target) return NextResponse.json({ error: "The placement target is unavailable." }, { status: 404 });
  const typedTarget = target as TargetRow;
  const objectPath = payload.maskKey.slice("artifacts/".length);
  const directory = objectPath.split("/").slice(0, -1).join("/");
  const objectName = objectPath.split("/").at(-1) ?? "";
  const { data: objects, error: storageError } = await client.storage.from("artifacts").list(directory, { search: objectName, limit: 1 });
  if (storageError || !objects?.some((item) => item.name === objectName)) {
    return NextResponse.json({ error: "The private mask upload could not be verified." }, { status: 409 });
  }

  const revision = typedTarget.manual_revision + 1;
  const { data: updatedTarget, error: updateError } = await client
    .from("placement_targets")
    .update({ seed_mask_key: payload.maskKey, manual_revision: revision, status: "tracking" })
    .eq("id", typedTarget.id)
    .select("id,placement_id,start_frame,end_frame,seed_frame,seed_bbox,seed_mask_key,manual_revision,status,tracking_model")
    .single();
  if (updateError || !updatedTarget) return NextResponse.json({ error: "The placement target could not be updated." }, { status: 500 });

  const { error: maskError } = await client.from("placement_masks").upsert(
    {
      target_id: typedTarget.id,
      owner_id: user.id,
      frame_index: typedTarget.seed_frame,
      kind: "target",
      storage_key: payload.maskKey,
      bbox: typedTarget.seed_bbox,
      confidence: 1,
      is_occluded: false,
      revision,
    },
    { onConflict: "target_id,frame_index,kind,revision" },
  );
  if (maskError) return NextResponse.json({ error: "The refined mask was saved, but its tracking metadata was rejected. Apply migration 0009 and retry." }, { status: 503 });

  try {
    const job = await queueAutomaticTargetPreparation(client, user.id, typedTarget.id, true);
    return NextResponse.json({ target: updatedTarget, job, automatic: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FRAMR could not restart automatic object tracking.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
