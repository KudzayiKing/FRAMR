import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";
import { MAX_PRODUCT_IMAGE_BYTES } from "@/lib/product-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATES = ["primary", "closed", "open", "side", "detail", "front", "rear", "packaging", "other"] as const;
type ProductState = (typeof STATES)[number];
type ReferencePayload = { imageKey: string; mimeType: string; sizeBytes: number; state: ProductState };
type Payload = { name: string; brand?: string; description?: string; imageKey: string; mimeType: string; sizeBytes: number; references: ReferencePayload[] };

function parseReference(value: unknown, defaultState: ProductState): ReferencePayload | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const state = typeof item.state === "string" && STATES.includes(item.state as ProductState) ? item.state as ProductState : defaultState;
  if (typeof item.imageKey !== "string" || typeof item.mimeType !== "string" || typeof item.sizeBytes !== "number") return null;
  return { imageKey: item.imageKey, mimeType: item.mimeType, sizeBytes: item.sizeBytes, state };
}

function parse(value: unknown): Payload | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string") return null;
  const primary = parseReference(item, "primary");
  if (!primary) return null;
  const extra = item.references == null
    ? []
    : Array.isArray(item.references)
      ? item.references.map((reference) => parseReference(reference, "other"))
      : null;
  if (!extra || extra.some((reference) => !reference)) return null;
  const references = [primary, ...(extra as ReferencePayload[])].filter((reference, index, all) => all.findIndex((candidate) => candidate.imageKey === reference.imageKey) === index);
  if (references.length > 5) return null;
  return {
    name: item.name,
    brand: typeof item.brand === "string" ? item.brand : undefined,
    description: typeof item.description === "string" ? item.description : undefined,
    imageKey: primary.imageKey,
    mimeType: primary.mimeType,
    sizeBytes: primary.sizeBytes,
    references,
  };
}

function validKey(key: string, ownerId: string) {
  return /^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(key) && key.startsWith(`products/${ownerId}/`);
}

function validReference(reference: ReferencePayload, ownerId: string) {
  return ["image/jpeg", "image/png", "image/webp"].includes(reference.mimeType)
    && reference.sizeBytes > 0
    && reference.sizeBytes <= MAX_PRODUCT_IMAGE_BYTES
    && validKey(reference.imageKey, ownerId);
}

export async function POST(request: Request) {
  const client = await getServerClient();
  if (!client) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "You must be signed in to add a product." }, { status: 401 });

  let payload: Payload | null;
  try { payload = parse(await request.json()); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!payload) return NextResponse.json({ error: "Product metadata or product-state references are incomplete." }, { status: 400 });
  const name = payload.name.trim().slice(0, 160);
  if (!name) return NextResponse.json({ error: "A product name is required." }, { status: 400 });
  if (!payload.references.every((reference) => validReference(reference, user.id))) {
    return NextResponse.json({ error: "Product images must be private JPEG, PNG, or WebP files no larger than 10 MB." }, { status: 400 });
  }

  const storageChecks = await Promise.all(payload.references.map(async (reference) => {
    const objectName = reference.imageKey.slice(`products/${user.id}/`.length);
    const { data: objects, error } = await client.storage.from("products").list(user.id, { search: objectName, limit: 1 });
    return !error && Boolean(objects?.some((object) => object.name === objectName));
  }));
  if (storageChecks.some((isPresent) => !isPresent)) {
    return NextResponse.json({ error: "One or more product images could not be verified in private storage." }, { status: 409 });
  }

  const { data: product, error: productError } = await client
    .from("products")
    .insert({
      owner_id: user.id,
      kind: "creator",
      name,
      brand: payload.brand?.trim().slice(0, 120) || null,
      description: payload.description?.trim().slice(0, 500) || null,
      image_key: payload.imageKey,
    })
    .select("id,name,brand,description,image_key,created_at")
    .single();
  if (productError || !product) return NextResponse.json({ error: "The product record could not be created." }, { status: 500 });

  const { error: referenceError } = await client.from("product_references").insert(
    payload.references.map((reference, sortOrder) => ({
      product_id: product.id,
      owner_id: user.id,
      storage_key: reference.imageKey,
      view_type: reference.state,
      sort_order: sortOrder,
      metadata: { state: reference.state, source: "product-upload" },
    })),
  );
  if (referenceError) {
    await client.from("products").delete().eq("id", product.id);
    return NextResponse.json({ error: "The product-state references could not be saved. Apply the latest database migration and try again." }, { status: 500 });
  }

  return NextResponse.json({ product, referenceCount: payload.references.length }, { status: 201 });
}
