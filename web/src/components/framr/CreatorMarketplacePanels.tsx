"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CirclePause, CirclePlay, Loader2, Megaphone, Store, X } from "lucide-react";
import { Chip, FramrButton, FramedCard, QualityChip } from "./FramrPrimitives";
import { VideoThumbnailPlaceholder } from "./VideoThumbnailPlaceholder";

export type CreatorMarketplaceListing = {
  id: string;
  placementId: string;
  status: "draft" | "published" | "paused" | "held" | "booked" | "archived";
  priceCents: number;
  currency: string;
  creatorNotes: string | null;
  thumbnailUrl: string;
  publishedAt: string | null;
  placement: {
    id: string;
    objectLabel: string;
    category: string | null;
    durationSeconds: number;
    quality: "Excellent" | "Good" | "Limited" | "Fair";
  };
  video: { id: string; title: string; status: string };
};

export type PublishablePlacement = {
  id: string;
  videoTitle: string;
  objectLabel: string;
  category: string;
  durationSeconds: number;
  quality: "Excellent" | "Good" | "Limited" | "Fair";
};

export type CreatorMarketplaceOffer = {
  id: string;
  status: "draft" | "submitted" | "creator_approved" | "creator_declined" | "canceled" | "expired";
  priceCents: number;
  currency: string;
  createdAt: string;
  campaign: { id: string; name: string };
  placement: { objectLabel: string; videoTitle: string } | null;
  product: { id: string; name: string; brand: string | null } | null;
  fundingStatus: "awaiting_payment" | "checkout_pending" | "funded" | "payment_failed" | "refunded";
  deliveryStatus: "not_started" | "preview_queued" | "preview_generating" | "creator_review" | "creator_approved" | "changes_requested" | "delivered" | "payout_eligible";
  previewVersionId: string | null;
  payoutStatus: "not_eligible" | "eligible" | "paid" | "held";
  creatorReviewNote: string | null;
};

type PublishPayload = { placementId: string; priceCents: number; creatorNotes: string };

type MarketplaceProps = {
  listings: CreatorMarketplaceListing[];
  publishablePlacements: PublishablePlacement[];
  onPublish: (payload: PublishPayload) => Promise<boolean>;
  onUpdate: (listingId: string, action: "publish" | "pause" | "archive") => Promise<boolean>;
};

type OffersProps = {
  offers: CreatorMarketplaceOffer[];
  onRespond: (offerId: string, action: "accept" | "decline") => Promise<boolean>;
  onReviewDelivery: (offerId: string, action: "approve" | "request_changes", note: string) => Promise<boolean>;
};

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100);
}

function statusClass(status: string) {
  if (status === "published" || status === "creator_approved") return "bg-emerald-100 text-emerald-800";
  if (status === "submitted" || status === "held") return "bg-amber-100 text-amber-800";
  if (status === "creator_declined" || status === "archived" || status === "canceled" || status === "expired") return "bg-paper2 text-inksoft";
  return "bg-accent-soft text-accent";
}

