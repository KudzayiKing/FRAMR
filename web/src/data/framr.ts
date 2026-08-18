/**
 * Design reference: FRAMR's source imagery and demo data are centralized here so
 * the same source-of-truth feeds landing, creator, and advertiser experiences.
 */
/** Demo imagery is served locally from `/images` (client/public/images). */
export const IMG = {
  original: "/images/framr_hero_original.png",
  auris: "/images/framr_hero_brand_auris.png",
  nordpeak: "/images/framr_hero_brand_nordpeak.png",
  espresso: "/images/framr_video_espresso-routine.png",
  headphones: "/images/framr_video_desk-headphones.png",
  pan: "/images/framr_video_weeknight-stirfry.png",
  pancakes: "/images/framr_video_sunday-pancakes.png",
  aurisProduct: "/images/framr_product_auris_model-a.png",
  espressoProduct: "/images/framr_product_kaffa-uno.png",
} as const;

export type Placement = {
  id: string;
  object: string;
  category: string;
  start: string;
  end: string;
  duration: number;
  quality: "Excellent" | "Good" | "Limited" | "Fair";
  confidence: number;
  box: { left: number; top: number; width: number; height: number };
};

export type Version = {
  id: string;
  label: string;
  brand: string;
  image: string;
  active: boolean;
  source?: boolean;
  earnings?: number;
};

export type Video = {
  id: string;
  title: string;
  thumbnail: string;
  duration: string;
  status: "uploading" | "processing" | "ready" | "failed";
  views: string;
  placements: Placement[];
  versions: Version[];
};

export type ProductAsset = {
  id: string;
  name: string;
  brand: string;
  category: string;
  image: string;
  frame: string;
};

export type Campaign = {
  id: string;
  name: string;
  status: "Active" | "In review" | "Draft";
  budget: number;
  spent: number;
  placements: number;
  impressions: string;
  dates: string;
  creators: number;
};

export type MarketplaceListing = {
  id: string;
  video: string;
  creator: string;
  image: string;
  object: string;
  duration: number;
  geography: string;
  views: string;
  price: number;
  quality: "Excellent" | "Good";
  category: string;
};

export const initialVideos: Video[] = [
  {
    id: "v1",
    title: "Perfect Fried Rice",
    thumbnail: IMG.original,
    duration: "00:34",
    status: "ready",
    views: "182K",
    placements: [
      { id: "p1", object: "Rice cooker", category: "Kitchen appliances", start: "00:07", end: "00:19", duration: 12.4, quality: "Excellent", confidence: 96, box: { left: 45, top: 11, width: 49, height: 47 } },
      { id: "p2", object: "Microwave", category: "Kitchen appliances", start: "00:21", end: "00:29", duration: 8.1, quality: "Good", confidence: 88, box: { left: 6, top: 4, width: 30, height: 20 } },
      { id: "p3", object: "Carbon-steel wok", category: "Cookware", start: "00:02", end: "00:06", duration: 3.8, quality: "Limited", confidence: 74, box: { left: 8, top: 52, width: 58, height: 40 } },
      { id: "p4", object: "Oil bottle", category: "Pantry", start: "00:14", end: "00:17", duration: 2.9, quality: "Fair", confidence: 61, box: { left: 80, top: 28, width: 15, height: 20 } },
    ],
    versions: [
      { id: "ver0", label: "Original", brand: "Source", image: IMG.original, active: true, source: true },
      { id: "ver1", label: "Auris Model A", brand: "Auris", image: IMG.auris, active: true, earnings: 320 },
      { id: "ver2", label: "Nordpeak Steel 900", brand: "Nordpeak", image: IMG.nordpeak, active: false, earnings: 280 },
    ],
  },
  {
    id: "v2",
    title: "Morning Espresso Routine",
    thumbnail: IMG.espresso,
    duration: "00:27",
    status: "ready",
    views: "94K",
    placements: [
      { id: "p5", object: "Espresso machine", category: "Kitchen appliances", start: "00:03", end: "00:15", duration: 11.6, quality: "Excellent", confidence: 95, box: { left: 6, top: 14, width: 62, height: 64 } },
      { id: "p6", object: "Ceramic cup", category: "Tableware", start: "00:12", end: "00:20", duration: 7.8, quality: "Good", confidence: 84, box: { left: 40, top: 58, width: 32, height: 28 } },
    ],
    versions: [
      { id: "ver3", label: "Original", brand: "Source", image: IMG.espresso, active: true, source: true },
      { id: "ver4", label: "Kaffa Uno", brand: "Kaffa", image: IMG.espressoProduct, active: true, earnings: 180 },
    ],
  },
  {
    id: "v3",
    title: "Weeknight Stir-Fry",
    thumbnail: IMG.pan,
    duration: "00:41",
    status: "ready",
    views: "121K",
    placements: [
      { id: "p7", object: "Sauté pan", category: "Cookware", start: "00:04", end: "00:18", duration: 13.9, quality: "Excellent", confidence: 93, box: { left: 5, top: 38, width: 74, height: 48 } },
      { id: "p8", object: "Gas range", category: "Appliances", start: "00:20", end: "00:27", duration: 6.9, quality: "Good", confidence: 82, box: { left: 8, top: 80, width: 62, height: 16 } },
    ],
    versions: [{ id: "ver5", label: "Original", brand: "Source", image: IMG.pan, active: true, source: true }],
  },
  {
    id: "v4",
    title: "Sunday Pancakes",
    thumbnail: IMG.pancakes,
    duration: "00:22",
    status: "processing",
    views: "—",
    placements: [],
    versions: [],
  },
];

