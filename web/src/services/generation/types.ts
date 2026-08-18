/** Provider-neutral contract for server-side video-generation workers. */
export type GenerationStatus = "queued" | "analyzing" | "generating" | "finalizing" | "complete" | "failed" | "retrying" | "canceled";

export type ProviderSubmission = {
  sourceVideo: Blob;
  sourceVideoFilename?: string;
  prompt: string;
  referenceImage?: Blob;
  referenceImageFilename?: string;
  resolution?: "720p";
};

export type GenerationHandle = {
  jobRef: string;
  status: GenerationStatus;
  providerStatus?: string;
  error?: string;
};

export interface VideoGenerationProvider {
  readonly name: string;
  readonly model: string;
  submitGeneration(input: ProviderSubmission): Promise<GenerationHandle>;
  getGenerationStatus(jobRef: string): Promise<GenerationHandle>;
  downloadResult(jobRef: string): Promise<Uint8Array>;
  cancelGeneration(jobRef: string): Promise<void>;
}

/**
 * Select a provider only inside trusted server or worker code. The browser never
 * receives the Decart API key. A missing key intentionally selects the local
 * deterministic provider so queue, storage, and UI flows remain testable.
 */
export async function getGenerationProvider(): Promise<VideoGenerationProvider> {
  const mode = process.env.FRAMR_GENERATION_MODE ?? (process.env.DECART_API_KEY ? "decart" : "mock");
  if (mode === "decart") {
    if (!process.env.DECART_API_KEY) throw new Error("DECART_API_KEY is required when FRAMR_GENERATION_MODE=decart.");
    const { createDecartProvider } = await import("./decart");
    return createDecartProvider();
  }
  const { createDevProvider } = await import("./dev");
  return createDevProvider();
}