export function CreatorMarketplacePanel({ listings, publishablePlacements, onPublish, onUpdate }: MarketplaceProps) {
  const [placementId, setPlacementId] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedPlacement = useMemo(() => publishablePlacements.find((placement) => placement.id === placementId) ?? null, [placementId, publishablePlacements]);

  const publish = async () => {
    const priceCents = Math.round(Number(price) * 100);
    if (!placementId || !Number.isInteger(priceCents) || priceCents <= 0) {
      setError("Choose a placement and enter a price greater than zero.");
      return;
    }
    setPublishing(true);
    setError(null);
    const published = await onPublish({ placementId, priceCents, creatorNotes: notes });
    setPublishing(false);
    if (published) { setPlacementId(""); setPrice(""); setNotes(""); }
  };

  const update = async (listingId: string, action: "publish" | "pause" | "archive") => {
    setUpdatingId(listingId);
    setError(null);
    const updated = await onUpdate(listingId, action);
    setUpdatingId(null);
    if (!updated) setError("We couldn’t update that listing. Please try again.");
  };

  return <div>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><div className="serif-italic text-lg text-accent">Marketplace</div><h2 className="mt-1 text-2xl font-extrabold tracking-tight">Make the right moments available.</h2><p className="mt-1 max-w-2xl text-sm text-inksoft">You decide exactly which detected items brands can request. Your original video stays private.</p></div><Chip className="bg-ink text-paper"><Store size={13} />{listings.filter((listing) => listing.status === "published").length} LIVE</Chip></div>

    <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        {listings.length === 0 ? <FramedCard className="p-7"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent"><Store size={18} /></div><h3 className="mt-4 text-lg font-extrabold">No placements are listed yet.</h3><p className="mt-2 max-w-md text-sm leading-relaxed text-inksoft">Choose one of the items FRAMR found in a finished video, set your price, and publish it when you are ready. Brands cannot see your original video.</p></FramedCard> : <div className="grid gap-4 sm:grid-cols-2">{listings.map((listing) => <FramedCard key={listing.id} className="group"><div className="relative aspect-[9/8] overflow-hidden bg-night">{listing.thumbnailUrl ? <img src={listing.thumbnailUrl} alt={listing.video.title} className="absolute inset-0 h-full w-full object-cover" /> : <VideoThumbnailPlaceholder />}<Chip className={`absolute left-2 top-2 ${statusClass(listing.status)}`}>{listing.status.replaceAll("_", " ").toUpperCase()}</Chip><Chip className="absolute bottom-2 right-2 bg-night/80 text-white">{listing.placement.durationSeconds.toFixed(1)}s</Chip></div><div className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-bold">{listing.placement.objectLabel}</div><div className="mt-0.5 truncate text-[11px] text-inksoft">{listing.video.title} · {listing.placement.category ?? "Uncategorized"}</div></div><div className="text-right text-sm font-extrabold text-accent">{formatMoney(listing.priceCents, listing.currency)}</div></div><div className="mt-3 flex items-center gap-2"><QualityChip quality={listing.placement.quality} /><span className="text-[11px] text-inksoft">Your listing</span></div>{listing.creatorNotes ? <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-inksoft">{listing.creatorNotes}</p> : null}<div className="mt-4 flex gap-2">{listing.status === "published" ? <FramrButton size="sm" variant="ghost" className="flex-1" disabled={updatingId === listing.id} onClick={() => { void update(listing.id, "pause"); }}><CirclePause size={14} />Pause</FramrButton> : listing.status === "paused" || listing.status === "draft" ? <FramrButton size="sm" className="flex-1" disabled={updatingId === listing.id} onClick={() => { void update(listing.id, "publish"); }}>{updatingId === listing.id ? <Loader2 size={14} className="animate-spin" /> : <CirclePlay size={14} />}Publish</FramrButton> : null}{listing.status !== "booked" && listing.status !== "archived" ? <FramrButton size="sm" variant="ghost" disabled={updatingId === listing.id} onClick={() => { void update(listing.id, "archive"); }} aria-label="Archive listing"><X size={14} /></FramrButton> : null}</div></div></FramedCard>)}</div>}</div>
      <FramedCard className="h-fit p-5"><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-paper"><Megaphone size={16} /></span><div><div className="text-sm font-bold">Publish a placement</div><div className="text-[11px] text-inksoft">Only you control visibility.</div></div></div>{publishablePlacements.length === 0 ? <p className="mt-5 text-sm leading-relaxed text-inksoft">All detected items are already listed, or your videos are still being analysed.</p> : <><label className="mt-5 block text-xs font-bold">Detected item<select value={placementId} onChange={(event) => setPlacementId(event.target.value)} disabled={publishing} className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal"><option value="">Choose an item…</option>{publishablePlacements.map((placement) => <option value={placement.id} key={placement.id}>{placement.objectLabel} · {placement.videoTitle}</option>)}</select></label>{selectedPlacement ? <div className="mt-3 rounded-md bg-paper2/70 p-3 text-xs text-inksoft"><strong className="text-ink">{selectedPlacement.objectLabel}</strong> · {selectedPlacement.category} · visible for {selectedPlacement.durationSeconds.toFixed(1)} seconds</div> : null}<label className="mt-4 block text-xs font-bold">Your price (USD)<input value={price} inputMode="decimal" disabled={publishing} onChange={(event) => setPrice(event.target.value)} placeholder="250" className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal" /></label><label className="mt-4 block text-xs font-bold">Note for brands <span className="font-normal text-inksoft">(optional)</span><textarea value={notes} disabled={publishing} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Best fit for kitchen and cookware products." className="mt-1.5 h-20 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal" /></label>{error ? <p role="alert" className="mt-3 text-xs text-red-700">{error}</p> : null}<FramrButton className="mt-5 w-full" disabled={publishing} onClick={() => { void publish(); }}>{publishing ? <><Loader2 size={16} className="animate-spin" />Publishing…</> : <><Store size={16} />Publish placement</>}</FramrButton></>}</FramedCard>
    </div>
  </div>;
}

function CreatorDeliveryReviewCard({ offer, onReviewDelivery }: { offer: CreatorMarketplaceOffer; onReviewDelivery: OffersProps["onReviewDelivery"] }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(true);
  const [note, setNote] = useState(offer.creatorReviewNote ?? "");
  const [busy, setBusy] = useState<"approve" | "request_changes" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch(`/api/versions/${offer.previewVersionId}`, { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json().catch(() => null) as { url?: string; error?: string } | null }))
      .then(({ response, body }) => { if (!active) return; if (response.ok && body?.url) setVideoUrl(body.url); else setError(body?.error ?? "This preview video is unavailable."); })
      .catch(() => { if (active) setError("This preview video is unavailable."); })
      .finally(() => { if (active) setLoadingVideo(false); });
    return () => { active = false; };
  }, [offer.previewVersionId]);
  const review = async (action: "approve" | "request_changes") => {
    setBusy(action); setError(null);
    const saved = await onReviewDelivery(offer.id, action, note);
    setBusy(null);
    if (!saved) setError("We couldn’t save your review. Please try again.");
  };
  return <FramedCard className="border-accent/40 p-5"><div className="flex flex-wrap items-start gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-white"><Check size={17} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold">Preview ready for your review</span><Chip className="bg-accent-soft text-accent">FUNDED</Chip></div><p className="mt-1 text-xs text-inksoft">{offer.campaign.name} · {offer.placement ? `${offer.placement.objectLabel} · ${offer.placement.videoTitle}` : "Your marketplace placement"}</p></div><span className="text-sm font-extrabold text-accent">{formatMoney(offer.priceCents, offer.currency)}</span></div><div className="mt-4 overflow-hidden rounded-lg bg-night" style={{ aspectRatio: "9 / 16", maxWidth: 300 }}>{loadingVideo ? <div className="flex h-full min-h-72 items-center justify-center text-xs font-bold text-white/80"><Loader2 size={16} className="mr-2 animate-spin" />Loading preview…</div> : videoUrl ? <video src={videoUrl} controls playsInline className="h-full w-full object-cover" /> : <div className="flex h-full min-h-72 items-center justify-center px-6 text-center text-xs text-white/80">{error ?? "Preview video unavailable."}</div>}</div><label className="mt-4 block text-xs font-bold">Optional note for the brand<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="mt-1.5 h-20 w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-normal" placeholder="Share any changes you need, or approve this delivery." /></label>{error ? <p role="alert" className="mt-3 text-xs text-red-700">{error}</p> : null}<div className="mt-4 flex flex-wrap gap-2"><FramrButton size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => { void review("request_changes"); }}>{busy === "request_changes" ? <Loader2 size={14} className="animate-spin" /> : null}Request changes</FramrButton><FramrButton size="sm" disabled={Boolean(busy) || !videoUrl} onClick={() => { void review("approve"); }}>{busy === "approve" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Approve delivery</FramrButton></div></FramedCard>;
}

