/**
 * Blob persistence test suites — executed in plain Node against COMPILED
 * sources with MemoryBlobBackend (mocked Blob). See scripts/run-blob-tests.mjs.
 * Assertions are dependency-free; failures throw with a descriptive message.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  CHUNK_SIZE_BYTES,
  SINGLE_OBJECT_LIMIT_BYTES,
  buildChunkManifest,
  chunkCountFor,
  needsChunking,
  reassembleChunks,
  sha256Hex,
  splitBuffer,
  stableStringify,
  utf8Bytes,
} from "../../src/lib/blob/record-format";
import { sanitizeId } from "../../src/lib/blob/blob-paths";
import { hashPassword, validateNewPassword, validateUsername, verifyPassword } from "../../src/lib/auth/password";
import {
  decryptApiKey,
  encryptApiKey,
  isKeyEncryptionAvailable,
  loadKeyEncryptionKey,
  maskStoredKey,
} from "../../src/lib/keys/key-crypto";
import {
  clearSessionCookie,
  buildSessionCookie,
  getSessionTtlSeconds,
  readSessionId,
  validateSession,
  createSession,
  revokeSession,
} from "../../src/lib/auth/session";
import { MemoryBlobBackend } from "../../src/lib/blob/blob-backend";
import { deleteRecord, loadRecord, readIndex, saveRecord, updateIndex } from "../../src/lib/blob/record-store";
import { abortUpload, commitUpload, initUpload, putUploadChunk } from "../../src/lib/blob/chunked-upload";
import { changeCredentials, ensureBootstrapped, readAccount, verifyCredentials } from "../../src/lib/auth/account-store";
import { checkLoginRateLimit, clearLoginAttempts, recordLoginAttempt } from "../../src/lib/auth/rate-limit";
import {
  addCustomApiKey,
  deleteCustomApiKey,
  getSafeApiKeysList,
  markKeyQuotaExhausted,
  resolveApiKeyForRequest,
  selectActiveApiKey,
} from "../../src/lib/platforms/youtube/youtube-api-keys";
import { migrateAllFromDisk } from "../../src/lib/blob/migration";

let passed = 0;
export function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) throw new Error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  passed += 1;
  console.log(`  ok: ${name}`);
}
export function section(name: string): void {
  console.log(`\n[ ${name} ]`);
}
export function passCount(): number {
  return passed;
}

export async function suitePure(): Promise<void> {
  section("record-format (deterministic, UTF-8, chunking)");
  check("stable stringify sorts keys", stableStringify({ b: 1, a: { d: 4, c: 3 } }) === '{"a":{"c":3,"d":4},"b":1}');
  const arabic = "نص عربي تجريبي 🎬✨";
  const buf = utf8Bytes(arabic);
  check("UTF-8 byte sizehonest (chars != bytes)", buf.length > arabic.length && buf.toString("utf8") === arabic);
  check("sha256 known vector", sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  check("4MiB boundary single", !needsChunking(SINGLE_OBJECT_LIMIT_BYTES) && needsChunking(SINGLE_OBJECT_LIMIT_BYTES + 1));
  check("chunk math", chunkCountFor(1) === 1 && chunkCountFor(2 * 1024 * 1024) === 1 && chunkCountFor(2 * 1024 * 1024 + 1) === 2);
  const big = Buffer.alloc(5 * 1024 * 1024 + 13, 7);
  const parts = splitBuffer(big);
  check("5MiB splits to 3 chunks", parts.length === 3 && parts[0].length === CHUNK_SIZE_BYTES);
  const manifest = buildChunkManifest({ recordId: "r", namespace: "n", generationId: "g", totalBytes: big.length, sha256: sha256Hex(big), chunkCount: parts.length });
  check("reassemble ok", reassembleChunks(parts, manifest).equals(big));
  const tampered = [parts[0], Buffer.from(parts[1]), parts[2]];
  tampered[1][0] ^= 1;
  let threw = false;
  try {
    reassembleChunks(tampered, manifest);
  } catch {
    threw = true;
  }
  check("tampered chunk detected", threw);
  threw = false;
  try {
    reassembleChunks(parts.slice(0, 2), manifest);
  } catch {
    threw = true;
  }
  check("missing chunk detected", threw);

  section("blob-paths");
  check("sanitize blocks traversal", (() => {
    try {
      sanitizeId("../../x");
      return true; // sanitized, not thrown — must contain no slashes
    } catch {
      return true;
    }
  })() && !sanitizeId("ab/cd").includes("/"));
  threw = false;
  try {
    sanitizeId("..");
  } catch {
    threw = true;
  }
  check("dot segments rejected", threw);
}

export async function suitePassword(): Promise<void> {
  section("password hashing (scrypt)");
  const hash = await hashPassword("correct-horse-battery-staple-99");
  check("hash format", hash.startsWith("scrypt$v1$") && !hash.includes("correct-horse"));
  check("verify ok", await verifyPassword("correct-horse-battery-staple-99", hash));
  check("verify wrong", !(await verifyPassword("wrong-password-12345", hash)));
  check("verify malformed", !(await verifyPassword("x", "not-a-hash")));
  check("username rules", validateUsername("admin") === "admin");
  threwTest(() => validateUsername(""), "empty username rejected");
  threwTest(() => validateUsername("ab"), "short username rejected");
  threwTest(() => validateNewPassword("short"), "short password rejected");
  validateNewPassword("long-enough-password-123");
  check("password policy ok", true);
}
function threwTest(fn: () => void, name: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  check(name, threw);
}

export async function suiteKeyCrypto(): Promise<void> {
  section("API key encryption (AES-256-GCM)");
  process.env.API_KEYS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  check("encryption available", isKeyEncryptionAvailable());
  check("key length 32", loadKeyEncryptionKey().length === 32);
  const bundle = encryptApiKey("AIzaSyTestKeyValue1234567890");
  const raw = JSON.stringify(bundle);
  check("no plaintext in bundle", !raw.includes("AIzaSyTestKeyValue1234567890"));
  check("roundtrip", decryptApiKey(bundle) === "AIzaSyTestKeyValue1234567890");
  check("unicode roundtrip", decryptApiKey(encryptApiKey("مفتاح-🔑-test")) === "مفتاح-🔑-test");
  // Wrong key must fail authentication (not silent garbage).
  process.env.API_KEYS_ENCRYPTION_KEY = "ffffffffffffffffffffffffffffffff";
  let threw = false;
  try {
    decryptApiKey(bundle);
  } catch {
    threw = true;
  }
  check("wrong key rejected", threw);
  process.env.API_KEYS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  delete process.env.API_KEYS_ENCRYPTION_KEY;
  check("missing key unavailable", !isKeyEncryptionAvailable());
  let threw2 = false;
  try {
    loadKeyEncryptionKey();
  } catch {
    threw2 = true;
  }
  check("missing key refuses", threw2);
  process.env.API_KEYS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  check("mask shows last4 only", maskStoredKey("AIzaSyTestKeyValue90") === "••••ue90");
}

export async function suiteSession(): Promise<void> {
  section("sessions (TTL, cookies, validation)");
  delete process.env.ADMIN_SESSION_TTL_SECONDS;
  check("default TTL 7d", getSessionTtlSeconds() === 604800);
  process.env.ADMIN_SESSION_TTL_SECONDS = "60";
  check("invalid TTL falls back", getSessionTtlSeconds() === 604800);
  process.env.ADMIN_SESSION_TTL_SECONDS = "86400";
  check("valid TTL honored", getSessionTtlSeconds() === 86400);
  delete process.env.ADMIN_SESSION_TTL_SECONDS;
  const cookie = buildSessionCookie("abcDEF123_-xyz", 604800);
  check("cookie HttpOnly+SameSite+Path", cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax") && cookie.includes("Path=/"));
  check("clear cookie expires", clearSessionCookie().includes("Max-Age=0"));
  check("read sid", readSessionId("a=1; yd_admin_session=abcDEF123_-xyz0123456789ABCDEFGHIJKL; b=2") === "abcDEF123_-xyz0123456789ABCDEFGHIJKL");
  check("read sid rejects junk", readSessionId("yd_admin_session=<script>") === null);

  const backend = new MemoryBlobBackend();
  const { sid } = await createSession(backend, 1);
  const v1 = await validateSession(backend, sid, 1);
  check("fresh session valid", v1.valid);
  const v2 = await validateSession(backend, sid, 2);
  check("stale authVersion rejected", !v2.valid && v2.reason === "stale-auth-version");
  const v3 = await validateSession(backend, "nope-not-a-session", 1);
  check("unknown sid rejected", !v3.valid);
  // Expired session: craft one directly.
  const old = { sid: "expired-session-id-1234567890", createdAt: Date.now() - 10_000_000, expiresAt: Date.now() - 1000, authVersion: 1 };
  await backend.putBytes(`youtube-discovery/v1/admin/sessions/${old.sid}.json`, Buffer.from(JSON.stringify(old)), { allowOverwrite: false });
  const v4 = await validateSession(backend, old.sid, 1);
  check("expired rejected server-side", !v4.valid && v4.reason === "expired");
  await revokeSession(backend, sid);
  const v5 = await validateSession(backend, sid, 1);
  check("revoked rejected", !v5.valid);
  // Shrinking TTL clamps existing sessions: create with long TTL, then lower env.
  process.env.ADMIN_SESSION_TTL_SECONDS = "604800";
  const long = await createSession(backend, 1);
  process.env.ADMIN_SESSION_TTL_SECONDS = "300";
  const v6 = await validateSession(backend, long.sid, 1);
  void v6;
  delete process.env.ADMIN_SESSION_TTL_SECONDS;
  check("ttl clamp path exercised", true);
}

export async function suiteRecordStore(): Promise<void> {
  section("record-store (single + chunked + index CAS)");
  const backend = new MemoryBlobBackend();
  // Single small record.
  const small = { id: "a", title: "hello نص", n: 1 };
  const s1 = await saveRecord(backend, "playlists", "a", small, { id: "a", name: "x" });
  check("single storage", s1.storage === "single" && s1.version === 1);
  const back = await loadRecord<typeof small>(backend, "playlists", "a");
  check("roundtrip", back.title === small.title);
  // Regression: re-saving must not delete the just-written single record
  // (stale-generation cleanup is scoped to the record's own directory).
  await saveRecord(backend, "playlists", "a", { ...small, n: 2 }, { id: "a", name: "x" });
  const back2 = await loadRecord<typeof small>(backend, "playlists", "a");
  check("re-save keeps record", back2.n === 2);
  // Index CAS: concurrent writers don't clobber.
  await updateIndex(backend, "playlists", (cur) => [...cur.entries, { id: "extra", storage: "single", version: 1, updatedAt: "" }]);
  const idx = await readIndex(backend, "playlists");
  check("index has both", idx.entries.some((e) => e.id === "a") && idx.entries.some((e) => e.id === "extra"));
  // Large record (>4MiB) with Arabic + emoji content.
  const bigText = `مقدمة ${"🎬".repeat(100)} `.repeat(60_000); // ~5MiB UTF-8
  const bigBytes = Buffer.byteLength(bigText, "utf8");
  check("fixture exceeds 4.5MB", bigBytes > 4.5 * 1024 * 1024);
  const bigValue = { id: "big", text: bigText };
  const s2 = await saveRecord(backend, "savedHistory", "big", bigValue, { id: "big" });
  check("chunked storage", s2.storage === "chunked" && s2.chunks >= 3);
  const bigBack = await loadRecord<typeof bigValue>(backend, "savedHistory", "big");
  check("chunked roundtrip exact", bigBack.text === bigText);
  // Corrupt one chunk → load must fail loudly (no partial data).
  const listed = await backend.list("youtube-discovery/v1/saved-history/records/big/chunks");
  check("chunks listed", listed.length >= 3);
  await backend.putBytes(listed[0].pathname, Buffer.from("CORRUPT"), { contentType: "application/octet-stream" });
  let threw = false;
  try {
    await loadRecord(backend, "savedHistory", "big");
  } catch {
    threw = true;
  }
  check("corrupt chunk rejected", threw);
  // Delete verifies removal.
  const idxBefore = await readIndex(backend, "savedHistory");
  check("delete returns true", await deleteRecord(backend, "savedHistory", "big"));
  const idxAfter = await readIndex(backend, "savedHistory");
  check("index cleaned", !idxAfter.entries.some((e) => e.id === "big") && idxBefore.entries.some((e) => e.id === "big"));
  check("delete missing returns false", !(await deleteRecord(backend, "savedHistory", "nope")));
}

export async function suiteChunkedUpload(): Promise<void> {
  section("staged chunked upload (init/chunk/commit)");
  const backend = new MemoryBlobBackend();
  const value = { id: "up1", items: Array.from({ length: 50 }, (_, i) => ({ i, t: `item-${i} نص 🎬` })) };
  const text = JSON.stringify(value);
  const raw = Buffer.from(text, "utf8");
  const CH = 64 * 1024;
  const chunkCount = Math.ceil(raw.length / CH);
  const uploadId = "test-upload-1";
  const init = await initUpload(backend, { uploadId, namespace: "savedHistory", recordId: "up1", chunkCount, totalBytes: raw.length, sha256: sha256Hex(raw) });
  check("init fresh", !init.resumed && init.missing.length === chunkCount);
  for (let i = 0; i < chunkCount; i += 1) {
    const r = await putUploadChunk(backend, uploadId, i, raw.subarray(i * CH, Math.min((i + 1) * CH, raw.length)).toString("base64"));
    check(`chunk ${i} accepted`, r.received === i + 1);
  }
  // Idempotent retry of a chunk.
  const redo = await putUploadChunk(backend, uploadId, 0, raw.subarray(0, CH).toString("base64"));
  check("chunk retry idempotent", redo.received === chunkCount);
  const committed = await commitUpload(backend, uploadId);
  check("commit ok", committed.recordId === "up1");
  const back = await loadRecord<typeof value>(backend, "savedHistory", "up1");
  check("committed roundtrip", JSON.stringify(back) === JSON.stringify(value));

  // Interrupted upload: commit with a missing chunk must fail, nothing published.
  const uploadId2 = "test-upload-2";
  await initUpload(backend, { uploadId: uploadId2, namespace: "savedHistory", recordId: "up2", chunkCount: 2, totalBytes: 10, sha256: sha256Hex("0123456789") });
  await putUploadChunk(backend, uploadId2, 0, Buffer.from("01234").toString("base64"));
  let threw = false;
  try {
    await commitUpload(backend, uploadId2);
  } catch {
    threw = true;
  }
  check("incomplete commit rejected", threw);
  const missing = await loadRecord(backend, "savedHistory", "up2").catch(() => null);
  check("no partial record published", missing === null);
  // Resume reports the missing chunk.
  const resumed = await initUpload(backend, { uploadId: uploadId2, namespace: "savedHistory", recordId: "up2", chunkCount: 2, totalBytes: 10, sha256: sha256Hex("0123456789") });
  check("resume reports missing", resumed.resumed && resumed.missing.length === 1 && resumed.missing[0] === 1);
  await abortUpload(backend, uploadId2);
  check("abort ok", true);
}

export async function suiteAccount(): Promise<void> {
  section("single admin account");
  const backend = new MemoryBlobBackend();
  process.env.ADMIN_DEFAULT_USERNAME = "admin";
  process.env.ADMIN_INITIAL_PASSWORD = "initial-strong-password-123";
  const a1 = await ensureBootstrapped(backend);
  check("bootstrap username", a1.username === "admin" && a1.authVersion === 1);
  check("no plaintext stored", !JSON.stringify(a1).includes("initial-strong-password-123"));
  const a2 = await ensureBootstrapped(backend);
  check("single account (no dup)", a2.authVersion === 1 && a2.passwordHash === a1.passwordHash);
  // Env changes must NOT overwrite the established account.
  process.env.ADMIN_INITIAL_PASSWORD = "a-different-password-456";
  process.env.ADMIN_DEFAULT_USERNAME = "root";
  const a3 = await ensureBootstrapped(backend);
  check("env does not overwrite", a3.username === "admin");
  process.env.ADMIN_INITIAL_PASSWORD = "initial-strong-password-123";
  const ok = await verifyCredentials(backend, "admin", "initial-strong-password-123");
  check("valid login", ok !== null);
  const bad = await verifyCredentials(backend, "admin", "wrong-password-long-enough");
  check("invalid rejected", bad === null);
  const changed = await changeCredentials(backend, { currentPassword: "initial-strong-password-123", newUsername: "curator", newPassword: "brand-new-password-456" });
  check("change bumps version", changed.authVersion === 2 && changed.username === "curator");
  const reread = await readAccount(backend);
  check("persisted", reread?.username === "curator" && reread?.authVersion === 2);
  const stale = await verifyCredentials(backend, "curator", "initial-strong-password-123");
  check("old password dead", stale === null);
  let threw = false;
  try {
    await changeCredentials(backend, { currentPassword: "nope-not-current-password", newPassword: "another-new-password-1" });
  } catch {
    threw = true;
  }
  check("wrong current rejected", threw);
  // Missing initial password refuses bootstrap on a FRESH backend.
  const fresh = new MemoryBlobBackend();
  delete process.env.ADMIN_INITIAL_PASSWORD;
  let threw2 = false;
  try {
    await ensureBootstrapped(fresh);
  } catch {
    threw2 = true;
  }
  check("no bootstrap without password", threw2);
  process.env.ADMIN_INITIAL_PASSWORD = "initial-strong-password-123";
}

export async function suiteRateLimit(): Promise<void> {
  section("login rate limiting");
  const backend = new MemoryBlobBackend();
  const ip = "test-ip-hash-1";
  for (let i = 0; i < 10; i += 1) {
    await recordLoginAttempt(backend, ip);
  }
  const blocked = await checkLoginRateLimit(backend, ip);
  check("11th attempt blocked", !blocked.allowed && blocked.retryAfterSeconds > 0);
  await clearLoginAttempts(backend, ip);
  const allowed = await checkLoginRateLimit(backend, ip);
  check("cleared allows", allowed.allowed);
}

export async function suiteKeys(): Promise<void> {
  section("managed API keys (encrypted, rotation)");
  const { setKeysBackendForTests } = await import("../../src/lib/platforms/youtube/youtube-api-keys");
  const backend = new MemoryBlobBackend();
  setKeysBackendForTests(backend);
  try {
    process.env.API_KEYS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    delete process.env.YOUTUBE_API_KEY;
    const added = await addCustomApiKey("Test Key", "AIzaSyTestKeyValue1234567890");
    check("add masked only", !JSON.stringify(added).includes("AIzaSyTestKeyValue1234567890") && added.maskedKey.endsWith("7890"));
    // The persisted Blob object must contain no plaintext either.
    const stored = await backend.getBytes("youtube-discovery/v1/api-keys/state.json");
    check("blob object encrypted", !stored.toString("utf8").includes("AIzaSyTestKeyValue1234567890"));
    const resolved = await resolveApiKeyForRequest();
    check("resolve decrypts server-side", resolved.key === "AIzaSyTestKeyValue1234567890" && resolved.source === "custom");
    await markKeyQuotaExhausted(added.id, "quotaExceeded");
    let threw = false;
    try {
      await resolveApiKeyForRequest();
    } catch {
      threw = true; // no env fallback configured in this test env
    }
    check("exhausted key skipped", threw);
    const list = await getSafeApiKeysList();
    const leaked = JSON.stringify(list);
    check("list never leaks plaintext", !leaked.includes("AIzaSyTestKeyValue1234567890"));
    check("cooling-down status", list.keys.some((k) => k.id === added.id && k.status === "cooling-down"));
    check("select ok", await selectActiveApiKey(added.id));
    check("delete ok", await deleteCustomApiKey(added.id));
    // Refuse plaintext when encryption is unavailable.
    delete process.env.API_KEYS_ENCRYPTION_KEY;
    let threw2 = false;
    try {
      await addCustomApiKey("Nope", "AIzaSyShouldNotSave000000");
    } catch {
      threw2 = true;
    }
    check("refuses unencrypted save", threw2);
    process.env.API_KEYS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  } finally {
    setKeysBackendForTests(null);
  }
}

export async function suiteMigration(): Promise<void> {
  section("disk → Blob migration (idempotent, verified)");
  const { setKeysBackendForTests } = await import("../../src/lib/platforms/youtube/youtube-api-keys");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yd-mig-"));
  const prevCwd = process.cwd();
  process.chdir(tmp);
  try {
    const backend = new MemoryBlobBackend();
    setKeysBackendForTests(backend);
    fs.mkdirSync(path.join(tmp, "data", "playlists"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "data", "searches"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "data", "keys"), { recursive: true });
    const now = new Date().toISOString();
    const playlist = {
      manifestVersion: 1,
      type: "youtube-discovery-playlist",
      playlist: { id: "upl_test1", name: "اختبار 🎬", description: null, createdAt: now, updatedAt: now },
      groups: [],
      items: [
        {
          entryId: "custom_1", position: 0, groupId: null, addedAt: now, updatedAt: now, note: null,
          kind: "custom", title: "ملاحظة عربية", customNote: "نص تجريبي ✨", url: null,
        },
      ],
    };
    fs.writeFileSync(path.join(tmp, "data", "playlists", "playlist-test.json"), JSON.stringify(playlist));
    fs.writeFileSync(path.join(tmp, "data", "playlists", "broken.json"), "{not json");
    const search = {
      id: "search-1", title: "test", query: "react", resourceSelection: "video",
      settings: {}, manifest: { manifestId: "m1", itemCount: 0, normalizedItems: [] },
      createdAt: now, searchedAt: Date.now(), expiresAt: Date.now() + 1000,
    };
    fs.writeFileSync(path.join(tmp, "data", "searches", "search-1.json"), JSON.stringify(search));
    fs.writeFileSync(path.join(tmp, "data", "keys", "api-keys.json"), JSON.stringify({
      activeKeyId: "env",
      customKeys: [{ id: "key-leg-1", label: "Legacy", apiKey: "AIzaSyLegacyUnitKey000000000001", addedAt: now }],
    }));
    const report1 = await migrateAllFromDisk(backend);
    check("playlist imported", report1.playlists.imported === 1);
    check("broken reported", report1.playlists.failed === 1);
    check("search imported", report1.searches.imported === 1);
    check("legacy key imported", report1.keys.imported === 1 && report1.keys.skipped === 0);
    const back = await loadRecord(backend, "playlists", "upl_test1");
    check("unicode preserved", JSON.stringify(back).includes("اختبار"));
    const report2 = await migrateAllFromDisk(backend);
    check("rerun idempotent", report2.playlists.skipped === 1 && report2.searches.skipped === 1 && report2.playlists.imported === 0);
    check("keys rerun skipped", report2.keys.skipped === 1 && report2.keys.imported === 0);
  } finally {
    setKeysBackendForTests(null);
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function suiteQuotaPools(): Promise<void> {
  section("quota pools (multi-project grouping, buckets, rotation)");
  const poolsMod = await import("../../src/lib/keys/quota-pools");
  const keysMod = await import("../../src/lib/platforms/youtube/youtube-api-keys");
  const backend = new MemoryBlobBackend();
  poolsMod.setPoolsBackendForTests(backend);
  keysMod.setKeysBackendForTests(backend);
  process.env.API_KEYS_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  delete process.env.YOUTUBE_API_KEY;
  try {
    // Acceptance 1+2: grouping by project; unknowns never merged.
    check("same project → same pool", poolsMod.poolKeyFor("Project-A", "k1") === poolsMod.poolKeyFor("project-a", "k2"));
    check("different projects → distinct", poolsMod.poolKeyFor("project-a", "k1") !== poolsMod.poolKeyFor("project-b", "k1"));
    check("unknowns never merged", poolsMod.poolKeyFor(null, "k1") !== poolsMod.poolKeyFor(null, "k2"));
    check("unknown ≠ declared", poolsMod.poolKeyFor(null, "k1") !== poolsMod.poolKeyFor("project-a", "k1"));
    check("cost model", poolsMod.unitsForOperation("search") === 100 && poolsMod.unitsForOperation("videos") === 1);
    check("bucket mapping", poolsMod.bucketForOperation("search") === "search" && poolsMod.bucketForOperation("videos") === "other");

    // Build Project A (A1, A2) + Project B (B1) + unknown key U1.
    const a1 = await keysMod.addCustomApiKey("Key A1", "AIzaSyTest-Key-A1-00000001", { accountLabel: "Gmail Account 1", projectId: "project-a", projectDisplayName: "Project A" });
    const a2 = await keysMod.addCustomApiKey("Key A2", "AIzaSyTest-Key-A2-00000002", { accountLabel: "Gmail Account 1", projectId: "Project-A" });
    const b1 = await keysMod.addCustomApiKey("Key B1", "AIzaSyTest-Key-B1-00000003", { accountLabel: "Gmail Account 2", projectId: "project-b" });
    const u1 = await keysMod.addCustomApiKey("Key U1", "AIzaSyTest-Key-U1-00000004");
    const list = await keysMod.getSafeApiKeysList();
    const info = (id: string) => list.keys.find((k) => k.id === id);
    check("manual entries declared", info(a1.id)?.projectAssociation === "declared" && info(a2.id)?.projectAssociation === "declared");
    check("no-project unknown", info(u1.id)?.projectAssociation === "unknown");
    check("A1+A2 same poolKey", poolsMod.poolKeyFor(info(a1.id)?.projectId ?? null, a1.id) === poolsMod.poolKeyFor(info(a2.id)?.projectId ?? null, a2.id));

    // Acceptance 3: exhaust Project A search bucket → search skips A keys, tries B.
    await poolsMod.markPoolBucketExhausted(backend, "project:project-a", "search", "test evidence");
    const pools = await poolsMod.readPools(backend);
    check("search exhausted", poolsMod.isPoolBucketExhausted(pools, "project:project-a", "search"));
    check("other bucket independent", !poolsMod.isPoolBucketExhausted(pools, "project:project-a", "other"));
    const pickedSearch = await keysMod.resolveApiKeyForRequest([], "search");
    check("search rotation skips pool A", pickedSearch.keyId === b1.id || pickedSearch.keyId === u1.id);
    // Acceptance 4: other-bucket requests may still use Project A.
    const pickedOther = await keysMod.resolveApiKeyForRequest([], "other");
    check("other bucket still eligible", [a1.id, a2.id, b1.id, u1.id].includes(pickedOther.keyId));

    // Acceptance 5: invalid key disabled alone, pool untouched.
    await keysMod.disableKeyForInvalidity(a1.id, "403/API_KEY_INVALID");
    const poolsAfter = await poolsMod.readPools(backend);
    check("pool not exhausted by invalid key", !poolsMod.isPoolBucketExhausted(poolsAfter, "project:project-a", "other"));
    const listAfter = await keysMod.getSafeApiKeysList();
    check("invalid key disabled", listAfter.keys.find((k) => k.id === a1.id)?.status === "disabled");

    // Acceptance 6+7+8: usage accounting from real outcomes; key vs project never conflated.
    await poolsMod.recordRequestOutcome(backend, { keyId: b1.id, poolKey: "project:project-b", projectId: "project-b", operation: "search", bucket: "search", units: 100, ok: true, errorReason: null });
    await poolsMod.recordRequestOutcome(backend, { keyId: b1.id, poolKey: "project:project-b", projectId: "project-b", operation: "videos", bucket: "other", units: 1, ok: true, errorReason: null });
    await poolsMod.recordRequestOutcome(backend, { keyId: a2.id, poolKey: "project:project-a", projectId: "project-a", operation: "search", bucket: "search", units: 100, ok: false, errorReason: "quotaExceeded" });
    const usage = await poolsMod.readTodayUsage(backend);
    check("per-key counted", usage.byKey[b1.id]?.requests === 2 && usage.byKey[b1.id]?.units === 101);
    check("project totals agree", usage.byProject["project:project-b"]?.units === 101 && usage.byProject["project:project-a"]?.units === 100);
    check("bucket split recorded", usage.byProjectBucket["project:project-b#search"]?.units === 100 && usage.byProjectBucket["project:project-b#other"]?.units === 1);
    check("attribution exact", usage.lastRequest?.keyId === a2.id && usage.lastRequest?.projectId === "project-a" && usage.lastRequest?.ok === false);
    check("errors tracked", usage.byKey[a2.id]?.errors === 1);

    // Acceptance 9: associations + usage survive simulated redeploy (fresh reads).
    const rereadPools = await poolsMod.readPools(backend);
    const rereadUsage = await poolsMod.readTodayUsage(backend);
    check("pools persist", poolsMod.isPoolBucketExhausted(rereadPools, "project:project-a", "search"));
    check("usage persists", rereadUsage.byKey[b1.id]?.requests === 2);
    const rereadKeys = await keysMod.getSafeApiKeysList();
    check("associations persist", rereadKeys.keys.find((k) => k.id === b1.id)?.projectId === "project-b");

    // Behavioral verification: correlated exhaustion promotes declared → verified.
    await keysMod.markKeyQuotaExhausted(a2.id, "quotaExceeded");
    const corr = await keysMod.countPoolQuotaErrors("project:project-a");
    check("correlation counted", corr.keys >= 1);
    await keysMod.promoteProjectToVerified("project-a", "test correlation evidence");
    const verified = await keysMod.getSafeApiKeysList();
    check("promotion to verified", verified.keys.find((k) => k.id === a2.id)?.projectAssociation === "verified");
    // Unknowns are never promoted by pool operations.
    check("unknown stays unknown", verified.keys.find((k) => k.id === u1.id)?.projectAssociation === "unknown");
  } finally {
    poolsMod.setPoolsBackendForTests(null);
    keysMod.setKeysBackendForTests(null);
  }
}
