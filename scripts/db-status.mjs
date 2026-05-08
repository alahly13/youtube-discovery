import { spawnSync } from "node:child_process";
import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

if (!process.env.DATABASE_URL) {
  console.warn("[db] DATABASE_URL is not set. Skipping migrate status.");
  process.exit(0);
}

const result = spawnSync("npx", ["prisma", "migrate", "status"], {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
