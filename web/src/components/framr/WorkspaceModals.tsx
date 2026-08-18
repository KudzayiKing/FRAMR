/** Design reference: source prototype modal workflows are separated into accessible, focused overlays. */
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Clapperboard, Download, Image, Loader2, Megaphone, Package, ScanSearch, ShieldCheck, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { IMG, type Campaign, type MarketplaceListing, type ProductAsset, type Video } from "@/data/framr";
import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase-browser";
import { FrameCorners } from "./FrameCorners";
import { Chip, FramrButton } from "./FramrPrimitives";

function Modal({ open, onClose, title, children, className = "max-w-lg" }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; className?: string }) {
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; if (open) document.addEventListener("keydown", listener); return () => document.removeEventListener("keydown", listener); }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="presentation"><button aria-label="Close modal" className="modal-backdrop absolute inset-0" onClick={onClose} /><div role="dialog" aria-modal="true" aria-label={title} className={`relative w-full overflow-hidden rounded-[10px] border border-line bg-white shadow-lift ${className}`}><FrameCorners className="-m-2 text-ink/70" />{title && <div className="flex items-center justify-between px-7 pt-7"><h2 className="text-lg font-extrabold tracking-tight">{title}</h2><button className="rounded p-1 transition hover:bg-paper2" onClick={onClose} aria-label="Close"><X size={20} /></button></div>}{children}</div></div>;
}

export function SignInModal({ open, onOpenChange, onEnter }: { open: boolean; onOpenChange: (open: boolean) => void; onEnter: (role: "creator" | "advertiser") => void }) {
  const enter = (role: "creator" | "advertiser") => { onOpenChange(false); onEnter(role); toast(role === "creator" ? "Signed in as @lena.cooks — demo creator workspace." : "Signed in as Auris Home — demo advertiser workspace."); };
  return <Modal open={open} onClose={() => onOpenChange(false)} title="Sign in to FRAMR" className="max-w-md"><div className="px-7 pb-7"><p className="mt-1 text-sm text-inksoft">Choose a workspace to continue. This demo ships with seeded creator & advertiser data.</p><div className="mt-6 grid gap-3"><button onClick={() => enter("creator")} className="frame-grow relative flex items-center gap-3 rounded-lg border border-line p-4 text-left transition hover:border-ink/40"><FrameCorners className="text-accent opacity-0 transition frame-grow-hover:opacity-100" /><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-paper"><Clapperboard size={20} /></span><span><span className="block text-sm font-bold">Continue as Creator</span><span className="mt-0.5 block text-xs text-inksoft">Lena · 4 videos · 9 placements · $500 earned</span></span><ArrowRight className="ml-auto text-inksoft" size={16} /></button><button onClick={() => enter("advertiser")} className="frame-grow relative flex items-center gap-3 rounded-lg border border-line p-4 text-left transition hover:border-ink/40"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-white"><Megaphone size={20} /></span><span><span className="block text-sm font-bold">Continue as Advertiser</span><span className="mt-0.5 block text-xs text-inksoft">Auris · 3 campaigns · 420K est. impressions</span></span><ArrowRight className="ml-auto text-inksoft" size={16} /></button></div><p className="mt-5 text-center text-[11px] text-inksoft">Demo bypass enabled · source integrations are represented as client-side flows.</p></div></Modal>;
}

