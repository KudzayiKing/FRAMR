"use client";

import { useEffect, useRef, useState } from "react";
import { Brush, Eraser, Loader2, RotateCcw, Save, X } from "lucide-react";
import { toast } from "sonner";
import type { Placement, Video } from "@/data/framr";
import { getBrowserClient } from "@/lib/supabase-browser";
import { FrameCorners } from "./FrameCorners";
import { Chip, FramrButton } from "./FramrPrimitives";

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 1280;

function timestampToSeconds(value: string) {
  return value.split(":").reduce((total, part) => total * 60 + Number(part || 0), 0);
}

type PlacementTarget = {
  id: string;
  placement_id: string;
  start_frame: number;
  end_frame: number;
  seed_frame: number;
  seed_bbox: Record<string, number> | null;
  seed_mask_key: string | null;
  manual_revision: number;
  status: string;
};

type Tool = "add" | "erase";

export function MaskRefinementModal({
  open,
  onClose,
  video,
  placement,
  onPrepared,
}: {
  open: boolean;
  onClose: () => void;
  video: Video | null;
  placement: Placement | null;
  onPrepared: (target: PlacementTarget) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seedVideoRef = useRef<HTMLVideoElement>(null);
  const drawingRef = useRef(false);
  const [target, setTarget] = useState<PlacementTarget | null>(null);
  const [tool, setTool] = useState<Tool>("add");
  const [brushSize, setBrushSize] = useState(36);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const initialiseCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !placement) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = "rgba(255,255,255,1)";
    context.fillRect(
      Math.round((placement.box.left / 100) * CANVAS_WIDTH),
      Math.round((placement.box.top / 100) * CANVAS_HEIGHT),
      Math.max(1, Math.round((placement.box.width / 100) * CANVAS_WIDTH)),
      Math.max(1, Math.round((placement.box.height / 100) * CANVAS_HEIGHT)),
    );
  };

  useEffect(() => {
    if (!open || !placement) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/placement-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placementId: placement.id }),
      });
      const body = await response.json().catch(() => null) as { target?: PlacementTarget; error?: string } | null;
      if (cancelled) return;
      if (!response.ok || !body?.target) {
        toast.error(body?.error ?? "The placement target could not be prepared.");
        onClose();
        return;
      }
      setTarget(body.target);
      window.requestAnimationFrame(initialiseCanvas);
    })();
    return () => { cancelled = true; };
  // The target should only be initialized for the newly selected placement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placement?.id]);

  const pointForEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  };

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointForEvent(event);
    const canvas = canvasRef.current;
    if (!point || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.save();
    context.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    context.fillStyle = "rgba(255,255,255,1)";
    context.beginPath();
    context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  };

  const save = async () => {
    const canvas = canvasRef.current;
    const client = getBrowserClient();
    if (!canvas || !client || !target) return;
    const { data: { user } } = await client.auth.getUser();
    if (!user) { toast.error("Sign in again before saving a refined mask."); return; }
    setSaving(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The canvas mask could not be encoded.");
      const objectPath = `${user.id}/targets/${target.id}/masks/${crypto.randomUUID()}.png`;
      const { error: uploadError } = await client.storage.from("artifacts").upload(objectPath, blob, { contentType: "image/png", upsert: false });
      if (uploadError) throw uploadError;
      const maskKey = `artifacts/${objectPath}`;
      const response = await fetch("/api/placement-targets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_mask", targetId: target.id, maskKey, mimeType: "image/png", sizeBytes: blob.size }),
      });
      const body = await response.json().catch(() => null) as { target?: PlacementTarget; error?: string } | null;
      if (!response.ok || !body?.target) throw new Error(body?.error ?? "The refined mask metadata could not be saved.");
      onPrepared(body.target);
      toast("Correction saved. FRAMR is automatically re-tracking this object now.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The refined mask could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (!open || !video || !placement) return null;
  const seedTimeSeconds = (timestampToSeconds(placement.start) + timestampToSeconds(placement.end)) / 2;
  return <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" role="presentation">
    <button aria-label="Close mask refinement" className="modal-backdrop absolute inset-0" onClick={onClose} />
    <div role="dialog" aria-modal="true" aria-label="Refine placement mask" className="relative w-full max-w-3xl overflow-hidden rounded-[10px] border border-line bg-white shadow-lift">
      <FrameCorners className="-m-2 text-ink/70" />
      <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,360px)_1fr]">
        <div className="relative mx-auto w-full max-w-[360px] overflow-hidden rounded-xl bg-night" style={{ aspectRatio: "9 / 16" }}>
          {video.sourceVideoUrl ? <video ref={seedVideoRef} src={video.sourceVideoUrl} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(seedTimeSeconds, Math.max(0, event.currentTarget.duration - 0.05)); }} onSeeked={(event) => { event.currentTarget.pause(); initialiseCanvas(); }} /> : <img src={video.thumbnail} alt={`Seed frame for ${placement.object}`} className="absolute inset-0 h-full w-full object-cover" />}
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="absolute inset-0 h-full w-full cursor-crosshair bg-accent/15 opacity-70"
            onPointerDown={(event) => { drawingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); draw(event); }}
            onPointerMove={(event) => { if (drawingRef.current) draw(event); }}
            onPointerUp={(event) => { drawingRef.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
            onPointerCancel={() => { drawingRef.current = false; }}
          />
          <Chip className="absolute bottom-3 left-3 bg-night/80 text-white">SEED FRAME {target?.seed_frame ?? "…"}</Chip>
        </div>
        <div className="min-w-0"><div className="flex items-start justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-[.14em] text-accent">Mask correction</div><h2 className="mt-1 text-xl font-extrabold tracking-tight">Help FRAMR track the {placement.object}</h2></div><button className="rounded p-1 hover:bg-paper2" onClick={onClose} aria-label="Close"><X size={18} /></button></div><p className="mt-2 text-sm text-inksoft">FRAMR normally creates this mask automatically. Use this correction only when the tracked boundary needs help: paint to add missing pixels or erase spillover. The private seed refines the next automatic SAM track and never modifies the source frame.</p><div className="mt-5 grid gap-3"><div className="flex flex-wrap gap-2"><FramrButton size="sm" variant={tool === "add" ? "dark" : "ghost"} onClick={() => setTool("add")}><Brush size={15} />Add mask</FramrButton><FramrButton size="sm" variant={tool === "erase" ? "dark" : "ghost"} onClick={() => setTool("erase")}><Eraser size={15} />Erase</FramrButton><FramrButton size="sm" variant="ghost" onClick={initialiseCanvas}><RotateCcw size={15} />Reset box</FramrButton></div><label className="text-xs font-bold text-ink">Brush diameter <span className="float-right text-inksoft">{brushSize}px</span><input aria-label="Mask brush diameter" className="mt-2 w-full accent-accent" type="range" min="10" max="140" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label></div><div className="mt-5 rounded-lg border border-line bg-paper2/70 p-3 text-xs text-inksoft"><strong className="text-ink">Target window:</strong> frames {target?.start_frame ?? "…"}–{target?.end_frame ?? "…"}. The worker will only track and later composite within this selected time range.</div><FramrButton variant="accent" className="mt-5 w-full" disabled={loading || saving || !target} onClick={() => { void save(); }}>{saving ? <><Loader2 size={16} className="animate-spin" />Saving private mask…</> : <><Save size={16} />Save correction and re-track</>}</FramrButton></div>
      </div>
    </div>
  </div>;
}
