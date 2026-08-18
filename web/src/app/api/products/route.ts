import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";
import { MAX_PRODUCT_IMAGE_BYTES } from "@/lib/product-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = { name: string; brand?: string; description?: string; imageKey: string; mimeType: string; sizeBytes: number };
function parse(value: unknown): Payload | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string" || typeof item.imageKey !== "string" || typeof item.mimeType !== "string" || typeof item.sizeBytes !== "number") return null;
  return { name: item.name, brand: typeof item.brand === "string" ? item.brand : undefined, description: typeof item.description === "string" ? item.description : undefined, imageKey: item.imageKey, mimeType: item.mimeType, sizeBytes: item.sizeBytes };
}
function validKey(key: string, ownerId: string) {
  return /^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(key) && key.startsWith(`products/${ownerId}/`);
}

export async function POST(request: Request) {
  const client = await getServerClient();
  if (!client) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "You must be signed in to add a product." }, { status: 401 });
  let payload: Payload | null;
  try { payload = parse(await request.json()); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!payload) return NextResponse.json({ error: "Product metadata is incomplete." }, { status: 400 });
  const name = payload.name.trim().slice(0, 160);
  if (!name) return NextResponse.json({ error: "A product name is required." }, { status: 400 });
  if (!["image/jpeg", "image/png", "image/webp"].includes(payload.mimeType) || payload.sizeBytes <= 0 || payload.sizeBytes > MAX_PRODUCT_IMAGE_BYTES) return NextResponse.json({ error: "Product images must be JPEG, PNG, or WebP and 10 MB or smaller." }, { status: 400 });
  if (!validKey(payload.imageKey, user.id)) return NextResponse.json({ error: "The uploaded image does not belong to this account." }, { status: 403 });
  const objectName = payload.imageKey.slice(`products/${user.id}/`.length + "products/".length);
  const { data: objects, error: storageError } = await client.storage.from("products").list(user.id, { search: objectName, limit: 1 });
  if (storageError || !objects?.some((item) => item.name === objectName)) return NextResponse.json({ error: "The uploaded image could not be verified in private storage." }, { status: 409 });
  const { data: product, error } = await client.from("products").insert({ owner_id: user.id, kind: "creator", name, brand: payload.brand?.trim().slice(0, 120) || null, description: payload.description?.trim().slice(0, 500) || null, image_key: payload.imageKey }).select("id,name,brand,description,image_key,created_at").single();
  if (error || !product) return NextResponse.json({ error: "The product record could not be created." }, { status: 500 });
  return NextResponse.json({ product }, { status: 201 });
}
