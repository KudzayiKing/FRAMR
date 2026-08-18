import type { GenerationHandle, ProviderSubmission, VideoGenerationProvider } from "./types";

/**
 * Deterministic non-billable provider. It mirrors the Decart lifecycle so the
 * database queue and UI can be exercised before a Decart API key is supplied.
 */
const stages: GenerationHandle["status"][] = ["queued", "analyzing", "generating", "finalizing", "complete"];
const STAGE_MS = 1_200;

function startedAtFromJobRef(jobRef: string) {
  const value = /^mock_(\d+)_/.exec(jobRef)?.[1];
  return value ? Number(value) : Number.NaN;
}

export function createDevProvider(): VideoGenerationProvider {
  return {
    name: "mock",
    model: "mock-lucy",
    async submitGeneration(input) {
      const jobRef = `mock_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      void input;
      return { jobRef, status: "queued", providerStatus: "queued" };
    },
    async getGenerationStatus(jobRef) {
      const startedAt = startedAtFromJobRef(jobRef);
      if (!Number.isFinite(startedAt)) return { jobRef, status: "failed", providerStatus: "missing", error: "Unknown mock job" };
      const index = Math.min(stages.length - 1, Math.floor((Date.now() - startedAt) / STAGE_MS));
      const status = stages[index];
      return { jobRef, status, providerStatus: status };
    },
    async downloadResult(jobRef) {
      void jobRef;
      // The generation worker uses the verified source bytes for mock output,
      // preserving a playable MP4 without storing provider state in memory.
      return new Uint8Array();
    },
    async cancelGeneration(_jobRef) {
      return;
    },
  };
}
