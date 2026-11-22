import crypto from "node:crypto";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BUCKET_KIND = "NEW";
const STORAGE_OWNER_UUID = "c987539d-246a-4817-b958-b0ea32c590f9";
const DATASET_SLUG = "saved-items";
const GENERATION_ID = "gen_legacy_20261112_vkyh94";

const WORKER_URL =
  process.env.R2_NEW_WORKER_URL ||
  "https://new-youtube-discovery-api.elmahdyabdulla208.workers.dev";
const SECRET =
  process.env.R2_NEW_WORKER_AUTH_SECRET ||
  process.env.WORKER_AUTH_SECRET ||
  process.env.R2_WORKER_AUTH_SECRET;

let passed = 0;
let failed = 0;

function assert(condition, testNum, desc) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [Test ${testNum}]\x1b[0m ${desc}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [Test ${testNum}]\x1b[0m ${desc}`);
    failed++;
  }
}

function base64UrlEncode(data) {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signToken(operation, key) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const claims = {
    iss: "youtube-discovery-web",
    aud: "new-youtube-discovery-api",
    sub: "admin-session",
    storage_owner_uuid: STORAGE_OWNER_UUID,
    bucket_kind: "NEW",
    operation,
    key: key.replace(/^\/+/, ""),
    iat: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(claims));
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const signatureB64 = base64UrlEncode(signature);
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

async function getObject(key) {
  const cleanKey = key.replace(/^\/+/, "");
  const token = signToken("download", cleanKey);
  const url = `${WORKER_URL}/v1/objects/${encodeURI(cleanKey)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const text = await res.text();
  return JSON.parse(text);
}

async function main() {
  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("Historical Archive Discovery & Integrity Verification Suite (2026)");
  console.log("Target Prefix: asdy/persistence/.../saved-items/before-app-updating/");
  console.log("══════════════════════════════════════════════════════════════════════\n");

  const manifestKey = `asdy/persistence/${STORAGE_OWNER_UUID}/${DATASET_SLUG}/before-app-updating/generations/${GENERATION_ID}/manifest.json`;
  const partKey = `asdy/persistence/${STORAGE_OWNER_UUID}/${DATASET_SLUG}/before-app-updating/generations/${GENERATION_ID}/parts/part-000001.json`;

  // Test 1: Historical Manifest Retrieval
  const manifest = await getObject(manifestKey);
  assert(manifest !== null, 1, "Historical manifest exists in R2 and is downloadable");
  assert(manifest?.generationId === GENERATION_ID, 2, `Manifest generationId matches "${GENERATION_ID}"`);
  assert(manifest?.isBeforeAppUpdating === true, 3, "Manifest has isBeforeAppUpdating === true");
  assert(manifest?.totalRecords === 474, 4, "Manifest declares totalRecords === 474");
  assert(Array.isArray(manifest?.parts) && manifest.parts.length === 1, 5, "Manifest points to exactly 1 part file");

  // Test 2: Historical Part File Retrieval & Integrity
  const part = await getObject(partKey);
  assert(part !== null, 6, "Historical part file exists in R2 and is downloadable");
  assert(part?.generationId === GENERATION_ID, 7, `Part generationId matches "${GENERATION_ID}"`);
  assert(part?.isBeforeAppUpdating === true, 8, "Part carries isBeforeAppUpdating === true");
  assert(Array.isArray(part?.items), 9, "Part records are stored under 'items' array");
  assert(part?.items?.length === 474, 10, "Part contains exactly 474 authentic records");

  // Test 3: Historical Records Schema & Metadata Fidelity
  const sample = part?.items?.[0];
  assert(Boolean(sample?.platformItemId), 11, `Sample record has valid platformItemId ("${sample?.platformItemId}")`);
  assert(Boolean(sample?.title), 12, `Sample record has authentic title ("${sample?.title}")`);
  assert(Boolean(sample?.url), 13, `Sample record has authentic URL ("${sample?.url}")`);
  assert(Boolean(sample?.thumbnailUrl), 14, "Sample record has valid thumbnailUrl");
  assert(Boolean(sample?.channelTitle), 15, `Sample record has authentic channelTitle ("${sample?.channelTitle}")`);
  assert(sample?.isBeforeAppUpdating === true, 16, "Sample record carries isBeforeAppUpdating === true");

  // Test 4: Deduplication and Non-Destructive Preservation
  const idSet = new Set();
  for (const item of part?.items || []) {
    if (item.platformItemId) idSet.add(item.platformItemId);
  }
  assert(idSet.size === 474, 17, `All 474 historical items have unique platformItemIds (count=${idSet.size})`);

  console.log(`\nResults: ${passed} PASSED, ${failed} FAILED\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
