/**
 * YouTube Discovery — Supabase Auth & Configurable Session Test Runner
 * Compiles scripts/supabase-auth-tests/suites.ts (+ reachable src graph) with tsc
 * into a temp dir, stubs `server-only`, maps `@/` path alias, and runs suites.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");
const projectRequire = createRequire(path.join(PROJECT_ROOT, "package.json"));

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yd-supabase-auth-tests-"));
  console.log(`Compiling Supabase auth test suites to ${tmp}...`);
  execFileSync(
    process.execPath,
    [
      path.join(PROJECT_ROOT, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      path.join(PROJECT_ROOT, "scripts", "supabase-auth-tests", "tsconfig.json"),
      "--outDir", tmp,
    ],
    { cwd: PROJECT_ROOT, stdio: ["ignore", "inherit", "inherit"] },
  );

  const Module = projectRequire("node:module");
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "server-only") return {};
    if (typeof request === "string" && request.startsWith("@/")) {
      return originalLoad.call(this, path.join(tmp, "src", request.slice(2)), parent, isMain);
    }
    try {
      return originalLoad.call(this, request, parent, isMain);
    } catch (err) {
      if (
        typeof request === "string" &&
        !request.startsWith(".") &&
        !request.startsWith("node:") &&
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "MODULE_NOT_FOUND"
      ) {
        return projectRequire(request);
      }
      throw err;
    }
  };

  try {
    const suitesPath = path.join(tmp, "scripts", "supabase-auth-tests", "suites.js");
    const { runAllSuites } = projectRequire(suitesPath);
    await runAllSuites();
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("   SUPABASE AUTH & 1-WEEK SESSION: ALL TESTS PASSED!          ");
    console.log("══════════════════════════════════════════════════════════════\n");
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows tmp
    }
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