export const initialAssets: ProductAsset[] = [
  { id: "a1", name: "Model A rice cooker", brand: "Auris", category: "Kitchen appliances", image: IMG.aurisProduct, frame: IMG.auris },
  { id: "a2", name: "Steel 900", brand: "Nordpeak", category: "Kitchen appliances", image: IMG.nordpeak, frame: IMG.nordpeak },
  { id: "a3", name: "Uno espresso", brand: "Kaffa", category: "Coffee", image: IMG.espressoProduct, frame: IMG.espressoProduct },
  { id: "a4", name: "Golden wok", brand: "Lena Studio", category: "Cookware", image: IMG.pan, frame: IMG.pan },
];

export const initialCampaigns: Campaign[] = [
  { id: "cp1", name: "Auris Spring Launch", status: "Active", budget: 5000, spent: 1280, placements: 3, impressions: "420K", dates: "Jul 20 – Aug 30", creators: 2 },
  { id: "cp2", name: "Nordpeak Chef Series", status: "In review", budget: 3000, spent: 0, placements: 1, impressions: "—", dates: "Aug 10 – Sep 10", creators: 1 },
  { id: "cp3", name: "Kaffa Morning Ritual", status: "Draft", budget: 2000, spent: 0, placements: 0, impressions: "—", dates: "—", creators: 0 },
];

export const listings: MarketplaceListing[] = [
  { id: "m1", video: "Perfect Fried Rice", creator: "@lena.cooks", image: IMG.original, object: "Rice cooker", duration: 12.4, geography: "US audience", views: "180K", price: 320, quality: "Excellent", category: "Cooking" },
  { id: "m2", video: "Morning Espresso Routine", creator: "@marco.brews", image: IMG.espresso, object: "Espresso machine", duration: 8.2, geography: "UK audience", views: "90K", price: 180, quality: "Good", category: "Coffee" },
  { id: "m3", video: "Studio Desk Reset", creator: "@noa.works", image: IMG.headphones, object: "Headphones", duration: 6.8, geography: "US audience", views: "240K", price: 450, quality: "Excellent", category: "Technology" },
  { id: "m4", video: "Weeknight Stir-Fry", creator: "@lena.cooks", image: IMG.pan, object: "Sauté pan", duration: 9.6, geography: "US audience", views: "120K", price: 210, quality: "Good", category: "Cooking" },
  { id: "m5", video: "Sunday Pancakes", creator: "@sundaytable", image: IMG.pancakes, object: "Maple syrup pour", duration: 7.4, geography: "CA audience", views: "65K", price: 140, quality: "Good", category: "Food" },
];

export const sponsorOffers = [
  { id: "of1", brand: "Auris", product: "Model A rice cooker", payout: 320, videoId: "v1", slot: "Rice cooker · 12.4s", status: "pending" },
  { id: "of2", brand: "Nordpeak", product: "Steel 900", payout: 280, videoId: "v1", slot: "Rice cooker · 12.4s", status: "pending" },
  { id: "of3", brand: "Kaffa", product: "Uno espresso", payout: 180, videoId: "v2", slot: "Espresso machine · 11.6s", status: "accepted" },
] as const;

export const sponsorDemand = [
  { id: "bd1", brand: "Auris", product: "Model A rice cooker", category: "Kitchen appliances", payout: "$280–$360", note: "Looking for cooking creators, US/EU" },
  { id: "bd2", brand: "Kaffa", product: "Uno espresso", category: "Coffee", payout: "$150–$220", note: "Morning-routine & café content" },
  { id: "bd3", brand: "Nordpeak", product: "Steel 900", category: "Kitchen appliances", payout: "$240–$300", note: "Recipe videos with visible counters" },
  { id: "bd4", brand: "Verde", product: "Cold-press olive oil", category: "Pantry", payout: "$120–$180", note: "Mediterranean & healthy cooking" },
] as const;

export const money = (amount: number) => `$${amount.toLocaleString()}`;

