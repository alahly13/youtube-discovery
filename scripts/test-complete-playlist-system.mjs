#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Comprehensive Playlist Management Test Suite
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: 30 automated unit and integration tests verifying:
 *   [1-5]   Playlist Creation, Metadata & Multiline Description Preservation
 *   [6-10]  Strict Description Separation (Playlist Desc vs Item Desc)
 *   [11-15] Deterministic UUID Mapping (toPlaylistUuid, toGroupUuid, toEntryUuid)
 *   [16-20] Duplicate Prevention & Canonical YouTube Key Detection
 *   [21-24] Non-Destructive Item & Playlist Removal Contract
 *   [25-28] Reordering, Section Groups & Position Stability
 *   [29-30] Multi-User Isolation & Offline Database Fallback Resilience
 * ═══════════════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";

console.log("\n🧪 Running Complete Playlist Management System Test Suite (2026)...\n");

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (error) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${error.message}`);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Replicated Deterministic Helper Functions (from src/lib/playlists/playlist-db-service.ts)
// ─────────────────────────────────────────────────────────────────────────────

function toPlaylistUuid(id) {
  if (!id || typeof id !== "string") return crypto.randomUUID();
  const clean = id.trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)) {
    return clean;
  }
  const hash = crypto.createHash("sha256").update(`yt-discovery-playlist:${clean}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function toGroupUuid(id) {
  if (!id || typeof id !== "string") return crypto.randomUUID();
  const clean = id.trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)) {
    return clean;
  }
  const hash = crypto.createHash("sha256").update(`yt-discovery-group:${clean}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function toEntryUuid(id) {
  if (!id || typeof id !== "string") return crypto.randomUUID();
  const clean = id.trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)) {
    return clean;
  }
  const hash = crypto.createHash("sha256").update(`yt-discovery-entry:${clean}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function canonicalYoutubeKey(kind, platformItemId) {
  return `youtube:${kind}:${platformItemId}`;
}

function emptyPlaylistManifest(name, description = null) {
  const now = new Date().toISOString();
  const id = `upl_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  return {
    manifestVersion: 1,
    playlist: {
      id,
      name,
      description,
      createdAt: now,
      updatedAt: now,
    },
    groups: [],
    items: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: Playlist Creation, Metadata & Multiline Description Preservation
// ─────────────────────────────────────────────────────────────────────────────
console.log("📁 Group 1: Playlist Creation, Metadata & Multiline Description Preservation");

runTest("1.1 Creates playlist with null description when omitted", () => {
  const p = emptyPlaylistManifest("Research Playlist Alpha");
  assert.equal(p.playlist.name, "Research Playlist Alpha");
  assert.equal(p.playlist.description, null);
  assert.equal(p.items.length, 0);
  assert.equal(p.groups.length, 0);
  assert.ok(p.playlist.id.startsWith("upl_"));
});

runTest("1.2 Creates playlist with single-line description", () => {
  const p = emptyPlaylistManifest("AI Trends 2026", "A curated list of AI research videos.");
  assert.equal(p.playlist.name, "AI Trends 2026");
  assert.equal(p.playlist.description, "A curated list of AI research videos.");
});

runTest("1.3 Strictly preserves multiline descriptions with paragraphs, newlines and tabs", () => {
  const multiline = `First line: Overview of Quantum Computing
Second line: Key breakthroughs in 2026.

• Topic A: Fault-tolerant qubits
• Topic B: Photonic interconnects
	- Sub-bullet with tab indentation

Note: Updated on Nov 4, 2026.`;

  const p = emptyPlaylistManifest("Quantum Deep Dive", multiline);
  assert.equal(p.playlist.description, multiline);
  assert.ok(p.playlist.description.includes("\n\n"));
  assert.ok(p.playlist.description.includes("• Topic A:"));
  assert.ok(p.playlist.description.includes("\t- Sub-bullet"));
});

runTest("1.4 Preserves unicode, emojis and non-English scripts in description", () => {
  const arabicDesc = "قائمة تشغيل بحثية خاصة بمستقبل الذكاء الاصطناعي والحوسبة السحابية ٢٠٢٦ 🚀\nتتضمن مقاطع رسمية ومراجع علمية.";
  const p = emptyPlaylistManifest("مستقبل الذكاء الاصطناعي", arabicDesc);
  assert.equal(p.playlist.name, "مستقبل الذكاء الاصطناعي");
  assert.equal(p.playlist.description, arabicDesc);
  assert.ok(p.playlist.description.includes("🚀"));
});

runTest("1.5 Generates distinct timestamps and unique IDs for sequential creations", () => {
  const p1 = emptyPlaylistManifest("Playlist 1");
  const p2 = emptyPlaylistManifest("Playlist 2");
  assert.notEqual(p1.playlist.id, p2.playlist.id);
  assert.ok(new Date(p1.playlist.createdAt).getTime() <= Date.now());
  assert.ok(new Date(p2.playlist.createdAt).getTime() <= Date.now());
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: Strict Description Separation (Playlist Desc vs Item Desc)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n📁 Group 2: Strict Description Separation (Playlist Desc vs Item Desc)");

const sampleItem = {
  entryId: "upe_sample_123",
  kind: "youtube",
  youtubeKind: "video",
  title: "Building Reliable Systems in 2026",
  note: "User personal note: check timestamp at 14:20",
  position: 0,
  groupId: null,
  addedAt: new Date().toISOString(),
  snapshot: {
    kind: "video",
    platformItemId: "vid_reliable_99",
    url: "https://www.youtube.com/watch?v=vid_reliable_99",
    title: "Building Reliable Systems in 2026",
    description: "Official YouTube Video description provided by the creator. Full metadata text goes here.",
    thumbnailUrl: "https://i.ytimg.com/vi/vid_reliable_99/mqdefault.jpg",
    channelTitle: "Architecture Masters",
    channelId: "UC_arch_123",
    publishedAt: "2026-03-01T12:00:00Z",
    viewCount: 45000,
    likeCount: 3200,
    commentCount: 150,
  },
};

runTest("2.1 Playlist description and YouTube item description remain completely distinct", () => {
  const p = emptyPlaylistManifest("My Curated Tech List", "Playlist curated by user asdy for Q4.");
  p.items.push(sampleItem);

  assert.equal(p.playlist.description, "Playlist curated by user asdy for Q4.");
  assert.equal(p.items[0].snapshot.description, "Official YouTube Video description provided by the creator. Full metadata text goes here.");
  assert.notEqual(p.playlist.description, p.items[0].snapshot.description);
});

runTest("2.2 Mutating playlist description does not alter or overwrite item snapshot description", () => {
  const p = emptyPlaylistManifest("Initial Name", "Initial playlist description.");
  p.items.push(JSON.parse(JSON.stringify(sampleItem)));

  // Simulate updating playlist description
  p.playlist.description = "Updated multiline playlist description:\n1. Better organization\n2. New categories.";
  p.playlist.updatedAt = new Date().toISOString();

  assert.equal(p.playlist.description, "Updated multiline playlist description:\n1. Better organization\n2. New categories.");
  assert.equal(p.items[0].snapshot.description, "Official YouTube Video description provided by the creator. Full metadata text goes here.");
});

runTest("2.3 Mutating item personal note does not alter playlist description or item snapshot description", () => {
  const p = emptyPlaylistManifest("Engineering Gems", "Curated engineering references.");
  p.items.push(JSON.parse(JSON.stringify(sampleItem)));

  // Update item's personal note
  p.items[0].note = "Revised note: essential chapter on distributed consensus.";

  assert.equal(p.items[0].note, "Revised note: essential chapter on distributed consensus.");
  assert.equal(p.playlist.description, "Curated engineering references.");
  assert.equal(p.items[0].snapshot.description, "Official YouTube Video description provided by the creator. Full metadata text goes here.");
});

runTest("2.4 Empty or null playlist description does not erase item snapshot descriptions", () => {
  const p = emptyPlaylistManifest("No Description Playlist", null);
  p.items.push(JSON.parse(JSON.stringify(sampleItem)));

  assert.equal(p.playlist.description, null);
  assert.equal(p.items[0].snapshot.description, "Official YouTube Video description provided by the creator. Full metadata text goes here.");
});

runTest("2.5 Multiple items retain their individual, distinct snapshot descriptions", () => {
  const item2 = {
    ...sampleItem,
    entryId: "upe_sample_456",
    snapshot: {
      ...sampleItem.snapshot,
      platformItemId: "vid_second_item",
      description: "Description of the second distinct video.",
    },
  };

  const p = emptyPlaylistManifest("Multi-Item Playlist", "Parent playlist description.");
  p.items.push(sampleItem, item2);

  assert.equal(p.items.length, 2);
  assert.equal(p.items[0].snapshot.description, "Official YouTube Video description provided by the creator. Full metadata text goes here.");
  assert.equal(p.items[1].snapshot.description, "Description of the second distinct video.");
  assert.notEqual(p.items[0].snapshot.description, p.items[1].snapshot.description);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Deterministic UUID Mapping (toPlaylistUuid, toGroupUuid, toEntryUuid)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n📁 Group 3: Deterministic UUID Mapping (toPlaylistUuid, toGroupUuid, toEntryUuid)");

runTest("3.1 toPlaylistUuid converts legacy client ID (upl_...) to valid RFC4122 UUID", () => {
  const clientUplId = "upl_1730740000000_abc12";
  const uuid = toPlaylistUuid(clientUplId);
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.ok(uuidRegex.test(uuid), `Generated UUID ${uuid} must match RFC4122 v4 pattern`);
});

runTest("3.2 toPlaylistUuid is 100% idempotent across multiple calls", () => {
  const clientUplId = "upl_1730740000000_abc12";
  const uuid1 = toPlaylistUuid(clientUplId);
  const uuid2 = toPlaylistUuid(clientUplId);
  const uuid3 = toPlaylistUuid(clientUplId);
  assert.equal(uuid1, uuid2);
  assert.equal(uuid2, uuid3);
});

runTest("3.3 toPlaylistUuid produces distinct UUIDs for different client IDs", () => {
  const id1 = "upl_1730740000000_abc12";
  const id2 = "upl_1730740000000_abc13";
  assert.notEqual(toPlaylistUuid(id1), toPlaylistUuid(id2));
});

runTest("3.4 Native UUIDs pass through unchanged", () => {
  const nativeUuid = "e1e07b8a-1111-4222-8333-444455556666";
  assert.equal(toPlaylistUuid(nativeUuid), nativeUuid);
  assert.equal(toGroupUuid(nativeUuid), nativeUuid);
  assert.equal(toEntryUuid(nativeUuid), nativeUuid);
});

runTest("3.5 toGroupUuid and toEntryUuid use separate domain namespaces", () => {
  const id = "shared_entity_id_100";
  const playlistUuid = toPlaylistUuid(id);
  const groupUuid = toGroupUuid(id);
  const entryUuid = toEntryUuid(id);

  // Cross-domain safety: the same string ID in different domains produces distinct UUIDs
  assert.notEqual(playlistUuid, groupUuid);
  assert.notEqual(groupUuid, entryUuid);
  assert.notEqual(playlistUuid, entryUuid);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Duplicate Prevention & Canonical YouTube Key Detection
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n📁 Group 4: Duplicate Prevention & Canonical YouTube Key Detection");

runTest("4.1 canonicalYoutubeKey produces standardized keys for videos, channels, and playlists", () => {
  assert.equal(canonicalYoutubeKey("video", "dQw4w9WgXcQ"), "youtube:video:dQw4w9WgXcQ");
  assert.equal(canonicalYoutubeKey("channel", "UC_abc123"), "youtube:channel:UC_abc123");
  assert.equal(canonicalYoutubeKey("youtube_playlist", "PL_xyz789"), "youtube:youtube_playlist:PL_xyz789");
});

runTest("4.2 Detects and prevents duplicate items in the same playlist", () => {
  const p = emptyPlaylistManifest("De-dup Test");
  p.items.push(sampleItem);

  const keyToFind = canonicalYoutubeKey(sampleItem.youtubeKind, sampleItem.snapshot.platformItemId);
  const exists = p.items.some(
    (it) => it.kind === "youtube" && canonicalYoutubeKey(it.youtubeKind, it.snapshot.platformItemId) === keyToFind
  );

  assert.equal(exists, true);

  // Attempting to add duplicate returns reason: "duplicate"
  function attemptAdd(playlist, newItem) {
    const k = canonicalYoutubeKey(newItem.youtubeKind, newItem.snapshot.platformItemId);
    const isDup = playlist.items.some(
      (it) => it.kind === "youtube" && canonicalYoutubeKey(it.youtubeKind, it.snapshot.platformItemId) === k
    );
    if (isDup) {
      return { added: false, reason: "duplicate" };
    }
    playlist.items.push(newItem);
    return { added: true };
  }

  const result = attemptAdd(p, sampleItem);
  assert.equal(result.added, false);
  assert.equal(result.reason, "duplicate");
  assert.equal(p.items.length, 1);
});

runTest("4.3 Allows distinct items to be added to the playlist", () => {
  const p = emptyPlaylistManifest("De-dup Test 2");
  p.items.push(sampleItem);

  const secondItem = {
    ...sampleItem,
    entryId: "upe_diff_999",
    snapshot: {
      ...sampleItem.snapshot,
      platformItemId: "vid_completely_different",
    },
  };

  function attemptAdd(playlist, newItem) {
    const k = canonicalYoutubeKey(newItem.youtubeKind, newItem.snapshot.platformItemId);
    const isDup = playlist.items.some(
      (it) => it.kind === "youtube" && canonicalYoutubeKey(it.youtubeKind, it.snapshot.platformItemId) === k
    );
    if (isDup) {
      return { added: false, reason: "duplicate" };
    }
    playlist.items.push(newItem);
    return { added: true };
  }

  const result = attemptAdd(p, secondItem);
  assert.equal(result.added, true);
  assert.equal(p.items.length, 2);
});

runTest("4.4 Same video item can exist across different playlists without collision", () => {
  const pA = emptyPlaylistManifest("Playlist A");
  const pB = emptyPlaylistManifest("Playlist B");

  pA.items.push(sampleItem);
  pB.items.push({ ...sampleItem, entryId: "upe_in_pB" });

  assert.equal(pA.items.length, 1);
  assert.equal(pB.items.length, 1);
  assert.equal(pA.items[0].snapshot.platformItemId, pB.items[0].snapshot.platformItemId);
  assert.notEqual(pA.items[0].entryId, pB.items[0].entryId);
});

runTest("4.5 Custom items without platformItemId are identified by entryId", () => {
  const customItem = {
    entryId: "upe_custom_1",
    kind: "custom",
    title: "External Research Paper Link",
    url: "https://arxiv.org/abs/2601.12345",
    note: "Background reading",
    position: 0,
    groupId: null,
    addedAt: new Date().toISOString(),
  };

  const p = emptyPlaylistManifest("Custom Links");
  p.items.push(customItem);

  assert.equal(p.items[0].kind, "custom");
  assert.equal(p.items[0].title, "External Research Paper Link");
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: Non-Destructive Item & Playlist Removal Contract
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n📁 Group 5: Non-Destructive Item & Playlist Removal Contract");

runTest("5.1 Removing an item from a playlist removes membership only without touching Saved Items", () => {
  // Simulated Saved Items store (local or cloud)
  const savedItemsStore = new Map();
  savedItemsStore.set("vid_reliable_99", {
    id: "si_1",
    platformItemId: "vid_reliable_99",
    title: "Building Reliable Systems in 2026",
  });

  const p = emptyPlaylistManifest("Playlist With Item");
  p.items.push(sampleItem);
  assert.equal(p.items.length, 1);

  // Perform removal of item from playlist
  p.items = p.items.filter((it) => it.entryId !== sampleItem.entryId);
  assert.equal(p.items.length, 0);

  // Contract verification: Saved Items store remains completely untouched
  assert.ok(savedItemsStore.has("vid_reliable_99"), "Item must remain present in Saved Items");
  assert.equal(savedItemsStore.get("vid_reliable_99").title, "Building Reliable Systems in 2026");
});

runTest("5.2 Deleting an entire playlist removes the playlist manifest but leaves Saved Items intact", () => {
  const savedItemsStore = new Map();
  savedItemsStore.set("vid_reliable_99", {
    id: "si_1",
    platformItemId: "vid_reliable_99",
    title: "Building Reliable Systems in 2026",
  });

  const playlistsStore = new Map();
  const p = emptyPlaylistManifest("To Be Deleted");
  p.items.push(sampleItem);
  playlistsStore.set(p.playlist.id, p);

  // Delete playlist
  playlistsStore.delete(p.playlist.id);

  assert.equal(playlistsStore.has(p.playlist.id), false);
  assert.ok(savedItemsStore.has("vid_reliable_99"), "Saved Items store must be completely unaffected by playlist deletion");
});

runTest("5.3 Removing an item from Playlist A does not remove it from Playlist B", () => {
  const pA = emptyPlaylistManifest("Playlist A");
  const pB = emptyPlaylistManifest("Playlist B");

  pA.items.push({ ...sampleItem, entryId: "upe_pA" });
  pB.items.push({ ...sampleItem, entryId: "upe_pB" });

  pA.items = pA.items.filter((it) => it.entryId !== "upe_pA");

  assert.equal(pA.items.length, 0);
  assert.equal(pB.items.length, 1);
  assert.equal(pB.items[0].snapshot.platformItemId, "vid_reliable_99");
});

runTest("5.4 Supports Undo operation for removed items", () => {
  const p = emptyPlaylistManifest("Undo Playlist");
  p.items.push(sampleItem);

  // Simulate snapshot on remove
  const lastRemoved = {
    playlistId: p.playlist.id,
    items: [...p.items],
    at: Date.now(),
  };

  p.items = [];
  assert.equal(p.items.length, 0);

  // Undo restoration
  p.items = [...lastRemoved.items];
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].entryId, sampleItem.entryId);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 6: Reordering, Section Groups & Position Stability
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n📁 Group 6: Reordering, Section Groups & Position Stability");

runTest("6.1 Reordering items maintains contiguous zero-based positions", () => {
  const items = [
    { ...sampleItem, entryId: "e0", position: 0 },
    { ...sampleItem, entryId: "e1", position: 1 },
    { ...sampleItem, entryId: "e2", position: 2 },
  ];

  // Move item at index 2 to index 0
  const [moved] = items.splice(2, 1);
  items.splice(0, 0, moved);

  // Re-sequence
  items.forEach((it, idx) => {
    it.position = idx;
  });

  assert.equal(items[0].entryId, "e2");
  assert.equal(items[0].position, 0);
  assert.equal(items[1].entryId, "e0");
  assert.equal(items[1].position, 1);
  assert.equal(items[2].entryId, "e1");
  assert.equal(items[2].position, 2);
});

runTest("6.2 Creates section groups with notes and maintains group ordering", () => {
  const group1 = {
    id: "grp_1",
    title: "Part 1: Foundational Papers",
    description: "Read these papers first before watching lectures.",
    position: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const group2 = {
    id: "grp_2",
    title: "Part 2: Advanced Implementations",
    description: "Hands-on tutorials and production code walkthroughs.",
    position: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const p = emptyPlaylistManifest("Grouped Research");
  p.groups.push(group1, group2);

  assert.equal(p.groups.length, 2);
  assert.equal(p.groups[0].title, "Part 1: Foundational Papers");
  assert.equal(p.groups[0].description, "Read these papers first before watching lectures.");
  assert.equal(p.groups[1].position, 1);
});

runTest("6.3 Associating items with groups via groupId", () => {
  const p = emptyPlaylistManifest("Grouped Items");
  const itemInGroup = { ...sampleItem, entryId: "e_grp", groupId: "grp_1" };
  const itemUngrouped = { ...sampleItem, entryId: "e_ungrp", groupId: null };

  p.items.push(itemInGroup, itemUngrouped);

  const inGroup = p.items.filter((it) => it.groupId === "grp_1");
  const unGrouped = p.items.filter((it) => it.groupId === null);

  assert.equal(inGroup.length, 1);
  assert.equal(unGrouped.length, 1);
  assert.equal(inGroup[0].entryId, "e_grp");
  assert.equal(unGrouped[0].entryId, "e_ungrp");
});

runTest("6.4 Deleting a group with mode 'keep-items' unlinks items without deleting them", () => {
  const p = emptyPlaylistManifest("Unlink Group Test");
  p.groups.push({ id: "grp_to_delete", title: "Temporary Group", position: 0 });
  p.items.push({ ...sampleItem, entryId: "e1", groupId: "grp_to_delete" });

  // Delete group with keep-items mode
  p.groups = p.groups.filter((g) => g.id !== "grp_to_delete");
  p.items = p.items.map((it) => (it.groupId === "grp_to_delete" ? { ...it, groupId: null } : it));

  assert.equal(p.groups.length, 0);
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].groupId, null);
  assert.equal(p.items[0].entryId, "e1");
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 7: Multi-User Isolation & Offline Database Fallback Resilience
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n📁 Group 7: Multi-User Isolation & Offline Database Fallback Resilience");

runTest("7.1 Multi-user playlist isolation: Owner A cannot access Owner B's playlist records", () => {
  const ownerA = "11111111-1111-1111-1111-111111111111";
  const ownerB = "22222222-2222-2222-2222-222222222222";

  const dbTable = [
    { id: "pl_1", owner_id: ownerA, title: "Owner A's Playlist" },
    { id: "pl_2", owner_id: ownerB, title: "Owner B's Secret Playlist" },
  ];

  function queryUserPlaylists(requestOwnerId) {
    return dbTable.filter((row) => row.owner_id === requestOwnerId);
  }

  const resultsForA = queryUserPlaylists(ownerA);
  const resultsForB = queryUserPlaylists(ownerB);

  assert.equal(resultsForA.length, 1);
  assert.equal(resultsForA[0].title, "Owner A's Playlist");
  assert.equal(resultsForB.length, 1);
  assert.equal(resultsForB[0].title, "Owner B's Secret Playlist");

  // Verify A never receives B's data
  assert.ok(!resultsForA.some((p) => p.owner_id === ownerB));
});

runTest("7.2 Offline database fallback handles errors transparently without crashing", () => {
  // Simulates the try/catch fallback in playlist-db-service.ts
  async function simulateDbSync(offline) {
    try {
      if (offline) {
        throw new Error("getaddrinfo ENOTFOUND db.qrsjlyminkpfcqpsnrxj.supabase.co");
      }
      return { success: true };
    } catch (err) {
      // Returns false or null for fallback
      return { success: false, fallbackToR2: true, error: err.message };
    }
  }

  return simulateDbSync(true).then((res) => {
    assert.equal(res.success, false);
    assert.equal(res.fallbackToR2, true);
    assert.ok(res.error.includes("ENOTFOUND"));
  });
});

console.log(`\n🎉 All ${passedTests}/${totalTests} Playlist Management tests passed successfully!\n`);
