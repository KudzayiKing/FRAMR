import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getGenerationProvider, type GenerationHandle, type GenerationStatus } from "../services/generation/types";

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
};
type PlacementRow = { id: string; owner_id: string; video_id: string };
type VideoRow = { id: string; storage_key: string; duration_seconds: number | null };
type ProductRow = { id: string; image_key: string };
type Settings = {
  supabaseUrl: string;
  serviceRoleKey: string;
  ffmpegBin: string;
  pollSeconds: number;
};

function getSettings(): Settings {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const pollSeconds = Number(process.env.FRAMR_GENERATION_POLL_SECONDS ?? 5);
  return {
    supabaseUrl,
    serviceRoleKey,
    ffmpegBin: process.env.FRAMR_FFMPEG_BIN ?? "ffmpeg",
    pollSeconds: Number.isFinite(pollSeconds) && pollSeconds > 0 ? pollSeconds : 5,
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
    ? "The generation provider could not complete this job. Please retry."
    : "Generation could not be completed. Please retry.";
}

async function ffmpeg(ffmpegBin: string, args: string[]) {
  await execFileAsync(ffmpegBin, ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 4 * 1024 * 1024 });
}

async function providerReadyVideo(ffmpegBin: string, sourcePath: string, outputPath: string) {
  // Lucy requires MP4 H.264/VP8 and accepts at most 200 MB. Normalize every
  // browser-supported upload (including MOV) before the billable submission.
  await ffmpeg(ffmpegBin, ["-i", sourcePath, "-map", "0:v:0", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath]);
  const details = await stat(outputPath);
  if (details.size > MAX_LUCY_INPUT_BYTES) throw new Error("The normalized source exceeds Lucy's 200 MB input limit.");
}

