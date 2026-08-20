"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleAlert, Loader2, ScanSearch, X } from "lucide-react";
import type { Video } from "@/data/framr";
import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase-browser";
import { FrameCorners } from "./FrameCorners";
import { Chip, FramrButton } from "./FramrPrimitives";
import { VideoThumbnailPlaceholder } from "./VideoThumbnailPlaceholder";

type AnalysisStatus = "processing" | "ready" | "failed";
type AnalysisVideo = {
  id: string;
  status: AnalysisStatus;
  processing_error: string | null;
  thumbnail_key: string | null;
  analysis_stage: string | null;
  analysis_progress: number | null;
};

const analysisCopy: Record<string, { label: string; detail: string }> = {
  queued: { label: "Getting your video ready", detail: "Your private upload is waiting for analysis." },
  preparing_video: { label: "Preparing your video", detail: "Checking the video so we can scan it accurately." },
  reading_video: { label: "Reading the scene", detail: "Finding the best moments to inspect." },
  finding_items: { label: "Finding items", detail: "Looking for objects that can become placements." },
  organizing_items: { label: "Organizing items", detail: "Grouping the items we found into simple choices." },
  finalizing: { label: "Finishing up", detail: "Saving your results and getting your placements ready." },
  complete: { label: "Analysis complete", detail: "Your item choices are ready." },
};

async function resolveThumbnail(key: string | null) {
  if (!key?.startsWith("thumbnails/")) return null;
  const client = getBrowserClient();
  if (!client) return null;
  const objectPath = key.slice("thumbnails/".length);
  const { data, error } = await client.storage.from("thumbnails").createSignedUrl(objectPath, 60 * 60);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

export function AnalysisProgressModal({
  open,
  video,
  onReady,
  onClose,
}: {
  open: boolean;
  video: Video | null;
  onReady: (videoId: string) => void;
  onClose: () => void;
}) {
  const [analysis, setAnalysis] = useState<AnalysisVideo | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !video || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;

    let cancelled = false;
    const sync = async () => {
      let { data, error } = await client
        .from("videos")
        .select("id,status,processing_error,thumbnail_key,analysis_stage,analysis_progress")
        .eq("id", video.id)
        .maybeSingle();
      // The modal remains usable while a local browser refresh races the one-time
      // progress migration. The next poll uses the full progress contract.
      if (error?.code === "42703") {
        const fallback = await client
          .from("videos")
          .select("id,status,processing_error,thumbnail_key")
          .eq("id", video.id)
          .maybeSingle();
        data = fallback.data ? { ...fallback.data, analysis_stage: null, analysis_progress: 0 } : null;
        error = fallback.error;
      }
      if (cancelled || error || !data) return;
      const next = data as AnalysisVideo;
      setAnalysis(next);
      if (next.thumbnail_key) {
        const signedThumbnail = await resolveThumbnail(next.thumbnail_key);
        if (!cancelled) setThumbnail(signedThumbnail);
      }
      if (next.status === "ready") {
        window.setTimeout(() => {
          if (!cancelled) onReady(next.id);
        }, 500);
      }
    };

    void sync();
    const interval = window.setInterval(() => { void sync(); }, 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [onReady, open, video?.id, video?.thumbnail]);

  const failed = analysis?.status === "failed";
  const visibleThumbnail = thumbnail ?? video?.thumbnail ?? null;
  const progress = Math.max(0, Math.min(100, Math.round(Number(analysis?.status === "ready" ? 100 : analysis?.analysis_progress ?? 0))));
  const stage = analysis?.status === "ready" ? "complete" : analysis?.analysis_stage ?? "queued";
  const copy = analysisCopy[stage] ?? analysisCopy.queued;

  const retry = async () => {
    if (!video) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const response = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_analysis" }),
      });
      const body = await response.json().catch(() => null) as { error?: string; video?: AnalysisVideo } | null;
      if (!response.ok || !body?.video) throw new Error(body?.error ?? "Please try again.");
      setAnalysis(body.video);
    } catch (cause) {
      setRetryError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setRetrying(false);
    }
  };

  const stageCaption = useMemo(() => progress === 0 ? "Waiting for the analysis worker" : `${progress}% complete`, [progress]);

  if (!open || !video) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
      <div className="modal-backdrop absolute inset-0" />
      <div role="dialog" aria-modal="true" aria-label="Finding items in your video" className="relative w-full max-w-xl overflow-hidden rounded-[10px] border border-line bg-white shadow-lift">
        <FrameCorners className="-m-2 text-ink/70" />
        <div className="grid sm:grid-cols-[180px_1fr]">
          <div className="relative aspect-[9/12] overflow-hidden bg-night sm:aspect-auto">
            {visibleThumbnail ? <img src={visibleThumbnail} alt={video.title} className="absolute inset-0 h-full w-full object-cover opacity-90" /> : <VideoThumbnailPlaceholder scanning={!failed} />}
            {visibleThumbnail && !failed ? <div className="scanline" /> : null}
            <FrameCorners className="m-3 text-white/70" />
            <Chip className="absolute bottom-3 left-3 bg-night/80 text-white">{failed ? <CircleAlert size={12} /> : <span className="rec-dot" />}{failed ? "TRY AGAIN" : `${progress}% ANALYZED`}</Chip>
          </div>
          <div className="p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[.14em] text-accent">Your video</div>
                <h2 className="mt-1 text-xl font-extrabold tracking-tight">{failed ? "Let’s try that again" : "Finding items you can replace"}</h2>
              </div>
              {failed ? <button className="rounded p-1 transition hover:bg-paper2" onClick={onClose} aria-label="Close"><X size={18} /></button> : null}
            </div>
            {!failed ? <div className="mt-8 rounded-lg border border-line bg-paper2/60 px-5 py-7"><div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-paper"><ScanSearch size={20} /></span><div><div className="text-sm font-bold">{copy.label}</div><div className="mt-1 text-xs text-inksoft">{copy.detail}</div></div></div><div className="mt-6 flex items-center justify-between text-[11px] font-bold uppercase tracking-[.12em] text-inksoft"><span>{stageCaption}</span><span className="text-accent">{progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} /></div></div> : <><div className="mt-6 rounded-lg border border-line bg-paper2/70 p-4 text-sm"><strong>We couldn’t finish this one.</strong><p className="mt-1 text-xs text-inksoft">Your video is still safely saved.</p></div>{retryError ? <p role="alert" className="mt-3 text-xs text-red-700">{retryError}</p> : null}<div className="mt-5 flex gap-3"><FramrButton variant="ghost" className="flex-1" onClick={onClose}>Back</FramrButton><FramrButton className="flex-1" disabled={retrying} onClick={() => { void retry(); }}>{retrying ? <><Loader2 size={16} className="animate-spin" />Trying again…</> : "Try again"}</FramrButton></div></>}
          </div>
        </div>
      </div>
    </div>
  );
}
