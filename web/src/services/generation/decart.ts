import type { GenerationHandle, GenerationStatus, ProviderSubmission, VideoGenerationProvider } from "./types";

type DecartJobResponse = { job_id?: string; id?: string; status?: string; error?: string; message?: string };

function providerError(status: number, body: unknown) {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const message = typeof value.message === "string" ? value.message : typeof value.error === "string" ? value.error : "The generation provider rejected this request.";
  return new Error(`Decart request failed (${status}): ${message.slice(0, 240)}`);
}

function mapStatus(rawStatus: string | undefined): GenerationStatus {
  const status = rawStatus?.toLowerCase() ?? "";
  if (["queued", "pending"].includes(status)) return "queued";
  if (["created", "preprocessing", "analyzing"].includes(status)) return "analyzing";
  if (["processing", "running", "generating", "in_progress"].includes(status)) return "generating";
  if (["finalizing", "postprocessing"].includes(status)) return "finalizing";
  if (["completed", "complete", "succeeded", "success"].includes(status)) return "complete";
  if (["retrying"].includes(status)) return "retrying";
  if (["canceled", "cancelled"].includes(status)) return "canceled";
  if (["failed", "error"].includes(status)) return "failed";
  // Preserve a non-terminal unknown provider state as active rather than marking
  // a billable job failed due solely to a provider vocabulary change.
  return "generating";
}

/**
 * Decart Lucy batch adapter. It follows the official multipart job API:
 * POST /v1/jobs/{model}, GET /v1/jobs/{id}, GET /v1/jobs/{id}/content.
 */
export function createDecartProvider(): VideoGenerationProvider {
  const apiKey = process.env.DECART_API_KEY;
  if (!apiKey) throw new Error("DECART_API_KEY is not configured.");
  const baseUrl = (process.env.DECART_API_BASE_URL ?? "https://api.decart.ai").replace(/\/$/, "");
  const model = process.env.DECART_MODEL ?? "lucy-latest";
  const headers = { "X-API-KEY": apiKey, "User-Agent": "FRAMR-generation-worker/1.0" };

  return {
    name: "decart",
    model,
    async submitGeneration(input: ProviderSubmission): Promise<GenerationHandle> {
      const form = new FormData();
      form.set("data", input.sourceVideo, input.sourceVideoFilename ?? "source.mp4");
      form.set("prompt", input.prompt);
      form.set("resolution", input.resolution ?? "720p");
      if (input.referenceImage) form.set("reference_image", input.referenceImage, input.referenceImageFilename ?? "product-reference.jpg");

      const response = await fetch(`${baseUrl}/v1/jobs/${encodeURIComponent(model)}`, {
        method: "POST",
        headers,
        body: form,
      });
      const payload = await response.json().catch(() => null) as DecartJobResponse | null;
      if (!response.ok) throw providerError(response.status, payload);
      const jobRef = payload?.job_id ?? payload?.id;
      if (!jobRef) throw new Error("Decart accepted the request but returned no job identifier.");
      return { jobRef, status: mapStatus(payload?.status), providerStatus: payload?.status };
    },
    async getGenerationStatus(jobRef: string): Promise<GenerationHandle> {
      const response = await fetch(`${baseUrl}/v1/jobs/${encodeURIComponent(jobRef)}`, { headers, cache: "no-store" });
      const payload = await response.json().catch(() => null) as DecartJobResponse | null;
      if (!response.ok) throw providerError(response.status, payload);
      return { jobRef, status: mapStatus(payload?.status), providerStatus: payload?.status };
    },
    async downloadResult(jobRef: string): Promise<Uint8Array> {
      const response = await fetch(`${baseUrl}/v1/jobs/${encodeURIComponent(jobRef)}/content`, { headers, cache: "no-store" });
      if (!response.ok) throw providerError(response.status, await response.json().catch(() => null));
      return new Uint8Array(await response.arrayBuffer());
    },
    async cancelGeneration(): Promise<void> {
      // Decart's current batch documentation does not expose a cancellation
      // endpoint. FRAMR cancels local delivery by marking the queued job canceled.
      return;
    },
  };
}
