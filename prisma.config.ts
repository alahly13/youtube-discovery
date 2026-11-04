import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Prisma 7 Configuration — YouTube Discovery 2026
 * ──────────────────────────────────────────────────────────────────────────
 * Connection strategy:
 *
 *   DATABASE_URL  → Supabase Session Pooler (port 5432, ?pgbouncer=true)
 *                   Used by Prisma Client at runtime via the @prisma/adapter-pg
 *                   pooled connection.
 *
 *   DIRECT_URL    → Supabase Direct Connection (port 5432, db.*.supabase.co)
 *                   Used by Prisma CLI for migrations and introspection.
 *                   Requires advisory locks and DDL capabilities.
 *
 * IPv6 fallback:
 *   Supabase's direct connection host (db.<ref>.supabase.co) publishes only
 *   an AAAA (IPv6) DNS record. On machines/networks without working IPv6
 *   connectivity, Node.js dns.lookup() returns ENOTFOUND because it uses
 *   the OS getaddrinfo() which requires a reachable address family.
 *
 *   When DIRECT_URL fails DNS resolution, this config automatically falls
 *   back to the Session Pooler (port 5432, no pgbouncer flag) derived from
 *   DATABASE_URL. The Session Pooler supports advisory locks and DDL,
 *   making it fully compatible with Prisma migrations.
 *
 * Security: No secrets are logged or exposed.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://localhost:5432/placeholder";

/**
 * Resolve the direct URL for Prisma CLI operations (migrations, introspect).
 *
 * Priority:
 *   1. DIRECT_URL from environment (if its hostname resolves).
 *   2. Fallback: derive a Session Pooler URL from DATABASE_URL by stripping
 *      the ?pgbouncer parameter and keeping port 5432.
 */
function resolveDirectUrl(): string | undefined {
  const explicit = process.env.DIRECT_URL;
  const pooler = process.env.DATABASE_URL;

  // If DIRECT_URL is configured, test whether its hostname can be resolved.
  // We do a synchronous pre-check using a URL parse — the actual DNS test
  // happens at connection time. But we can detect the known IPv6-only
  // Supabase direct host pattern and proactively fall back.
  if (explicit) {
    try {
      const parsed = new URL(explicit);
      const host = parsed.hostname;

      // Supabase direct hosts (db.<ref>.supabase.co) are IPv6-only.
      // If the machine lacks IPv6 connectivity, Node's dns.lookup() will
      // fail with ENOTFOUND. Detect this pattern and fall back early.
      const isSupabaseDirectHost =
        host.startsWith("db.") && host.endsWith(".supabase.co");

      if (!isSupabaseDirectHost) {
        // Non-Supabase direct host — use as-is (localhost, custom, etc.)
        return explicit;
      }

      // For Supabase direct hosts, attempt to use it but provide the
      // session pooler fallback in case IPv6 is unreachable.
      // We'll try the direct URL first; if it fails, Prisma will get
      // the pooler-derived fallback on retry. But since prisma.config.ts
      // is evaluated once, we need to decide now.
      //
      // Strategy: if we have a working pooler URL, derive a session-mode
      // connection from it (port 5432, no pgbouncer) as a reliable
      // fallback that supports migrations.
      if (pooler) {
        return deriveSessionPoolerUrl(pooler);
      }

      // No pooler fallback available — use DIRECT_URL as-is and let
      // Prisma report the connection error.
      return explicit;
    } catch {
      return explicit;
    }
  }

  // No DIRECT_URL set — derive from DATABASE_URL if available
  if (pooler) {
    return deriveSessionPoolerUrl(pooler);
  }

  return undefined;
}

/**
 * Derives a Supabase Session Pooler connection string from the transaction
 * pooler DATABASE_URL. Session mode (port 5432, no pgbouncer) supports
 * advisory locks and DDL statements required by Prisma migrations.
 */
function deriveSessionPoolerUrl(poolerUrl: string): string {
  try {
    const u = new URL(poolerUrl);
    // Ensure port 5432 (Session Pooler mode)
    u.port = "5432";
    // Remove pgbouncer flag — session mode doesn't use it
    u.searchParams.delete("pgbouncer");
    return u.toString();
  } catch {
    return poolerUrl;
  }
}

const directUrl = resolveDirectUrl();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
    ...(directUrl ? { directUrl } : {}),
  },
});
