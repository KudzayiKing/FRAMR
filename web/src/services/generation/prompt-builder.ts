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
  const category = clean(placement.category, "product", 100);
  const productName = clean(product.name, "replacement product", 140);
  const brand = clean(product.brand, "", 100);
  const description = clean(product.description, "", 280);
  const productIdentity = brand ? `${brand} ${productName}` : productName;
  const timeRange = `${formatTimestamp(placement.startSeconds)} to ${formatTimestamp(placement.endSeconds)}`;

  const lines = [
    "Edit the supplied portrait source video as a realistic product replacement.",
    `Replace only the ${objectLabel} (${category}) that is visible approximately from ${timeRange} with the reference product: ${productIdentity}.`,
    "Use the reference image as the source of truth for the product's shape, materials, colors, branding, and proportions.",
    "Preserve the original people, hands, background, camera movement, framing, lighting direction, shadows, reflections, perspective, occlusion, and natural motion.",
    "Keep the rest of the video unchanged. Do not add captions, watermarks, new objects, or branding outside the replacement product.",
    "Ensure the replacement is stable across frames and blends naturally into the original scene.",
  ];
  if (description) lines.splice(3, 0, `Product context: ${description}.`);
  return lines.join(" ");
}
