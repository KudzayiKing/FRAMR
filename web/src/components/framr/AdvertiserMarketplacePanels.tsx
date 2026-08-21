"use client";

import { useMemo, useState } from "react";
import { Building2, Check, CircleDollarSign, CreditCard, Loader2, Megaphone, Package, Search, Send, Sparkles, Store } from "lucide-react";
import { Chip, FramrButton, FramedCard, QualityChip } from "./FramrPrimitives";
import { VideoThumbnailPlaceholder } from "./VideoThumbnailPlaceholder";

export type AdvertiserBrand = { id: string; name: string; website: string | null };
export type AdvertiserProduct = { id: string; name: string; brand: string | null; imageUrl: string };
export type AdvertiserOffer = {
  id: string;
  status: string;
  priceCents: number;
  currency: string;
  fundingStatus: "awaiting_payment" | "checkout_pending" | "funded" | "payment_failed" | "refunded";
  deliveryStatus: "not_started" | "preview_queued" | "preview_generating" | "creator_review" | "creator_approved" | "changes_requested" | "delivered" | "payout_eligible";
  previewRunId: string | null;
  previewVersionId: string | null;
  payoutStatus: "not_eligible" | "eligible" | "paid" | "held";
  creatorRespondedAt: string | null;
  updatedAt: string;
  listing: { object_label: string | null; video_title: string | null } | null;
  product: { name: string; brand: string | null } | null;
};

export type AdvertiserCampaign = {
  id: string;
  name: string;
  status: "draft" | "pending_approval" | "active" | "paused" | "completed" | "rejected";
  budgetCents: number;
  category: string | null;
  geography: string | null;
  productId: string | null;
  currency: string;
  metrics: { offers: number; accepted: number; committedCents: number };
  offers: AdvertiserOffer[];
};
export type AdvertiserListing = {
  id: string;
  priceCents: number;
  currency: string;
  objectLabel: string;
  category: string | null;
  durationSeconds: number | null;
  quality: "Excellent" | "Good" | "Limited" | "Fair" | null;
  videoTitle: string | null;
  thumbnailUrl: string | null;
  creatorNotes: string | null;
  creator: { displayName: string; handle: string | null };
};

type Props = {
  brand: AdvertiserBrand | null;
  products: AdvertiserProduct[];
  campaigns: AdvertiserCampaign[];
  listings: AdvertiserListing[];
  onSaveBrand: (payload: { name: string; website: string }) => Promise<boolean>;
  onCreateCampaign: (payload: { name: string; budgetCents: number; productId: string; category: string; geography: string }) => Promise<boolean>;
  onSubmitOffer: (payload: { listingId: string; campaignId: string; productId: string }) => Promise<boolean>;
  onFundOffer: (offerId: string) => Promise<boolean>;
  onRequestPreview: (offerId: string) => Promise<boolean>;
  onAddProduct: () => void;
};

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100);
}

function statusClass(status: string) {
  if (status === "active" || status === "creator_approved") return "bg-emerald-100 text-emerald-800";
  if (status === "submitted" || status === "pending_approval") return "bg-amber-100 text-amber-800";
  return "bg-paper2 text-inksoft";
}