export function UploadVideoModal({ open, onClose, onComplete }: { open: boolean; onClose: () => void; onComplete: (video: Video) => void }) {
  const [phase, setPhase] = useState<"idle" | "validating" | "ready" | "uploading" | "creating" | "complete">("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<{ durationSeconds: number; width: number; height: number } | null>(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = "framr-video-file";

  const reset = () => {
    setPhase("idle");
    setSelectedFile(null);
    setMetadata(null);
    setTitle("");
    setProgress(0);
    setError(null);
    setDragging(false);
  };

  const close = () => {
    if (phase === "uploading" || phase === "creating") return;
    reset();
    onClose();
  };

  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const { validateVideoFile, inspectVideo, validateVideoMetadata, titleFromFilename } = await import("@/lib/video-upload");
    const fileError = validateVideoFile(file);
    if (fileError) {
      setSelectedFile(null);
      setMetadata(null);
      setPhase("idle");
      setError(fileError);
      return;
    }
    setPhase("validating");
    try {
      const nextMetadata = await inspectVideo(file);
      const metadataError = validateVideoMetadata(nextMetadata);
      if (metadataError) {
        setSelectedFile(null);
        setMetadata(null);
        setPhase("idle");
        setError(metadataError);
        return;
      }
      setSelectedFile(file);
      setMetadata(nextMetadata);
      setTitle(titleFromFilename(file.name));
      setPhase("ready");
    } catch (nextError) {
      setSelectedFile(null);
      setMetadata(null);
      setPhase("idle");
      setError(nextError instanceof Error ? nextError.message : "This video could not be read.");
    }
  };

  const upload = async () => {
    if (!selectedFile || !metadata || !title.trim()) return;
    const { getBrowserClient, isSupabaseConfigured } = await import("@/lib/supabase-browser");
    const { uploadVideoToSupabase } = await import("@/lib/video-upload");
    const client = getBrowserClient();
    if (!isSupabaseConfigured || !client) {
      setError("Video uploads require a configured Supabase project.");
      return;
    }
    setError(null);
    setProgress(0);
    setPhase("uploading");
    let uploaded: Awaited<ReturnType<typeof uploadVideoToSupabase>> | null = null;
    try {
      uploaded = await uploadVideoToSupabase({ client, file: selectedFile, metadata, onProgress: setProgress });
      setPhase("creating");
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          storageKey: uploaded.storageKey,
          mimeType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          durationSeconds: uploaded.durationSeconds,
          width: uploaded.width,
          height: uploaded.height,
        }),
      });
      const body = (await response.json()) as { error?: string; video?: { id: string; title: string; status: "processing"; duration_seconds: number; width: number; height: number; storage_key: string; thumbnail_key: string | null } };
      if (!response.ok || !body.video) throw new Error(body.error ?? "The video record could not be created.");

      const duration = Math.round(body.video.duration_seconds);
      onComplete({
        id: body.video.id,
        title: body.video.title,
        thumbnail: URL.createObjectURL(selectedFile),
        duration: `00:${String(duration).padStart(2, "0")}`,
        status: "processing",
        views: "—",
        placements: [],
        versions: [],
      });
      setPhase("complete");
      toast("Video uploaded. Analysis is queued and its status will update automatically.");
    } catch (nextError) {
      if (uploaded) await client.storage.from("videos").remove([uploaded.objectPath]);
      setPhase("ready");
      setError(nextError instanceof Error ? nextError.message : "The upload could not be completed.");
    }
  };

  const durationLabel = metadata ? `00:${String(Math.round(metadata.durationSeconds)).padStart(2, "0")}` : "";
  const isBusy = phase === "validating" || phase === "uploading" || phase === "creating";

  return <Modal open={open} onClose={close} title="Upload a video"><div className="px-7 pb-7"><input id={inputId} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only" onChange={(event) => void selectFile(event.target.files?.[0])} />{phase === "idle" || phase === "validating" ? <><label htmlFor={inputId} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void selectFile(event.dataTransfer.files?.[0]); }} className={`frame-grow relative mt-6 flex w-full cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition ${dragging ? "border-accent bg-accent-soft/40" : "border-line bg-paper2/60 hover:bg-paper2"}`}><FrameCorners className="text-accent" /><span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-paper">{phase === "validating" ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}</span><span className="text-sm font-bold">{phase === "validating" ? "Checking your video…" : "Drop your vertical video here"}</span><span className="text-xs leading-relaxed text-inksoft">MP4 or MOV · 9:16 · 15–60 seconds · max 500 MB<br />Stored in your private bucket.</span></label><div className="mt-4 grid grid-cols-3 gap-2 text-[11px] text-inksoft"><span>Vertical 1080×1920</span><span>15–60s runtime</span><span>Private by default</span></div></> : <div className="mt-6"><div className="flex items-center gap-3"><div className="striped h-16 w-12 rounded-md bg-ink" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{selectedFile?.name}</div><div className="text-xs text-inksoft">{selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB` : ""} · {metadata ? `${metadata.width}×${metadata.height}` : ""} · {durationLabel}</div></div>{phase === "uploading" ? <span className="text-xs font-bold text-accent">{progress}%</span> : null}</div><label className="mt-5 block text-xs font-bold text-inksoft">Video title<input value={title} disabled={isBusy || phase === "complete"} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-medium text-ink outline-none transition focus:border-accent disabled:cursor-not-allowed disabled:bg-paper2" /></label>{phase === "uploading" || phase === "creating" ? <><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-paper2"><div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${phase === "creating" ? 100 : progress}%` }} /></div><div className="mt-4 flex items-center gap-3 text-sm"><Loader2 size={16} className="animate-spin text-accent" /><span>{phase === "creating" ? "Creating the video record…" : "Uploading securely to private storage…"}</span></div></> : null}{phase === "complete" ? <div className="mt-5 flex items-center gap-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><Check size={16} /><span>Your video is queued for analysis.</span></div> : null}{phase === "ready" ? <div className="mt-6 flex gap-3"><FramrButton variant="ghost" className="flex-1" onClick={reset}>Choose another</FramrButton><FramrButton className="flex-1" onClick={() => void upload()} disabled={!title.trim()}>Upload video <Upload size={16} /></FramrButton></div> : null}{phase === "complete" ? <FramrButton className="mt-6 w-full" onClick={close}>View video status <ArrowRight size={16} /></FramrButton> : null}</div>}{error ? <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}</div></Modal>;
}
export function ProductModal({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (asset: ProductAsset) => void }) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = () => { setName(""); setBrand(""); setDescription(""); setFile(null); if (preview) URL.revokeObjectURL(preview); setPreview(null); setSaving(false); setError(null); };
  const close = () => { if (saving) return; reset(); onClose(); };
  const choose = (candidate: File | undefined) => {
    if (!candidate) return;
    if (!/^(image\/(jpeg|png|webp))$/.test(candidate.type) || candidate.size <= 0 || candidate.size > 10 * 1024 * 1024) { setError("Choose a JPEG, PNG, or WebP image no larger than 10 MB."); return; }
    if (preview) URL.revokeObjectURL(preview);
    setFile(candidate); setPreview(URL.createObjectURL(candidate)); setError(null);
  };
  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || !file) { setError("Add a product name and reference image."); return; }
    const fallbackAsset = (id: string, image: string): ProductAsset => ({ id, name: trimmedName, brand: brand.trim() || "Your brand", category: "Product", image, frame: image });
    if (!isSupabaseConfigured) { const image = preview ?? IMG.aurisProduct; onSave(fallbackAsset(`asset-${Date.now()}`, image)); toast(`“${trimmedName}” saved as a reusable demo product asset.`); close(); return; }
    const client = getBrowserClient();
    if (!client) { setError("Product storage is unavailable."); return; }
    setSaving(true); setError(null);
    try {
      const { uploadProductImage } = await import("@/lib/product-upload");
      const uploaded = await uploadProductImage(client, file);
      const response = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmedName, brand: brand.trim(), description: description.trim(), ...uploaded }) });
      const body = await response.json().catch(() => null) as { product?: { id: string; name: string; brand: string | null }; error?: string } | null;
      if (!response.ok || !body?.product) throw new Error(body?.error ?? "The product could not be saved.");
      onSave(fallbackAsset(body.product.id, preview ?? IMG.aurisProduct));
      toast(`“${body.product.name}” is ready as a private product reference.`);
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The product could not be saved."); setSaving(false); }
  };
  return <Modal open={open} onClose={close} title="Add a product asset" className="max-w-md"><div className="px-7 pb-7"><p className="mt-1 text-xs text-inksoft">Upload a reusable private product reference for placements and generated versions.</p><label className="frame-grow relative mt-5 flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line bg-paper2/60 p-6 text-inksoft transition hover:bg-paper2"><FrameCorners className="text-accent" /><Image size={24} /><span className="text-xs font-semibold">{file ? file.name : "Choose product image"}</span><span className="text-[11px]">JPEG, PNG, or WebP · max 10 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => choose(event.target.files?.[0])} /></label>{preview && <img src={preview} alt="Product preview" className="mt-3 h-32 w-full rounded-lg border border-line object-cover" />}<div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-semibold">Product name<input value={name} disabled={saving} onChange={(event) => setName(event.target.value)} maxLength={160} className="mt-1 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal" placeholder="Model A rice cooker" /></label><label className="text-xs font-semibold">Brand<input value={brand} disabled={saving} onChange={(event) => setBrand(event.target.value)} maxLength={120} className="mt-1 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal" placeholder="Auris" /></label></div><label className="mt-3 block text-xs font-semibold">Description <span className="font-normal text-inksoft">(optional)</span><textarea value={description} disabled={saving} onChange={(event) => setDescription(event.target.value)} maxLength={500} className="mt-1 h-16 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal" placeholder="Induction rice cooker with ceramic core…" /></label>{error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}<FramrButton className="mt-5 w-full" disabled={saving} onClick={() => void save()}>{saving ? <><Loader2 size={16} className="animate-spin" />Saving…</> : "Save product asset"}</FramrButton></div></Modal>;
}

