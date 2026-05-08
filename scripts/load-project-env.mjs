import fs from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

export function loadProjectEnv(options = {}) {
  const projectDir = process.cwd();
  const silent = options.silent ?? false;

  const result = loadEnvConfig(projectDir, process.env.NODE_ENV !== "production", {
    info: () => {},
    error: () => {},
  });

  const unsupportedEnvFiles = [".local.env", path.join("src", ".local.env")];

  for (const relativePath of unsupportedEnvFiles) {
    const absolutePath = path.join(projectDir, relativePath);

    if (fs.existsSync(absolutePath) && !silent) {
      console.warn(
        `[env] Ignoring unsupported ${relativePath}. Use root .env.local locally or Vercel Project Settings for deployments.`,
      );
    }
  }

  return result;
}
