/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Compile-on-demand helper for Node-based contract tests.
 * ──────────────────────────────────────────────────────────────────────────
 * Why this exists:
 *   Node 24 can execute TypeScript with type stripping, but it does not resolve
 *   extensionless relative imports (`./canonical-paths`) used by the Next.js
 *   source graph. Compiling the small test graph to CommonJS in a temp folder
 *   keeps the production source imports untouched while allowing plain Node to
 *   run the verification suites.
 *
 * Scope: Test tooling only. Never imported by application code.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, "..", "..");

/**
 * Compiles one or more TypeScript entrypoints (and their reachable relative
 * imports) into an isolated CommonJS temp directory.
 *
 * @param {string[]} entries Paths relative to the project root.
 * @returns {{ tmpDir: string; load: (relativeOutPath: string) => unknown; cleanup: () => void }}
 */
export function compileTsEntries(entries) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yd-contract-tests-"));
  const tscBin = path.join(PROJECT_ROOT, "node_modules", "typescript", "bin", "tsc");

  execFileSync(
    process.execPath,
    [
      tscBin,
      ...entries.map((entry) => path.join(PROJECT_ROOT, entry)),
      "--outDir",
      tmpDir,
      "--rootDir",
      path.join(PROJECT_ROOT, "src"),
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--target",
      "es2022",
      "--esModuleInterop",
      "--skipLibCheck",
      "--noEmitOnError",
    ],
    { cwd: PROJECT_ROOT, stdio: "inherit" }
  );

  const projectRequire = createRequire(path.join(PROJECT_ROOT, "package.json"));

  return {
    tmpDir,
    load(relativeOutPath) {
      return projectRequire(path.join(tmpDir, relativeOutPath));
    },
    cleanup() {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}
