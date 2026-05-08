import { loadProjectEnv } from "./load-project-env.mjs";

loadProjectEnv();

const requiredPublicKeys = ["NEXT_PUBLIC_APP_URL"];
const optionalServerKeys = ["YOUTUBE_API_KEY", "GEMINI_API_KEY"];
const requiredWhenPersistenceEnabled = ["DATABASE_URL"];

const missingRequired = requiredPublicKeys.filter((key) => !process.env[key]);
const missingOptional = optionalServerKeys.filter((key) => !process.env[key]);
const persistenceEnabled = process.env.ENABLE_YOUTUBE_MANIFEST_PERSISTENCE === "true";
const missingPersistence = persistenceEnabled
  ? requiredWhenPersistenceEnabled.filter((key) => !process.env[key])
  : [];

if (missingRequired.length > 0) {
  console.error(`[env] Missing required public config: ${missingRequired.join(", ")}`);
  process.exit(1);
}

if (missingPersistence.length > 0) {
  console.error(
    `[env] Persistence is enabled, but required server-only config is missing: ${missingPersistence.join(", ")}`,
  );
  process.exit(1);
}

if (missingOptional.length > 0) {
  console.warn(
    `[env] Optional provider keys are missing and related live features will be disabled: ${missingOptional.join(", ")}`,
  );
}

console.log("[env] Application environment preflight completed without printing secret values.");
