"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import type { Placement, Video } from "@/data/framr";
import { FrameCorners } from "./FrameCorners";
import { Chip, FramrButton } from "./FramrPrimitives";

type FrameRunStatus = "queued" | "running" | "needs_review" | "ready" | "failed" | "canceled";
type FrameRun = {
  id: string;
  status: FrameRunStatus;
  error: string | null;
  cost_cents: number | null;
  progress: number;
  current_stage: string | null;
};
type RunProduct = { id: string; name: string; brand: string | null; image: string };
type PreparedTarget = { id: string; seed_frame: number; manual_revision: number; seed_mask_key: string | null; status: string };

const progressCopy: Record<string, { label: string; detail: string }> = {
  track_target: { label: "Mapping the selected item", detail: "Following it through the video so the replacement stays in place." },
  prepare_source: { label: "Preparing your video", detail: "Getting the selected product moment ready for the preview." },
  edit_keyframes: { label: "Creating the replacement", detail: "Fitting your product into the scene and its movement." },
  quality_check: { label: "Checking the result", detail: "Making sure every product-state moment joins safely." },
  render_video: { label: "Rendering your version", detail: "Restoring the original audio and saving your new video." },
};

function normalizedProgress(run: FrameRun | null, preparing: boolean) {
  if (!run) return preparing ? 8 : 0;
  const raw = Number(run.progress ?? 0);
  const scaled = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export function FrameRunModal({
  open,
  onClose,
  video,
  placement,
  products,
  run,
  preparing,
  onStart,
  onCancel,
  onFinish,
}: {
  open: boolean;
  onClose: () => void;
  video: Video | null;
  placement: Placement | null;
  products: RunProduct[];
  target: PreparedTarget | null;
  run: FrameRun | null;
  preparing: boolean;
  onStart: (productId: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onFinish: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setProductId("");
    setSubmitting(false);
    onClose();
  };

  if (!open || !video || !placement) return null;

  const start = async () => {
    if (!productId) return;
    setSubmitting(true);
    try {
      await onStart(productId);
    } finally {
      setSubmitting(false);
    }
  };
  const cancel = async () => {
    setSubmitting(true);
    try {
      await onCancel();
    } finally {
      setSubmitting(false);
    }
  };

  const complete = run?.status === "ready";
  const failed = run?.status === "failed" || run?.status === "canceled";
  const paused = run?.status === "needs_review";
  const creating = preparing || (Boolean(run) && !complete && !failed && !paused);
  const progress = normalizedProgress(run, preparing);
  const stage = preparing ? "track_target" : run?.current_stage ?? "prepare_source";
  const current = progressCopy[stage] ?? progressCopy.prepare_source;
  const statusLabel = complete ? "PREVIEW READY" : failed ? "PREVIEW COULDN’T FINISH" : paused ? "PREVIEW ON HOLD" : creating ? `${progress}% COMPLETE` : "CHOOSE PRODUCT";
  const heading = complete ? "Your preview is ready" : failed ? "This preview couldn’t finish" : paused ? "Your preview is saved" : creating ? "Creating your preview" : "Choose the replacement product";
  const description = complete
    ? "Compare it with your original, then keep it or download it."
    : failed
      ? "Your selected item and product are still saved. We’re improving the preview connection before you try again."
      : paused
        ? "Your selected item and product are saved while we connect preview editing."
        : creating
          ? "You can keep browsing while FRAMR creates this version. It will be ready in Versions when processing is complete."
          : `Pick the product that should replace this ${placement.object}. FRAMR will then create a new version in Versions.`;
  const progressCaption = progress === 0 ? "Waiting for the preview worker" : `${progress}% complete`;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="presentation">
      <button aria-label="Close modal" className="modal-backdrop absolute inset-0" onClick={close} />
      <div role="dialog" aria-modal="true" aria-label="Placement preview" className="relative w-full max-w-2xl overflow-hidden rounded-[10px] border border-line bg-white shadow-lift">
        <FrameCorners className="-m-2 text-ink/70" />
        <div className="grid sm:grid-cols-[220px_1fr]">
          <div className="relative aspect-[9/12] overflow-hidden bg-night sm:aspect-auto">
            <img src={video.thumbnail} alt={video.title} className="absolute inset-0 h-full w-full object-cover opacity-90" />
            {creating ? <div className="scanline" /> : null}
            <FrameCorners className="m-3 text-white/70" />
            <Chip className="absolute bottom-3 left-3 bg-night/80 text-white">
              {complete ? <Check size={12} /> : creating ? <span className="rec-dot" /> : null}
              {statusLabel}
            </Chip>
          </div>
          <div className="p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[.14em] text-accent">Placement preview</div>
                <h2 className="mt-1 text-xl font-extrabold tracking-tight">{heading}</h2>
              </div>
              <button className="rounded p-1 hover:bg-paper2" aria-label="Close" onClick={close}><X size={18} /></button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-inksoft">{description}</p>

            {!run && !preparing ? <>
              <div className="mt-5 rounded-lg border border-line bg-paper2/60 p-3 text-xs"><strong>{placement.object}</strong><span className="text-inksoft"> · your selected item</span></div>
              <label className="mt-5 block text-xs font-bold text-ink">
                Replacement product
                <select value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal">
                  <option value="">Choose the product to place…</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.brand ? `${product.brand} — ` : ""}{product.name}</option>)}
                </select>
              </label>
              {products.length === 0 ? <p className="mt-3 rounded-lg border border-line bg-paper2 p-3 text-xs text-inksoft">Add one product image, then come back to create your version.</p> : null}
              <FramrButton variant="accent" className="mt-5 w-full" disabled={!productId || submitting} onClick={() => { void start(); }}>
                {submitting ? <><Loader2 size={16} className="animate-spin" />Creating version…</> : <><Sparkles size={16} />Create version</>}
              </FramrButton>
            </> : complete ? <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><div className="flex items-center gap-2 font-bold"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white"><Check size={12} /></span>Your new version is ready</div><FramrButton className="mt-4 w-full" onClick={() => { onFinish(); close(); }}>Watch and download</FramrButton></div> : failed ? <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Your preview couldn’t be completed.</strong><p className="mt-1 text-xs leading-relaxed text-amber-900/80">Your chosen item and product remain saved. We’re keeping this version separate from your original.</p><FramrButton variant="ghost" className="mt-4 w-full" onClick={close}>Back to workspace</FramrButton></div> : paused ? <div className="mt-6 rounded-lg border border-line bg-paper2/70 p-4 text-sm"><strong>Your preview is safely saved.</strong><p className="mt-1 text-xs leading-relaxed text-inksoft">No action is needed from you right now. Your selected item and product are saved while we connect preview editing.</p><FramrButton variant="ghost" className="mt-4 w-full" onClick={close}>Back to workspace</FramrButton></div> : <><div className="mt-7 rounded-lg border border-line bg-paper2/60 px-5 py-7"><div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-paper"><Loader2 size={20} className="animate-spin" /></span><div><div className="text-sm font-bold">{current.label}</div><div className="mt-1 text-xs leading-relaxed text-inksoft">{current.detail}</div></div></div><div className="mt-6 flex items-center justify-between text-[11px] font-bold uppercase tracking-[.12em] text-inksoft"><span>{progressCaption}</span><span className="text-accent">{progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} /></div><p className="mt-3 text-[11px] text-inksoft">You can close this window and return to Versions at any time.</p></div><FramrButton variant="ghost" className="mt-5 w-full" disabled={submitting} onClick={() => { void cancel(); }}>Cancel preview</FramrButton></>}
          </div>
        </div>
      </div>
    </div>
  );
}