export function CampaignModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (campaign: Campaign) => void }) {
  const [step, setStep] = useState(0); const [name, setName] = useState("Model A rice cooker launch"); const [budget, setBudget] = useState("3000"); const titles = ["What are you selling?", "Where should it appear?", "Who should see it?", "Budget & schedule"];
  const close = () => { setStep(0); onClose(); };
  const next = () => { if (step === 3) { onCreate({ id: `campaign-${Date.now()}`, name, status: "Draft", budget: Number(budget) || 3000, spent: 0, placements: 0, impressions: "—", dates: "TBD", creators: 0 }); close(); toast("Campaign drafted — fund it to start matching."); return; } setStep((value) => value + 1); };
  const body = step === 0 ? <div className="grid grid-cols-3 gap-3">{[[IMG.aurisProduct, "Model A rice cooker"], [IMG.espressoProduct, "Uno espresso"], [IMG.nordpeak, "Steel 900"]].map(([image, label]) => <button key={label} onClick={() => setName(`${label} launch`)} className={`frame-grow relative overflow-hidden rounded-lg border ${name.startsWith(label) ? "border-2 border-accent" : "border-line"}`}><FrameCorners className="m-1 text-accent" /><img src={image} alt={label} className="aspect-square w-full object-cover" /><span className="block truncate p-2 text-[11px] font-bold">{label}</span></button>)}</div> : step === 1 ? <div className="flex flex-wrap gap-2">{["Food", "Cooking", "Coffee", "Travel", "Fashion", "Beauty", "Fitness", "Technology", "Lifestyle"].map((category) => <Chip key={category} className="bg-paper2 text-inksoft">{category}</Chip>)}</div> : step === 2 ? <div className="grid gap-4"><label className="text-xs font-semibold">Country<select className="mt-1 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal"><option>United States</option><option>United Kingdom</option><option>Canada</option></select></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold">Age from<input type="number" defaultValue="18" className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm font-normal" /></label><label className="text-xs font-semibold">Age to<input type="number" defaultValue="34" className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm font-normal" /></label></div></div> : <div className="grid gap-4"><label className="text-xs font-semibold">Campaign name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm font-normal" /></label><label className="text-xs font-semibold">Budget ($)<input type="number" value={budget} onChange={(event) => setBudget(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm font-normal" /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold">Start<input type="date" defaultValue="2026-08-24" className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm font-normal" /></label><label className="text-xs font-semibold">End<input type="date" defaultValue="2026-09-30" className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm font-normal" /></label></div></div>;
  return <Modal open={open} onClose={close} className="max-w-lg"><div className="px-7 pb-7 pt-7"><div className="flex items-start justify-between"><div><div className="text-[11px] font-bold uppercase tracking-[.14em] text-accent">New campaign</div><h2 className="text-xl font-extrabold tracking-tight">{titles[step]}</h2></div><button className="rounded p-1 hover:bg-paper2" onClick={close}><X size={20} /></button></div><div className="mt-5 h-1 overflow-hidden rounded-full bg-paper2"><div className="h-full bg-accent transition-all" style={{ width: `${((step + 1) / 4) * 100}%` }} /></div><div className="mt-6 min-h-[210px]">{body}</div><div className="mt-6 flex justify-between"><FramrButton variant="ghost" size="sm" className={step === 0 ? "invisible" : ""} onClick={() => setStep((value) => value - 1)}><ArrowLeft size={16} />Back</FramrButton><FramrButton size="sm" onClick={next}>{step === 3 ? "Create campaign" : <>Continue<ArrowRight size={16} /></>}</FramrButton></div></div></Modal>;
}

export function ReserveModal({ listing, open, onClose }: { listing: MarketplaceListing | null; open: boolean; onClose: () => void }) {
  if (!listing) return null;
  return <Modal open={open} onClose={onClose} className="max-w-lg"><div className="grid grid-cols-[140px_1fr]"><div className="relative bg-night"><img src={listing.image} alt={listing.video} className="absolute inset-0 h-full w-full object-cover" /><FrameCorners className="m-2 text-white/70" /></div><div className="p-6"><div className="flex items-start justify-between gap-2"><div><div className="text-[11px] font-bold uppercase tracking-[.14em] text-accent">{listing.object} · {listing.duration}s on screen</div><h2 className="text-lg font-extrabold tracking-tight">{listing.video}</h2><div className="text-xs text-inksoft">{listing.creator} · {listing.geography} · {listing.category}</div></div><button onClick={onClose}><X size={18} /></button></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-md bg-paper2/80 py-2"><div className="text-sm font-extrabold">{listing.views}</div><div className="text-[10px] text-inksoft">est. views</div></div><div className="rounded-md bg-paper2/80 py-2"><div className="text-sm font-extrabold">{listing.duration}s</div><div className="text-[10px] text-inksoft">on-screen</div></div><div className="rounded-md bg-paper2/80 py-2"><div className="text-sm font-extrabold text-accent">${listing.price}</div><div className="text-[10px] text-inksoft">placement</div></div></div><label className="mt-4 block text-xs font-semibold">Attach to campaign<select className="mt-1 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal"><option>Auris Spring Launch</option><option>Nordpeak Chef Series</option></select></label><p className="mt-3 flex gap-1.5 text-[11px] text-inksoft"><ShieldCheck size={14} className="shrink-0 text-accent" />Creators approve every placement. Nothing is inserted without consent.</p><FramrButton variant="accent" className="mt-4 w-full" onClick={() => { toast(`Reserved ${listing.object} in “${listing.video}” — sent to creator for approval.`); onClose(); }}>Reserve placement</FramrButton></div></div></Modal>;
}

export function GenerationModal({ open, onClose, video, products, generation, onStart, onFinish }: {
  open: boolean;
  onClose: () => void;
  video: Video | null;
  products: { id: string; name: string; brand: string | null; image: string }[];
  generation: { id: string; status: "queued" | "analyzing" | "generating" | "finalizing" | "complete" | "failed" | "retrying" | "canceled"; error: string | null; cost_cents: number | null } | null;
  onStart: (productId: string) => Promise<void>;
  onFinish: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) { setSeenOpen(open); if (!open) { setProductId(""); setSubmitting(false); } }
  if (!video) return null;
  const status = generation?.status ?? null;
  const steps = ["queued", "analyzing", "generating", "finalizing", "complete"] as const;
  const activeIndex = status ? Math.max(0, steps.indexOf(status === "retrying" ? "queued" : status === "failed" || status === "canceled" ? "queued" : status)) : -1;
  const start = async () => {
    if (!productId) return;
    setSubmitting(true);
    try { await onStart(productId); } finally { setSubmitting(false); }
  };
  const finish = () => { onFinish(); onClose(); toast("Version generation completed — original untouched."); };
  const labels: Record<(typeof steps)[number], string> = { queued: "Queued", analyzing: "Preparing source", generating: "Generating edited video", finalizing: "Restoring audio & exporting", complete: "Version complete" };
  return <Modal open={open} onClose={onClose} className="max-w-xl"><div className="grid sm:grid-cols-[220px_1fr]"><div className="relative aspect-[9/12] overflow-hidden bg-night sm:aspect-auto"><img src={video.thumbnail} alt="Placements source frame" className="absolute inset-0 h-full w-full object-cover opacity-90" />{status && status !== "complete" && status !== "failed" && <div className="scanline" />}<FrameCorners className="m-3 text-white/70" /><Chip className="absolute bottom-3 left-3 bg-night/80 text-white">{status === "complete" ? <Check size={12} /> : <span className="rec-dot" />}{status ? status.toUpperCase() : "READY"}</Chip></div><div className="p-7"><div className="text-[11px] font-bold uppercase tracking-[.14em] text-accent">Generation job</div><h2 className="mt-1 text-xl font-extrabold tracking-tight">{status ? "Creating your replacement" : "Create a placement version"}</h2><p className="mt-1 text-xs text-inksoft">The source video remains unchanged. FRAMR creates a new private version branch.</p>{!status && <><label className="mt-5 block text-xs font-bold text-ink">Replacement product<select value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal"><option value="">Select a product reference…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.brand ? `${product.brand} — ` : ""}{product.name}</option>)}</select></label>{products.length === 0 && <p className="mt-3 rounded-md border border-line bg-paper2 p-3 text-xs text-inksoft">Upload a private product reference image in Assets before starting a generation.</p>}<FramrButton variant="accent" className="mt-5 w-full" disabled={!productId || submitting} onClick={() => { void start(); }}>{submitting ? <><Loader2 size={16} className="animate-spin" />Queueing…</> : "Create version"}</FramrButton></>}{status && <div className="mt-5 space-y-3">{steps.map((step, index) => <div className="flex items-center gap-3 text-sm" key={step}><span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-paper2">{activeIndex > index || status === "complete" ? <Check size={14} className="text-emerald-600" /> : activeIndex === index && status !== "failed" ? <Loader2 size={14} className="animate-spin text-accent" /> : <span className="h-1.5 w-1.5 rounded-full bg-inksoft/40" />}</span><span className={activeIndex >= index ? "" : "text-inksoft"}>{labels[step]}</span></div>)}</div>}{generation?.cost_cents != null && <p className="mt-4 text-[11px] text-inksoft">Estimated generation cost: ${(generation.cost_cents / 100).toFixed(2)}.</p>}{status === "failed" && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{generation?.error ?? "Generation could not be completed. Please retry."}</div>}{status === "complete" && <div className="mt-5 rounded-lg border border-line bg-paper2/60 p-4"><div className="flex items-center gap-2 text-sm font-bold"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-paper"><Check size={12} /></span>Version created</div><div className="mt-2 font-mono text-[11px] text-inksoft">1080×1920 · source audio preserved · render complete</div><FramrButton className="mt-4 w-full" onClick={finish}>View versions</FramrButton></div>}</div></div></Modal>;
}

export function ExportModal({ open, onClose, label }: { open: boolean; onClose: () => void; label: string }) {
  const [done, setDone] = useState(false); const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) { setSeenOpen(open); if (!open) setDone(false); }
  useEffect(() => { if (!open) return; const timer = window.setTimeout(() => setDone(true), 1500); return () => window.clearTimeout(timer); }, [open]);
  return <Modal open={open} onClose={onClose} className="max-w-md"><div className="p-7"><div className="text-[11px] font-bold uppercase tracking-[.14em] text-accent">Export</div><h2 className="mt-1 text-xl font-extrabold tracking-tight">{label}</h2><div className="mt-5 space-y-3">{["Preparing version branch", "Rendering 1080×1920", "Muxing MP4 · social-ready"].map((step) => <div key={step} className="flex items-center gap-3 text-sm"><span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-paper2">{done ? <Check size={14} className="text-emerald-600" /> : <Loader2 size={14} className="animate-spin text-accent" />}</span>{step}</div>)}</div>{done && <div className="mt-5"><div className="flex items-center gap-3 rounded-lg border border-line bg-paper2/70 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-paper"><Download size={18} /></span><div><div className="text-sm font-bold">framr_{label.toLowerCase().replaceAll(" ", "-")}.mp4</div><div className="text-[11px] text-inksoft">MP4 · 1080×1920 · audio preserved</div></div></div><FramrButton variant="accent" className="mt-4 w-full" onClick={() => { toast("Download started — check your exports folder."); onClose(); }}><Download size={16} />Download MP4</FramrButton></div>}</div></Modal>;
}

