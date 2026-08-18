/** Design reference: the application workspace keeps the source's permanent role-based sidebar and compact operational header. */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CreditCard,
  ExternalLink,
  Film,
  LayoutGrid,
  Layers3,
  LogOut,
  Menu,
  Megaphone,
  Package,
  Plus,
  ScanSearch,
  Search,
  Settings,
  Store,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { FramrMark } from "@/components/framr/FramrMark";
import { FramrButton, Chip } from "@/components/framr/FramrPrimitives";
import { AdvertiserWorkspace, CreatorWorkspace } from "@/components/framr/WorkspaceViews";
import {
  CampaignModal,
  ExportModal,
  GenerationModal,
  ProductModal,
  ReserveModal,
  UploadVideoModal,
} from "@/components/framr/WorkspaceModals";
import {
  IMG,
  initialAssets,
  initialCampaigns,
  initialVideos,
  type Campaign,
  type MarketplaceListing,
  type Placement,
  type ProductAsset,
  type Version,
  type Video,
} from "@/data/framr";
import { signOut } from "@/lib/auth";
import type { GenerationStatus } from "@/services/generation/types";
import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase-browser";

export type Role = "creator" | "advertiser";
type WorkspaceProps = { role: Role; onExit: () => void; onSignOut: () => void };
type GenerationProduct = { id: string; name: string; brand: string | null; image: string };
type GenerationJob = { id: string; status: GenerationStatus; version_id: string | null; error: string | null; cost_cents: number | null };
type NavItem = { id: string; label: string; icon: typeof LayoutGrid };

const creatorNav: NavItem[] = [
  { id: "home", label: "Home", icon: LayoutGrid },
  { id: "videos", label: "Videos", icon: Film },
  { id: "placements", label: "Placements", icon: ScanSearch },
  { id: "versions", label: "Versions", icon: Layers3 },
  { id: "market", label: "Marketplace", icon: Store },
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "assets", label: "Assets", icon: Package },
  { id: "settings", label: "Settings", icon: Settings },
];

const advertiserNav: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "placements", label: "Placements", icon: ScanSearch },
  { id: "products", label: "Products", icon: Package },
  { id: "market", label: "Marketplace", icon: Store },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "settings", label: "Settings", icon: Settings },
];

type PersistedVideoRow = {
  id: string;
  title: string;
  status: Video["status"];
  duration_seconds: number | null;
  thumbnail_key: string | null;
  storage_key: string;
};

type PersistedPlacementRow = {
  id: string;
  video_id: string;
  object_label: string;
  category: string | null;
  start_seconds: number;
  end_seconds: number;
  quality: Placement["quality"];
  confidence: number;
  box: Record<string, number> | null;
};
type PersistedVersionRow = {
  id: string;
  placement_id: string;
  label: string;
  brand: string | null;
  status: "draft" | "generating" | "ready" | "failed";
  video_key: string | null;
  thumbnail_key: string | null;
  is_active: boolean;
};

function normalizeBox(box: Record<string, number> | null): Placement["box"] {
  return {
    left: Math.max(0, Math.min(100, Number(box?.left ?? 0) * 100)),
    top: Math.max(0, Math.min(100, Number(box?.top ?? 0) * 100)),
    width: Math.max(0, Math.min(100, Number(box?.width ?? 0) * 100)),
    height: Math.max(0, Math.min(100, Number(box?.height ?? 0) * 100)),
  };
}

function toPlacement(row: PersistedPlacementRow): Placement {
  return {
    id: row.id,
    object: row.object_label,
    category: row.category ?? "Uncategorized",
    start: formatDuration(row.start_seconds),
    end: formatDuration(row.end_seconds),
    duration: Math.max(0, row.end_seconds - row.start_seconds),
    quality: row.quality,
    confidence: Math.round(row.confidence * 100),
    box: normalizeBox(row.box),
  };
}

async function resolvePrivateUrl(client: NonNullable<ReturnType<typeof getBrowserClient>>, key: string | null, fallback: string) {
  if (!key) return fallback;
  const [bucket, ...pathParts] = key.split("/");
  const objectPath = pathParts.join("/");
  if (!["thumbnails", "products", "videos", "generated"].includes(bucket) || !objectPath) return fallback;
  const [ownerId, fileName] = pathParts;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId ?? "");
  if (!isUuid || !fileName) return fallback;
  const { data, error } = await client.storage.from(bucket).createSignedUrl(objectPath, 60 * 60);
  return !error && data?.signedUrl ? data.signedUrl : fallback;
}

