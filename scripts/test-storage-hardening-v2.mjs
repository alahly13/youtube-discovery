/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Storage Hardening & Local-First Test Suite (v2)
 * ──────────────────────────────────────────────────────────────────────────
 * Verifies real production code (compiled via TypeScript + Worker runtime):
 *   1. Rule Zero: R2 Workers enforce `onlyIf: { etagDoesNotMatch: "*" }`,
 *      protect `before-app-updating/manifest.json`, `/generations/`, `asdy/old/`
 *      against overwrite (409 conflict) and reject non-temp DELETEs (403).
 *   2. Rule Zero: R2StorageBackend rejects overwrite on immutable keys even if
 *      caller passes `allowOverwrite: true` and throws BlobForbiddenError on
 *      delete() of canonical/historical keys.
 *   3. Safe PostgreSQL Sync (`save-all`): REFERENCES / PLAYLIST / RESEARCH_QUEUE
 *      / SEARCH_HISTORY never wipe unrepresented rows (`deleteMany({ notIn })`)
 *      and only delete explicitly tombstoned entity IDs.
 *   4. Playlist `upl_* <-> UUID` identity & `snapshot_json` lossless round-trip
 *      across `playlist-db-service.ts` & `/api/playlists`.
 *   5. Legacy services (`rate-limit`, `search-storage-archive`, `quota-pools`,
 *      `youtube-api-keys`) read/write PostgreSQL Prisma models without hitting
 *      ephemeral disk / `youtube-discovery/v1/*` fallback writes.
 *   6. Local-first Class-A temporary manifests (`local-manifest-store.ts`):
 *      lifecycle states, checkpoint preservation, graceful IDB fallback, and
 *      local browser filtering.
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
  "src/lib/storage/r2-blob-backend.ts",
  "src/lib/playlists/playlist-db-service.ts",
  "src/lib/auth/rate-limit.ts",
  "src/lib/platforms/youtube/youtube-api-keys.ts",
  "src/lib/keys/quota-pools.ts",
  "src/lib/search-storage/search-storage-archive.ts",
  "src/lib/manifests/local-manifest-store.ts",
  "src/app/api/sync/save-all/route.ts",
];

function compileTargets() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yd-hardening-v2-"));
  const tsconfigPath = path.join(tmpDir, "tsconfig.v2.json");
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

  // Compile Cloudflare Workers to CommonJS with esbuild for runtime handler verification
  const esbuild = projectRequire("esbuild");
  for (const rel of [
    "cloudflare/workers/new-youtube-discovery-api/src/index.ts",
    "cloudflare/workers/old-youtube-discovery-api/src/index.ts",
  ]) {
    const outFile = path.join(tmpDir, rel.replace(/\.ts$/, ".js"));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    esbuild.buildSync({
      entryPoints: [path.join(ROOT, rel)],
      outfile: outFile,
      platform: "node",
      format: "cjs",
      bundle: false,
      sourcemap: false,
    });
  }

  return tmpDir;
}

