/** Design reference: the application workspace keeps the source's permanent role-based sidebar and compact operational header. */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { CreatorMarketplaceListing, CreatorMarketplaceOffer, PublishablePlacement } from "@/components/framr/CreatorMarketplacePanels";
import type { AdvertiserBrand, AdvertiserCampaign, AdvertiserListing, AdvertiserProduct } from "@/components/framr/AdvertiserMarketplacePanels";
import { FrameRunModal } from "@/components/framr/FrameRunModal";
import { AnalysisProgressModal } from "@/components/framr/AnalysisProgressModal";
import { MaskRefinementModal } from "@/components/framr/MaskRefinementModal";
import {
  CampaignModal,
  ExportModal,
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
import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase-browser";

export type Role = "creator" | "advertiser";
type WorkspaceProps = { role: Role; onExit: () => void; onSignOut: () => void };
type GenerationProduct = { id: string; name: string; brand: string | null; image: string };
type PlacementTarget = {
  id: string;
  placement_id: string;
  start_frame: number;
  end_frame: number;
  seed_frame: number;
  seed_mask_key: string | null;
  manual_revision: number;
  status: string;
};
type PlacementRunStatus = "queued" | "running" | "needs_review" | "ready" | "failed" | "canceled";
type PlacementRun = {
  id: string;
  status: PlacementRunStatus;
  version_id: string | null;
  error: string | null;
  cost_cents: number | null;
  progress: number;
  current_stage: string | null;
};
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

const privateUrlCache = new Map<string, string>();

async function resolvePrivateUrl(client: NonNullable<ReturnType<typeof getBrowserClient>>, key: string | null, fallback: string) {
  if (!key) return fallback;
  const cached = privateUrlCache.get(key);
  if (cached) return cached;
  const [bucket, ...pathParts] = key.split("/");
  const objectPath = pathParts.join("/");
  if (!["thumbnails", "products", "videos", "generated", "artifacts"].includes(bucket) || !objectPath) return fallback;
  const [ownerId, fileName] = pathParts;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId ?? "");
  if (!isUuid || !fileName) return fallback;
  const { data, error } = await client.storage.from(bucket).createSignedUrl(objectPath, 60 * 60);
  if (error || !data?.signedUrl) return fallback;
  privateUrlCache.set(key, data.signedUrl);
  return data.signedUrl;
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
  const [creatorListings, setCreatorListings] = useState<CreatorMarketplaceListing[]>([]);
  const [creatorOffers, setCreatorOffers] = useState<CreatorMarketplaceOffer[]>([]);
  const [advertiserBrand, setAdvertiserBrand] = useState<AdvertiserBrand | null>(null);
  const [advertiserProducts, setAdvertiserProducts] = useState<AdvertiserProduct[]>([]);
  const [advertiserCampaigns, setAdvertiserCampaigns] = useState<AdvertiserCampaign[]>([]);
  const [advertiserListings, setAdvertiserListings] = useState<AdvertiserListing[]>([]);
  const [modal, setModal] = useState<"upload" | "analysis" | "product" | "campaign" | "mask" | "generate" | "export" | null>(null);
  const [reserve, setReserve] = useState<MarketplaceListing | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState("v1");
  const [exportLabel, setExportLabel] = useState("Auris Model A");
  const [generationProducts, setGenerationProducts] = useState<GenerationProduct[]>([]);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<PlacementTarget | null>(null);
  const [placementRun, setPlacementRun] = useState<PlacementRun | null>(null);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [pendingPlacementVideoId, setPendingPlacementVideoId] = useState<string | null>(null);

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
      const image = await resolvePrivateUrl(client, row.thumbnail_key, "");
      const videoUrl = await resolvePrivateUrl(client, row.video_key, "");
      current.push({ id: row.id, label: row.label, brand: row.brand ?? "Product", image, active: row.is_active, videoUrl: videoUrl || undefined });
      versionsByVideo.set(videoId, current);
    }
    const hydrated = await Promise.all(((videoResponse.data ?? []) as PersistedVideoRow[]).map(async (row) => {
      const thumbnail = await resolvePrivateUrl(client, row.thumbnail_key, "");
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

  const loadCreatorMarketplace = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    const [listingResponse, offerResponse] = await Promise.all([
      fetch("/api/creator/listings", { cache: "no-store" }),
      fetch("/api/creator/offers", { cache: "no-store" }),
    ]);
    const listingBody = await listingResponse.json().catch(() => null) as { listings?: Array<{
      id: string; placement_id: string; status: CreatorMarketplaceListing["status"]; price_cents: number; currency: string; creator_notes: string | null; thumbnail_key: string | null;
      placement: { id: string; object_label: string; category: string | null; duration_seconds: number; quality: CreatorMarketplaceListing["placement"]["quality"] };
      video: { id: string; title: string; status: string };
    }>; error?: string } | null;
    const offerBody = await offerResponse.json().catch(() => null) as { offers?: Array<{
      id: string; status: CreatorMarketplaceOffer["status"]; price_cents: number; currency: string; created_at: string;
      funding_status: CreatorMarketplaceOffer["fundingStatus"]; delivery_status: CreatorMarketplaceOffer["deliveryStatus"]; preview_version_id: string | null; payout_status: CreatorMarketplaceOffer["payoutStatus"]; creator_review_note: string | null;
      campaign: { id: string; name: string }; placement?: { object_label: string; video_title: string } | null; product?: { id: string; name: string; brand: string | null } | null;
    }>; error?: string } | null;
    if (!listingResponse.ok || !offerResponse.ok) {
      if (listingResponse.status !== 500 && offerResponse.status !== 500) toast.error(listingBody?.error ?? offerBody?.error ?? "Marketplace data could not be loaded.");
      return;
    }
    const hydratedListings = await Promise.all((listingBody?.listings ?? []).map(async (listing) => ({
      id: listing.id,
      placementId: listing.placement_id,
      status: listing.status,
      priceCents: listing.price_cents,
      currency: listing.currency,
      creatorNotes: listing.creator_notes,
      thumbnailUrl: await resolvePrivateUrl(client, listing.thumbnail_key, ""),
      publishedAt: null,
      placement: {
        id: listing.placement.id,
        objectLabel: listing.placement.object_label,
        category: listing.placement.category,
        durationSeconds: listing.placement.duration_seconds,
        quality: listing.placement.quality,
      },
      video: listing.video,
    })));
    setCreatorListings(hydratedListings);
    setCreatorOffers((offerBody?.offers ?? []).map((offer) => ({
      id: offer.id,
      status: offer.status,
      priceCents: offer.price_cents,
      currency: offer.currency,
      createdAt: offer.created_at,
      campaign: offer.campaign,
      placement: offer.placement ? { objectLabel: offer.placement.object_label, videoTitle: offer.placement.video_title } : null,
      product: offer.product ?? null,
      fundingStatus: offer.funding_status,
      deliveryStatus: offer.delivery_status,
      previewVersionId: offer.preview_version_id,
      payoutStatus: offer.payout_status,
      creatorReviewNote: offer.creator_review_note,
    })));
  }, []);

  const loadAdvertiserMarketplace = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    const [brandResponse, campaignResponse, marketResponse] = await Promise.all([
      fetch("/api/advertiser/brand", { cache: "no-store" }),
      fetch("/api/advertiser/campaigns", { cache: "no-store" }),
      fetch("/api/advertiser/marketplace", { cache: "no-store" }),
    ]);
    const brandBody = await brandResponse.json().catch(() => null) as { brand?: { id: string; name: string; website: string | null } | null; error?: string } | null;
    const campaignBody = await campaignResponse.json().catch(() => null) as { campaigns?: Array<{ id: string; name: string; status: AdvertiserCampaign["status"]; budget_cents: number; category: string | null; geography: string | null; product_id: string | null; currency: string; metrics: AdvertiserCampaign["metrics"]; offers: AdvertiserCampaign["offers"] }>; products?: Array<{ id: string; name: string; brand: string | null; image_key: string | null }>; error?: string } | null;
    const marketBody = await marketResponse.json().catch(() => null) as { listings?: Array<{ id: string; price_cents: number; currency: string; object_label: string; category: string | null; duration_seconds: number | null; quality: AdvertiserListing["quality"]; video_title: string | null; creator_notes: string | null; thumbnail_url: string | null; creator: { display_name: string; handle: string | null } }>; error?: string } | null;
    if (!brandResponse.ok || !campaignResponse.ok || !marketResponse.ok) {
      const pendingBrandSetup = brandResponse.ok && (campaignResponse.status === 409 || marketResponse.status === 409);
      if (!pendingBrandSetup) toast.error(brandBody?.error ?? campaignBody?.error ?? marketBody?.error ?? "Advertiser marketplace data could not be loaded.");
      setAdvertiserBrand(brandBody?.brand ?? null);
      if (!brandBody?.brand) { setAdvertiserProducts([]); setAdvertiserCampaigns([]); setAdvertiserListings([]); }
      return;
    }
    setAdvertiserBrand(brandBody?.brand ?? null);
    const hydratedProducts = await Promise.all((campaignBody?.products ?? []).map(async (product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      imageUrl: await resolvePrivateUrl(client, product.image_key, ""),
    })));
    setAdvertiserProducts(hydratedProducts);
    setAssets(hydratedProducts.map((product) => ({ id: product.id, name: product.name, brand: product.brand ?? "Your brand", category: "Product", image: product.imageUrl, frame: product.imageUrl })));
    setAdvertiserCampaigns((campaignBody?.campaigns ?? []).map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      budgetCents: campaign.budget_cents,
      category: campaign.category,
      geography: campaign.geography,
      productId: campaign.product_id,
      currency: campaign.currency,
      metrics: campaign.metrics,
      offers: campaign.offers ?? [],
    })));
    setAdvertiserListings((marketBody?.listings ?? []).map((listing) => ({
      id: listing.id,
      priceCents: listing.price_cents,
      currency: listing.currency,
      objectLabel: listing.object_label,
      category: listing.category,
      durationSeconds: listing.duration_seconds,
      quality: listing.quality,
      videoTitle: listing.video_title,
      thumbnailUrl: listing.thumbnail_url,
      creatorNotes: listing.creator_notes,
      creator: { displayName: listing.creator.display_name, handle: listing.creator.handle },
    })));
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

  const startPlacementRun = useCallback(async (placementId: string, target: PlacementTarget, productId: string) => {
    const response = await fetch("/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placementId, productId, targetId: target.id, idempotencyKey: crypto.randomUUID() }),
    });
    const body = await response.json().catch(() => null) as { run?: PlacementRun; error?: string; reused?: boolean } | null;
    if (!response.ok || !body?.run) {
      toast.error(body?.error ?? "We couldn’t create that preview.");
      return;
    }
    setPlacementRun(body.run);
  }, []);

  useEffect(() => {
    if (role !== "creator" || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;

    let channel: ReturnType<typeof client.channel> | null = null;
    let cancelled = false;
    const subscribe = async () => {
      await Promise.all([loadCreatorVideos(), loadGenerationProducts(), loadCreatorMarketplace()]);
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
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "marketplace_listings", filter: `creator_id=eq.${user.id}` },
          () => { void loadCreatorMarketplace(); },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "campaign_placements", filter: `creator_id=eq.${user.id}` },
          () => { void loadCreatorMarketplace(); },
        )
        .subscribe();
    };
    void subscribe();

    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [loadCreatorMarketplace, loadCreatorVideos, loadGenerationProducts, role]);

  useEffect(() => {
    if (role !== "advertiser" || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    let channel: ReturnType<typeof client.channel> | null = null;
    let cancelled = false;
    const subscribe = async () => {
      await loadAdvertiserMarketplace();
      const { data: { user } } = await client.auth.getUser();
      if (cancelled || !user) return;
      channel = client
        .channel(`framr-advertiser-market-${user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "campaigns", filter: `advertiser_id=eq.${user.id}` }, () => { void loadAdvertiserMarketplace(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "products", filter: `owner_id=eq.${user.id}` }, () => { void loadAdvertiserMarketplace(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "campaign_placements" }, () => { void loadAdvertiserMarketplace(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "marketplace_listings" }, () => { void loadAdvertiserMarketplace(); })
        .subscribe();
    };
    void subscribe();
    return () => { cancelled = true; if (channel) void client.removeChannel(channel); };
  }, [loadAdvertiserMarketplace, role]);

  useEffect(() => {
    if (role !== "advertiser" || !isSupabaseConfigured) return;
    const url = new URL(window.location.href);
    const payment = url.searchParams.get("payment");
    if (!payment) return;
    if (payment === "success") toast.success("Payment confirmed. Choose Start preview when you are ready.");
    if (payment === "cancel") toast("Checkout was canceled. Your approved offer is still waiting for funding.");
    url.searchParams.delete("payment");
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    const refreshTimer = window.setTimeout(() => { void loadAdvertiserMarketplace(); }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [loadAdvertiserMarketplace, role]);

  useEffect(() => {
    if (!selectedTarget?.id || !isSupabaseConfigured) return;
    const client = getBrowserClient();
    if (!client) return;
    const targetId = selectedTarget.id;
    let cancelled = false;
    const syncTarget = async () => {
      const { data, error } = await client
        .from("placement_targets")
        .select("id,placement_id,start_frame,end_frame,seed_frame,seed_mask_key,manual_revision,status")
        .eq("id", targetId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const next = data as PlacementTarget;
      setSelectedTarget((current) => current?.id === next.id ? next : current);
      if (next.status === "ready") {
        void loadCreatorVideos();
        if (pendingProductId && selectedPlacementId === next.placement_id) {
          const productId = pendingProductId;
          setPendingProductId(null);
          void startPlacementRun(next.placement_id, next, productId);
        }
      } else if (next.status === "needs_review" || next.status === "failed") {
        setPendingProductId(null);
        void loadCreatorVideos();
      }
    };
    void syncTarget();
    const interval = window.setInterval(() => { void syncTarget(); }, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedTarget?.id, loadCreatorVideos, pendingProductId, selectedPlacementId, startPlacementRun]);

  useEffect(() => {
    if (!placementRun?.id || !isSupabaseConfigured || ["ready", "needs_review", "failed", "canceled"].includes(placementRun.status)) return;
    const client = getBrowserClient();
    if (!client) return;
    const runId = placementRun.id;
    let cancelled = false;
    const syncRun = async () => {
      const { data, error } = await client
        .from("placement_runs")
        .select("id,status,version_id,error,estimated_cost_cents,progress,current_stage")
        .eq("id", runId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const row = data as Omit<PlacementRun, "cost_cents"> & { estimated_cost_cents: number | null };
      const next: PlacementRun = { ...row, cost_cents: row.estimated_cost_cents };
      setPlacementRun((current) => current?.id === next.id ? next : current);
      if (["ready", "needs_review", "failed", "canceled"].includes(next.status)) void loadCreatorVideos();
    };
    void syncRun();
    const interval = window.setInterval(() => { void syncRun(); }, 5_000);
    const channel = client
      .channel(`framr-placement-run-${runId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "placement_runs", filter: `id=eq.${runId}` }, () => { void syncRun(); })
      .subscribe();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void client.removeChannel(channel);
    };
  }, [placementRun?.id, loadCreatorVideos]);

  const queueGeneration = async (productId: string) => {
    const placementId = selectedPlacementId;
    if (!placementId || !selectedTarget || selectedTarget.placement_id !== placementId) {
      toast.error("Choose an item first.");
      return;
    }
    if (selectedTarget.status !== "ready") {
      setPendingProductId(productId);
      return;
    }
    await startPlacementRun(placementId, selectedTarget, productId);
  };

  const prepareAutomaticTarget = async (placementId: string) => {
    setSelectedPlacementId(placementId);
    setSelectedTarget(null);
    setPlacementRun(null);
    setPendingProductId(null);
    const response = await fetch("/api/placement-targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placementId }),
    });
    const body = await response.json().catch(() => null) as { target?: PlacementTarget; error?: string; reused?: boolean } | null;
    if (!response.ok || !body?.target) {
      toast.error(body?.error ?? "FRAMR could not start automatic object tracking.");
      return;
    }
    setSelectedTarget(body.target);
    setPage("versions");
    setModal("generate");
    toast(body.reused ? "FRAMR is continuing to map this object." : "FRAMR is mapping this object through your video.");
  };

  const cancelPlacementRun = async () => {
    if (!placementRun) return;
    const response = await fetch("/api/generations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: placementRun.id, action: "cancel" }),
    });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) { toast.error(body?.error ?? "The placement run could not be canceled."); return; }
    setPlacementRun((current) => current ? { ...current, status: "canceled", error: "Canceled by creator." } : current);
    await loadCreatorVideos();
  };

  const publishablePlacements = useMemo<PublishablePlacement[]>(() => videos
    .filter((video) => video.status === "ready")
    .flatMap((video) => video.placements.map((placement) => ({
      id: placement.id,
      videoTitle: video.title,
      objectLabel: placement.object,
      category: placement.category,
      durationSeconds: placement.duration,
      quality: placement.quality,
    })))
    .filter((placement) => !creatorListings.some((listing) => listing.placementId === placement.id)), [creatorListings, videos]);

  const publishListing = async (payload: { placementId: string; priceCents: number; creatorNotes: string }) => {
    const response = await fetch("/api/creator/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) { toast.error(body?.error ?? "That placement could not be published."); return false; }
    toast.success("Placement published. Brands can request it while your original stays private.");
    await loadCreatorMarketplace();
    return true;
  };

  const updateListing = async (listingId: string, action: "publish" | "pause" | "archive") => {
    const response = await fetch("/api/creator/listings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId, action }) });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) { toast.error(body?.error ?? "That listing could not be updated."); return false; }
    toast.success(action === "archive" ? "Listing archived." : action === "pause" ? "Listing paused." : "Listing published.");
    await loadCreatorMarketplace();
    return true;
  };

  const respondToOffer = async (offerId: string, action: "accept" | "decline") => {
    const response = await fetch("/api/creator/offers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offerId, action }) });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) { toast.error(body?.error ?? "Your response could not be saved."); return false; }
    toast.success(action === "accept" ? "Offer accepted. The campaign will move to funding next." : "Offer declined.");
    await loadCreatorMarketplace();
    return true;
  };

  const reviewCreatorDelivery = async (offerId: string, action: "approve" | "request_changes", note: string) => {
    const response = await fetch(`/api/creator/offers/${offerId}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) { toast.error(body?.error ?? "Your delivery review could not be saved."); return false; }
    toast.success(action === "approve" ? "Delivery approved. This placement is now payout eligible." : "Changes requested. The advertiser has been notified.");
    await loadCreatorMarketplace();
    return true;
  };

  const saveAdvertiserBrand = async (payload: { name: string; website: string }) => {
    const response = await fetch("/api/advertiser/brand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) { toast.error(body?.error ?? "Your brand could not be saved."); return false; }
    toast.success("Brand profile saved. You can now add products and campaigns.");
    await loadAdvertiserMarketplace();
    return true;
  };

  const createAdvertiserCampaign = async (payload: { name: string; budgetCents: number; productId: string; category: string; geography: string }) => {
    const response = await fetch("/api/advertiser/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) { toast.error(body?.error ?? "The campaign could not be created."); return false; }
    toast.success("Campaign created. Choose a creator placement to send your first offer.");
    await loadAdvertiserMarketplace();
    setPage("market");
    return true;
  };

  const submitAdvertiserOffer = async (payload: { listingId: string; campaignId: string; productId: string }) => {
    const response = await fetch("/api/advertiser/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) { toast.error(body?.error ?? "The creator offer could not be sent."); return false; }
    toast.success("Offer sent. The creator will decide before any preview starts.");
    await loadAdvertiserMarketplace();
    return true;
  };

  const fundAdvertiserOffer = async (offerId: string) => {
    const response = await fetch(`/api/advertiser/offers/${offerId}/checkout`, { method: "POST" });
    const body = await response.json().catch(() => null) as { checkoutUrl?: string; error?: string } | null;
    if (!response.ok || !body?.checkoutUrl) { toast.error(body?.error ?? "Secure checkout could not be opened."); return false; }
    window.location.assign(body.checkoutUrl);
    return true;
  };

  const requestAdvertiserPreview = async (offerId: string) => {
    const response = await fetch(`/api/advertiser/offers/${offerId}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    const body = await response.json().catch(() => null) as { runId?: string; reused?: boolean; error?: string } | null;
    if (!response.ok || !body?.runId) { toast.error(body?.error ?? "The funded preview could not be started."); return false; }
    toast.success(body.reused ? "Your preview is already in progress." : "Preview started. The creator will review it when it is ready.");
    await loadAdvertiserMarketplace();
    return true;
  };

  const nav = role === "creator" ? creatorNav : advertiserNav;
  const title = nav.find((item) => item.id === page)?.label ?? page;
  const selectedVideo = videos.find((video) => video.id === selectedVideoId) ?? videos[0] ?? null;
  const selectedPlacement = selectedVideo?.placements.find((placement) => placement.id === selectedPlacementId) ?? null;

  const updateVersion = () => {
    setPage("versions");
  };

  const addVideo = (video: Video) => {
    setVideos((current) => current.some((item) => item.id === video.id) ? current : [video, ...current]);
    setSelectedVideoId(video.id);
    setPendingPlacementVideoId(video.id);
    setModal("analysis");
  };

  const pendingAnalysisVideo = videos.find((video) => video.id === pendingPlacementVideoId) ?? null;

  const finishAnalysis = useCallback((videoId: string) => {
    setSelectedVideoId(videoId);
    setPendingPlacementVideoId(null);
    setModal(null);
    setPage("placements");
    void loadCreatorVideos();
    toast.success("Analysis complete. Your placement workspace is ready to review.");
  }, [loadCreatorVideos]);

  const contentProps = {
    page,
    videos,
    assets,
    campaigns,
    search,
    creatorListings,
    publishablePlacements,
    creatorOffers,
    advertiserBrand,
    advertiserProducts,
    advertiserCampaigns,
    advertiserListings,
    onPage: setPage,
    onSelectVideo: (videoId: string) => {
      setSelectedVideoId(videoId);
      setPage("placements");
    },
    onUpload: () => setModal("upload"),
    onProduct: () => setModal("product"),
    onCampaign: () => setModal("campaign"),
    onGenerate: (placementId?: string) => {
      if (!placementId) { toast.error("Choose a detected object from the placements list before preparing a placement preview."); return; }
      void prepareAutomaticTarget(placementId);
    },
    onExport: async (versionId: string, label: string) => {
      setExportLabel(label);
      if (versionId.startsWith("source-")) { toast.error("The source video is protected. Export a generated version instead."); return; }
      const response = await fetch(`/api/versions/${versionId}`);
      const body = await response.json().catch(() => null) as { url?: string; error?: string } | null;
      if (!response.ok || !body?.url) { toast.error(body?.error ?? "An export link could not be created."); return; }
      window.open(body.url, "_blank", "noopener,noreferrer");
    },
    onReserve: (listing: MarketplaceListing) => setReserve(listing),
    onPublishListing: publishListing,
    onUpdateListing: updateListing,
    onRespondToOffer: respondToOffer,
    onReviewCreatorDelivery: reviewCreatorDelivery,
    onSaveAdvertiserBrand: saveAdvertiserBrand,
    onCreateAdvertiserCampaign: createAdvertiserCampaign,
    onSubmitAdvertiserOffer: submitAdvertiserOffer,
    onFundAdvertiserOffer: fundAdvertiserOffer,
    onRequestAdvertiserPreview: requestAdvertiserPreview,
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
          {label === "Campaigns" && role === "creator" && creatorOffers.filter((offer) => offer.status === "submitted").length > 0 && <span className="ml-auto text-[10px] font-bold text-accent">{creatorOffers.filter((offer) => offer.status === "submitted").length}</span>}
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
        <FramrButton size="sm" variant="accent" onClick={() => role === "creator" ? setModal("upload") : setPage("campaigns")}>{role === "creator" ? <><Upload size={16} /><span className="hidden sm:inline">Upload video</span></> : <><Plus size={16} /><span className="hidden sm:inline">New campaign</span></>}</FramrButton>
      </header>
      <main className="mx-auto w-full max-w-[1400px] p-5 sm:p-8">{role === "creator" ? <CreatorWorkspace {...contentProps} /> : <AdvertiserWorkspace {...contentProps} />}</main>
    </div>
    <UploadVideoModal open={modal === "upload"} onClose={() => setModal(null)} onComplete={addVideo} />
    <AnalysisProgressModal
      key={pendingPlacementVideoId ?? "no-pending-upload"}
      open={modal === "analysis"}
      video={pendingAnalysisVideo}
      onReady={finishAnalysis}
      onClose={() => { setModal(null); setPendingPlacementVideoId(null); setPage("videos"); }}
    />
    <ProductModal open={modal === "product"} onClose={() => setModal(null)} onSave={(asset) => { setAssets((items) => [asset, ...items]); if (role === "creator") void loadGenerationProducts(); else void loadAdvertiserMarketplace(); }} />
    <CampaignModal open={modal === "campaign"} onClose={() => setModal(null)} onCreate={(campaign) => setCampaigns((items) => [campaign, ...items])} />
    <MaskRefinementModal
      open={modal === "mask"}
      onClose={() => setModal(null)}
      video={selectedVideo}
      placement={selectedPlacement}
      onPrepared={(target) => { setSelectedTarget(target); setPage("versions"); setModal("generate"); toast("FRAMR is re-tracking your refined mask."); }}
    />
    <FrameRunModal
      open={modal === "generate"}
      onClose={() => setModal(null)}
      video={selectedVideo}
      placement={selectedPlacement}
      products={generationProducts}
      target={selectedTarget}
      run={placementRun}
      preparing={Boolean(pendingProductId)}
      onStart={queueGeneration}
      onCancel={cancelPlacementRun}
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
