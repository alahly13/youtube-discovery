/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Architectural Audit Hardening Regression Suite
 * ──────────────────────────────────────────────────────────────────────────
 * Executes compiled TypeScript production modules with isolated mocks (zero
 * live DB or network calls) to verify critical P0-P2 audit fixes:
 *   1. Cookie deletion preservation in @supabase/ssr wrapper (Max-Age=0)
 *   2. Proxy /login redirect-loop guard & invalid-session cookie cleanup
 *   3. Reconciliation compare R2 `obj.key`, `storageOwnerUuid`, and fail-closed
 *      behavior on Worker listing failures
 *   4. Sync save-all fail-closed snapshot loading & no superseded overwrite
 *   5. Admin migrate response contract aligned with StorageMigrationCard
 * ═══════════════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const projectRequire = createRequire(path.join(ROOT, "package.json"));

const TARGET_FILES = [
  "src/lib/supabase/server.ts",
  "src/proxy.ts",
  "src/app/manifest.ts",
  "src/lib/storage/r2-blob-backend.ts",
  "src/app/api/admin/migrate/route.ts",
  "src/app/api/storage/reconciliation/compare/route.ts",
  "src/app/api/sync/save-all/route.ts",
];

function compileTargetGraph() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yd-audit-hardening-"));
  const tsconfigPath = path.join(tmpDir, "tsconfig.audit.json");
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "commonjs",
        moduleResolution: "node",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        baseUrl: ROOT,
        outDir: tmpDir,
        rootDir: ROOT,
        paths: {
          "@/*": ["src/*"],
        },
      },
      files: TARGET_FILES.map((rel) => path.join(ROOT, rel)),
    }),
    "utf8"
  );

  execFileSync(
    process.execPath,
    [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", tsconfigPath],
    { cwd: ROOT, stdio: "inherit" }
  );

  return tmpDir;
}

