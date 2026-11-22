import crypto from "node:crypto";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BUCKET_KIND = "NEW";
const STORAGE_OWNER_UUID = "c987539d-246a-4817-b958-b0ea32c590f9";
const WORKER_URL =
  process.env.R2_NEW_WORKER_URL ||
  "https://new-youtube-discovery-api.elmahdyabdulla208.workers.dev";
const SECRET =
  process.env.R2_NEW_WORKER_AUTH_SECRET ||
  process.env.WORKER_AUTH_SECRET ||
  process.env.R2_WORKER_AUTH_SECRET;

if (!SECRET) {
  console.error("Missing Worker auth secret in env");
  process.exit(1);
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

async function listPrefix(prefix) {
  const cleanPrefix = prefix.replace(/^\/+/, "");
  const allObjects = [];
  let cursor = undefined;
  let pagesCount = 0;

  do {
    pagesCount++;
    const token = signToken("list", cleanPrefix);
    const res = await fetch(`${WORKER_URL}/v1/objects/list`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix: cleanPrefix,
        cursor,
        limit: 100,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { error: `HTTP ${res.status}: ${errText}`, pagesCount, allObjects };
    }

    const data = await res.json();
    if (data.objects && Array.isArray(data.objects)) {
      allObjects.push(...data.objects);
    }
    if (data.truncated && data.cursor) {
      cursor = data.cursor;
    } else {
      cursor = undefined;
    }
  } while (cursor);

  return { objects: allObjects, pagesCount, cursorReachedEnd: !cursor };
}

async function downloadObject(key) {
  const cleanKey = key.replace(/^\/+/, "");
  const token = signToken("download", cleanKey);
  const url = `${WORKER_URL}/v1/objects/${encodeURI(cleanKey)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    return { ok: false, status: res.status, error: await res.text() };
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    ok: true,
    status: res.status,
    length: text.length,
    json,
    rawPreview: text.slice(0, 500),
  };
}

async function main() {
  console.log("=== STEP 1: Probing prefixes under before-app-updating ===");
  const basePrefix = `asdy/persistence/${STORAGE_OWNER_UUID}/saved-items/before-app-updating/`;
  console.log("Listing base prefix:", basePrefix);
  const baseList = await listPrefix(basePrefix);
  console.log(`Base list found ${baseList.objects?.length || 0} objects across ${baseList.pagesCount} pages.`);
  if (baseList.objects) {
    for (const obj of baseList.objects) {
      console.log(`  - Key: ${obj.key} (${obj.size} bytes, uploaded: ${obj.uploaded})`);
    }
  }

  console.log("\n=== STEP 2: Checking exact investigation targets ===");
  const target1 = `${basePrefix}manifest.json`;
  const target2 = `${basePrefix}generations/gen_legacy_20261112_vkyh94/manifest.json`;
  const targetPartsPrefix = `${basePrefix}generations/gen_legacy_20261112_vkyh94/parts/`;

  console.log("\nTarget 1:", target1);
  const dl1 = await downloadObject(target1);
  console.log(`  Exists: ${dl1.ok} (status: ${dl1.status})`);
  if (dl1.ok) {
    console.log("  Manifest structure keys:", Object.keys(dl1.json || {}));
    if (dl1.json?.parts) console.log("  Parts listed in manifest:", dl1.json.parts.length);
    if (dl1.json?.itemCount) console.log("  ItemCount in manifest:", dl1.json.itemCount);
  } else {
    console.log("  Status info:", dl1.error?.slice(0, 200));
  }

  console.log("\nTarget 2:", target2);
  const dl2 = await downloadObject(target2);
  console.log(`  Exists: ${dl2.ok} (status: ${dl2.status})`);
  if (dl2.ok) {
    console.log("  Manifest structure keys:", Object.keys(dl2.json || {}));
    console.log("  Manifest content:\n", JSON.stringify(dl2.json, null, 2));
  } else {
    console.log("  Status info:", dl2.error?.slice(0, 200));
  }

  console.log("\nTarget Parts Prefix:", targetPartsPrefix);
  const partsList = await listPrefix(targetPartsPrefix);
  console.log(`  Total parts found: ${partsList.objects?.length || 0}`);
  console.log(`  Pages count: ${partsList.pagesCount}`);
  console.log(`  Exhausted listing: ${partsList.cursorReachedEnd}`);

  if (partsList.objects && partsList.objects.length > 0) {
    for (let i = 0; i < partsList.objects.length; i++) {
      const p = partsList.objects[i];
      console.log(`  Part [${i + 1}]: key=${p.key}, size=${p.size}, etag=${p.etag}, uploaded=${p.uploaded}`);
    }

    console.log("\n=== STEP 3: Inspecting First Part Content ===");
    const firstPartKey = partsList.objects[0].key;
    const dlPart = await downloadObject(firstPartKey);
    console.log(`  Downloaded first part (${firstPartKey}): ok=${dlPart.ok}, size=${dlPart.length}`);
    if (dlPart.ok && dlPart.json) {
      console.log("  Part JSON top-level keys:", Object.keys(dlPart.json));
      if (Array.isArray(dlPart.json)) {
        console.log(`  Part is an ARRAY of ${dlPart.json.length} items`);
        console.log("  Sample item [0]:", JSON.stringify(dlPart.json[0], null, 2));
      } else {
        for (const k of Object.keys(dlPart.json)) {
          if (Array.isArray(dlPart.json[k])) {
            console.log(`  Key "${k}" is an ARRAY of ${dlPart.json[k].length} records!`);
            console.log(`  Sample record from "${k}" [0]:`, JSON.stringify(dlPart.json[k][0], null, 2));
          } else {
            console.log(`  Key "${k}": type=${typeof dlPart.json[k]}, val=${JSON.stringify(dlPart.json[k])}`);
          }
        }
      }
    } else {
      console.log("  Raw preview of part:", dlPart.rawPreview);
    }
  }

  console.log("\n=== STEP 4: Checking all objects under asdy/persistence/ ===");
  const rootList = await listPrefix(`asdy/persistence/${STORAGE_OWNER_UUID}/saved-items/`);
  console.log(`Found ${rootList.objects?.length || 0} total objects under saved-items/`);
  for (const obj of rootList.objects || []) {
    console.log(`  - ${obj.key} (${obj.size} bytes)`);
  }
}

main().catch(err => {
  console.error("FATAL in main:", err);
  process.exit(1);
});
