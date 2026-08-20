import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getGenerationProvider, type GenerationStatus } from "../services/generation/types";
import {
  buildLucyStatePlan,
  splitLucyStatePlanForProvider,
  type LucyStateWindow,
  type MaskSample,
  type ProductReference,
  withLucyStatePrompt,
} from "../services/generation/lucy-state-plan";

const execFileAsync = promisify(execFile);
const MAX_LUCY_INPUT_BYTES = 200 * 1024 * 1024;

type ClaimedJob = {
  id: string;
  placement_id: string;
  version_id: string;
  product_id: string;
  status: GenerationStatus;
  provider: string | null;
  model: string | null;
  provider_job_id: string | null;
  prompt: string | null;
  attempts: number;
  output_key: string | null;
  state_plan?: unknown;
  state_outputs?: unknown;
  current_window_index?: number;
};
type PlacementRow = {
  id: string;
  owner_id: string;
  video_id: string;
  object_label: string;
  category: string | null;
  start_seconds: number;
  end_seconds: number;
};
type VideoRow = { id: string; storage_key: string; duration_seconds: number | null; frame_rate: number | null; frame_count: number | null };
type PlacementTargetRow = {
  id: string;
  start_frame: number;
  end_frame: number;
  shot_start_frame: number | null;
  shot_end_frame: number | null;
  manual_revision: number;
  status: string;
};
type ProductRow = { id: string; image_key: string };
type ProductReferenceRow = { storage_key: string; view_type: ProductReference["state"]; sort_order: number };
type SourceWindow = { startSeconds: number; endSeconds: number; durationSeconds: number; source: "tracked-shot" | "detected-fallback" };
type StateOutputMap = Record<string, string>;
type Settings = {
  supabaseUrl: string;
  serviceRoleKey: string;
  ffmpegBin: string;
  ffprobeBin: string;
  pollSeconds: number;
  windowPaddingSeconds: number;
};

function getSettings(): Settings {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const pollSeconds = Number(process.env.FRAMR_GENERATION_POLL_SECONDS ?? 5);
  const windowPaddingSeconds = Number(process.env.FRAMR_LUCY_WINDOW_PADDING_SECONDS ?? 0.75);
  return {
    supabaseUrl,
    serviceRoleKey,
    ffmpegBin: process.env.FRAMR_FFMPEG_BIN ?? "ffmpeg",
    ffprobeBin: process.env.FRAMR_FFPROBE_BIN ?? "ffprobe",
    pollSeconds: Number.isFinite(pollSeconds) && pollSeconds > 0 ? pollSeconds : 5,
    windowPaddingSeconds: Number.isFinite(windowPaddingSeconds) && windowPaddingSeconds >= 0 ? windowPaddingSeconds : 0.75,
  };
}

function storagePath(key: string, bucket: string) {
  const prefix = `${bucket}/`;
  if (!key.startsWith(prefix)) throw new Error(`Expected a ${bucket}-bucket storage key.`);
  const value = key.slice(prefix.length);
  if (!value || value.includes("..")) throw new Error("Invalid storage path.");
  return value;
}

function imageContentType(key: string) {
  if (/\.png$/i.test(key)) return "image/png";
  if (/\.webp$/i.test(key)) return "image/webp";
  return "image/jpeg";
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown worker error";
  return message.includes("DECART") || message.includes("Decart")
    ? "The generation provider could not complete this preview. Your selected product is saved."
    : "The preview could not be completed safely. Your selected product is saved.";
}

function isTransientDecartPollFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /Decart request failed \((429|500|502|503|504)\)/.test(message);
}

async function ffmpeg(ffmpegBin: string, args: string[]) {
  await execFileAsync(ffmpegBin, ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 4 * 1024 * 1024 });
}

