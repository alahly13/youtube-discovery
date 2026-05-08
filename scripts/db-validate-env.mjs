import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const url = process.env.DATABASE_URL;

if (!url) {
  console.warn("[db] DATABASE_URL is not set. Prisma schema validation will use the non-secret local placeholder from prisma.config.ts.");
  process.exit(0);
}

try {
  const parsed = new URL(url);
  const supported = ["postgresql:", "postgres:", "prisma:", "prisma+postgres:"].includes(parsed.protocol);

  if (!supported) {
    console.error("[db] DATABASE_URL must use a PostgreSQL-compatible Prisma protocol.");
    process.exit(1);
  }

  console.log("[db] DATABASE_URL shape validated without printing connection details.");
} catch {
  console.error("[db] DATABASE_URL is not a valid URL.");
  process.exit(1);
}