function creatorOfferState(offer: CreatorMarketplaceOffer) {
  if (offer.status !== "creator_approved") return offer.status.replaceAll("_", " ").toUpperCase();
  if (offer.fundingStatus !== "funded") return "AWAITING FUNDING";
  if (offer.deliveryStatus === "preview_queued" || offer.deliveryStatus === "preview_generating") return "PREVIEW IN PROGRESS";
  if (offer.deliveryStatus === "changes_requested") return "CHANGES REQUESTED";
  if (offer.payoutStatus === "eligible") return "PAYOUT ELIGIBLE";
  if (offer.deliveryStatus === "creator_approved" || offer.deliveryStatus === "delivered") return "DELIVERY APPROVED";
  return "READY FOR PREVIEW";
}

export function CreatorOffersPanel({ offers, onRespond, onReviewDelivery }: OffersProps) {
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const respond = async (offerId: string, action: "accept" | "decline") => {
    setRespondingId(offerId);
    await onRespond(offerId, action);
    setRespondingId(null);
  };
  const awaiting = offers.filter((offer) => offer.status === "submitted").length;
  const reviewsReady = offers.filter((offer) => offer.deliveryStatus === "creator_review" && offer.previewVersionId).length;
  return <div><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="serif-italic text-lg text-accent">Campaign offers</div><h2 className="mt-1 text-2xl font-extrabold tracking-tight">You stay in control of every partnership.</h2><p className="mt-1 text-sm text-inksoft">Accept products that fit your content, then approve the funded delivery only when it feels right.</p></div><Chip className={awaiting || reviewsReady ? "bg-amber-100 text-amber-800" : "bg-paper2 text-inksoft"}>{reviewsReady ? `${reviewsReady} REVIEW READY` : `${awaiting} AWAITING YOU`}</Chip></div><div className="mt-6 space-y-3">{offers.length === 0 ? <FramedCard className="p-7"><Megaphone size={20} className="text-accent" /><h3 className="mt-4 text-lg font-extrabold">No campaign offers yet.</h3><p className="mt-2 max-w-lg text-sm leading-relaxed text-inksoft">Publish a placement in Marketplace to make it available for matching. New offers will appear here automatically.</p></FramedCard> : offers.map((offer) => offer.deliveryStatus === "creator_review" && offer.previewVersionId ? <CreatorDeliveryReviewCard key={offer.id} offer={offer} onReviewDelivery={onReviewDelivery} /> : <FramedCard key={offer.id} className="p-5"><div className="flex flex-wrap items-start gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-night text-paper"><Megaphone size={17} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold">{offer.campaign.name}</span><Chip className={statusClass(offer.status)}>{creatorOfferState(offer)}</Chip></div><p className="mt-1 text-xs text-inksoft">{offer.placement ? `${offer.placement.objectLabel} · ${offer.placement.videoTitle}` : "Your marketplace placement"}{offer.product ? ` · ${offer.product.brand ? `${offer.product.brand} — ` : ""}${offer.product.name}` : ""}</p><p className="mt-3 text-sm font-extrabold text-accent">{formatMoney(offer.priceCents, offer.currency)}</p></div>{offer.status === "submitted" ? <div className="flex gap-2"><FramrButton size="sm" variant="ghost" disabled={respondingId === offer.id} onClick={() => { void respond(offer.id, "decline"); }}>Decline</FramrButton><FramrButton size="sm" disabled={respondingId === offer.id} onClick={() => { void respond(offer.id, "accept"); }}>{respondingId === offer.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Accept</FramrButton></div> : null}</div></FramedCard>)}</div></div>;
}
