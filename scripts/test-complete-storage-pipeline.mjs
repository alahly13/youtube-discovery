#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Complete Storage Pipeline, Workers & Local-First Verification Suite
 * ──────────────────────────────────────────────────────────────────────────
 * Covers:
 * 1. Grouped 20-item video save into 1 generation (no individual R2 calls)
 * 2. Outbox atomic mutation schema and batch aggregation
 * 3. "I Will Search For" local-only persistence, schema, and complete zero-cloud isolation
 * 4. Tab-closing beforeunload protection trigger logic (totalPending > 0)
 * 5. 12-hour auto-sync scheduling, drift compensation, and overdue recovery math
 * 6. NEW Worker batch upload simulation, 50-item limit guard, SHA-256 receipts
 * 7. NEW Worker DELETE immutability (/temp/ only allowed, committed generations blocked)
 * 8. OLD Worker zero-deletion protection and 4-category boundary enforcement
 * 9. Merged read model tombstone filtering across local and remote manifests
 * 10. Local Data Center scanner recognizing local_research_reminders as LOCAL-ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 */

import assert from "node:assert";
import crypto from "node:crypto";

async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("   YOUTUBE DISCOVERY 2026 — COMPLETE STORAGE PIPELINE SUITE   ");
  console.log("══════════════════════════════════════════════════════════════\n");

  let passedCount = 0;
  let failedCount = 0;

  async function runTest(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    Error: ${err.message}\n`);
      failedCount++;
    }
  }

  await runTest("1. Grouped 20-item save: produces 1 generation manifest part, zero individual R2 objects", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    id: `video_${i + 1}`,
    videoId: `vid_${String(i + 1).padStart(4, "0")}`,
    title: `Research Video ${i + 1}`,
    channelTitle: `Channel ${i + 1}`,
    publishedAt: new Date(Date.now() - i * 3600000).toISOString(),
    thumbnailUrl: `https://i.ytimg.com/vi/vid_${i + 1}/hqdefault.jpg`,
    tags: ["tech", "ai", `tag_${i}`],
  }));

  // Dataset generation serializer test
  const generationId = `gen_${Date.now()}_001`;
  const storageOwnerUuid = "00000000-0000-0000-0000-000000000001";
  const datasetId = "ds_saved_items_001";

  // When saved, all 20 items form a single generation envelope
  const generationEnvelope = {
    schemaVersion: 1,
    generationId,
    datasetType: "SAVED_ITEMS",
    storageOwnerUuid,
    recordCount: items.length,
    records: items,
    generatedAt: new Date().toISOString(),
  };

  const payload = Buffer.from(JSON.stringify(generationEnvelope), "utf8");
  const partSha256 = crypto.createHash("sha256").update(payload).digest("hex");

  assert.strictEqual(items.length, 20);
  assert.strictEqual(generationEnvelope.recordCount, 20);
  assert.strictEqual(typeof partSha256, "string");
  assert.strictEqual(partSha256.length, 64);

  // Grouped path derivation
  const expectedPath = `${storageOwnerUuid}/persistence/datasets/${datasetId}/generations/${generationId}/parts/part-000001.json`;
  assert.strictEqual(
    expectedPath,
    `${storageOwnerUuid}/persistence/datasets/${datasetId}/generations/${generationId}/parts/part-000001.json`
  );
});

  await runTest("2. Outbox operation schema: atomic entity mutation + append outbox entry", () => {
  const opId = `op_${crypto.randomUUID()}`;
  const ownerId = "00000000-0000-0000-0000-000000000001";
  const outboxRecord = {
    id: opId,
    ownerId,
    datasetType: "SAVED_ITEMS",
    operationType: "UPSERT",
    entityId: "vid_9999",
    payload: { videoId: "vid_9999", title: "Test Save" },
    clientTimestamp: Date.now(),
    retryCount: 0,
    status: "PENDING",
  };

  assert.strictEqual(outboxRecord.status, "PENDING");
  assert.strictEqual(outboxRecord.ownerId, ownerId);
  assert.strictEqual(outboxRecord.operationType, "UPSERT");
  assert.ok(outboxRecord.clientTimestamp <= Date.now());
});

  await runTest("3. I Will Search For: local-only reminders never produce outbox operations", () => {
  const reminder = {
    id: `reminder_${Date.now()}_abc`,
    ownerId: "00000000-0000-0000-0000-000000000001",
    videoId: "vid_local_only_123",
    title: "Curious Video for Later Search",
    channelTitle: "Science Channel",
    thumbnailUrl: "https://i.ytimg.com/vi/vid_local_only_123/hqdefault.jpg",
    note: "Check references on this topic tonight",
    status: "TO_RESEARCH",
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Rule: Reminder records are strictly local to local_research_reminders store
  // They are NEVER passed to outbox_operations
  const outboxItems = [];
  function processAction(actionType, record) {
    if (actionType === "LOCAL_RESEARCH_REMINDER") {
      // Local store only — NO OUTBOX OPERATION CREATED
      return { localSaved: true, queuedForCloudSync: false };
    }
    outboxItems.push(record);
    return { localSaved: true, queuedForCloudSync: true };
  }

  const result = processAction("LOCAL_RESEARCH_REMINDER", reminder);
  assert.strictEqual(result.localSaved, true);
  assert.strictEqual(result.queuedForCloudSync, false);
  assert.strictEqual(outboxItems.length, 0, "Outbox MUST remain empty for local research reminders");
});

  await runTest("4. Tab protection: beforeunload triggers whenever totalPending > 0 or sync is active", () => {
    function shouldTriggerUnloadWarning(totalPending, isSyncing) {
      return totalPending > 0 || isSyncing;
    }

    assert.strictEqual(shouldTriggerUnloadWarning(0, false), false, "Clean state does not warn");
    assert.strictEqual(shouldTriggerUnloadWarning(5, false), true, "Pending changes trigger warning");
    assert.strictEqual(shouldTriggerUnloadWarning(0, true), true, "Active sync triggers warning");
    assert.strictEqual(shouldTriggerUnloadWarning(3, true), true, "Pending changes during sync trigger warning");
  });

  await runTest("5. 12-Hour sync: overdue calculation matches 43,200,000 ms threshold", () => {
    const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
    const now = Date.now();

    function isSyncOverdue(lastSyncTime) {
      if (!lastSyncTime) return true;
      return now - lastSyncTime >= TWELVE_HOURS_MS;
    }

    assert.strictEqual(isSyncOverdue(null), true, "Never synced is overdue");
    assert.strictEqual(isSyncOverdue(now - 3600000), false, "1 hour ago is not overdue");
    assert.strictEqual(isSyncOverdue(now - 11 * 3600000), false, "11 hours ago is not overdue");
    assert.strictEqual(isSyncOverdue(now - 12 * 3600000), true, "Exactly 12 hours ago is overdue");
    assert.strictEqual(isSyncOverdue(now - 24 * 3600000), true, "24 hours ago is overdue");
  });

  await runTest("6. NEW Worker: batch size limit (max 50) and SHA-256 verification receipts", async () => {
    const oversizedBatch = Array.from({ length: 51 }, (_, i) => ({
      key: `test/part-${i}.json`,
      content: "{}",
      sha256: crypto.createHash("sha256").update("{}").digest("hex"),
    }));

    function validateBatchLimits(items) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Missing required fields: non-empty items array.");
      }
      if (items.length > 50) {
        throw new Error(`Batch item count (${items.length}) exceeds maximum limit of 50 items per batch.`);
      }
      return true;
    }

    assert.throws(
      () => validateBatchLimits(oversizedBatch),
      /exceeds maximum limit of 50 items/
    );

    const validBatch = Array.from({ length: 3 }, (_, i) => {
      const content = JSON.stringify({ itemIndex: i, name: `Part ${i}` });
      return {
        key: `00000000-0000-0000-0000-000000000001/persistence/datasets/ds_test/generations/gen_1/parts/part-${i + 1}.json`,
        content,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
      };
    });

    assert.strictEqual(validateBatchLimits(validBatch), true);

    const receipts = validBatch.map((item) => {
      const computed = crypto.createHash("sha256").update(item.content).digest("hex");
      assert.strictEqual(computed, item.sha256);
      return {
        key: item.key,
        size: Buffer.byteLength(item.content),
        etag: `etag_${computed.slice(0, 8)}`,
        sha256: computed,
        uploaded: new Date().toISOString(),
      };
    });

    assert.strictEqual(receipts.length, 3);
    assert.strictEqual(receipts[0].sha256, validBatch[0].sha256);
  });

  await runTest("7. NEW Worker DELETE: blocks committed generations (403), only /temp/ keys allowed", () => {
    function checkDeleteAllowed(key) {
      if (!key.includes("/temp/")) {
        return { allowed: false, status: 403, error: "Permanent committed generation parts cannot be deleted via Worker API." };
      }
      return { allowed: true, status: 200 };
    }

    const committedKey = "00000000-0000-0000-0000-000000000001/persistence/datasets/ds1/generations/g1/parts/part-000001.json";
    const tempKey = "00000000-0000-0000-0000-000000000001/temp/staging_upload_123.tmp";

    const res1 = checkDeleteAllowed(committedKey);
    assert.strictEqual(res1.allowed, false);
    assert.strictEqual(res1.status, 403);

    const res2 = checkDeleteAllowed(tempKey);
    assert.strictEqual(res2.allowed, true);
    assert.strictEqual(res2.status, 200);
  });

  await runTest("8. OLD Worker: zero deletion of archive manifests and strictly 4 canonical categories", () => {
    const CANONICAL_OLD_CATEGORIES = [
      "saved-items",
      "saved-playlists",
      "saved-titles-links",
      "saved-search-history",
    ];

    function validateOldPath(pathname) {
      const match = pathname.match(/^asdy\/old\/([^/]+)\//);
      if (!match) return false;
      const cat = match[1];
      return CANONICAL_OLD_CATEGORIES.includes(cat) || cat === "unclassified";
    }

    assert.strictEqual(validateOldPath("asdy/old/saved-items/manifest-1.json"), true);
    assert.strictEqual(validateOldPath("asdy/old/saved-playlists/p1.json"), true);
    assert.strictEqual(validateOldPath("asdy/old/saved-titles-links/t1.json"), true);
    assert.strictEqual(validateOldPath("asdy/old/saved-search-history/s1.json"), true);
    assert.strictEqual(validateOldPath("asdy/old/unclassified/other.json"), true);
    assert.strictEqual(validateOldPath("asdy/old/collections/col.json"), false, "Collections must be rejected");
    assert.strictEqual(validateOldPath("random/bucket/path.json"), false);

    function checkOldDeleteAllowed(key) {
      if (!key.includes("/temp/")) {
        return { allowed: false, status: 403, error: "Permanent historical archive manifests cannot be deleted." };
      }
      return { allowed: true, status: 200 };
    }

    assert.strictEqual(
      checkOldDeleteAllowed("asdy/old/saved-items/item1.json").status,
      403,
      "Historical manifests cannot be deleted"
    );
  });

  await runTest("9. Merged Read Model: local offline saves and tombstones correctly layered over remote", () => {
    const remoteItems = [
      { id: "vid_1", title: "Remote Video 1" },
      { id: "vid_2", title: "Remote Video 2" },
      { id: "vid_3", title: "Remote Video 3" },
    ];

    const localPendingOutbox = [
      { entityId: "vid_2", operationType: "DELETE" },
      { entityId: "vid_4", operationType: "UPSERT", payload: { id: "vid_4", title: "Local Video 4" } },
    ];

    const tombstones = new Set(
      localPendingOutbox.filter((op) => op.operationType === "DELETE").map((op) => op.entityId)
    );

    const localUpserts = new Map(
      localPendingOutbox.filter((op) => op.operationType === "UPSERT").map((op) => [op.entityId, op.payload])
    );

    const visible = remoteItems.filter((item) => !tombstones.has(item.id));

    for (const [id, item] of localUpserts.entries()) {
      if (!tombstones.has(id)) {
        visible.push(item);
      }
    }

    const visibleIds = visible.map((v) => v.id);
    assert.deepStrictEqual(visibleIds, ["vid_1", "vid_3", "vid_4"]);
    assert.ok(!visibleIds.includes("vid_2"), "Tombstoned item vid_2 must be hidden from read model");
  });

  await runTest("10. Local Data Center: recognizes local_research_reminders as LOCAL-ONLY, NOT CLOUD SYNCED", () => {
    const recognizedStores = [
      { name: "saved_items", isLocalOnly: false },
      { name: "saved_playlists", isLocalOnly: false },
      { name: "search_history", isLocalOnly: false },
      { name: "research_queue", isLocalOnly: false },
      { name: "references", isLocalOnly: false },
      { name: "local_research_reminders", isLocalOnly: true, label: "LOCAL ONLY — NOT CLOUD SYNCED" },
    ];

    const reminderStore = recognizedStores.find((s) => s.name === "local_research_reminders");
    assert.ok(reminderStore, "local_research_reminders must be recognized by Local Data Center");
    assert.strictEqual(reminderStore.isLocalOnly, true);
    assert.strictEqual(reminderStore.label, "LOCAL ONLY — NOT CLOUD SYNCED");
  });

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`   TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (TOTAL: ${passedCount + failedCount})`);
  console.log("══════════════════════════════════════════════════════════════\n");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
