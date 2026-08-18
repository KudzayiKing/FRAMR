import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";
import {
  MAX_VIDEO_BYTES,
  getVideoContentType,
  validateVideoMetadata,
  type VideoMetadata,
} from "@/lib/video-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateVideoPayload = VideoMetadata & {
  title: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
};

function isOwnerScopedVideoKey(storageKey: string, ownerId: string) {
  return /^videos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov)$/i.test(storageKey) && storageKey.startsWith(`videos/${ownerId}/`);
}

function parsePayload(value: unknown): CreateVideoPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.title !== "string" ||
    typeof payload.storageKey !== "string" ||
    typeof payload.mimeType !== "string" ||
    typeof payload.sizeBytes !== "number" ||
    typeof payload.durationSeconds !== "number" ||
    typeof payload.width !== "number" ||
    typeof payload.height !== "number"
  ) return null;
  return payload as CreateVideoPayload;
}

export async function POST(request: Request) {
  const client = await getServerClient();
  if (!client) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "You must be signed in to upload a video." }, { status: 401 });

  let payload: CreateVideoPayload | null;
  try {
    payload = parsePayload(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!payload) return NextResponse.json({ error: "Upload metadata is incomplete." }, { status: 400 });

  const title = payload.title.trim().slice(0, 160);
  if (!title) return NextResponse.json({ error: "A video title is required." }, { status: 400 });
  if (payload.sizeBytes <= 0 || payload.sizeBytes > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "Videos must be between 1 byte and 500 MB." }, { status: 400 });
  }
  if (payload.mimeType !== "video/mp4" && payload.mimeType !== "video/quicktime") {
    return NextResponse.json({ error: "Only MP4 and MOV videos are supported." }, { status: 400 });
  }
  if (getVideoContentType({ name: payload.storageKey, type: payload.mimeType } as File) !== payload.mimeType) {
    return NextResponse.json({ error: "The file extension does not match the submitted video type." }, { status: 400 });
  }
  const metadataError = validateVideoMetadata(payload);
  if (metadataError) return NextResponse.json({ error: metadataError }, { status: 400 });
  if (!isOwnerScopedVideoKey(payload.storageKey, user.id)) {
    return NextResponse.json({ error: "The uploaded video does not belong to this account." }, { status: 403 });
  }

  const objectPath = payload.storageKey.slice("videos/".length);
  const { data: object, error: objectError } = await client.storage.from("videos").list(user.id, {
    search: objectPath.slice(`${user.id}/`.length),
    limit: 1,
  });
  if (objectError || !object?.some((item) => item.name === objectPath.slice(`${user.id}/`.length))) {
    return NextResponse.json({ error: "The uploaded video could not be verified in private storage." }, { status: 409 });
  }

  const { data: video, error: insertError } = await client
    .from("videos")
    .insert({
      owner_id: user.id,
      title,
      status: "processing",
      duration_seconds: payload.durationSeconds,
      width: payload.width,
      height: payload.height,
      storage_key: payload.storageKey,
    })
    .select("id, title, status, duration_seconds, width, height, storage_key, thumbnail_key, created_at")
    .single();
  if (insertError) {
    return NextResponse.json({ error: "The upload reached storage but the video record could not be created." }, { status: 500 });
  }

  return NextResponse.json({ video }, { status: 201 });
}
