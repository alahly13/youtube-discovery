import { spawnSync } from "node:child_process";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

if (process.env.CONFIRM_DB_APPLY !== "true") {
  console.error("[db] Refusing to apply migrations. Set CONFIRM_DB_APPLY=true for an intentional migrate deploy.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("[db] DATABASE_URL is required for db:apply.");
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
