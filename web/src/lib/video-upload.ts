import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MIN_DURATION_SECONDS = 15;
export const MAX_DURATION_SECONDS = 60;
export const PORTRAIT_ASPECT_RATIO = 9 / 16;
export const ASPECT_RATIO_TOLERANCE = 0.015;

export type VideoMetadata = {
  durationSeconds: number;
  width: number;
  height: number;
};

export type UploadedVideo = VideoMetadata & {
  objectPath: string;
  storageKey: string;
  contentType: "video/mp4" | "video/quicktime";
  sizeBytes: number;
};

function extensionFromName(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function getVideoContentType(file: File): "video/mp4" | "video/quicktime" | null {
  const extension = extensionFromName(file.name);
  if (file.type === "video/mp4" || extension === "mp4") return "video/mp4";
  if (file.type === "video/quicktime" || extension === "mov") return "video/quicktime";
  return null;
}

export function validateVideoFile(file: File): string | null {
  if (!getVideoContentType(file)) return "Choose an MP4 or MOV video file.";
  if (file.size === 0) return "The selected video is empty.";
  if (file.size > MAX_VIDEO_BYTES) return "Videos must be 500 MB or smaller.";
  return null;
}

export function validateVideoMetadata(metadata: VideoMetadata): string | null {
  if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds < MIN_DURATION_SECONDS || metadata.durationSeconds > MAX_DURATION_SECONDS) {
    return "Videos must run between 15 and 60 seconds.";
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width <= 0 || metadata.height <= 0) {
    return "We could not read the video dimensions.";
  }
  const aspectRatio = metadata.width / metadata.height;
  if (Math.abs(aspectRatio - PORTRAIT_ASPECT_RATIO) > ASPECT_RATIO_TOLERANCE) {
    return "Videos must use a 9:16 portrait frame, such as 1080×1920.";
  }
  return null;
}

export function inspectVideo(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const metadata = {
        durationSeconds: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This video could not be read. Please try another MP4 or MOV file."));
    };
    video.src = url;
  });
}

function encodeObjectPath(objectPath: string) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

function uploadWithProgress({
  file,
  uploadUrl,
  accessToken,
  anonKey,
  contentType,
  onProgress,
}: {
  file: File;
  uploadUrl: string;
  accessToken: string;
  anonKey: string;
  contentType: string;
  onProgress: (progress: number) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl);
    request.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    request.setRequestHeader("apikey", anonKey);
    request.setRequestHeader("Content-Type", contentType);
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    request.onerror = () => reject(new Error("The upload could not reach storage. Check your connection and try again."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error("Storage rejected this upload. Please try again."));
    };
    request.send(file);
  });
}

export async function uploadVideoToSupabase({
  client,
  file,
  metadata,
  onProgress,
}: {
  client: SupabaseClient;
  file: File;
  metadata: VideoMetadata;
  onProgress: (progress: number) => void;
}): Promise<UploadedVideo> {
  const contentType = getVideoContentType(file);
  if (!contentType) throw new Error("Choose an MP4 or MOV video file.");

  const [{ data: userData, error: userError }, { data: sessionData, error: sessionError }] = await Promise.all([
    client.auth.getUser(),
    client.auth.getSession(),
  ]);
  if (userError || !userData.user || sessionError || !sessionData.session?.access_token) {
    throw new Error("Your session has expired. Please sign in again before uploading.");
  }

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!projectUrl || !anonKey) throw new Error("Upload storage is not configured for this environment.");

  const extension = contentType === "video/mp4" ? "mp4" : "mov";
  const objectPath = `${userData.user.id}/${crypto.randomUUID()}.${extension}`;
  const uploadUrl = `${projectUrl.replace(/\/$/, "")}/storage/v1/object/videos/${encodeObjectPath(objectPath)}`;
  await uploadWithProgress({
    file,
    uploadUrl,
    accessToken: sessionData.session.access_token,
    anonKey,
    contentType,
    onProgress,
  });

  return {
    ...metadata,
    objectPath,
    storageKey: `videos/${objectPath}`,
    contentType,
    sizeBytes: file.size,
  };
}

export function titleFromFilename(filename: string) {
  const stem = filename.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim();
  return stem || "Untitled video";
}
