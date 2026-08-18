import type { GenerationInput, GenerationHandle, VideoGenerationProvider } from "./types";

/**
 * Decart Lucy production adapter — §5/§27. Skeleton ready for credentials.
 * Decart-specific logic stays in this file; the app only sees
 * VideoGenerationProvider. Requires DECART_API_KEY.
 */
export function createDecartProvider(): VideoGenerationProvider {
  const apiKey = process.env.DECART_API_KEY as string;
  const baseUrl = process.env.DECART_API_BASE_URL ?? "https://api.decart.ai";

  const mapStatus = (raw: string): GenerationHandle["status"] => {
    const normalized = raw.toLowerCase();
    if (["queued", "pending"].includes(normalized)) return "queued";
    if (["analyzing", "preprocessing"].includes(normalized)) return "analyzing";
    if (["processing", "running", "generating"].includes(normalized)) return "generating";
    if (["finalizing", "postprocessing"].includes(normalized)) return "finalizing";
    if (["completed", "succeeded", "complete"].includes(normalized)) return "complete";
    if (["retrying"].includes(normalized)) return "retrying";
    if (["canceled", "cancelled"].includes(normalized)) return "canceled";
    return "failed";
  };

  return {
    name: "decart",
    async generatePlacement(input: GenerationInput): Promise<GenerationHandle> {
      const response = await fetch(`${baseUrl}/v1/videos/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "lucy",
          prompt: `Place the product "${input.productName ?? "product"}" inside the source video frame, preserving lighting, perspective, and motion.`,
          source_video: input.videoStorageKey,
          region: input.region,
          region_time: input.timeRange,
          product_image: input.productImageStorageKey,
          resolution: input.targetResolution ?? { width: 1080, height: 1920 },
        }),
      });
      if (!response.ok) {
        const { error } = (await response.json().catch(() => ({ error: "Decart request failed" }))) as { error?: string };
        throw new Error(`Decart generation failed (${response.status}): ${error ?? "unknown error"}`);
      }
      const { id } = (await response.json()) as { id: string };
      return { jobRef: id, status: "queued" };
    },
    async getGenerationStatus(jobRef: string): Promise<GenerationHandle> {
      const response = await fetch(`${baseUrl}/v1/videos/${jobRef}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) return { jobRef, status: "failed", error: `status ${response.status}` };
      const data = (await response.json()) as { status: string; output_url?: string };
      const status = mapStatus(data.status);
      return status === "complete" ? { jobRef, status, resultStorageKey: data.output_url } : { jobRef, status };
    },
    async cancelGeneration(jobRef: string): Promise<void> {
      await fetch(`${baseUrl}/v1/videos/${jobRef}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    },
  };
}
