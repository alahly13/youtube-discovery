/**
 * Blob persistence test runner.
 *  1. Compiles scripts/blob-tests/suites.ts (+ reachable src graph) with tsc
 *     into a temp dir (no build artifacts left in the repo).
 *  2. Stubs `server-only` (plain-Node harness, not RSC) and runs all suites
 *     against MemoryBlobBackend (mocked Blob).
 *  3. Optionally runs a SCOPED real-Blob integration test when
 *     BLOB_READ_WRITE_TOKEN is present and --integration is passed, using
 *     `__test__`-prefixed records that are deleted afterwards (only test
 *     records are ever deleted).
 *
 * Never prints secret values. Exits non-zero on any failure.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");
// Resolve third-party modules from the project (compiled output lives in tmp).
const projectRequire = createRequire(path.join(PROJECT_ROOT, "package.json"));

async function main() {
  const withIntegration = process.argv.includes("--integration");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yd-blob-tests-"));
  console.log(`compiling suites to ${tmp}`);
  execFileSync(
    process.execPath,
    [
      path.join(PROJECT_ROOT, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      path.join(PROJECT_ROOT, "scripts", "blob-tests", "tsconfig.json"),
      "--outDir", tmp,
    ],
    { cwd: PROJECT_ROOT, stdio: "inherit" },
  );

  // Stub `server-only` for the plain-Node harness (CJS loader patch),
  // and map the `@/` path alias to the compiled output.
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
      // Bare third-party imports (e.g. @vercel/blob, zod) resolve from the project.
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

  // Test-only env (never touches real credentials; integration opts in below).
  const realBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const realStoreId = process.env.BLOB_STORE_ID;
  process.env.ADMIN_DEFAULT_USERNAME = "admin";
  process.env.ADMIN_INITIAL_PASSWORD = "test-initial-password-123";
  process.env.ADMIN_SESSION_SECRET = "test-session-secret-0123456789abcdef";
  process.env.ADMIN_SESSION_TTL_SECONDS = "604800";
  process.env.API_KEYS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  delete process.env.YOUTUBE_API_KEY;

  const compiled = path.join(tmp, "scripts", "blob-tests", "suites.js");
  const suites = projectRequire(compiled);
  const order = [
    "suitePure",
    "suitePassword",
    "suiteKeyCrypto",
    "suiteSession",
    "suiteRecordStore",
    "suiteChunkedUpload",
    "suiteAccount",
    "suiteRateLimit",
    "suiteKeys",
    "suiteQuotaPools",
    "suiteMigration",
  ];
  for (const name of order) {
    await suites[name]();
  }
  console.log(`\nUNIT: all suites passed (${suites.passCount()} assertions, mocked Blob)`);

  if (withIntegration) {
    // Restore ONLY the real Blob token for the scoped integration leg.
    if (realBlobToken) process.env.BLOB_READ_WRITE_TOKEN = realBlobToken;
    if (realStoreId) process.env.BLOB_STORE_ID = realStoreId;
    await runIntegration(tmp);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function runIntegration(tmp) {
  console.log("\n[ real-Blob integration (scoped, test records only) ]");
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log("  skip: BLOB_READ_WRITE_TOKEN not set — integration NOT claimed");
    return;
  }
  const store = projectRequire(path.join(tmp, "src", "lib", "blob", "record-store.js"));
  const { VercelBlobBackend } = projectRequire(path.join(tmp, "src", "lib", "blob", "vercel-blob-backend.js"));
  const backend = new VercelBlobBackend();
  const stamp = Date.now().toString(36);
  const ids = [`__test__-small-${stamp}`, `__test__-big-${stamp}`];
  try {
    // 1. Small record round-trip.
    const small = { id: ids[0], title: "integration اختبار 🎬", n: 1 };
    await store.saveRecord(backend, "savedHistory", ids[0], small, { id: ids[0] });
    const back = await store.loadRecord(backend, "savedHistory", ids[0]);
    if (back.id !== small.id || back.title !== small.title || back.n !== small.n) throw new Error("small roundtrip mismatch");
    console.log("  ok: small record round-trip on real Blob store");
    // 2. >4.5MB record → chunked + reassembled exactly.
    const bigText = `تكامل ${"🎬".repeat(50)} `.repeat(60_000);
    const bigBytes = Buffer.byteLength(bigText, "utf8");
    if (!(bigBytes > 4.5 * 1024 * 1024)) throw new Error("fixture too small");
    const saved = await store.saveRecord(backend, "savedHistory", ids[1], { id: ids[1], text: bigText }, { id: ids[1] });
    if (saved.storage !== "chunked") throw new Error("expected chunked storage");
    const bigBack = await store.loadRecord(backend, "savedHistory", ids[1]);
    if (bigBack.text !== bigText) throw new Error("big roundtrip mismatch");
    console.log(`  ok: ${(bigBytes / 1048576).toFixed(1)}MiB record chunked (${saved.chunks} chunks) + reassembled exactly`);
    // 3. Index lists the test records.
    const index = await store.readIndex(backend, "savedHistory");
    if (!ids.every((id) => index.entries.some((e) => e.id === id))) throw new Error("index missing test records");
    console.log("  ok: index lists test records");
  } finally {
    // 4. Cleanup ONLY the test records created above.
    for (const id of ids) {
      await store.deleteRecord(backend, "savedHistory", id).catch(() => {});
    }
    const index = await store.readIndex(backend, "savedHistory").catch(() => ({ entries: [] }));
    const leaked = ids.filter((id) => index.entries.some((e) => e.id === id));
    if (leaked.length > 0) throw new Error(`cleanup failed for ${leaked.join(",")}`);
    console.log("  ok: test records deleted, nothing else touched");
  }
  console.log("INTEGRATION: passed against the real private Blob store");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
