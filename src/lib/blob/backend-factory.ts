import "server-only";

import type { BlobBackend } from "./blob-backend";
import { MemoryBlobBackend } from "./blob-backend";
import { getBlobRuntimeConfig } from "./blob-config";
import { VercelBlobBackend } from "./vercel-blob-backend";

/**
 * Backend factory. Production code calls getBlobBackend() (Vercel SDK,
 * validated config). Tests inject MemoryBlobBackend directly. A process-wide
 * singleton avoids re-constructing the adapter per request (it holds no
 * credentials itself — the SDK reads env per call).
 */

let singleton: VercelBlobBackend | null = null;

export function getBlobBackend(): BlobBackend {
  // Validates configuration eagerly so misconfiguration surfaces as a clear
  // 503 instead of a cryptic SDK failure deep in a request.
  getBlobRuntimeConfig();
  if (!singleton) singleton = new VercelBlobBackend();
  return singleton;
}

/** Test-only backend (never used by routes). */
export function createMemoryBackend(): MemoryBlobBackend {
  return new MemoryBlobBackend();
}
