/**
 * YouTube Discovery — Phase 1.6 Recovery & Download Center Test Runner
 * Compiles scripts/recovery-tests/suites.ts (+ reachable src graph) with tsc
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yd-recovery-tests-"));
  console.log(`Compiling recovery & download center test suites to ${tmp}...`);
  execFileSync(
    process.execPath,
    [
      path.join(PROJECT_ROOT, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      path.join(PROJECT_ROOT, "scripts", "recovery-tests", "tsconfig.json"),
      "--outDir", tmp,
    ],
    { cwd: PROJECT_ROOT, stdio: "inherit" },
  );

  const Module = projectRequire("node:module");
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "server-only") return {};
    if (
      request === "@/lib/db/prisma" ||
      (typeof request === "string" && (request.endsWith("lib/db/prisma") || request.endsWith("lib/db/prisma.js")))
    ) {
      const mockPrisma = {
        savedItemIndex: {
          count: async () => 2,
          findMany: async () => [
            {
              platform_item_id: "test1",
              item_type: "video",
              title: "Test Video 1",
              channel_title: "Test Channel",
              saved_date: new Date(),
              is_shorts_like: false,
            },
          ],
        },
        userPlaylist: {
          findFirst: async () => ({
            id: "pl1",
            title: "Test Playlist 1",
            description: "Test Desc",
            created_at: new Date(),
            updated_at: new Date(),
            entries: [],
            groups: [],
          }),
          findMany: async () => [
            {
              id: "pl1",
              title: "Test Playlist 1",
              description: "Test Desc",
              created_at: new Date(),
              updated_at: new Date(),
              _count: { entries: 1 },
              entries: [],
              groups: [],
            },
          ],
        },
        searchHistory: {
          count: async () => 1,
          findMany: async () => [
            {
              id: "sh1",
              query_text: "test search",
              executed_at: new Date(),
            },
          ],
        },
        savedReference: {
          count: async () => 1,
          findMany: async () => [
            {
              id: "ref1",
              title: "Test Reference",
              url: "https://example.com",
              created_at: new Date(),
            },
          ],
        },
        archivedManifest: {
          findMany: async () => [],
          findFirst: async () => null,
        },
        syncBatch: { findMany: async () => [] },
        storageManifestGeneration: { findMany: async () => [] },
        storageManifestPart: { findMany: async () => [] },
      };
      return { prisma: mockPrisma };
    }
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

  const suites = projectRequire(path.join(tmp, "scripts", "recovery-tests", "suites.js"));
  await suites.runAllSuites();
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`   PHASE 1.6: ALL ${suites.passCount()} ASSERTIONS PASSED!`);
  console.log(`══════════════════════════════════════════════════════════════\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
