export type PlacementPromptContext = {
  objectLabel: string;
  category?: string | null;
  startSeconds: number;
  endSeconds: number;
};

export type ProductPromptContext = {
  name: string;
  brand?: string | null;
  description?: string | null;
};

function clean(value: string | null | undefined, fallback: string, limit = 220) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, limit) : fallback;
}

function formatTimestamp(value: number) {
  const total = Math.max(0, Math.round(value));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Builds provider-agnostic, whole-video guidance for Lucy. The Decart batch API
 * accepts prompt and reference image but no mask/box/time parameters, so the
 * detected placement range becomes explicit textual context rather than a
 * fabricated provider field.
 */
export function buildPlacementReplacementPrompt(
  placement: PlacementPromptContext,
  product: ProductPromptContext,
) {
  const objectLabel = clean(placement.objectLabel, "detected object", 120);
  const productName = clean(product.name, "replacement product", 80);
  const brand = clean(product.brand, "", 60);
  const productIdentity = brand ? `${brand} ${productName}` : productName;
  const timeRange = `${formatTimestamp(placement.startSeconds)} to ${formatTimestamp(placement.endSeconds)}`;

  // Lucy has a strict prompt token limit. Keep the information that governs a
  // product swap, but omit prose the reference image and source clip already
  // communicate.
  return [
    `Replace only the ${objectLabel} from ${timeRange} with ${productIdentity} from the reference image.`,
    "Match its shape, material, color, branding, scale, and visible details.",
    "Keep people, hands, background, camera, lighting, shadows, reflections, perspective, and motion unchanged.",
    "No captions, watermarks, or extra objects.",
  ].join(" ");
}
