/**
 * Search pipeline test runner (no network, no YouTube quota).
 * Compiles scripts/search-tests/suites.ts (+ reachable src graph) with tsc
 * into a temp dir, stubs `server-only`, and runs the suites in plain Node.
 * Exits non-zero on any failure.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yd-search-tests-"));
  console.log(`compiling suites to ${tmp}`);
  execFileSync(
    process.execPath,
    [
      path.join(PROJECT_ROOT, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      path.join(PROJECT_ROOT, "scripts", "search-tests", "tsconfig.json"),
      "--outDir", tmp,
    ],
    { cwd: PROJECT_ROOT, stdio: "inherit" },
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
  const suites = projectRequire(path.join(tmp, "scripts", "search-tests", "suites.js"));
  for (const name of ["suiteQueryAcceptance", "suiteQueryRejection", "suiteSerialization", "suiteFallbackIntact", "suiteShuffleWords", "suiteTrimSpaces", "suiteShuffleOneWord"]) {
    await suites[name]();
  }
  console.log(`\nSEARCH PIPELINE: all suites passed (${suites.passCount()} assertions, no network)`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
