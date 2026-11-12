/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Secret-Safe Environment Inspector (`npm run env:check`)
 * ──────────────────────────────────────────────────────────────────────────
 * Security Policy:
 *   - NEVER prints secret values, API keys, database URLs, or tokens.
 *   - Outputs ONLY boolean/category presence (`SET`, `MISSING`, `ALIAS`,
 *     `FORMAT_OK`, `FORMAT_WARN`) and variable names.
 *   - Safe to run locally, in PowerShell, or in CI logs.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const strictMode = process.argv.includes("--strict");

function isSet(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

function validateUrl(name) {
  if (!isSet(name)) return { status: "MISSING", ok: false };
  try {
    const u = new URL(process.env[name].trim());
    return u.protocol === "https:" || u.protocol === "http:"
      ? { status: "SET (VALID_URL)", ok: true }
      : { status: "FORMAT_WARN (UNEXPECTED_SCHEME)", ok: false };
  } catch {
    return { status: "FORMAT_WARN (INVALID_URL)", ok: false };
  }
}

function validatePostgresUrl(name) {
  if (!isSet(name)) return { status: "MISSING", ok: false };
  const raw = process.env[name].trim();
  const ok = raw.startsWith("postgresql://") || raw.startsWith("postgres://");
  return {
    status: ok ? "SET (POSTGRES_URI_OK)" : "FORMAT_WARN (EXPECTED_POSTGRES_URI)",
    ok,
  };
}

function validateEncryptionKey(name) {
  if (!isSet(name)) return { status: "MISSING", ok: false };
  const raw = process.env[name].trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return { status: "SET (HEX_32_BYTES)", ok: true };
  }
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) {
      return { status: "SET (BASE64_32_BYTES)", ok: true };
    }
  } catch {
    // fallback check below
  }
  if (Buffer.byteLength(raw, "utf8") === 32) {
    return { status: "SET (UTF8_32_BYTES)", ok: true };
  }
  return { status: "FORMAT_WARN (EXPECTED_32_BYTE_KEY)", ok: false };
}

function printRow(group, name, requiredLabel, check) {
  const colGroup = group.padEnd(16);
  const colName = name.padEnd(36);
  const colReq = requiredLabel.padEnd(14);
  console.log(`  ${colGroup} ${colName} ${colReq} ${check.status}`);
}

console.log("");
console.log("YouTube Discovery (2026) — Environment Verification (Values Masked)");
console.log("=".repeat(84));

const criticalFailures = [];
const warnings = [];

// 1. Public & App Metadata
console.log("\n[1] Application & Deployment Metadata");
if (isSet("NEXT_PUBLIC_APP_URL")) {
  printRow("Public", "NEXT_PUBLIC_APP_URL", "Recommended", validateUrl("NEXT_PUBLIC_APP_URL"));
} else if (isSet("VERCEL_PROJECT_PRODUCTION_URL") || isSet("VERCEL_URL")) {
  printRow("Public", "NEXT_PUBLIC_APP_URL", "Recommended", { status: "AUTO_FROM_VERCEL_URL", ok: true });
} else {
  warnings.push("NEXT_PUBLIC_APP_URL not set (defaults to http://localhost:3000 locally)");
  printRow("Public", "NEXT_PUBLIC_APP_URL", "Recommended", { status: "DEFAULT (localhost:3000)", ok: true });
}

// 2. Supabase Auth
console.log("\n[2] Supabase Authentication (Authoritative)");
const sbUrl = validateUrl("NEXT_PUBLIC_SUPABASE_URL");
if (!sbUrl.ok) criticalFailures.push("NEXT_PUBLIC_SUPABASE_URL missing or invalid");
printRow("Supabase", "NEXT_PUBLIC_SUPABASE_URL", "Required", sbUrl);