async function run() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("   YOUTUBE DISCOVERY — AUDIT HARDENING REGRESSION SUITE       ");
  console.log("══════════════════════════════════════════════════════════════\n");

  const tmpDir = compileTargetGraph();
  const Module = projectRequire("node:module");
  const originalLoad = Module._load;

  const envBackup = { ...process.env };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.R2_NEW_WORKER_URL = "https://new-worker.example.workers.dev";
  process.env.R2_NEW_WORKER_AUTH_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  let supabaseStubMode = "VALID_SESSION";
  let currentPrismaMock = {};
  let currentR2Mock = {};

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "server-only") return {};

    if (request === "@supabase/ssr") {
      return {
        createServerClient(_url, _key, options) {
          return {
            auth: {
              async signOut() {
                options.cookies.setAll([
                  { name: "sb-ref-auth-token", value: "", options: { path: "/", maxAge: 0 } },
                ]);
                return { error: null };
              },
              async getUser() {
                if (supabaseStubMode === "INVALID_SESSION") {
                  return { data: { user: null }, error: { message: "JWT expired" } };
                }
                return { data: { user: { id: "auth-u-1" } }, error: null };
              },
            },
          };
        },
      };
    }

    if (request === "@/lib/auth/require-auth") {
      return {
        assertSameOrigin: () => null,
        requireAdmin: async () => ({
          ok: true,
          admin: {
            profileId: "22222222-2222-4222-8222-222222222222",
            userId: "auth-u-1",
            email: "asdy@youtube.discov.com",
            storageOwnerUuid: "11111111-1111-4111-8111-111111111111",
            storageNamespace: "asdy",
            username: "asdy",
            role: "admin",
          },
        }),
      };
    }

    if (request === "@/lib/db/prisma") {
      return {
        prisma: new Proxy(
          {},
          {
            get(_t, prop) {
              if (currentPrismaMock && prop in currentPrismaMock) {
                return currentPrismaMock[prop];
              }
              return {
                findFirst: async () => null,
                findMany: async () => [],
                findUnique: async () => null,
                create: async (args) => ({ id: "created-id-1", ...(args?.data || {}) }),
                update: async (args) => ({ id: "updated-id-1", ...(args?.data || {}) }),
              };
            },
          }
        ),
      };
    }

    if (
      request === "@/lib/storage/r2-worker-storage-client" ||
      request === "./r2-worker-storage-client"
    ) {
      return {
        getR2WorkerStorageClient: () => currentR2Mock,
      };
    }

    if (request === "@/lib/storage/r2-blob-backend") {
      return {
        getNewStorageBackend: () => ({
          putBytes: async () => ({ ok: true }),
          getBytes: async () => null,
        }),
        NEW_R2_BUCKET: "new-youtube-discovery-private",
      };
    }

    if (typeof request === "string" && request.startsWith("@/")) {
      return originalLoad.call(this, path.join(tmpDir, "src", request.slice(2)), parent, isMain);
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

  let passed = 0;
  async function test(name, fn) {
    await fn();
    passed++;
    console.log(`  ✓ PASS: ${name}`);
  }

  try {
    const { NextRequest, NextResponse } = projectRequire("next/server");
    const { createRouteHandlerSupabaseClient } = projectRequire(
      path.join(tmpDir, "src", "lib", "supabase", "server.js")
    );
    const proxyModule = projectRequire(path.join(tmpDir, "src", "proxy.js"));
    const proxy = proxyModule.default;
    const migrateRoute = projectRequire(
      path.join(tmpDir, "src", "app", "api", "admin", "migrate", "route.js")
    );
    const compareRoute = projectRequire(
      path.join(tmpDir, "src", "app", "api", "storage", "reconciliation", "compare", "route.js")
    );
    const saveAllRoute = projectRequire(
      path.join(tmpDir, "src", "app", "api", "sync", "save-all", "route.js")
    );

    // 1. Cookie deletion maxAge preservation
    await test("1. createRouteHandlerSupabaseClient preserves Max-Age=0 during signOut", async () => {
      const req = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: { cookie: "sb-ref-auth-token=stale" },
      });
      const res = NextResponse.json({ success: true });
      const client = createRouteHandlerSupabaseClient(req, res);
      assert.ok(client, "Client must initialize");
      await client.auth.signOut();
      const setCookies = res.headers.getSetCookie();
      const clearedCookie = setCookies.find((c) => c.startsWith("sb-ref-auth-token="));
      assert.ok(clearedCookie, "Cleared auth cookie header must exist");
      assert.ok(
        clearedCookie.includes("Max-Age=0"),
        `Expected Max-Age=0 to remain intact on logout, got: ${clearedCookie}`
      );
    });

    // 2. Proxy loop prevention & stale cookie eviction
    await test("2. proxy skips /login redirect on ?reauth=1 and clears invalid Supabase cookies", async () => {
      supabaseStubMode = "INVALID_SESSION";
      const reqReauth = new NextRequest("http://localhost:3000/login?reauth=1", {
        headers: { cookie: "sb-ref-auth-token=stale-jwt" },
      });
      const resReauth = await proxy(reqReauth);
      assert.equal(resReauth.status, 200, "Explicit reauth link must render /login instead of redirecting");

      const reqStale = new NextRequest("http://localhost:3000/login", {
        headers: { cookie: "sb-ref-auth-token=stale-jwt" },
      });
      const resStale = await proxy(reqStale);
      assert.equal(resStale.status, 200, "Expired Supabase cookie on /login must not redirect to /search");
      const cleared = resStale.headers.getSetCookie().find((c) => c.startsWith("sb-ref-auth-token="));
      assert.ok(cleared && cleared.includes("Max-Age=0"), "Stale cookie must be evicted on /login");

      supabaseStubMode = "VALID_SESSION";
      const reqValid = new NextRequest("http://localhost:3000/login", {
        headers: { cookie: "sb-ref-auth-token=valid-jwt" },
      });
      const resValid = await proxy(reqValid);
      assert.equal(resValid.status, 307, "Verified session on /login redirects to /search");
      assert.ok(resValid.headers.get("location")?.endsWith("/search"));
    });

    // 3. /api/admin/migrate response shape matches StorageMigrationCard
    await test("3. /api/admin/migrate returns playlists/searches/keys buckets with failed counts", async () => {
      currentPrismaMock = {
        savedSearchPreset: {
          findFirst: async () => null,
          create: async (args) => args.data,
        },
      };
      const req = new Request("http://localhost:3000/api/admin/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savedTitles: [{ id: "st_1", title: "AI Coding", query: "ai coding 2026" }],
        }),
      });
      const res = await migrateRoute.POST(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(typeof data.playlists?.failed, "number");
      assert.equal(typeof data.searches?.failed, "number");
      assert.equal(typeof data.keys?.failed, "number");
      assert.equal(data.titlesImported, 1);
    });

    // 4. Reconciliation compare R2 obj.key + storageOwnerUuid + fail-closed
    await test("4. /api/storage/reconciliation/compare passes storageOwnerUuid, reads obj.key, and fails closed on R2 errors", async () => {
      const ownerUuid = "11111111-1111-4111-8111-111111111111";
      const genId = "gen_001";
      const manifestKey = `asdy/persistence/${ownerUuid}/saved-items/generations/${genId}/manifest.json`;
      const partKey = `asdy/persistence/${ownerUuid}/saved-items/generations/${genId}/parts/part-000001.json`;
      const partPayload = Buffer.from(
        JSON.stringify({
          records: [{ id: "youtube:vid1", platformItemId: "vid1", title: "Video 1", itemType: "video" }],
        }),
        "utf8"
      );
      const partSha = crypto.createHash("sha256").update(partPayload).digest("hex");
      const manifestPayload = Buffer.from(
        JSON.stringify({ generationId: genId, parts: [{ storagePath: partKey, sha256: partSha }] }),
        "utf8"
      );

      currentPrismaMock = {
        userProfile: {
          findFirst: async () => ({
            id: "22222222-2222-4222-8222-222222222222",
            storage_owner_uuid: ownerUuid,
          }),
        },
        storageDataset: {
          findFirst: async () => ({ id: "ds-1", dataset_type: "SAVED_ITEMS", current_generation_id: genId }),
        },
        storageGeneration: {
          findMany: async () => [
            {
              id: genId,
              generation_number: 1,
              state: "COMMITTED",
              total_parts: 1,
              total_records: 1,
              parts: [
                {
                  id: "part-db-1",
                  part_number: 1,
                  storage_path: partKey,
                  byte_count: BigInt(partPayload.length),
                  record_count: 1,
                  sha256: partSha,
                  status: "UPLOADED",
                },
              ],
            },
          ],
        },
      };

      const seenListOpts = [];
      const seenGetOpts = [];
      currentR2Mock = {
        listAllObjects: async (_bucket, prefix, opts) => {
          seenListOpts.push({ prefix, opts });
          return {
            objects: [
              { key: manifestKey, size: manifestPayload.length, etag: "m1", uploaded: new Date().toISOString() },
              { key: partKey, size: partPayload.length, etag: "p1", uploaded: new Date().toISOString() },
            ],
            truncated: false,
            incomplete: false,
          };
        },
        getObject: async (_bucket, key, opts) => {
          seenGetOpts.push({ key, opts });
          if (key === manifestKey) {
            return { data: manifestPayload, sha256: crypto.createHash("sha256").update(manifestPayload).digest("hex") };
          }
          if (key === partKey) {
            return { data: partPayload, sha256: partSha };
          }
          throw new Error(`Unexpected key requested: ${key}`);
        },
      };

      const okReq = new Request("http://localhost:3000/api/storage/reconciliation/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType: "SAVED_ITEMS",
          localRecords: [{ id: "youtube:vid1", platformItemId: "vid1", title: "Video 1", itemType: "video" }],
        }),
      });
      const okRes = await compareRoute.POST(okReq);
      assert.equal(okRes.status, 200);
      const okJson = await okRes.json();
      assert.equal(okJson.ok, true);
      assert.ok(seenListOpts.every((x) => x.opts?.storageOwnerUuid === ownerUuid), "listAllObjects must pass storageOwnerUuid");
      assert.ok(seenGetOpts.every((x) => x.opts?.storageOwnerUuid === ownerUuid), "getObject must pass storageOwnerUuid");
      assert.equal(okJson.partResults[0].r2.manifestExists, true);
      assert.equal(okJson.partResults[0].r2.partExists, true);
      assert.equal(okJson.partResults[0].r2.checksumMatches, true);

      // Fail-closed test: Worker error across all prefixes must return 503 instead of silent empty map
      currentR2Mock = {
        listAllObjects: async () => {
          throw new Error("WORKER_UNAUTHORIZED");
        },
      };
      const failReq = new Request("http://localhost:3000/api/storage/reconciliation/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetType: "SAVED_ITEMS", localRecords: [] }),
      });
      const failRes = await compareRoute.POST(failReq);
      assert.equal(failRes.status, 503);
      const failJson = await failRes.json();
      assert.equal(failJson.error, "CLOUDFLARE_R2_LISTING_FAILED");
    });

    // 5. Sync save-all fails closed when committed part read fails
    await test("5. /api/sync/save-all fails closed if committed R2 part read errors (never wipes cloud)", async () => {
      const ownerUuid = "11111111-1111-4111-8111-111111111111";
      const profileUuid = "22222222-2222-4222-8222-222222222222";
      currentPrismaMock = {
        userProfile: {
          findFirst: async () => ({
            id: profileUuid,
            auth_user_id: "auth-u-1",
            storage_owner_uuid: ownerUuid,
            username: "asdy",
            role: "admin",
          }),
        },
        storageDataset: {
          findFirst: async () => ({
            id: "ds-1",
            owner_id: profileUuid,
            dataset_type: "SAVED_ITEMS",
            current_revision: 2,
            current_generation_id: "gen_002",
          }),
        },
        saveSyncBatch: {
          findUnique: async () => null,
        },
        storageGeneration: {
          findMany: async () => {
            throw new Error("Should not iterate all historical generations");
          },
          findFirst: async () => ({
            id: "gen_002",
            generation_number: 2,
            state: "COMMITTED",
            parts: [
              {
                part_number: 1,
                storage_path: `asdy/persistence/${ownerUuid}/saved-items/generations/gen_002/parts/part-000001.json`,
                sha256: "a".repeat(64),
              },
            ],
          }),
        },
      };

      currentR2Mock = {
        getObject: async () => {
          throw new Error("R2_TRANSIENT_FAILURE");
        },
      };

      const req = new Request("http://localhost:3000/api/sync/save-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: "batch_test_fail_closed",
          datasets: [
            {
              datasetType: "SAVED_ITEMS",
              idempotencyKey: "idem_test_fail_closed",
              operations: [
                {
                  operationId: "op_1",
                  entityId: "vid_new",
                  operationType: "UPSERT",
                  payload: { platformItemId: "vid_new", title: "New Video", itemType: "video" },
                },
              ],
            },
          ],
        }),
      });
      const res = await saveAllRoute.POST(req);
      assert.equal(res.status, 500, "save-all must abort when existing committed snapshot cannot be read");
      const json = await res.json();
      assert.equal(json.ok, false);
      assert.equal(json.errorCategory, "R2_VERIFICATION_ERROR");
    });

    // 6. Web App Manifest route parity with share_target
    await test("6. src/app/manifest.ts defines Web Share Target matching public/manifest.webmanifest", async () => {
      const manifestModule = projectRequire(
        path.join(tmpDir, "src", "app", "manifest.js")
      );
      const result = manifestModule.default();
      assert.equal(result.share_target?.action, "/share-target");
      assert.equal(result.share_target?.method, "POST");
      assert.equal(result.share_target?.enctype, "multipart/form-data");
      assert.equal(result.share_target?.params?.url, "url");
    });

    // 7. R2StorageBackend fails closed on canonical owner paths & OLD paths when Worker configured
    await test("7. R2StorageBackend fails closed on owner/OLD Worker errors without masking onto local disk", async () => {
      const { R2StorageBackend } = projectRequire(
        path.join(tmpDir, "src", "lib", "storage", "r2-blob-backend.js")
      );
      currentR2Mock = {
        getObject: async () => {
          throw new Error("SIMULATED_WORKER_OUTAGE");
        },
        putObject: async () => {
          throw new Error("SIMULATED_WORKER_WRITE_FAILURE");
        },
        headObject: async () => {
          throw new Error("SIMULATED_WORKER_HEAD_FAILURE");
        },
      };
      const backend = new R2StorageBackend();
      const canonicalKey = "asdy/persistence/11111111-1111-4111-8111-111111111111/saved-items/version.json";
      await assert.rejects(
        () => backend.putBytes(canonicalKey, Buffer.from("{}", "utf8")),
        /SIMULATED_WORKER_WRITE_FAILURE/,
        "putBytes on canonical owner path must fail closed on Worker error"
      );
      await assert.rejects(
        () => backend.getBytes(canonicalKey),
        /SIMULATED_WORKER_OUTAGE/,
        "getBytes on canonical owner path must fail closed on Worker error"
      );
      await assert.rejects(
        () => backend.head(canonicalKey),
        /SIMULATED_WORKER_HEAD_FAILURE/,
        "head on canonical owner path must fail closed on Worker error"
      );
    });

    console.log(`\n══════════════════════════════════════════════════════════════`);
    console.log(`   AUDIT HARDENING REGRESSION SUITE: ${passed}/${passed} PASSED`);
    console.log(`══════════════════════════════════════════════════════════════\n`);
  } finally {
    Module._load = originalLoad;
    process.env = envBackup;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup failure on Windows
    }
  }
}

run().catch((err) => {
  console.error("\n✗ Audit hardening regression suite failed:", err);
  process.exit(1);
});
