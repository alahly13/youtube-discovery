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
/* Core authentication and storage keys checked at runtime.
   Missing keys only emit warnings during build so preview/CI builds still pass. */
const coreAuthKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "ADMIN_DEFAULT_USERNAME",
  "ADMIN_EMAIL",
  "API_KEYS_ENCRYPTION_KEY",
];

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

const hasSupabase =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
  Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

if (hasSupabase) {
  console.log("[env] Supabase Auth & PostgreSQL persistence configured.");
} else {
  const missingCoreAuth = coreAuthKeys.filter((key) => !process.env[key]);
  if (missingCoreAuth.length > 0) {
    console.warn(
      `[env] Supabase Auth is not fully configured (missing: ${missingCoreAuth.join(", ")}). ` +
        `Protected routes will return clear errors until Supabase Auth environment variables are set. ` +
        `See .env.example.`,
    );
  }
}

console.log("[env] Application environment preflight completed without printing secret values.");