const sbPub = isSet("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
  ? { status: "SET", ok: true }
  : isSet("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  ? { status: "ALIAS (NEXT_PUBLIC_SUPABASE_ANON_KEY)", ok: true }
  : { status: "MISSING", ok: false };
if (!sbPub.ok) criticalFailures.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or ANON_KEY) missing");
printRow("Supabase", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "Required", sbPub);

const sbRole = isSet("SUPABASE_SERVICE_ROLE_KEY")
  ? { status: "SET", ok: true }
  : isSet("SUPABASE_SECRET_KEY")
  ? { status: "ALIAS (SUPABASE_SECRET_KEY)", ok: true }
  : { status: "MISSING", ok: false };
if (!sbRole.ok) criticalFailures.push("SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) missing");
printRow("Supabase", "SUPABASE_SERVICE_ROLE_KEY", "Required", sbRole);

printRow("Auth", "ADMIN_DEFAULT_USERNAME", "Recommended", {
  status: isSet("ADMIN_DEFAULT_USERNAME") ? "SET" : "DEFAULT (asdy)",
  ok: true,
});
printRow("Auth", "ADMIN_EMAIL", "Recommended", {
  status: isSet("ADMIN_EMAIL") ? "SET" : "DEFAULT (asdy@youtube.discov.com)",
  ok: true,
});
const hasTtl =
  isSet("SESSION_TTL_SECONDS") ||
  isSet("ADMIN_SESSION_TTL_SECONDS") ||
  isSet("SUPABASE_SESSION_TTL_SECONDS") ||
  isSet("SESSION_DURATION");
printRow("Auth", "SESSION_TTL_SECONDS", "Optional", {
  status: hasTtl ? "SET" : "DEFAULT (604800)",
  ok: true,
});

// 3. Database
console.log("\n[3] Supabase PostgreSQL (Prisma 7)");
const dbUrl = validatePostgresUrl("DATABASE_URL");
if (!dbUrl.ok) criticalFailures.push("DATABASE_URL missing or malformed");
printRow("Database", "DATABASE_URL", "Required", dbUrl);

const dirUrl = validatePostgresUrl("DIRECT_URL");
if (!dirUrl.ok) warnings.push("DIRECT_URL missing (Prisma CLI migrations fall back to pooler/DATABASE_URL)");
printRow("Database", "DIRECT_URL", "Recommended", dirUrl);

// 4. Cloudflare R2 Workers
console.log("\n[4] Cloudflare R2 Workers & HMAC Capability Signing");
const r2NewUrl = validateUrl("R2_NEW_WORKER_URL");
const r2OldUrl = validateUrl("R2_OLD_WORKER_URL");
printRow("R2 NEW", "R2_NEW_WORKER_URL", "Required(Cloud)", r2NewUrl);
printRow("R2 OLD", "R2_OLD_WORKER_URL", "Recommended", r2OldUrl);
if (!r2NewUrl.ok) warnings.push("R2_NEW_WORKER_URL unset (R2 writes fall back to ephemeral disk)");

const hasSharedSecret = isSet("WORKER_AUTH_SECRET") || isSet("R2_WORKER_AUTH_SECRET");
const newSecretCheck = isSet("R2_NEW_WORKER_AUTH_SECRET")
  ? { status: "SET", ok: true }
  : hasSharedSecret
  ? { status: "ALIAS (WORKER_AUTH_SECRET)", ok: true }
  : { status: "MISSING", ok: false };
const oldSecretCheck = isSet("R2_OLD_WORKER_AUTH_SECRET")
  ? { status: "SET", ok: true }
  : hasSharedSecret
  ? { status: "ALIAS (WORKER_AUTH_SECRET)", ok: true }
  : { status: "MISSING", ok: false };
if (!newSecretCheck.ok) warnings.push("R2_NEW_WORKER_AUTH_SECRET / WORKER_AUTH_SECRET missing");
if (!oldSecretCheck.ok) warnings.push("R2_OLD_WORKER_AUTH_SECRET / WORKER_AUTH_SECRET missing");
printRow("R2 NEW", "R2_NEW_WORKER_AUTH_SECRET", "Required(Cloud)", newSecretCheck);
printRow("R2 OLD", "R2_OLD_WORKER_AUTH_SECRET", "Recommended", oldSecretCheck);

// 5. Encryption, YouTube & AI
console.log("\n[5] Security, YouTube Data API v3 & Scoped Gemini AI");
const encKey = validateEncryptionKey("API_KEYS_ENCRYPTION_KEY");
if (!encKey.ok) warnings.push("API_KEYS_ENCRYPTION_KEY missing or not 32 bytes (managed API key storage disabled)");
printRow("Security", "API_KEYS_ENCRYPTION_KEY", "Required", encKey);

const ytKey = { status: isSet("YOUTUBE_API_KEY") ? "SET" : "UNSET (DB managed keys only)", ok: true };
const geminiKey = { status: isSet("GEMINI_API_KEY") ? "SET" : "UNSET (AI analysis disabled)", ok: true };
printRow("YouTube", "YOUTUBE_API_KEY", "Optional", ytKey);
printRow("Gemini AI", "GEMINI_API_KEY", "Optional", geminiKey);

// Summary
console.log("\n" + "-".repeat(84));
if (criticalFailures.length > 0) {
  console.log(`CRITICAL ISSUES (${criticalFailures.length}):`);
  for (const item of criticalFailures) console.log(`  - ${item}`);
} else {
  console.log("CRITICAL CHECKS: PASSED");
}

if (warnings.length > 0) {
  console.log(`WARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log(`  - ${w}`);
}

console.log("\nNote: Worker secrets (WORKER_AUTH_SECRET, ALLOWED_ORIGINS) live inside Cloudflare");
console.log("      and must match R2_NEW_WORKER_AUTH_SECRET / R2_OLD_WORKER_AUTH_SECRET.\n");

if (strictMode && criticalFailures.length > 0) {
  process.exit(1);
}