function formatDuration(seconds: number | null) {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function Workspace({ role, onExit, onSignOut }: WorkspaceProps) {
  const [page, setPage] = useState(role === "creator" ? "home" : "overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [videos, setVideos] = useState<Video[]>(() => isSupabaseConfigured ? [] : initialVideos);
  const [assets, setAssets] = useState<ProductAsset[]>(() => isSupabaseConfigured ? [] : initialAssets);
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [modal, setModal] = useState<"upload" | "product" | "campaign" | "generate" | "export" | null>(null);
  const [reserve, setReserve] = useState<MarketplaceListing | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState("v1");
  const [exportLabel, setExportLabel] = useState("Auris Model A");
  const [generationProducts, setGenerationProducts] = useState<GenerationProduct[]>([]);
  const [generationJob, setGenerationJob] = useState<GenerationJob | null>(null);

  const loadCreatorVideos = useCallback(async () => {
    const client = getBrowserClient();
    if (!client) return;
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;

    const [videoResponse, placementResponse] = await Promise.all([
      client
        .from("videos")
        .select("id,title,status,duration_seconds,thumbnail_key,storage_key")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false }),
      client
        .from("placements")
        .select("id,video_id,object_label,category,start_seconds,end_seconds,quality,confidence,box")
        .eq("owner_id", user.id)
        .order("start_seconds", { ascending: true }),
    ]);
    if (videoResponse.error || placementResponse.error) {
      toast.error("Could not load your video library.");
      return;
    }

    const placementRows = (placementResponse.data ?? []) as PersistedPlacementRow[];
    const placementsByVideo = new Map<string, Placement[]>();
    const videoByPlacement = new Map<string, string>();
    for (const row of placementRows) {
      const current = placementsByVideo.get(row.video_id) ?? [];
      current.push(toPlacement(row));
      placementsByVideo.set(row.video_id, current);
      videoByPlacement.set(row.id, row.video_id);
    }
    const placementIds = placementRows.map((row) => row.id);
    const versionResponse = placementIds.length ? await client
      .from("placement_versions")
      .select("id,placement_id,label,brand,status,video_key,thumbnail_key,is_active")
      .in("placement_id", placementIds)
      .order("created_at", { ascending: true }) : { data: [], error: null };
    if (versionResponse.error) { toast.error("Could not load generated versions."); return; }
    const versionsByVideo = new Map<string, Version[]>();
    for (const row of (versionResponse.data ?? []) as PersistedVersionRow[]) {
      const videoId = videoByPlacement.get(row.placement_id);
      if (!videoId || row.status !== "ready") continue;
      const current = versionsByVideo.get(videoId) ?? [];
      const image = await resolvePrivateUrl(client, row.thumbnail_key, IMG.original);
      const videoUrl = await resolvePrivateUrl(client, row.video_key, "");
      current.push({ id: row.id, label: row.label, brand: row.brand ?? "Product", image, active: row.is_active, videoUrl: videoUrl || undefined });
      versionsByVideo.set(videoId, current);
    }
    const hydrated = await Promise.all(((videoResponse.data ?? []) as PersistedVideoRow[]).map(async (row) => {
      const thumbnail = await resolvePrivateUrl(client, row.thumbnail_key, IMG.original);
      const sourceVideoUrl = await resolvePrivateUrl(client, row.storage_key, "");
      const source: Version = { id: `source-${row.id}`, label: "Original", brand: "Source", image: thumbnail, active: true, source: true, videoUrl: sourceVideoUrl || undefined };
      return {
        id: row.id,
        title: row.title,
        thumbnail,
        duration: formatDuration(row.duration_seconds),
        status: row.status,
        views: "—",
        placements: placementsByVideo.get(row.id) ?? [],
        versions: [source, ...(versionsByVideo.get(row.id) ?? [])],
        sourceVideoUrl: sourceVideoUrl || undefined,
      };
    }));
    setVideos(hydrated);
    setSelectedVideoId((current) => hydrated.some((video) => video.id === current) ? current : hydrated[0]?.id ?? "");
  }, []);

  const loadGenerationProducts = useCallback(async () => {
    const client = getBrowserClient();
    if (!client) return;
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    const { data, error } = await client.from("products").select("id,name,brand,image_key").eq("owner_id", user.id).order("created_at", { ascending: false });
    if (error) return;
    const hydrated = await Promise.all((data ?? []).filter((product) => product.image_key).map(async (product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      image: await resolvePrivateUrl(client, product.image_key, IMG.aurisProduct),
    })));
    setGenerationProducts(hydrated);
    setAssets(hydrated.map((product) => ({ id: product.id, name: product.name, brand: product.brand ?? "Your brand", category: "Product", image: product.image, frame: product.image })));
  }, []);

  useEffect(() => {
    if (role !== "creator" || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;

    let channel: ReturnType<typeof client.channel> | null = null;
    let cancelled = false;
    const subscribe = async () => {
      await Promise.all([loadCreatorVideos(), loadGenerationProducts()]);
      const { data: { user } } = await client.auth.getUser();
      if (cancelled || !user) return;
      channel = client
        .channel(`framr-video-status-${user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "videos", filter: `owner_id=eq.${user.id}` },
          () => { void loadCreatorVideos(); },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "placement_versions" },
          () => { void loadCreatorVideos(); },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "products", filter: `owner_id=eq.${user.id}` },
          () => { void loadGenerationProducts(); },
        )
        .subscribe();
    };
    void subscribe();

    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [loadCreatorVideos, loadGenerationProducts, role]);

  useEffect(() => {
    if (!generationJob?.id || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    const channel = client
      .channel(`framr-generation-${generationJob.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "generation_jobs", filter: `id=eq.${generationJob.id}` }, (event) => {
        const row = event.new as GenerationJob;
        setGenerationJob((current) => current?.id === row.id ? { ...current, ...row } : current);
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [generationJob?.id]);

  const queueGeneration = async (productId: string) => {
    const placementId = selectedVideo?.placements[0]?.id;
    if (!placementId) { toast.error("Select a detected placement before creating a version."); return; }
    const response = await fetch("/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placementId, productId }),
    });
    const body = await response.json().catch(() => null) as { generation?: GenerationJob; error?: string } | null;
    if (!response.ok || !body?.generation) { toast.error(body?.error ?? "Generation could not be queued."); return; }
    setGenerationJob(body.generation);
  };

  const nav = role === "creator" ? creatorNav : advertiserNav;
  const title = nav.find((item) => item.id === page)?.label ?? page;
  const selectedVideo = videos.find((video) => video.id === selectedVideoId) ?? videos[0] ?? null;

  const updateVersion = () => {
    setPage("versions");
  };

  const addVideo = (video: Video) => {
    setVideos((current) => current.some((item) => item.id === video.id) ? current : [video, ...current]);
    setSelectedVideoId(video.id);
    setPage("videos");
  };

  const contentProps = {
    page,
    videos,
    assets,
    campaigns,
    search,
    onPage: setPage,
    onSelectVideo: (videoId: string) => {
      setSelectedVideoId(videoId);
      setPage("placements");
    },
    onUpload: () => setModal("upload"),
    onProduct: () => setModal("product"),
    onCampaign: () => setModal("campaign"),
    onGenerate: () => setModal("generate"),
    onExport: async (versionId: string, label: string) => {
      setExportLabel(label);
      if (versionId.startsWith("source-")) { toast.error("The source video is protected. Export a generated version instead."); return; }
      const response = await fetch(`/api/versions/${versionId}`);
      const body = await response.json().catch(() => null) as { url?: string; error?: string } | null;
      if (!response.ok || !body?.url) { toast.error(body?.error ?? "An export link could not be created."); return; }
      window.open(body.url, "_blank", "noopener,noreferrer");
    },
    onReserve: (listing: MarketplaceListing) => setReserve(listing),
    onToggleVersion: async (_videoId: string, versionId: string) => {
      if (versionId.startsWith("source-")) return;
      const current = selectedVideo?.versions.find((version) => version.id === versionId);
      const response = await fetch(`/api/versions/${versionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: current?.active ? "deactivate" : "activate" }) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) { toast.error(body?.error ?? "The active version could not be updated."); return; }
      await loadCreatorVideos();
    },
    onToast: (message: string) => toast(message),
  };

  return <div className="min-h-screen bg-paper text-ink">
    <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className={`fixed inset-0 z-30 bg-night/50 lg:hidden ${mobileOpen ? "block" : "hidden"}`} />
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-paper transition-transform duration-300 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-16 items-center gap-2 border-b border-line px-5">
        <button onClick={onExit} title="Back to home" aria-label="Back to home" className="-ml-1.5 p-1.5 text-inksoft transition hover:text-ink"><ArrowLeft size={18} /></button>
        <FramrMark compact onNavigate={onExit} />
        <Chip className={`ml-auto ${role === "creator" ? "bg-paper2 text-inksoft" : "bg-accent-soft text-accent"}`}>{role.toUpperCase()}</Chip>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {nav.map(({ id, label, icon: Icon }, index) => <button key={id} onClick={() => { setPage(id); setMobileOpen(false); }} className={`nav-item ${page === id ? "nav-item--active" : ""} ${index === nav.length - 2 ? "mt-4 border-t border-line pt-4" : ""}`}>
          <Icon size={16} />{label}
          {label === "Videos" && <span className="ml-auto text-[10px] font-bold">{videos.length}</span>}
          {label === "Campaigns" && role === "creator" && <span className="ml-auto text-[10px] font-bold text-accent">2</span>}
        </button>)}
      </nav>
      <div className="border-t border-line p-3"><div className="flex items-center gap-3 p-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-extrabold ${role === "creator" ? "bg-ink text-paper" : "bg-accent text-white"}`}>{role === "creator" ? "LK" : "AU"}</span>
        <div className="min-w-0"><div className="truncate text-xs font-bold">{role === "creator" ? "Lena Kovač" : "Auris Home"}</div><div className="text-[10px] text-inksoft">{role === "creator" ? "@lena.cooks · Pro" : "Growth plan · Stripe"}</div></div>
        <button className="ml-auto p-1.5 text-inksoft hover:text-ink" title="Back to site" onClick={onExit}><ExternalLink size={16} /></button>
        <button className="p-1.5 text-inksoft transition hover:text-accent" title="Sign out" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button>
      </div></div>
    </aside>
    <div className="min-h-screen lg:pl-64">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-paper/95 px-5 backdrop-blur">
        <button className="-ml-2 p-2 lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
        <h1 className="text-lg font-extrabold tracking-tight">{title}</h1>
        <Chip className="hidden bg-paper2 text-inksoft sm:inline-flex">{isSupabaseConfigured ? "LIVE WORKSPACE" : "DEMO WORKSPACE"}</Chip>
        <div className="relative ml-auto hidden md:block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-inksoft" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-56 rounded-md border border-line bg-white py-0 pl-9 pr-3 text-sm placeholder:text-inksoft/60" placeholder={role === "creator" ? "Search videos, placements…" : "Search marketplace…"} /></div>
        <FramrButton size="sm" variant="accent" onClick={() => setModal(role === "creator" ? "upload" : "campaign")}>{role === "creator" ? <><Upload size={16} /><span className="hidden sm:inline">Upload video</span></> : <><Plus size={16} /><span className="hidden sm:inline">New campaign</span></>}</FramrButton>
      </header>
      <main className="mx-auto w-full max-w-[1400px] p-5 sm:p-8">{role === "creator" ? <CreatorWorkspace {...contentProps} /> : <AdvertiserWorkspace {...contentProps} />}</main>
    </div>
    <UploadVideoModal open={modal === "upload"} onClose={() => setModal(null)} onComplete={addVideo} />
    <ProductModal open={modal === "product"} onClose={() => setModal(null)} onSave={(asset) => { setAssets((items) => [asset, ...items]); void loadGenerationProducts(); }} />
    <CampaignModal open={modal === "campaign"} onClose={() => setModal(null)} onCreate={(campaign) => setCampaigns((items) => [campaign, ...items])} />
    <GenerationModal
      open={modal === "generate"}
      onClose={() => setModal(null)}
      video={selectedVideo}
      products={generationProducts}
      generation={generationJob}
      onStart={queueGeneration}
      onFinish={updateVersion}
    />
    <ExportModal open={modal === "export"} onClose={() => setModal(null)} label={exportLabel} />
    <ReserveModal listing={reserve} open={Boolean(reserve)} onClose={() => setReserve(null)} />
  </div>;
}

export function WorkspacePageClient({ role, onExitHref }: { role: Role; onExitHref: string }) {
  const router = useRouter();
  const handleSignOut = async () => {
    await signOut();
    router.push(onExitHref);
  };
  return <><Toaster richColors position="bottom-center" /><Workspace role={role} onExit={() => router.push(onExitHref)} onSignOut={handleSignOut} /></>;
}