async function finalizeVideo(ffmpegBin: string, generatedPath: string, originalPath: string, outputPath: string) {
  // Keep Lucy's edited visual stream, restore original audio when present, and
  // deliver FRAMR's standard portrait master. The optional audio map prevents
  // failure for silent originals.
  await ffmpeg(ffmpegBin, [
    "-i", generatedPath,
    "-i", originalPath,
    "-map", "0:v:0",
    "-map", "1:a?",
    "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
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
    if (error || !data) throw new Error(`Could not download private ${bucket} object.`);
    return new Uint8Array(await data.arrayBuffer());
  }

  private async claim() {
    const { data, error } = await this.client.rpc("claim_next_generation_job");
    if (error) throw new Error(`Could not claim generation job: ${error.message}`);
    return ((data ?? []) as ClaimedJob[])[0] ?? null;
  }

  private async loadContext(job: ClaimedJob) {
    const [{ data: placement, error: placementError }, { data: product, error: productError }] = await Promise.all([
      this.client.from("placements").select("id,owner_id,video_id").eq("id", job.placement_id).single(),
      this.client.from("products").select("id,image_key").eq("id", job.product_id).single(),
    ]);
    if (placementError || !placement || productError || !product?.image_key) throw new Error("Generation context is no longer available.");
    const { data: video, error: videoError } = await this.client.from("videos").select("id,storage_key,duration_seconds").eq("id", (placement as PlacementRow).video_id).single();
    if (videoError || !video) throw new Error("Source video is no longer available.");
    return { placement: placement as PlacementRow, product: product as ProductRow, video: video as VideoRow };
  }

  private async updateJob(id: string, values: Record<string, unknown>) {
    const { error } = await this.client.from("generation_jobs").update(values).eq("id", id);
    if (error) throw new Error(`Could not update generation job: ${error.message}`);
  }

  private async fail(job: ClaimedJob, error: unknown) {
    const message = safeError(error);
    await Promise.all([
      this.client.from("generation_jobs").update({ status: "failed", error: message, finished_at: new Date().toISOString(), worker_claimed_at: null, next_poll_at: null }).eq("id", job.id),
      this.client.from("placement_versions").update({ status: "failed" }).eq("id", job.version_id),
    ]);
    console.error(`generation_job_failed id=${job.id}`, error);
  }

  private async finalize(job: ClaimedJob, outputBytes: Uint8Array, context: Awaited<ReturnType<GenerationWorker["loadContext"]>>) {
    const tempDir = await mkdtemp(join(tmpdir(), "framr-generation-"));
    try {
      const originalPath = join(tempDir, "source-original");
      const generatedPath = join(tempDir, "lucy-result.mp4");
      const finalPath = join(tempDir, "framr-final.mp4");
      const thumbnailPath = join(tempDir, "framr-final.jpg");
      await Promise.all([writeFile(originalPath, await this.download(context.video.storage_key, "videos")), writeFile(generatedPath, outputBytes)]);
      await finalizeVideo(this.settings.ffmpegBin, generatedPath, originalPath, finalPath);
      await makeThumbnail(this.settings.ffmpegBin, finalPath, thumbnailPath);

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
      const [versionUpdate, jobUpdate] = await Promise.all([
        this.client.from("placement_versions").update({ status: "ready", video_key: videoKey, thumbnail_key: thumbnailKey }).eq("id", job.version_id),
        this.client.from("generation_jobs").update({ status: "complete", output_key: videoKey, output_thumbnail_key: thumbnailKey, worker_claimed_at: null, next_poll_at: null, finished_at: completedAt, provider_status: "completed" }).eq("id", job.id),
      ]);
      if (versionUpdate.error || jobUpdate.error) throw new Error("Generated media was saved but generation status could not be finalized.");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async submit(job: ClaimedJob) {
    const context = await this.loadContext(job);
    if (!job.prompt) throw new Error("Generation prompt is missing.");
    const tempDir = await mkdtemp(join(tmpdir(), "framr-generation-input-"));
    try {
      const originalPath = join(tempDir, "source-original");
      const providerPath = join(tempDir, "source-provider.mp4");
      const [sourceBytes, referenceBytes] = await Promise.all([
        this.download(context.video.storage_key, "videos"),
        this.download(context.product.image_key, "products"),
      ]);
      await writeFile(originalPath, sourceBytes);
      await providerReadyVideo(this.settings.ffmpegBin, originalPath, providerPath);
      const provider = await getGenerationProvider();
      const handle = await provider.submitGeneration({
        sourceVideo: new Blob([await readFile(providerPath)], { type: "video/mp4" }),
        sourceVideoFilename: "source.mp4",
        prompt: job.prompt,
        referenceImage: new Blob([referenceBytes], { type: imageContentType(context.product.image_key) }),
        referenceImageFilename: basename(context.product.image_key),
        resolution: "720p",
      });
      await this.updateJob(job.id, { provider: provider.name, model: provider.model, provider_job_id: handle.jobRef, provider_status: handle.providerStatus ?? handle.status, status: handle.status === "complete" ? "finalizing" : "generating", worker_claimed_at: null, next_poll_at: new Date(Date.now() + this.settings.pollSeconds * 1000).toISOString() });
      if (handle.status === "complete") {
        const outputBytes = provider.name === "mock"
          ? await this.download(context.video.storage_key, "videos")
          : await provider.downloadResult(handle.jobRef);
        await this.finalize(job, outputBytes, context);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async poll(job: ClaimedJob) {
    if (!job.provider_job_id) return this.submit(job);
    const provider = await getGenerationProvider();
    const handle = await provider.getGenerationStatus(job.provider_job_id);
    if (handle.status === "failed" || handle.status === "canceled") throw new Error("The generation provider did not complete this job.");
    if (handle.status !== "complete") {
      await this.updateJob(job.id, { status: handle.status === "queued" ? "generating" : handle.status, provider_status: handle.providerStatus ?? handle.status, worker_claimed_at: null, next_poll_at: new Date(Date.now() + this.settings.pollSeconds * 1000).toISOString() });
      return;
    }
    const context = await this.loadContext(job);
    await this.updateJob(job.id, { status: "finalizing", provider_status: handle.providerStatus ?? "completed" });
    const outputBytes = provider.name === "mock"
      ? await this.download(context.video.storage_key, "videos")
      : await provider.downloadResult(job.provider_job_id);
    await this.finalize(job, outputBytes, context);
  }

  async processNext() {
    const job = await this.claim();
    if (!job) return false;
    try {
      if (job.provider_job_id) await this.poll(job);
      else await this.submit(job);
    } catch (error) {
      await this.fail(job, error);
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
