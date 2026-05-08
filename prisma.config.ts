import nextEnv from "@next/env";
import { defineConfig } from "prisma/config";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
  info: () => {},
  error: () => {},
});

// Prisma CLI commands such as validate/generate should work in Codex and CI before
// a real Supabase database is provisioned. Migration/apply scripts separately gate
// real DATABASE_URL usage so the placeholder can never become production truth.
const validationOnlyUrl =
  "postgresql://prisma:prisma@localhost:5432/youtube_discovery?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? validationOnlyUrl,
  },
});
