import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

/* ═══════════════════════════════════════════════════════════════════════════
   Environment Preflight Validation
   ──────────────────────────────────────────────────────────────────────────
   Runs before every build. On Vercel, VERCEL_URL is auto-injected so
   NEXT_PUBLIC_APP_URL can fall back to it safely. Missing optional keys
   only emit warnings — they never block the build.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Auto-populate NEXT_PUBLIC_APP_URL from Vercel env if not explicitly set.
   Vercel injects VERCEL_URL (e.g., "my-project-abc123.vercel.app") and
   VERCEL_PROJECT_PRODUCTION_URL for production deploys. */
if (!process.env.NEXT_PUBLIC_APP_URL) {
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const vercelUrl = process.env.VERCEL_URL;

  if (vercelProductionUrl) {
    process.env.NEXT_PUBLIC_APP_URL = `https://${vercelProductionUrl}`;
  } else if (vercelUrl) {
    process.env.NEXT_PUBLIC_APP_URL = `https://${vercelUrl}`;
  }
}

const requiredPublicKeys = ["NEXT_PUBLIC_APP_URL"];
const optionalServerKeys = ["YOUTUBE_API_KEY", "GEMINI_API_KEY"];
const requiredWhenPersistenceEnabled = ["DATABASE_URL"];
/* Blob + auth are required at RUNTIME (local .env.local and Vercel Project
   Settings) but only warn here so CI/preview builds without them still pass.
   Routes return clear 503/401 errors instead of silently falling back. */
const blobAuthKeys = [
  "BLOB_STORE_ID",
  "BLOB_READ_WRITE_TOKEN",
  "ADMIN_INITIAL_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "API_KEYS_ENCRYPTION_KEY",
];
/* BLOB_WEBHOOK_PUBLIC_KEY is webhook-only (no webhook endpoint exists) and
   is intentionally never required for reads, writes, or authentication. */

const missingRequired = requiredPublicKeys.filter((key) => !process.env[key]);
const missingOptional = optionalServerKeys.filter((key) => !process.env[key]);
const persistenceEnabled = process.env.ENABLE_YOUTUBE_MANIFEST_PERSISTENCE === "true";
const missingPersistence = persistenceEnabled
  ? requiredWhenPersistenceEnabled.filter((key) => !process.env[key])
  : [];

if (missingRequired.length > 0) {
  /* On Vercel, we auto-populate NEXT_PUBLIC_APP_URL above, so this should
     only fire in truly misconfigured environments. Warn instead of crash
     to avoid blocking preview deployments. */
  console.warn(`[env] Missing public config: ${missingRequired.join(", ")}. Using fallback defaults.`);
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  }
}

if (missingPersistence.length > 0) {
  /* Do not crash the build if DATABASE_URL is missing — persistence will
     fall back to in-memory store at runtime. Just warn. */
  console.warn(
    `[env] Persistence is enabled, but DATABASE_URL is missing. Runtime will use in-memory manifest store.`,
  );
}

if (missingOptional.length > 0) {
  console.warn(
    `[env] Optional provider keys are missing and related live features will be disabled: ${missingOptional.join(", ")}`,
  );
}

const missingBlobAuth = blobAuthKeys.filter((key) => !process.env[key]);
if (missingBlobAuth.length > 0) {
  console.warn(
    `[env] Blob/auth persistence is not fully configured (missing: ${missingBlobAuth.join(", ")}). ` +
      `Protected routes will return clear errors until BLOB_STORE_ID, BLOB_READ_WRITE_TOKEN, ` +
      `ADMIN_INITIAL_PASSWORD, ADMIN_SESSION_SECRET, and API_KEYS_ENCRYPTION_KEY are set. ` +
      `See .env.example. Local-only storage is never used as a substitute.`,
  );
}

console.log("[env] Application environment preflight completed without printing secret values.");
