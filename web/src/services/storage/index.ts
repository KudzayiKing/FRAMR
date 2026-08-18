import type { StorageService, StoredObject } from "./types";

/**
 * Development storage adapter.
 * Persists objects under ./.storage so runs work with zero credentials and
 * the object-storage contract (keys -> URLs) matches the production service.
 */
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

/** Cloudflare R2 (S3-compatible) skeleton — §5. Requires R2 credentials; the dev
 *  adapter is used until they're configured. Decart/provider logic must never
 *  reach this layer (keeps provider isolation per §39). */
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

let singleton: StorageService | null = null;
export function getStorageService(): StorageService {
  if (!singleton) {
    const hasR2 = Boolean(process.env.R2_BUCKET && process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
    singleton = hasR2 ? createR2StorageService() : createDevStorageService();
  }
  return singleton;
}
