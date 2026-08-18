/** Storage architecture abstraction — §5. Never store video blobs in Postgres.
 *  Service boundary keeps the provider (S3/R2/Supabase Storage) swappable. */

export type StoredObject = {
  key: string;
  url: string;
  sizeBytes: number;
};

export interface StorageService {
  put(input: { owner: string; kind: "video" | "thumbnail" | "product_image" | "generated"; buffer: Uint8Array; contentType: string }): Promise<StoredObject>;
  getSignedUrl(key: string, options?: { expiresInSeconds?: number }): Promise<string>;
  delete(key: string): Promise<void>;
}
