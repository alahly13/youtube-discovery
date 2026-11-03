import { Pool } from "pg";
import { loadProjectEnv } from "../load-project-env.mjs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Database Migration Inspector — Safe Read-Only PostgreSQL Client
 * ──────────────────────────────────────────────────────────────────────────
 * - Queries `_prisma_migrations` table safely with read-only SELECT.
 * - NEVER executes schema modifications (CREATE, ALTER, DROP) or data mutations.
 * - Extracts connection metadata with strict password and secret masking.
 * - Handles connection timeouts, missing tables, and network failures cleanly.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Ensure local project env is loaded (e.g. .env.local or .env)
loadProjectEnv({ silent: true });

/**
 * Mask a host or URL component for safe terminal display.
 * e.g., "aws-0-eu-central-1.pooler.supabase.com" or "db.abcdefgh.supabase.co"
 */
export function maskHost(host) {
  if (!host) return "unknown";
  if (host === "localhost" || host === "127.0.0.1") return "localhost";
  const parts = host.split(".");
  if (parts.length > 2) {
    return `${parts[0]}.${"*".repeat(Math.min(parts[1].length, 6))}.${parts.slice(2).join(".")}`;
  }
  return host;
}

/**
 * Safely parses database connection details without exposing secrets.
 */
export function parseConnectionDetails(rawUrl) {
  if (!rawUrl) {
    return {
      isConfigured: false,
      provider: "Not Configured",
      host: "None",
      database: "None",
      isSupabase: false,
      isPooled: false,
    };
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname;
    const isSupabase = host.includes("supabase.co") || host.includes("supabase.com");
    const isPooled = parsed.port === "6543" || parsed.searchParams.has("pgbouncer");
    const provider = isSupabase
      ? isPooled
        ? "PostgreSQL / Supabase (Pooled)"
        : "PostgreSQL / Supabase (Direct)"
      : "PostgreSQL (Standard)";

    return {
      isConfigured: true,
      provider,
      host: maskHost(host),
      database: parsed.pathname ? parsed.pathname.replace(/^\//, "") : "postgres",
      isSupabase,
      isPooled,
    };
  } catch {
    return {
      isConfigured: true,
      provider: "PostgreSQL (Custom)",
      host: "Masked",
      database: "Masked",
      isSupabase: false,
      isPooled: false,
    };
  }
}

/**
 * Resolves the database connection string to use.
 * Prefers DIRECT_URL for migrations (as Prisma CLI does in prisma.config.ts),
 * with fallback to DATABASE_URL.
 */
export function resolveDatabaseUrl(customUrl) {
  if (customUrl) return customUrl;
  return process.env.DIRECT_URL || process.env.DATABASE_URL || null;
}

/**
 * Safely inspects the database `_prisma_migrations` table.
 *
 * @param {object} [options]
 * @param {string} [options.connectionUrl] - Optional explicit connection string.
 * @param {number} [options.timeoutMs=5000] - Connection timeout in milliseconds.
 * @returns {Promise<object>} Database inspection report.
 */
export async function inspectDatabaseMigrations(options = {}) {
  const timeoutMs = options.timeoutMs ?? 20000;
  const rawUrl = resolveDatabaseUrl(options.connectionUrl);
  const connectionInfo = parseConnectionDetails(rawUrl);

  if (!rawUrl) {
    return {
      connected: false,
      status: "CONFIG_MISSING",
      error: "Neither DIRECT_URL nor DATABASE_URL is defined.",
      connectionInfo,
      tableExists: false,
      migrations: [],
    };
  }

  let pool;
  try {
    pool = new Pool({
      connectionString: rawUrl,
      connectionTimeoutMillis: timeoutMs,
      statement_timeout: timeoutMs,
      ssl: rawUrl.includes("localhost") || rawUrl.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
    });

    // 1. Test basic connectivity with a fast scalar check
    const client = await pool.connect();

    try {
      // 2. Check if _prisma_migrations table exists in public schema
      const tableCheckRes = await client.query(
        "SELECT to_regclass('public._prisma_migrations') as reg;"
      );
      const tableExists = Boolean(tableCheckRes.rows[0]?.reg);

      if (!tableExists) {
        return {
          connected: true,
          status: "TABLE_NOT_FOUND",
          error: "Table '_prisma_migrations' does not exist in the database.",
          connectionInfo,
          tableExists: false,
          migrations: [],
        };
      }

      // 3. Read recorded migrations in order
      const query = `
        SELECT 
          id,
          checksum,
          finished_at,
          migration_name,
          logs,
          rolled_back_at,
          started_at,
          applied_steps_count
        FROM public._prisma_migrations
        ORDER BY started_at ASC, id ASC;
      `;

      const result = await client.query(query);

      const migrations = result.rows.map((row) => ({
        id: row.id,
        migrationName: row.migration_name,
        checksum: row.checksum,
        startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
        finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
        rolledBackAt: row.rolled_back_at ? new Date(row.rolled_back_at).toISOString() : null,
        appliedStepsCount: Number(row.applied_steps_count ?? 0),
        logs: row.logs || null,
        durationMs:
          row.started_at && row.finished_at
            ? Math.max(0, new Date(row.finished_at).getTime() - new Date(row.started_at).getTime())
            : null,
      }));

      return {
        connected: true,
        status: "CONNECTED",
        error: null,
        connectionInfo,
        tableExists: true,
        migrations,
      };
    } finally {
      client.release();
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorCode = err?.code || "UNREACHABLE";

    // Clean error message to avoid printing connection strings
    const safeErrorMsg = errorMsg
      .replace(/postgresql:\/\/[^@]+@/, "postgresql://***:***@")
      .replace(/postgres:\/\/[^@]+@/, "postgres://***:***@");

    return {
      connected: false,
      status: "UNREACHABLE",
      error: `Database connection failed (${errorCode}): ${safeErrorMsg}`,
      connectionInfo,
      tableExists: false,
      migrations: [],
    };
  } finally {
    if (pool) {
      await pool.end().catch(() => {});
    }
  }
}
