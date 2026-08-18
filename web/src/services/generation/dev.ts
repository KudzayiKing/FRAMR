import type { GenerationInput, GenerationHandle, VideoGenerationProvider } from "./types";

/**
 * Development adapter — §44. Deterministic, no credentials, mirrors the
 * real lifecycle (queued → analyzing → generating → finalizing → complete)
 * so the pipeline can be demoed and integration-tested without Decart.
 */
const stages: GenerationHandle["status"][] = ["queued", "analyzing", "generating", "finalizing", "complete"];
const jobs = new Map<string, { startedAt: number; input: GenerationInput }>();
const STAGE_MS = 1200;

export function createDevProvider(): VideoGenerationProvider {
  return {
    name: "dev",
    async generatePlacement(input: GenerationInput): Promise<GenerationHandle> {
      const jobRef = `dev_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      jobs.set(jobRef, { startedAt: Date.now(), input });
      return { jobRef, status: "queued" };
    },
    async getGenerationStatus(jobRef: string): Promise<GenerationHandle> {
      const job = jobs.get(jobRef);
      if (!job) return { jobRef, status: "failed", error: "Unknown job" };
      const elapsed = Date.now() - job.startedAt;
      const stageIndex = Math.min(stages.length - 1, Math.floor(elapsed / STAGE_MS));
      const status = stages[stageIndex];
      return status === "complete"
        ? { jobRef, status, resultStorageKey: `generated/${jobRef}.mp4` }
        : { jobRef, status };
    },
    async cancelGeneration(jobRef: string): Promise<void> {
      jobs.delete(jobRef);
    },
  };
}
