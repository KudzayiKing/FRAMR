import type { SupabaseClient } from "@supabase/supabase-js";
import type { StorageService, StoredObject } from "./types";

const bucketByKind = {
  video: "videos",
  generated: "generated",
  product_image: "products",
  thumbnail: "thumbnails",
} as const;

type StorageKind = keyof typeof bucketByKind;

function buildObjectKey(bucket: string, objectPath: string) {
  return `${bucket}/${objectPath}`;
}

function parseObjectKey(key: string) {
  const [bucket, ...pathParts] = key.split("/");
  const objectPath = pathParts.join("/");
  if (!bucket || !objectPath || !Object.values(bucketByKind).includes(bucket as (typeof bucketByKind)[StorageKind])) {
    throw new Error("Storage key must use the format <bucket>/<owner-id>/<object-name>.");
  }
  return { bucket, objectPath };
}

function extensionFor(contentType: string) {
  const extensionByType: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  return extensionByType[contentType] ?? "bin";
}

/**
 * Supabase Storage adapter. It deliberately receives a caller-scoped client so
 * RLS remains active for browser/server session requests and can later accept a
 * service-role worker client without changing the storage contract.
 */
export function createSupabaseStorageService(client: SupabaseClient): StorageService {
  return {
    async put({ owner, kind, buffer, contentType }): Promise<StoredObject> {
      const bucket = bucketByKind[kind];
      const objectPath = `${owner}/${crypto.randomUUID()}.${extensionFor(contentType)}`;
      const { error } = await client.storage.from(bucket).upload(objectPath, buffer, {
        contentType,
        upsert: false,
      });
      if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);

      const { data, error: signedUrlError } = await client.storage
        .from(bucket)
        .createSignedUrl(objectPath, 60 * 10);
      if (signedUrlError || !data?.signedUrl) {
        throw new Error(`Supabase Storage signed URL failed: ${signedUrlError?.message ?? "no URL returned"}`);
      }

      return {
        key: buildObjectKey(bucket, objectPath),
        url: data.signedUrl,
        sizeBytes: buffer.byteLength,
      };
    },

    async getSignedUrl(key, options): Promise<string> {
      const { bucket, objectPath } = parseObjectKey(key);
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(objectPath, options?.expiresInSeconds ?? 60 * 10);
      if (error || !data?.signedUrl) {
        throw new Error(`Supabase Storage signed URL failed: ${error?.message ?? "no URL returned"}`);
      }
      return data.signedUrl;
    },

    async delete(key): Promise<void> {
      const { bucket, objectPath } = parseObjectKey(key);
      const { error } = await client.storage.from(bucket).remove([objectPath]);
      if (error) throw new Error(`Supabase Storage delete failed: ${error.message}`);
    },
  };
}

/** Development adapter for zero-credential local previews. */
export function createDevStorageService(): StorageService {
  return {
    async put({ owner, kind, buffer }): Promise<StoredObject> {
      const key = `dev/${owner}/${kind}/${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      return { key, url: `/local-storage/${key}`, sizeBytes: buffer.byteLength };
    },
    async getSignedUrl(key): Promise<string> {
      return `/local-storage/${key}`;
    },
    async delete(): Promise<void> {
      return;
    },
  };
}

/** Cloudflare R2 (S3-compatible) skeleton, retained as a future swappable adapter. */
export function createR2StorageService(): StorageService {
  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;
  if (!bucket || !endpoint) {
    throw new Error("R2 storage not configured: set R2_BUCKET and R2_ENDPOINT");
  }
  return {
    async put(): Promise<StoredObject> {
      throw new Error("R2Storage.put not implemented — wire @aws-sdk/client-s3 with R2 credentials");
    },
    async getSignedUrl(): Promise<string> {
      throw new Error("R2Storage.getSignedUrl not implemented — wire presigned GET via @aws-sdk/s3-request-presigner");
    },
    async delete(): Promise<void> {
      throw new Error("R2Storage.delete not implemented — wire DeleteObjectCommand");
    },
  };
}

/**
 * Use the authenticated Supabase client when one is available. R2 remains a
 * future opt-in; otherwise local demo mode preserves the prior behaviour.
 */
export function getStorageService(client?: SupabaseClient): StorageService {
  if (client) return createSupabaseStorageService(client);
  const hasR2 = Boolean(
    process.env.R2_BUCKET &&
      process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
  return hasR2 ? createR2StorageService() : createDevStorageService();
}
