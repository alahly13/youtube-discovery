import "server-only";

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Prisma 7 Database Client Singleton
 * ──────────────────────────────────────────────────────────────────────────
 * - Uses `@prisma/adapter-pg` with `pg.Pool` for PostgreSQL / Supabase.
 * - Supports pooled connections via DATABASE_URL and direct connections via
 *   DIRECT_URL in `prisma.config.ts`.
 * - Singleton pattern prevents multiple instances during Next.js hot reload.
 * - Ready for serverless / Vercel deployment with connection reuse.
 * - Foundation only: Application models will be added when specified by user.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    // Infrastructure fallback when DATABASE_URL is not yet configured
    return new PrismaClient();
  }

  try {
    const pool =
      globalForPrisma.pool ??
      new Pool({
        connectionString,
        max: 10,
        ssl: connectionString.includes("localhost")
          ? false
          : { rejectUnauthorized: false },
      });

    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.pool = pool;
    }

    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
  } catch (err) {
    console.warn(
      "[db] Failed to initialize PrismaPg adapter with DATABASE_URL, falling back to standard client:",
      err instanceof Error ? err.message : String(err)
    );
    return new PrismaClient();
  }
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