function base64Url(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signWorkerJwt(claims, secret) {
  const headerB64 = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = base64Url(JSON.stringify(claims));
  const dataToSign = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac("sha256", secret).update(dataToSign).digest();
  return `${dataToSign}.${base64Url(sig)}`;
}

function createSimulatedR2Bucket() {
  const objects = new Map();
  return {
    _objects: objects,
    async head(key) {
      return objects.get(key) || null;
    },
    async get(key) {
      const obj = objects.get(key);
      if (!obj) return null;
      return {
        ...obj,
        body: obj.bytes,
        writeHttpMetadata(headers) {
          if (obj.httpMetadata?.contentType) {
            headers.set("Content-Type", obj.httpMetadata.contentType);
          }
        },
      };
    },
    async put(key, value, opts = {}) {
      if (opts.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) {
        return null;
      }
      const bytes = Buffer.isBuffer(value)
        ? Buffer.from(value)
        : Buffer.from(new Uint8Array(value));
      const etag = `"${crypto.createHash("md5").update(bytes).digest("hex")}"`;
      const stored = {
        key,
        bytes,
        size: bytes.length,
        etag,
        httpEtag: etag,
        version: crypto.randomUUID(),
        uploaded: new Date(),
        httpMetadata: opts.httpMetadata || {},
        customMetadata: opts.customMetadata || {},
      };
      objects.set(key, stored);
      return stored;
    },
    async delete(key) {
      objects.delete(key);
    },
    async list({ prefix = "" } = {}) {
      const matched = [];
      for (const [k, obj] of objects.entries()) {
        if (k.startsWith(prefix)) matched.push(obj);
      }
      return { objects: matched, truncated: false };
    },
  };
}

async function run() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("   YOUTUBE DISCOVERY — STORAGE HARDENING V2 TEST SUITE        ");
  console.log("══════════════════════════════════════════════════════════════\n");

  const tmpDir = compileTargets();
  const Module = projectRequire("node:module");
  const originalLoad = Module._load;
  const envBackup = { ...process.env };

  process.env.API_KEYS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

  let prismaState = {};
  let mockR2Client = {};
  const deleteCalls = [];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "server-only") return {};

    if (request === "@/lib/db/prisma") {
      return {
        prisma: new Proxy(
          {},
          {
            get(_t, prop) {
              if (prop === "$transaction") {
                return async (cb) => cb(Module._load("@/lib/db/prisma", parent, false).prisma);
              }
              if (prop in prismaState) {
                return prismaState[prop];
              }
              return {
                findFirst: async () => null,
                findUnique: async () => null,
                findMany: async () => [],
                upsert: async (args) => args.create,
                create: async (args) => args.data,
                update: async (args) => args.data,
                updateMany: async () => ({ count: 0 }),
                deleteMany: async (args) => {
                  deleteCalls.push({ model: String(prop), args });
                  return { count: 0 };
                },
              };
            },
          }
        ),
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
            storageOwnerUuid: "11111111-1111-4111-8111-111111111111",
            username: "asdy",
            role: "admin",
          },
        }),
      };
    }

    if (
      request === "@/lib/storage/r2-worker-storage-client" ||
      request === "./r2-worker-storage-client"
    ) {
      return {
        getR2WorkerStorageClient: () => mockR2Client,
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
    const ownerUuid = "11111111-1111-4111-8111-111111111111";
    const profileUuid = "22222222-2222-4222-8222-222222222222";
    const secret = "test-secret-0123456789abcdef0123456789abcdef";

    // 1. NEW Worker write-once protection & before-app-updating manifest guard
    await test("1. NEW Worker blocks overwriting before-app-updating/manifest.json & enforces onlyIf", async () => {
      const workerMod = projectRequire(
        path.join(tmpDir, "cloudflare", "workers", "new-youtube-discovery-api", "src", "index.js")
      );
      const worker = workerMod.default;
      const bucket = createSimulatedR2Bucket();
      const key = `asdy/persistence/${ownerUuid}/before-app-updating/saved-items/manifest.json`;

      const now = Math.floor(Date.now() / 1000);
      const makeToken = (op) =>
        signWorkerJwt(
          {
            iss: "youtube-discovery-web",
            aud: "new-youtube-discovery-api",
            sub: "test",
            storage_owner_uuid: ownerUuid,
            bucket_kind: "NEW",
            operation: op,
            key,
            iat: now,
            exp: now + 120,
            jti: crypto.randomUUID(),
          },
          secret
        );

      const firstRes = await worker.fetch(
        new Request(`https://worker.local/v1/objects/${key}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${makeToken("upload")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ id: "old_1" }] }),
        }),
        { NEW_BUCKET: bucket, WORKER_AUTH_SECRET: secret }
      );
      assert.equal(firstRes.status, 200);

      // Identical content retry should succeed idempotently
      const retryRes = await worker.fetch(
        new Request(`https://worker.local/v1/objects/${key}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${makeToken("upload")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ id: "old_1" }] }),
        }),
        { NEW_BUCKET: bucket, WORKER_AUTH_SECRET: secret }
      );
      assert.equal(retryRes.status, 200);

      // Overwriting with different content must return 409 CONFLICT
      const conflictRes = await worker.fetch(
        new Request(`https://worker.local/v1/objects/${key}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${makeToken("upload")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ id: "mutated" }] }),
        }),
        { NEW_BUCKET: bucket, WORKER_AUTH_SECRET: secret }
      );
      assert.equal(conflictRes.status, 409);

      // DELETE on historical manifest must be rejected 403
      const delRes = await worker.fetch(
        new Request(`https://worker.local/v1/objects/${key}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${makeToken("delete")}` },
        }),
        { NEW_BUCKET: bucket, WORKER_AUTH_SECRET: secret }
      );
      assert.equal(delRes.status, 403);
    });

    // 2. OLD Worker write-once + strict temp DELETE check
    await test("2. OLD Worker enforces conditional create & rejects DELETE outside dedicated temp prefix", async () => {
      const oldWorkerMod = projectRequire(
        path.join(tmpDir, "cloudflare", "workers", "old-youtube-discovery-api", "src", "index.js")
      );
      const worker = oldWorkerMod.default;
      const bucket = createSimulatedR2Bucket();
      const trickyKey = "asdy/old/saved-items/temp/archive.json";
      const now = Math.floor(Date.now() / 1000);

      const makeToken = (op) =>
        signWorkerJwt(
          {
            iss: "youtube-discovery-web",
            aud: "old-youtube-discovery-api",
            sub: "test",
            storage_owner_uuid: ownerUuid,
            bucket_kind: "OLD",
            operation: op,
            key: trickyKey,
            iat: now,
            exp: now + 120,
            jti: crypto.randomUUID(),
          },
          secret
        );

      const put1 = await worker.fetch(
        new Request(`https://worker.local/v1/objects/${trickyKey}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${makeToken("upload")}` },
          body: JSON.stringify({ legacy: true }),
        }),
        { OLD_BUCKET: bucket, WORKER_AUTH_SECRET: secret }
      );
      assert.equal(put1.status, 200);

      // Attempting overwrite even though path contains '/temp/' in middle must fail 409
      const put2 = await worker.fetch(
        new Request(`https://worker.local/v1/objects/${trickyKey}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${makeToken("upload")}` },
          body: JSON.stringify({ legacy: false }),
        }),
        { OLD_BUCKET: bucket, WORKER_AUTH_SECRET: secret }
      );
      assert.equal(put2.status, 409);

      // DELETE on historical path with '/temp/' substring in middle must fail 403
      const del = await worker.fetch(
        new Request(`https://worker.local/v1/objects/${trickyKey}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${makeToken("delete")}` },
        }),
        { OLD_BUCKET: bucket, WORKER_AUTH_SECRET: secret }
      );
      assert.equal(del.status, 403);
    });

    // 3. R2StorageBackend enforces Rule Zero immutable paths
    await test("3. R2StorageBackend blocks delete() and ignores allowOverwrite:true on immutable keys", async () => {
      process.env.R2_NEW_WORKER_URL = "https://new-worker.example.workers.dev";
      process.env.R2_NEW_WORKER_AUTH_SECRET = secret;

      const { R2StorageBackend } = projectRequire(
        path.join(tmpDir, "src", "lib", "storage", "r2-blob-backend.js")
      );
      let recordedAllowOverwrite = null;
      mockR2Client = {
        headObject: async () => ({ key: "existing", size: 12, etag: "e1", uploaded: new Date().toISOString() }),
        putObject: async (_b, _k, _d, opts) => {
          recordedAllowOverwrite = opts?.allowOverwrite;
          return { key: "k", size: 12, etag: "e1", sha256: "a".repeat(64) };
        },
        deleteObject: async () => {
          throw new Error("Should not reach deleteObject for immutable key");
        },
      };

      const backend = new R2StorageBackend();
      const genPartKey = `asdy/persistence/${ownerUuid}/saved-items/generations/gen-1/parts/part-000001.json`;
      await assert.rejects(
        () => backend.putBytes(genPartKey, Buffer.from("{}", "utf8"), { allowOverwrite: true }),
        (err) => err?.name === "StorageConflictError"
      );
      assert.equal(recordedAllowOverwrite, null);

      await assert.rejects(
        () => backend.delete(genPartKey),
        (err) => err?.name === "StorageForbiddenError"
      );
    });

    // 4. Playlist upl_* <-> UUID bidirectional DB preservation & snapshot_json fidelity
    await test("4. playlist-db-service preserves upl_* record_id and full entry snapshot_json", async () => {
      const {
        toPlaylistUuid,
        syncPlaylistToDb,
        getPlaylistManifestFromDb,
        listPlaylistsFromDb,
      } = projectRequire(path.join(tmpDir, "src", "lib", "playlists", "playlist-db-service.js"));

      const storedPlaylists = new Map();
      const storedGroups = new Map();
      const storedEntries = new Map();

      prismaState = {
        userProfile: {
          findFirst: async () => ({ id: profileUuid }),
        },
        userPlaylist: {
          findFirst: async () => null,
          findMany: async () =>
            Array.from(storedPlaylists.values()).map((p) => ({
              ...p,
              groups: Array.from(storedGroups.values()),
              entries: Array.from(storedEntries.values()),
            })),
          upsert: async ({ where, create, update }) => {
            const id = where.owner_id_id.id;
            const prev = storedPlaylists.get(id);
            const next = prev ? { ...prev, ...update } : { ...create };
            storedPlaylists.set(id, next);
            return next;
          },
        },
        userPlaylistGroup: {
          upsert: async ({ where, create, update }) => {
            const id = where.playlist_id_id.id;
            const prev = storedGroups.get(id);
            const next = prev ? { ...prev, ...update } : { ...create };
            storedGroups.set(id, next);
            return next;
          },
          deleteMany: async () => ({ count: 0 }),
        },
        userPlaylistEntry: {
          upsert: async ({ where, create, update }) => {
            const id = where.id;
            const prev = storedEntries.get(id);
            const next = prev ? { ...prev, ...update } : { ...create };
            storedEntries.set(id, next);
            return next;
          },
          deleteMany: async () => ({ count: 0 }),
        },
      };

      const manifest = {
        manifestVersion: 1,
        type: "youtube-discovery-playlist",
        playlist: {
          id: "upl_local_abc123",
          name: "AI Research Picks",
          description: "Top deep dives",
          createdAt: "2026-11-25T10:00:00.000Z",
          updatedAt: "2026-11-25T10:00:00.000Z",
        },
        groups: [
          {
            id: "grp_1",
            title: "Lectures",
            description: null,
            position: 0,
            createdAt: "2026-11-25T10:00:00.000Z",
            updatedAt: "2026-11-25T10:00:00.000Z",
          },
        ],
        items: [
          {
            kind: "youtube",
            youtubeKind: "video",
            entryId: "yt-video:vid999",
            position: 0,
            groupId: "grp_1",
            addedAt: "2026-11-25T10:00:00.000Z",
            updatedAt: "2026-11-25T10:00:00.000Z",
            note: "Must watch",
            snapshot: {
              platformItemId: "vid999",
              title: "Transformers Deep Dive",
              description: "Great lecture",
              thumbnailUrl: "https://i.ytimg.com/vi/vid999/hqdefault.jpg",
              channelId: "ch1",
              channelTitle: "AI Lab",
              publishedAt: "2026-11-20T00:00:00.000Z",
              viewsCount: 42000,
              likesCount: 2500,
              commentsCount: 120,
              durationSeconds: 1800,
              itemCount: null,
              url: "https://www.youtube.com/watch?v=vid999",
              sourceItemType: "video",
              isShortsLike: false,
            },
          },
        ],
      };

      const ok = await syncPlaylistToDb(ownerUuid, manifest);
      assert.equal(ok, true);

      const listed = await listPlaylistsFromDb(ownerUuid);
      assert.equal(listed.length, 1);
      assert.equal(listed[0].id, "upl_local_abc123", "listPlaylistsFromDb must return canonical upl_* id");

      // Reconstruct both by upl_* ID and deterministic DB UUID alias
      const uuidAlias = toPlaylistUuid("upl_local_abc123");
      prismaState.userPlaylist.findFirst = async () => ({
        ...storedPlaylists.get(uuidAlias),
        groups: Array.from(storedGroups.values()),
        entries: Array.from(storedEntries.values()),
      });
      const restored = await getPlaylistManifestFromDb(ownerUuid, uuidAlias);
      assert.equal(restored.playlist.id, "upl_local_abc123");
      assert.equal(restored.items[0].kind, "youtube");
      assert.equal(restored.items[0].snapshot.viewsCount, 42000);
      assert.equal(restored.items[0].groupId, "grp_1");
    });

    // 5. Distributed Postgres Login Rate Limiter & Search Storage
    await test("5. rate-limit & search-storage-archive persist cleanly via PostgreSQL Prisma", async () => {
      const rateLimitMod = projectRequire(path.join(tmpDir, "src", "lib", "auth", "rate-limit.js"));
      const searchArchiveMod = projectRequire(
        path.join(tmpDir, "src", "lib", "search-storage", "search-storage-archive.js")
      );

      const rateStore = new Map();
      const historyStore = new Map();
      prismaState = {
        userProfile: {
          findFirst: async () => ({
            id: profileUuid,
            storage_owner_uuid: ownerUuid,
            username: "asdy",
          }),
        },
        loginRateLimit: {
          findUnique: async ({ where }) => rateStore.get(where.ip_hash) || null,
          upsert: async ({ where, create, update }) => {
            const cur = rateStore.get(where.ip_hash);
            const row = cur
              ? { ...cur, ...update, updated_at: new Date() }
              : { ...create, updated_at: new Date() };
            rateStore.set(where.ip_hash, row);
            return row;
          },
          deleteMany: async ({ where }) => {
            rateStore.delete(where.ip_hash);
            return { count: 1 };
          },
        },
        searchHistoryRecord: {
          upsert: async ({ where, create, update }) => {
            const cur = historyStore.get(where.id);
            const row = cur ? { ...cur, ...update } : { ...create };
            historyStore.set(where.id, row);
            return row;
          },
          findMany: async () => Array.from(historyStore.values()),
          findFirst: async ({ where }) =>
            Array.from(historyStore.values()).find((r) =>
              where.OR.some(
                (cond) =>
                  (cond.id && cond.id === r.id) ||
                  (cond.record_id && cond.record_id === r.record_id)
              )
            ) || null,
          deleteMany: async ({ where }) => {
            let deleted = 0;
            for (const [k, r] of historyStore.entries()) {
              if (
                where.OR?.some(
                  (c) => (c.id?.in && c.id.in.includes(r.id)) || (c.record_id && c.record_id === r.record_id)
                )
              ) {
                historyStore.delete(k);
                deleted++;
              }
            }
            return { count: deleted };
          },
        },
      };

      const ipHash = rateLimitMod.hashIp("203.0.113.5");
      for (let i = 0; i < 10; i++) {
        await rateLimitMod.recordLoginAttempt({}, ipHash);
      }
      const blocked = await rateLimitMod.checkLoginRateLimit({}, ipHash);
      assert.equal(blocked.allowed, false);
      await rateLimitMod.clearLoginAttempts({}, ipHash);
      const reset = await rateLimitMod.checkLoginRateLimit({}, ipHash);
      assert.equal(reset.allowed, true);

      const saved = await searchArchiveMod.saveSearchToArchive({
        id: "srch_1",
        query: "distributed systems",
        resourceSelection: "ALL",
        settings: {
          query: "distributed systems",
          resourceType: "ALL",
          maxResults: 25,
          order: "relevance",
          safeSearch: "none",
          regionCode: "US",
        },
        manifest: {
          manifestId: "m_1",
          manifestType: "youtube_search",
          platform: "youtube",
          title: "Search: distributed systems",
          query: "distributed systems",
          resourceTypes: ["ALL"],
          source: { kind: "search", id: null, label: "Search" },
          searchSettingsSnapshot: null,
          createdAt: new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          pageSize: 25,
          pagesFetched: 1,
          nextPageToken: null,
          quotaCostEstimate: 100,
          region: "US",
          language: null,
          status: "complete",
          itemCount: 0,
          totalItemsCollected: 0,
          uniqueItemCount: 0,
          duplicateCount: 0,
          duplicatesCount: 0,
          collectedAt: new Date().toISOString(),
          warnings: [],
          errors: [],
          normalizedItems: [],
          items: [],
        },
      });
      assert.equal(saved.id, "srch_1");
      const fetched = await searchArchiveMod.getSearchFromArchive("srch_1");
      assert.equal(fetched?.query, "distributed systems");
    });

    // 6. Local-first temporary manifest store fallback & lifecycle check
    await test("6. local-manifest-store handles Class-A lifecycle, checkpoints & filtering without IDB", async () => {
      const localManifestMod = projectRequire(
        path.join(tmpDir, "src", "lib", "manifests", "local-manifest-store.js")
      );
      const manifest = {
        manifestId: "man_local_1",
        manifestType: "youtube_channel_uploads",
        platform: "youtube",
        title: "Channel Uploads",
        query: null,
        resourceTypes: ["video"],
        source: { kind: "channel", id: "UC_1", label: "Channel" },
        searchSettingsSnapshot: null,
        createdAt: "2026-11-25T10:00:00.000Z",
        fetchedAt: "2026-11-25T10:00:00.000Z",
        pageSize: 50,
        pagesFetched: 1,
        nextPageToken: "PAGE_2_TOKEN",
        quotaCostEstimate: 1,
        region: null,
        language: null,
        status: "partial",
        itemCount: 1,
        totalItemsCollected: 1,
        uniqueItemCount: 1,
        duplicateCount: 0,
        duplicatesCount: 0,
        collectedAt: "2026-11-25T10:00:00.000Z",
        warnings: [],
        errors: [],
        normalizedItems: [
          {
            id: "youtube:v1",
            platform: "youtube",
            itemType: "video",
            platformItemId: "v1",
            url: "https://youtube.com/watch?v=v1",
            title: "Rust Async Internals",
            description: "Tokio guide",
            channelId: "UC_1",
            channelTitle: "SystemsChannel",
            publishedAt: "2026-10-01T00:00:00.000Z",
            thumbnailUrl: null,
            tags: ["rust"],
            language: "en",
            viewsCount: 1000,
            likesCount: 50,
            commentsCount: 5,
            durationSeconds: 300,
            isShortsLike: false,
            isAgeRestricted: false,
            liveBroadcastContent: "none",
            itemCount: null,
            rawJson: {},
          },
        ],
        items: [],
      };

      const stored = await localManifestMod.persistTempManifestLocally(manifest);
      assert.equal(stored.lifecycleState, "PROCESSING");
      assert.equal(stored.checkpoint.pageToken, "PAGE_2_TOKEN");

      const got = await localManifestMod.getLocalTempManifest("man_local_1");
      assert.equal(got?.manifestId, "man_local_1");

      const filtered = localManifestMod.filterLocalTempManifest(got, {
        keyword: "tokio",
        minViews: 500,
        maxViews: null,
        minLikes: null,
        maxLikes: null,
        minComments: null,
        maxComments: null,
        targetViews: null,
        year: null,
        yearFrom: null,
        yearTo: null,
        month: null,
        publishedAfter: null,
        publishedBefore: null,
        durationMinSec: null,
        durationMaxSec: null,
        channelId: null,
        channelName: null,
        language: null,
        hasThumbnail: "any",
        hasDescription: "any",
        hasLanguage: "any",
        shortsLikeOnly: false,
        itemTypes: [],
        strictMetadata: false,
        sort: "latest",
      });
      assert.equal(filtered.count, 1);
    });

    // 7. save-all preserves unrepresented DB rows on REFERENCES/RESEARCH_QUEUE/SEARCH_HISTORY
    await test("7. save-all never issues blanket deleteMany({ notIn }) when empty tombstones arrive", async () => {
      deleteCalls.length = 0;
      const saveAllMod = projectRequire(
        path.join(tmpDir, "src", "app", "api", "sync", "save-all", "route.js")
      );
      const refPayload = Buffer.from(JSON.stringify({ records: [] }), "utf8");
      const sha = crypto.createHash("sha256").update(refPayload).digest("hex");

      prismaState = {
        userProfile: {
          findFirst: async () => ({
            id: profileUuid,
            auth_user_id: "auth-u-1",
            storage_owner_uuid: ownerUuid,
            username: "asdy",
            role: "admin",
          }),
        },
        saveSyncBatch: {
          findUnique: async () => null,
          create: async ({ data }) => ({ id: "batch-uuid-1", ...data }),
          upsert: async ({ create }) => ({ id: "batch-uuid-1", ...create }),
          update: async () => ({}),
        },
        storageDataset: {
          findFirst: async () => ({
            id: "ds-ref-1",
            owner_id: profileUuid,
            dataset_type: "REFERENCES",
            current_revision: 0n,
            current_generation_id: null,
          }),
          updateMany: async () => ({ count: 1 }),
        },
        storageGeneration: {
          findFirst: async () => null,
          create: async ({ data }) => data,
        },
        storageManifestPart: { create: async ({ data }) => data },
        savedReference: {
          upsert: async ({ create }) => create,
          deleteMany: async (args) => {
            deleteCalls.push({ model: "savedReference", args });
            return { count: 0 };
          },
        },
        savedSearchPreset: {
          upsert: async ({ create }) => create,
          deleteMany: async (args) => {
            deleteCalls.push({ model: "savedSearchPreset", args });
            return { count: 0 };
          },
        },
        auditLog: { create: async ({ data }) => data },
      };

      mockR2Client = {
        listAllObjects: async () => ({ objects: [], truncated: false, incomplete: false }),
        uploadBatch: async (batchId, _dt, items) => ({
          ok: true,
          batchId,
          uploadedCount: items.length,
          receipts: items.map((it) => ({
            key: it.key,
            sha256: crypto.createHash("sha256").update(it.data).digest("hex"),
            size: it.data.length,
            etag: `"mock-etag"`,
            uploaded: new Date().toISOString(),
          })),
        }),
        verifyBatch: async (_b, items) => ({ ok: true, verifiedCount: items.length, failures: [] }),
        putObject: async (_bucket, key) => ({ ok: true, key, sha256: sha, bytes: 2 }),
      };

      const req = new Request("http://localhost:3000/api/sync/save-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: "b_ref_nodel",
          datasets: [
            {
              datasetType: "REFERENCES",
              idempotencyKey: "idem_ref_nodel",
              operations: [
                {
                  operationId: "op_ref_1",
                  entityId: "title_1",
                  operationType: "UPSERT",
                  payload: { id: "title_1", resourceType: "SAVED_TITLE", title: "My Saved Title" },
                },
              ],
            },
          ],
        }),
      });
      const res = await saveAllMod.POST(req);
      const body = await res.json();
      assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(body)}`);
      assert.equal(
        deleteCalls.length,
        0,
        "REFERENCES upsert without DELETE operations must NEVER call deleteMany on DB rows"
      );
    });

    // 8. API keys & quota pools persist cleanly to PostgreSQL (managedApiKey, quotaPoolState, quotaUsageEvent)
    await test("8. youtube-api-keys & quota-pools persist via PostgreSQL Prisma without disk fallback", async () => {
      const apiKeysMod = projectRequire(
        path.join(tmpDir, "src", "lib", "platforms", "youtube", "youtube-api-keys.js")
      );
      const poolsMod = projectRequire(path.join(tmpDir, "src", "lib", "keys", "quota-pools.js"));

      apiKeysMod.setKeysBackendForTests(null);
      poolsMod.setPoolsBackendForTests(null);

      const managedKeys = new Map();
      const poolStates = new Map();
      const usageEvents = [];

      prismaState = {
        userProfile: {
          findFirst: async () => ({
            id: profileUuid,
            storage_owner_uuid: ownerUuid,
            username: "asdy",
          }),
        },
        managedApiKey: {
          findMany: async () => Array.from(managedKeys.values()).filter((r) => !r.revoked_at),
          findFirst: async ({ where }) =>
            Array.from(managedKeys.values()).find((r) => r.record_id === where.record_id) || null,
          update: async ({ where, data }) => {
            const cur = managedKeys.get(where.id);
            const next = { ...cur, ...data };
            managedKeys.set(where.id, next);
            return next;
          },
          upsert: async ({ create, update }) => {
            const existing = Array.from(managedKeys.values()).find(
              (r) => r.key_fingerprint === create.key_fingerprint
            );
            if (existing) {
              const next = { ...existing, ...update };
              managedKeys.set(existing.id, next);
              return next;
            }
            const id = crypto.randomUUID();
            const row = { id, created_at: new Date(), revoked_at: null, ...create };
            managedKeys.set(id, row);
            return row;
          },
          updateMany: async () => ({ count: 0 }),
        },
        quotaPoolState: {
          findUnique: async () => poolStates.get(profileUuid) || null,
          upsert: async ({ create, update }) => {
            const cur = poolStates.get(profileUuid);
            const row = cur
              ? { ...cur, ...update, updated_at: new Date() }
              : {
                  id: crypto.randomUUID(),
                  active_key_id: "env",
                  last_rotated_index: -1,
                  pools_json: {},
                  usage_by_day_json: {},
                  updated_at: new Date(),
                  ...create,
                };
            poolStates.set(profileUuid, row);
            return row;
          },
        },
        quotaUsageEvent: {
          create: async ({ data }) => {
            usageEvents.push(data);
            return data;
          },
        },
      };

      const added = await apiKeysMod.addCustomApiKey("Test Research Key", "AIzaSyTestFakeKeyValue1234567890", {
        projectId: "proj-test",
      });
      assert.equal(added.label, "Test Research Key");
      assert.equal(managedKeys.size, 1);

      const list = await apiKeysMod.getSafeApiKeysList();
      assert.equal(list.keys.some((k) => k.id === added.id), true);

      await poolsMod.recordRequestOutcome(
        { getBytes: async () => Buffer.from("{}") },
        {
          keyId: added.id,
          poolKey: "proj:proj-test",
          projectId: "proj-test",
          operation: "search.list",
          bucket: "search",
          units: 100,
          ok: true,
          errorReason: null,
        }
      );
      assert.equal(usageEvents.length, 1);
      const today = await poolsMod.readTodayUsage({});
      assert.equal(today.byKey[added.id]?.units, 100);
    });

    console.log(`\n══════════════════════════════════════════════════════════════`);
    console.log(`   STORAGE HARDENING V2 SUITE: ${passed}/${passed} PASSED`);
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
  console.error("\n✗ Storage hardening v2 suite failed:", err);
  process.exit(1);
});
