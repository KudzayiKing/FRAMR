import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_PRODUCT_IMAGE_BYTES = 10 * 1024 * 1024;
const supported = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export type UploadedProductImage = { imageKey: string; mimeType: string; sizeBytes: number };

export function validateProductImage(file: File) {
  if (!supported.has(file.type)) return "Choose a JPEG, PNG, or WebP product image.";
  if (file.size <= 0) return "The selected product image is empty.";
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) return "Product images must be 10 MB or smaller.";
  return null;
}

export async function uploadProductImage(client: SupabaseClient, file: File): Promise<UploadedProductImage> {
  const validationError = validateProductImage(file);
  if (validationError) throw new Error(validationError);
  const [{ data: userData, error: userError }, { data: sessionData, error: sessionError }] = await Promise.all([
    client.auth.getUser(),
    client.auth.getSession(),
  ]);
  if (userError || !userData.user || sessionError || !sessionData.session?.access_token) throw new Error("Your session has expired. Please sign in again.");
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!projectUrl || !anonKey) throw new Error("Product storage is not configured for this environment.");
  const extension = supported.get(file.type);
  if (!extension) throw new Error("Unsupported product image.");
  const objectPath = `${userData.user.id}/${crypto.randomUUID()}.${extension}`;
  const response = await fetch(`${projectUrl.replace(/\/$/, "")}/storage/v1/object/products/${objectPath.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionData.session.access_token}`,
      apikey: anonKey,
      "Content-Type": file.type,
      "x-upsert": "false",
    },
    body: file,
  });
  if (!response.ok) throw new Error("Private product storage rejected this upload.");
  return { imageKey: `products/${objectPath}`, mimeType: file.type, sizeBytes: file.size };
}
