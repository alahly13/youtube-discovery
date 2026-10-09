"use client";

import { authFetch } from "./auth-fetch";

/**
 * Client-side record saver with automatic staged upload for large payloads.
 * The browser NEVER submits an oversized record in one request: payloads
 * over ~3 MiB are split into 2 MiB base64 chunks across init/chunk/commit
 * calls. Small records use the direct single-request path unchanged.
 */

const DIRECT_LIMIT_BYTES = 3 * 1024 * 1024;
const CHUNK_BYTES = 2 * 1024 * 1024;

function randomUploadId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `up_${Array.from(bytes)
    .map((b) => b.toString(36))
    .join("")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20)}${Date.now().toString(36)}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function postAction(action: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await authFetch(`/api/blob-upload/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `Upload ${action} failed (${res.status})`);
  }
  return data;
}

export interface SavedSearchPayload {
  id?: string;
  query: string;
  resourceSelection: "ALL" | "video" | "channel" | "playlist";
  settings: unknown;
  filters?: unknown;
  manifest: unknown;
  title?: string;
}

/**
 * Persist a complete saved-search record (small → direct POST; large →
 * staged chunked upload). Resolves only after the server confirms the
 * committed version reads back successfully.
 */
export async function saveSearchRecord(payload: SavedSearchPayload): Promise<{ id: string }> {
  const text = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes <= DIRECT_LIMIT_BYTES) {
    const res = await authFetch("/api/search-storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
    if (!data.id) throw new Error("Save did not return a record id");
    return { id: data.id };
  }
  // ── Staged path for oversized records ──
  const recordId = payload.id || `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const raw = new TextEncoder().encode(text);
  const chunkCount = Math.ceil(raw.length / CHUNK_BYTES);
  const digest = await sha256Hex(text);
  const uploadId = randomUploadId();
  const toB64 = (chunk: Uint8Array): string => {
    let binary = "";
    for (let i = 0; i < chunk.length; i += 0x8000) {
      binary += String.fromCharCode(...chunk.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  };
  await postAction("init", {
    uploadId,
    namespace: "savedHistory",
    recordId,
    chunkCount,
    totalBytes: raw.length,
    sha256: digest,
  });
  try {
    for (let i = 0; i < chunkCount; i += 1) {
      const slice = raw.subarray(i * CHUNK_BYTES, Math.min((i + 1) * CHUNK_BYTES, raw.length));
      await postAction("chunk", { uploadId, index: i, data: toB64(slice) });
    }
    await postAction("commit", { uploadId });
    return { id: recordId };
  } catch (err) {
    await postAction("abort", { uploadId }).catch(() => {});
    throw err;
  }
}