async function probeDuration(ffprobeBin: string, path: string) {
  const { stdout } = await execFileAsync(ffprobeBin, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("A generated state window has no readable video duration.");
  return duration;
}

async function validateStateWindowDurations(ffprobeBin: string, paths: string[], plan: LucyStateWindow[]) {
  await Promise.all(paths.map(async (path, index) => {
    const actual = await probeDuration(ffprobeBin, path);
    const expected = plan[index]!.endSeconds - plan[index]!.startSeconds;
    if (Math.abs(actual - expected) > 0.85) {
      throw new Error(`A generated ${plan[index]!.state} product-state window has an unsafe duration mismatch.`);
    }
  }));
}

function placementWindow(placement: PlacementRow, target: PlacementTargetRow | null, video: VideoRow, paddingSeconds: number): SourceWindow {
  const sourceDuration = Number(video.duration_seconds ?? 0);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error("The source video duration is unavailable for preview generation.");
  const frameRate = Number(video.frame_rate ?? 0);
  const trackedStart = Number(target?.start_frame);
  const trackedEnd = Number(target?.end_frame);
  if (target?.status === "ready" && Number.isFinite(frameRate) && frameRate > 0 && Number.isFinite(trackedStart) && Number.isFinite(trackedEnd) && trackedEnd >= trackedStart) {
    const hasShotBounds = target.shot_start_frame !== null && target.shot_end_frame !== null
      && Number.isFinite(target.shot_start_frame) && Number.isFinite(target.shot_end_frame)
      && target.shot_end_frame >= target.shot_start_frame;
    const shotStartSeconds = hasShotBounds && target.shot_start_frame !== null ? Math.max(0, target.shot_start_frame / frameRate) : 0;
    const shotEndSeconds = hasShotBounds && target.shot_end_frame !== null ? Math.min(sourceDuration, (target.shot_end_frame + 1) / frameRate) : sourceDuration;
    const startSeconds = Math.max(shotStartSeconds, trackedStart / frameRate - paddingSeconds);
    const endSeconds = Math.min(shotEndSeconds, (trackedEnd + 1) / frameRate + paddingSeconds);
    const durationSeconds = endSeconds - startSeconds;
    if (durationSeconds >= 1) return { startSeconds, endSeconds, durationSeconds, source: "tracked-shot" };
  }
  const detectedStart = Number(placement.start_seconds);
  const detectedEnd = Number(placement.end_seconds);
  if (!Number.isFinite(detectedStart) || !Number.isFinite(detectedEnd) || detectedEnd <= detectedStart) throw new Error("The selected placement does not have a usable detected range.");
  const startSeconds = Math.max(0, detectedStart - paddingSeconds);
  const endSeconds = Math.min(sourceDuration, detectedEnd + paddingSeconds);
  const durationSeconds = endSeconds - startSeconds;
  if (durationSeconds < 1) throw new Error("The selected Lucy window is too short to generate safely.");
  return { startSeconds, endSeconds, durationSeconds, source: "detected-fallback" };
}

function asSourceWindow(window: LucyStateWindow, source: SourceWindow["source"]): SourceWindow {
  return {
    startSeconds: window.startSeconds,
    endSeconds: window.endSeconds,
    durationSeconds: window.endSeconds - window.startSeconds,
    source,
  };
}

function validStateWindow(value: unknown): value is LucyStateWindow {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.index === "number" && typeof item.state === "string" && typeof item.referenceKey === "string"
    && typeof item.startSeconds === "number" && typeof item.endSeconds === "number" && typeof item.startFrame === "number"
    && typeof item.endFrame === "number" && typeof item.promptSuffix === "string" && typeof item.splitReason === "string"
    && item.endSeconds > item.startSeconds;
}

function readStatePlan(job: ClaimedJob) {
  return Array.isArray(job.state_plan) && job.state_plan.every(validStateWindow)
    ? job.state_plan as LucyStateWindow[]
    : [];
}

function readStateOutputs(job: ClaimedJob): StateOutputMap {
  if (!job.state_outputs || typeof job.state_outputs !== "object" || Array.isArray(job.state_outputs)) return {};
  return Object.entries(job.state_outputs as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .reduce<StateOutputMap>((outputs, [index, key]) => ({ ...outputs, [index]: key }), {});
}

function validatePlan(plan: LucyStateWindow[]) {
  if (!plan.length || plan.length > 8) throw new Error("The product-state plan is invalid.");
  const ordered = [...plan].sort((a, b) => a.index - b.index);
  for (let index = 0; index < ordered.length; index += 1) {
    const window = ordered[index];
    if (window.index !== index || window.endSeconds - window.startSeconds < 1 || !window.referenceKey.startsWith("products/")) {
      throw new Error("The product-state plan contains an unsafe window.");
    }
    const previous = ordered[index - 1];
    if (previous && Math.abs(previous.endSeconds - window.startSeconds) > 0.12) {
      throw new Error("The product-state windows are not source-contiguous.");
    }
  }
  return ordered;
}

async function providerReadyVideo(ffmpegBin: string, sourcePath: string, outputPath: string, window: SourceWindow) {
  await ffmpeg(ffmpegBin, [
    "-ss", window.startSeconds.toFixed(3),
    "-i", sourcePath,
    "-t", window.durationSeconds.toFixed(3),
    "-map", "0:v:0",
    "-an",
    // Lucy accepts portrait H.264 inputs, but normalizing each state window to
    // 30 fps avoids provider-side validation failures on 60 fps mobile sources
    // and gives both state windows identical, predictable media properties.
    "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black",
    "-r", "30",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ]);
  const details = await stat(outputPath);
  if (details.size > MAX_LUCY_INPUT_BYTES) throw new Error("The normalized source window exceeds Lucy's 200 MB input limit.");
}

async function finalizeStateWindows(
  ffmpegBin: string,
  generatedPaths: string[],
  originalPath: string,
  outputPath: string,
  plan: LucyStateWindow[],
  originalDurationSeconds: number,
) {
  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  const originalInput = generatedPaths.length;
  let cursor = 0;
  let parts = 0;
  for (const window of plan) {
    if (window.startSeconds - cursor > 0.05) {
      filterParts.push(`[${originalInput}:v]trim=start=${cursor.toFixed(3)}:end=${window.startSeconds.toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[source${parts}]`);
      concatInputs.push(`[source${parts}]`);
      parts += 1;
    }
    filterParts.push(`[${window.index}:v]trim=duration=${(window.endSeconds - window.startSeconds).toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[edited${window.index}]`);
    concatInputs.push(`[edited${window.index}]`);
    parts += 1;
    cursor = window.endSeconds;
  }
  if (Number.isFinite(originalDurationSeconds) && originalDurationSeconds - cursor > 0.05) {
    filterParts.push(`[${originalInput}:v]trim=start=${cursor.toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black[tail]`);
    concatInputs.push("[tail]");
    parts += 1;
  }
  filterParts.push(`${concatInputs.join("")}concat=n=${parts}:v=1:a=0[video]`);
  const args = generatedPaths.flatMap((path) => ["-i", path]);
  await ffmpeg(ffmpegBin, [
    ...args,
    "-i", originalPath,
    "-filter_complex", filterParts.join(";"),
    "-map", "[video]",
    "-map", `${originalInput}:a?`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath,
  ]);
}

async function makeThumbnail(ffmpegBin: string, videoPath: string, thumbnailPath: string) {
  await ffmpeg(ffmpegBin, ["-ss", "0.1", "-i", videoPath, "-frames:v", "1", "-q:v", "2", thumbnailPath]);
}

export class GenerationWorker {
  private readonly client: SupabaseClient;
  private readonly settings: Settings;

  constructor(settings = getSettings()) {
    this.settings = settings;
    this.client = createClient(settings.supabaseUrl, settings.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  }

  private async download(key: string, bucket: string) {
    const { data, error } = await this.client.storage.from(bucket).download(storagePath(key, bucket));
    if (error || !data) throw new Error(`Could not download private ${bucket} media.`);
    return new Uint8Array(await data.arrayBuffer());
  }

  private async claim() {
    const { data, error } = await this.client.rpc("claim_next_generation_job");
    if (error) throw new Error(`Could not claim generation job: ${error.message}`);
    return ((data ?? []) as ClaimedJob[])[0] ?? null;
  }

  private async loadContext(job: ClaimedJob) {
    const [{ data: placement, error: placementError }, { data: product, error: productError }, { data: target, error: targetError }] = await Promise.all([
      this.client.from("placements").select("id,owner_id,video_id,object_label,category,start_seconds,end_seconds").eq("id", job.placement_id).single(),
      this.client.from("products").select("id,image_key").eq("id", job.product_id).single(),
      this.client.from("placement_targets").select("id,start_frame,end_frame,shot_start_frame,shot_end_frame,manual_revision,status").eq("placement_id", job.placement_id).eq("status", "ready").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (placementError || !placement || productError || !product?.image_key) throw new Error("Generation context is no longer available.");
    if (targetError) throw new Error("FRAMR could not load the tracked shot window.");
    const typedTarget = (target as PlacementTargetRow | null) ?? null;
    const [{ data: video, error: videoError }, { data: references, error: referenceError }, { data: masks, error: maskError }] = await Promise.all([
      this.client.from("videos").select("id,storage_key,duration_seconds,frame_rate,frame_count").eq("id", (placement as PlacementRow).video_id).single(),
      this.client.from("product_references").select("storage_key,view_type,sort_order").eq("product_id", job.product_id).order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
      typedTarget
        ? this.client.from("placement_masks").select("frame_index,is_occluded").eq("target_id", typedTarget.id).eq("kind", "target").eq("revision", typedTarget.manual_revision).order("frame_index", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (videoError || !video) throw new Error("Source video is no longer available.");
    if (referenceError || maskError) throw new Error("FRAMR could not load product-state guidance.");
    const typedProduct = product as ProductRow;
    const productReferences: ProductReference[] = ((references ?? []) as ProductReferenceRow[])
      .filter((reference) => reference.storage_key.startsWith("products/"))
      .map((reference) => ({ storageKey: reference.storage_key, state: reference.view_type, sortOrder: reference.sort_order }));
    if (!productReferences.length) productReferences.push({ storageKey: typedProduct.image_key, state: "primary", sortOrder: 0 });
    return {
      placement: placement as PlacementRow,
      product: typedProduct,
      target: typedTarget,
      video: video as VideoRow,
      references: productReferences,
      masks: ((masks ?? []) as Array<{ frame_index: number; is_occluded: boolean }>).map<MaskSample>((mask) => ({ frameIndex: mask.frame_index, isOccluded: Boolean(mask.is_occluded) })),
    };
  }

  private async updateJob(id: string, values: Record<string, unknown>) {
    const { error } = await this.client.from("generation_jobs").update(values).eq("id", id);
    if (error) throw new Error(`Could not update generation job: ${error.message}`);
  }

  private async updateAssociatedRun(job: ClaimedJob, values: Record<string, unknown>) {
    if (!job.version_id) return;
    const { error } = await this.client.from("placement_runs").update(values).eq("version_id", job.version_id);
    if (error) throw new Error(`Could not update linked placement run: ${error.message}`);
  }

  private async deferProviderPoll(job: ClaimedJob, error: unknown) {
    const retryAt = new Date(Date.now() + Math.max(this.settings.pollSeconds, 15) * 1000).toISOString();
    await Promise.all([
      this.updateJob(job.id, { status: "generating", provider_status: "temporary-status-delay", worker_claimed_at: null, next_poll_at: retryAt }),
      this.updateAssociatedRun(job, { status: "running", current_stage: "edit_keyframes", progress: 55, error: null }),
    ]);
    console.warn(`generation_status_poll_delayed id=${job.id}`, error);
  }

  private async fail(job: ClaimedJob, error: unknown) {
    const message = safeError(error);
    await Promise.all([
      this.client.from("generation_jobs").update({ status: "failed", error: message, finished_at: new Date().toISOString(), worker_claimed_at: null, next_poll_at: null }).eq("id", job.id),
      this.client.from("placement_versions").update({ status: "failed", review_status: "needs_review" }).eq("id", job.version_id),
      this.updateAssociatedRun(job, { status: "failed", current_stage: "quality_check", error: message, finished_at: new Date().toISOString() }),
    ]);
    console.error(`generation_job_failed id=${job.id}`, error);
  }

  private async buildPlan(job: ClaimedJob, context: Awaited<ReturnType<GenerationWorker["loadContext"]>>) {
    const existing = readStatePlan(job);
    if (existing.length) return validatePlan(existing);
    const window = placementWindow(context.placement, context.target, context.video, this.settings.windowPaddingSeconds);
    const plan = validatePlan(splitLucyStatePlanForProvider(
      buildLucyStatePlan({
        startSeconds: window.startSeconds,
        endSeconds: window.endSeconds,
        frameRate: Number(context.video.frame_rate ?? 30),
        references: context.references,
        masks: context.masks,
      }),
      Number(context.video.frame_rate ?? 30),
    ));
    await this.updateJob(job.id, { state_plan: plan, state_outputs: {}, current_window_index: 0 });
    return plan;
  }

  private async finalize(job: ClaimedJob, context: Awaited<ReturnType<GenerationWorker["loadContext"]>>, plan: LucyStateWindow[], outputs: StateOutputMap) {
    const tempDir = await mkdtemp(join(tmpdir(), "framr-generation-"));
    try {
      const originalPath = join(tempDir, "source-original.mp4");
      const generatedPaths = plan.map((window) => join(tempDir, `lucy-state-${window.index}.mp4`));
      const finalPath = join(tempDir, "framr-final.mp4");
      const thumbnailPath = join(tempDir, "framr-final.jpg");
      const outputKeys = plan.map((window) => outputs[String(window.index)]);
      if (outputKeys.some((key) => !key)) throw new Error("A product-state output is missing; FRAMR will not publish a partial preview.");
      const [originalBytes, ...generatedBytes] = await Promise.all([
        this.download(context.video.storage_key, "videos"),
        ...outputKeys.map((key) => this.download(key as string, "generated")),
      ]);
      await Promise.all([
        writeFile(originalPath, originalBytes),
        ...generatedPaths.map((path, index) => writeFile(path, generatedBytes[index] as Uint8Array)),
      ]);
      await validateStateWindowDurations(this.settings.ffprobeBin, generatedPaths, plan);
      await finalizeStateWindows(this.settings.ffmpegBin, generatedPaths, originalPath, finalPath, plan, Number(context.video.duration_seconds ?? 0));
      await makeThumbnail(this.settings.ffmpegBin, finalPath, thumbnailPath);
      const finalDetails = await stat(finalPath);
      const finalDuration = await probeDuration(this.settings.ffprobeBin, finalPath);
      const sourceDuration = Number(context.video.duration_seconds ?? 0);
      if (finalDetails.size < 1_024 || (Number.isFinite(sourceDuration) && Math.abs(finalDuration - sourceDuration) > 0.85)) {
        throw new Error("The final preview failed its render-integrity check.");
      }

      const videoObjectPath = `${context.placement.owner_id}/${job.version_id}.mp4`;
      const thumbnailObjectPath = `${context.placement.owner_id}/${job.version_id}.jpg`;
      const [finalBytes, thumbnailBytes] = await Promise.all([readFile(finalPath), readFile(thumbnailPath)]);
      const [videoUpload, thumbnailUpload] = await Promise.all([
        this.client.storage.from("generated").upload(videoObjectPath, finalBytes, { contentType: "video/mp4", upsert: true }),
        this.client.storage.from("thumbnails").upload(thumbnailObjectPath, thumbnailBytes, { contentType: "image/jpeg", upsert: true }),
      ]);
      if (videoUpload.error || thumbnailUpload.error) throw new Error("Generated media could not be saved to private storage.");

      const videoKey = `generated/${videoObjectPath}`;
      const thumbnailKey = `thumbnails/${thumbnailObjectPath}`;
      const completedAt = new Date().toISOString();
      const qualitySummary = {
        stateWindowCount: plan.length,
        continuity: plan.some((window) => window.splitReason === "tracked-transition") ? "state-transition-guided" : "canonical-reference-guided",
        sourceAudio: "preserved",
        renderIntegrity: "pass",
        durationIntegrity: "pass",
      };
      const [versionUpdate, jobUpdate] = await Promise.all([
        this.client.from("placement_versions").update({ status: "ready", video_key: videoKey, thumbnail_key: thumbnailKey, quality_summary: qualitySummary }).eq("id", job.version_id),
        this.client.from("generation_jobs").update({ status: "complete", output_key: videoKey, output_thumbnail_key: thumbnailKey, worker_claimed_at: null, next_poll_at: null, finished_at: completedAt, provider_status: "completed", state_outputs: outputs }).eq("id", job.id),
      ]);
      if (versionUpdate.error || jobUpdate.error) throw new Error("Generated media was saved but preview status could not be finalized.");
      await this.updateAssociatedRun(job, { status: "ready", current_stage: "render_video", progress: 100, error: null, quality_summary: qualitySummary, finished_at: completedAt });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async completeWindow(job: ClaimedJob, context: Awaited<ReturnType<GenerationWorker["loadContext"]>>, plan: LucyStateWindow[], outputBytes: Uint8Array) {
    const index = Number.isInteger(job.current_window_index) ? Number(job.current_window_index) : 0;
    const window = plan[index];
    if (!window) throw new Error("The completed Lucy state window is unavailable.");
    const objectPath = `${context.placement.owner_id}/${job.version_id}/lucy-state-${index}.mp4`;
    const stateKey = `generated/${objectPath}`;
    const upload = await this.client.storage.from("generated").upload(objectPath, outputBytes, { contentType: "video/mp4", upsert: true });
    if (upload.error) throw new Error("The private state-window output could not be saved.");
    const outputs = { ...readStateOutputs(job), [String(index)]: stateKey };
    const nextIndex = index + 1;
    if (nextIndex < plan.length) {
      const progress = 20 + (nextIndex / plan.length) * 55;
      await Promise.all([
        this.updateJob(job.id, { status: "queued", provider_job_id: null, provider_status: "state-window-complete", current_window_index: nextIndex, state_outputs: outputs, worker_claimed_at: null, next_poll_at: null }),
        this.updateAssociatedRun(job, { status: "running", current_stage: "edit_keyframes", progress, error: null }),
      ]);
      return;
    }
    await Promise.all([
      this.updateJob(job.id, { status: "finalizing", provider_status: "all-state-windows-complete", state_outputs: outputs }),
      this.updateAssociatedRun(job, { status: "running", current_stage: "quality_check", progress: 85, error: null }),
    ]);
    await this.finalize(job, context, plan, outputs);
  }

  private async submit(job: ClaimedJob) {
    const context = await this.loadContext(job);
    if (!job.prompt) throw new Error("Generation prompt is missing.");
    const plan = await this.buildPlan(job, context);
    const index = Number.isInteger(job.current_window_index) ? Number(job.current_window_index) : 0;
    const state = plan[index];
    if (!state) throw new Error("The requested product-state window is unavailable.");
    const tempDir = await mkdtemp(join(tmpdir(), "framr-generation-input-"));
    try {
      await this.updateAssociatedRun(job, { status: "running", current_stage: "prepare_source", progress: 12, error: null });
      const originalPath = join(tempDir, "source-original.mp4");
      const providerPath = join(tempDir, "source-provider.mp4");
      const [sourceBytes, referenceBytes] = await Promise.all([
        this.download(context.video.storage_key, "videos"),
        this.download(state.referenceKey, "products"),
      ]);
      await writeFile(originalPath, sourceBytes);
      const window = asSourceWindow(state, placementWindow(context.placement, context.target, context.video, this.settings.windowPaddingSeconds).source);
      await providerReadyVideo(this.settings.ffmpegBin, originalPath, providerPath, window);
      const provider = await getGenerationProvider();
      const handle = await provider.submitGeneration({
        sourceVideo: new Blob([await readFile(providerPath)], { type: "video/mp4" }),
        sourceVideoFilename: `source-state-${index}.mp4`,
        prompt: withLucyStatePrompt(job.prompt, state),
        referenceImage: new Blob([referenceBytes], { type: imageContentType(state.referenceKey) }),
        referenceImageFilename: basename(state.referenceKey),
        resolution: "720p",
      });
      await Promise.all([
        this.updateJob(job.id, { provider: provider.name, model: provider.model, provider_job_id: handle.jobRef, provider_status: handle.providerStatus ?? handle.status, status: handle.status === "complete" ? "finalizing" : "generating", worker_claimed_at: null, next_poll_at: new Date(Date.now() + this.settings.pollSeconds * 1000).toISOString() }),
        this.updateAssociatedRun(job, { status: "running", current_stage: "edit_keyframes", progress: 25 + (index / plan.length) * 45, error: null }),
      ]);
      if (handle.status === "complete") {
        const outputBytes = provider.name === "mock" ? new Uint8Array(await readFile(providerPath)) : await provider.downloadResult(handle.jobRef);
        await this.completeWindow({ ...job, current_window_index: index, state_plan: plan }, context, plan, outputBytes);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async poll(job: ClaimedJob) {
    if (!job.provider_job_id) return this.submit(job);
    const provider = await getGenerationProvider();
    const handle = await provider.getGenerationStatus(job.provider_job_id);
    if (handle.status === "failed" || handle.status === "canceled") throw new Error("The generation provider did not complete this product-state window.");
    if (handle.status !== "complete") {
      await Promise.all([
        this.updateJob(job.id, { status: handle.status === "queued" ? "generating" : handle.status, provider_status: handle.providerStatus ?? handle.status, worker_claimed_at: null, next_poll_at: new Date(Date.now() + this.settings.pollSeconds * 1000).toISOString() }),
        this.updateAssociatedRun(job, { status: "running", current_stage: "edit_keyframes", progress: 55, error: null }),
      ]);
      return;
    }
    const context = await this.loadContext(job);
    const plan = readStatePlan(job);
    if (!plan.length) throw new Error("The completed provider job has no durable product-state plan.");
    const outputBytes = provider.name === "mock" ? await this.download(context.video.storage_key, "videos") : await provider.downloadResult(job.provider_job_id);
    await this.completeWindow(job, context, validatePlan(plan), outputBytes);
  }

  async processNext() {
    const job = await this.claim();
    if (!job) return false;
    try {
      if (job.provider_job_id) await this.poll(job);
      else await this.submit(job);
    } catch (error) {
      if (job.provider_job_id && isTransientDecartPollFailure(error)) await this.deferProviderPoll(job, error);
      else await this.fail(job, error);
    }
    return true;
  }
}

async function main() {
  const once = process.argv.includes("--once");
  const worker = new GenerationWorker();
  console.info(`generation_worker_started mode=${process.env.FRAMR_GENERATION_MODE ?? (process.env.DECART_API_KEY ? "decart" : "mock")} poll_seconds=${getSettings().pollSeconds}`);
  do {
    try {
      const processed = await worker.processNext();
      if (once) return;
      if (!processed) await new Promise((resolve) => setTimeout(resolve, getSettings().pollSeconds * 1000));
    } catch (error) {
      console.error("generation_worker_loop_error", error);
      if (once) process.exitCode = 1;
      await new Promise((resolve) => setTimeout(resolve, getSettings().pollSeconds * 1000));
    }
  } while (!once);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