export function BrandSetupPanel({ brand, onSaveBrand }: Pick<Props, "brand" | "onSaveBrand">) {
  const [name, setName] = useState(brand?.name ?? "");
  const [website, setWebsite] = useState(brand?.website ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim()) { setError("Enter your brand name."); return; }
    setSaving(true); setError(null);
    const saved = await onSaveBrand({ name, website });
    setSaving(false);
    if (!saved) setError("We couldn’t save your brand profile. Please try again.");
  };
  return <FramedCard className="max-w-xl p-6"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent"><Building2 size={19} /></div><div className="mt-4 serif-italic text-lg text-accent">Advertiser setup</div><h2 className="mt-1 text-2xl font-extrabold tracking-tight">{brand ? "Your brand profile" : "Start with your brand."}</h2><p className="mt-2 text-sm leading-relaxed text-inksoft">A real brand profile is required before you can create campaigns or browse creator placements.</p><label className="mt-6 block text-xs font-bold">Brand name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal" placeholder="Auris Home" /></label><label className="mt-4 block text-xs font-bold">Website <span className="font-normal text-inksoft">(optional)</span><input value={website} onChange={(event) => setWebsite(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal" placeholder="https://yourbrand.com" /></label>{error ? <p role="alert" className="mt-3 text-xs text-red-700">{error}</p> : null}<FramrButton className="mt-5" disabled={saving} onClick={() => { void save(); }}>{saving ? <><Loader2 size={16} className="animate-spin" />Saving…</> : <><Check size={16} />Save brand</>}</FramrButton></FramedCard>;
}

export function AdvertiserCampaignsPanel({ brand, products, campaigns, onCreateCampaign, onAddProduct }: Pick<Props, "brand" | "products" | "campaigns" | "onCreateCampaign" | "onAddProduct">) {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [productId, setProductId] = useState("");
  const [category, setCategory] = useState("");
  const [geography, setGeography] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    const budgetCents = Math.round(Number(budget) * 100);
    if (!name.trim() || !productId || !Number.isInteger(budgetCents) || budgetCents <= 0) { setError("Enter a campaign name, product, and budget greater than zero."); return; }
    setCreating(true); setError(null);
    const created = await onCreateCampaign({ name, budgetCents, productId, category, geography });
    setCreating(false);
    if (created) { setName(""); setBudget(""); setProductId(""); setCategory(""); setGeography(""); }
    else setError("We couldn’t create that campaign. Please try again.");
  };
  if (!brand) return <BrandSetupPanel brand={brand} onSaveBrand={async () => false} />;
  return <div><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="serif-italic text-lg text-accent">Campaigns</div><h2 className="mt-1 text-2xl font-extrabold tracking-tight">Plan the product, then choose the moment.</h2><p className="mt-1 text-sm text-inksoft">Each campaign is tied to one of your products and controls the offers you send to creators.</p></div><Chip className="bg-ink text-paper">{campaigns.filter((campaign) => campaign.status === "active").length} ACTIVE</Chip></div><div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"><div>{campaigns.length === 0 ? <FramedCard className="p-7"><Megaphone size={20} className="text-accent" /><h3 className="mt-4 text-lg font-extrabold">No campaigns yet.</h3><p className="mt-2 text-sm leading-relaxed text-inksoft">Upload a product, then create a campaign before making an offer on a creator placement.</p></FramedCard> : <div className="grid gap-4 md:grid-cols-2">{campaigns.map((campaign) => <FramedCard key={campaign.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><Chip className={statusClass(campaign.status)}>{campaign.status.replaceAll("_", " ").toUpperCase()}</Chip><h3 className="mt-3 text-lg font-extrabold">{campaign.name}</h3><p className="mt-1 text-xs text-inksoft">{campaign.category || "All categories"}{campaign.geography ? ` · ${campaign.geography}` : ""}</p></div><span className="text-sm font-extrabold text-accent">{money(campaign.budgetCents, campaign.currency)}</span></div><div className="mt-5 grid grid-cols-3 gap-2 text-center"><div className="rounded-md bg-paper2/80 p-2"><strong className="block text-sm">{campaign.metrics.offers}</strong><span className="text-[10px] text-inksoft">offers</span></div><div className="rounded-md bg-paper2/80 p-2"><strong className="block text-sm">{campaign.metrics.accepted}</strong><span className="text-[10px] text-inksoft">accepted</span></div><div className="rounded-md bg-paper2/80 p-2"><strong className="block text-sm">{money(campaign.metrics.committedCents, campaign.currency)}</strong><span className="text-[10px] text-inksoft">committed</span></div></div></FramedCard>)}</div>}</div><FramedCard className="h-fit p-5"><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-night text-paper"><Megaphone size={16} /></span><div><div className="text-sm font-bold">Create campaign</div><div className="text-[11px] text-inksoft">Offers stay pending creator approval.</div></div></div>{products.length === 0 ? <div className="mt-5 rounded-md bg-paper2/70 p-4"><p className="text-sm text-inksoft">Add your product first. It becomes the reference used only after a creator approves an offer.</p><FramrButton size="sm" className="mt-3" onClick={onAddProduct}><Package size={14} />Add product</FramrButton></div> : <><label className="mt-5 block text-xs font-bold">Campaign name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal" placeholder="Autumn cookware launch" /></label><label className="mt-4 block text-xs font-bold">Product<select value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal"><option value="">Choose a product…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.brand ? `${product.brand} — ` : ""}{product.name}</option>)}</select></label><label className="mt-4 block text-xs font-bold">Budget (USD)<input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal" placeholder="2500" /></label><label className="mt-4 block text-xs font-bold">Product category <span className="font-normal text-inksoft">(optional)</span><input value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal" placeholder="Cookware" /></label><label className="mt-4 block text-xs font-bold">Audience geography <span className="font-normal text-inksoft">(optional)</span><input value={geography} onChange={(event) => setGeography(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal" placeholder="US audience" /></label>{error ? <p role="alert" className="mt-3 text-xs text-red-700">{error}</p> : null}<FramrButton className="mt-5 w-full" disabled={creating} onClick={() => { void create(); }}>{creating ? <><Loader2 size={16} className="animate-spin" />Creating…</> : <><Megaphone size={16} />Create campaign</>}</FramrButton></>}</FramedCard></div></div>;
}

export function AdvertiserMarketplacePanel({ brand, campaigns, listings, onSaveBrand, onSubmitOffer }: Pick<Props, "brand" | "campaigns" | "listings" | "onSaveBrand" | "onSubmitOffer">) {
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedListing = useMemo(() => listings.find((listing) => listing.id === selectedListingId) ?? null, [listings, selectedListingId]);
  const campaign = useMemo(() => campaigns.find((item) => item.id === campaignId) ?? null, [campaigns, campaignId]);
  const submit = async () => {
    if (!selectedListing || !campaign?.productId) { setError("Choose an active campaign linked to a product."); return; }
    setSubmitting(true); setError(null);
    const submitted = await onSubmitOffer({ listingId: selectedListing.id, campaignId: campaign.id, productId: campaign.productId });
    setSubmitting(false);
    if (submitted) { setSelectedListingId(null); setCampaignId(""); }
    else setError("We couldn’t submit this offer. Please try again.");
  };
  if (!brand) return <BrandSetupPanel brand={brand} onSaveBrand={onSaveBrand} />;
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "active" && campaign.productId);
  return <div><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="serif-italic text-lg text-accent">Creator marketplace</div><h2 className="mt-1 text-2xl font-extrabold tracking-tight">Find the exact moment for your product.</h2><p className="mt-1 text-sm text-inksoft">Browse creator-approved placement snapshots. Originals, masks, and source footage remain private.</p></div><Chip className="bg-ink text-paper"><Search size={13} />{listings.length} AVAILABLE</Chip></div><div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"><div>{listings.length === 0 ? <FramedCard className="p-7"><Store size={20} className="text-accent" /><h3 className="mt-4 text-lg font-extrabold">No matching placements are published yet.</h3><p className="mt-2 text-sm leading-relaxed text-inksoft">Creator listings will appear here when creators choose to make an analysed placement available.</p></FramedCard> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{listings.map((listing) => <FramedCard key={listing.id} interactive className={`group ${selectedListingId === listing.id ? "ring-2 ring-accent" : ""}`}><button className="block w-full text-left" onClick={() => { setSelectedListingId(listing.id); setError(null); }}><div className="relative aspect-[9/8] overflow-hidden bg-night">{listing.thumbnailUrl ? <img src={listing.thumbnailUrl} alt={`Preview of ${listing.objectLabel} placement`} className="h-full w-full object-cover" /> : <VideoThumbnailPlaceholder />}<Chip className="absolute left-2 top-2 bg-night/85 text-white">{listing.objectLabel} · {listing.durationSeconds?.toFixed(1) ?? "—"}s</Chip>{listing.quality ? <QualityChip quality={listing.quality} /> : null}</div><div className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-bold">{listing.videoTitle ?? "Creator video"}</div><div className="mt-0.5 truncate text-[11px] text-inksoft">{listing.creator.handle || listing.creator.displayName} · {listing.category || "Uncategorized"}</div></div><span className="shrink-0 text-base font-extrabold text-accent">{money(listing.priceCents, listing.currency)}</span></div>{listing.creatorNotes ? <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-inksoft">{listing.creatorNotes}</p> : null}</div></button></FramedCard>)}</div>}</div><FramedCard className="h-fit p-5"><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white"><CircleDollarSign size={16} /></span><div><div className="text-sm font-bold">Make an offer</div><div className="text-[11px] text-inksoft">Creators approve before any preview begins.</div></div></div>{selectedListing ? <><div className="mt-5 rounded-md bg-paper2/70 p-3"><strong className="block text-sm">{selectedListing.objectLabel}</strong><span className="mt-0.5 block text-xs text-inksoft">{selectedListing.videoTitle} · {money(selectedListing.priceCents, selectedListing.currency)}</span></div>{activeCampaigns.length === 0 ? <p className="mt-4 text-sm leading-relaxed text-inksoft">Create an active campaign with an attached product before making an offer.</p> : <><label className="mt-4 block text-xs font-bold">Campaign<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-normal"><option value="">Choose a campaign…</option>{activeCampaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name} · {money(campaign.budgetCents, campaign.currency)}</option>)}</select></label>{error ? <p role="alert" className="mt-3 text-xs text-red-700">{error}</p> : null}<FramrButton className="mt-5 w-full" disabled={submitting} onClick={() => { void submit(); }}>{submitting ? <><Loader2 size={16} className="animate-spin" />Sending…</> : <><Send size={16} />Send creator offer</>}</FramrButton></>}</> : <p className="mt-5 text-sm leading-relaxed text-inksoft">Select a creator placement to review its price and send an offer from one of your campaigns.</p>}</FramedCard></div></div>;
}

function offerPresentation(offer: AdvertiserOffer) {
  if (offer.status !== "creator_approved") return { label: offer.status === "creator_declined" ? "DECLINED" : "AWAITING CREATOR", className: "bg-amber-100 text-amber-800", detail: offer.status === "creator_declined" ? "The creator declined this offer." : "Waiting for the creator’s decision." };
  if (offer.fundingStatus !== "funded") return { label: "AWAITING FUNDING", className: "bg-amber-100 text-amber-800", detail: "Fund this approved offer before a preview can begin." };
  if (offer.deliveryStatus === "preview_queued" || offer.deliveryStatus === "preview_generating") return { label: "PREVIEW IN PROGRESS", className: "bg-blue-100 text-blue-800", detail: "Your funded preview is being prepared." };
  if (offer.deliveryStatus === "creator_review") return { label: "WITH CREATOR", className: "bg-blue-100 text-blue-800", detail: "The creator is reviewing the funded preview." };
  if (offer.deliveryStatus === "changes_requested") return { label: "CHANGES REQUESTED", className: "bg-amber-100 text-amber-800", detail: "The creator requested changes to this preview." };
  if (offer.payoutStatus === "eligible" || offer.deliveryStatus === "payout_eligible") return { label: "APPROVED", className: "bg-emerald-100 text-emerald-800", detail: "The creator approved this delivery." };
  if (offer.deliveryStatus === "creator_approved" || offer.deliveryStatus === "delivered") return { label: "DELIVERED", className: "bg-emerald-100 text-emerald-800", detail: "This funded placement is ready for delivery." };
  return { label: "READY FOR PREVIEW", className: "bg-emerald-100 text-emerald-800", detail: "Start the preview when you are ready." };
}

export function AdvertiserPipelinePanel({ campaigns, onFundOffer, onRequestPreview }: Pick<Props, "campaigns" | "onFundOffer" | "onRequestPreview">) {
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fund = async (offerId: string) => {
    setBusyOfferId(offerId); setError(null);
    const funded = await onFundOffer(offerId);
    if (!funded) { setBusyOfferId(null); setError("We couldn’t open secure checkout. Please try again."); }
  };
  const preview = async (offerId: string) => {
    if (!window.confirm("Start this funded preview now? This begins video processing for the approved placement.")) return;
    setBusyOfferId(offerId); setError(null);
    const queued = await onRequestPreview(offerId);
    setBusyOfferId(null);
    if (!queued) setError("We couldn’t start this preview. Please try again.");
  };
  return <div><div className="serif-italic text-lg text-accent">Placement pipeline</div><h2 className="mt-1 text-2xl font-extrabold tracking-tight">Every offer, in one real pipeline.</h2><p className="mt-1 text-sm text-inksoft">Creator approval unlocks funding. Funding never starts a preview automatically—you choose when to start.</p>{error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}<div className="mt-6 overflow-hidden rounded-[10px] border border-line bg-white divide-y divide-line">{campaigns.length === 0 ? <div className="p-6 text-sm text-inksoft">Create a campaign and send an offer to start your pipeline.</div> : campaigns.map((campaign) => <div className="p-5" key={campaign.id}><div className="flex flex-wrap items-center gap-4"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-night text-paper"><Megaphone size={16} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold">{campaign.name}</span><Chip className={statusClass(campaign.status)}>{campaign.status.toUpperCase()}</Chip></div><p className="mt-1 text-[11px] text-inksoft">{campaign.metrics.offers} offers sent · {campaign.metrics.accepted} creator approved · {money(campaign.metrics.committedCents, campaign.currency)} committed</p></div></div>{campaign.offers.length ? <div className="mt-4 grid gap-3">{campaign.offers.map((offer) => { const presentation = offerPresentation(offer); const busy = busyOfferId === offer.id; const canFund = offer.status === "creator_approved" && offer.fundingStatus !== "funded"; const canPreview = offer.status === "creator_approved" && offer.fundingStatus === "funded" && offer.deliveryStatus === "not_started"; return <div key={offer.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper2/40 p-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold">{offer.listing?.object_label ?? "Creator placement"}</span><span className="text-xs text-inksoft">for {offer.product?.brand ? `${offer.product.brand} ` : ""}{offer.product?.name ?? "your product"}</span><Chip className={presentation.className}>{presentation.label}</Chip></div><p className="mt-1 text-xs text-inksoft">{offer.listing?.video_title ?? "Creator video"} · {money(offer.priceCents, offer.currency)} · {presentation.detail}</p></div>{canFund ? <FramrButton size="sm" disabled={busy} onClick={() => { void fund(offer.id); }}>{busy ? <><Loader2 size={14} className="animate-spin" />Opening checkout…</> : <><CreditCard size={14} />Fund {money(offer.priceCents, offer.currency)}</>}</FramrButton> : null}{canPreview ? <FramrButton size="sm" disabled={busy} onClick={() => { void preview(offer.id); }}>{busy ? <><Loader2 size={14} className="animate-spin" />Starting…</> : <><Sparkles size={14} />Start preview</>}</FramrButton> : null}</div>; })}</div> : <p className="mt-4 text-xs text-inksoft">No offers have been sent from this campaign yet.</p>}</div>)}</div></div>;
}
