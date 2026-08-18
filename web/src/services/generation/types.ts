/** AI generation abstraction — §5/§27. The app must never know which model made a video.
 *  Providers stay isolated; app code only sees this interface. */

export type GenerationInput = {
  videoStorageKey: string;
  placementId: string;
  /** Box normalized 0..1 (left/top/width/height), start/end in seconds */
  region: { left: number; top: number; width: number; height: number };
  timeRange: { startSeconds: number; endSeconds: number };
  productImageStorageKey: string;
  productName?: string;
  targetResolution?: { width: number; height: number };
};

export type GenerationHandle = {
  jobRef: string;
  status: "queued" | "analyzing" | "generating" | "finalizing" | "complete" | "failed" | "retrying" | "canceled";
  /** Present once complete; object-storage key for the generated video */
  resultStorageKey?: string;
  error?: string;
};

export interface VideoGenerationProvider {
  readonly name: string;
  generatePlacement(input: GenerationInput): Promise<GenerationHandle>;
  getGenerationStatus(jobRef: string): Promise<GenerationHandle>;
  cancelGeneration(jobRef: string): Promise<void>;
}

/** Factory: picks Decart when configured, otherwise the deterministic dev adapter.
 *  Swapping providers = config, not app rewrite (§44). Import-time only —
 *  Decart is only selected when DECART_API_KEY is set (§35: secrets server-side). */
export async function getGenerationProvider(): Promise<VideoGenerationProvider> {
  if (process.env.DECART_API_KEY) {
    const { createDecartProvider } = await import("./decart");
    return createDecartProvider();
  }
  const { createDevProvider } = await import("./dev");
  return createDevProvider();
}
