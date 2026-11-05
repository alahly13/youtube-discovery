# YouTube Discovery — Manifest Dataset, Generations & Storage Explorer Specification (v2.0)

**Document:** `docs/data-architecture/manifest-format.md`  
**Version:** 2.0 (Canonical Resource Taxonomy + Cloudflare R2 Implementation Reconciliation)  
**Baseline Date:** 2 November 2026  
**Reconciled:** 5 November 2026  
**Status:** **APPROVED ARCHITECTURE SPECIFICATION & IMPLEMENTATION FOUNDATION**  
**Execution Mode:** AUTHORIZED LOCAL IMPLEMENTATION & RUNTIME FOUNDATION  

> **2026-11-05 reconciliation:** The physical object store is Cloudflare R2 (NEW bucket `new-youtube-discovery-private`), not Supabase Storage. Manifest parts use the taxonomy-v2 envelope. The canonical resource taxonomy and stable IDs described below are mandatory. Applied database truth: 6 migrations, including `20261104230000_canonical_resource_classification`. See §6 for the authoritative paths and hydration rules.

---

## 1. Core Principles, Authority & Sizing Budgets

### 1.1 Single Source of Truth: PostgreSQL is Authoritative
- **PostgreSQL (`storage_datasets.current_generation_id`) is the SOLE authoritative source of truth for which generation is active and committed.**
- The root `manifest.json` file in Cloudflare R2 is purely a **derived convenience artifact**.
  - It is NOT authoritative.
  - If it is missing, stale, or fails to upload, the database current generation pointer remains 100% authoritative.
  - It can be deterministically regenerated from PostgreSQL at any time.
  - The Manifest Storage Explorer always reads the active generation from PostgreSQL and verifies physical storage parts against database registry rows.

### 1.2 Dual-Layer Architecture
- **PostgreSQL (Authoritative Registry & Index):** Maintains `storage_datasets`, `storage_generations`, `storage_manifest_parts`, and `storage_temp_objects`. It coordinates revisions, locks datasets during commits, tracks SHA-256 hashes, exact byte counts, item counts, and relations.
- **Cloudflare R2 (Physical Immutable Chunks):** Private bucket `new-youtube-discovery-private` stores physical, immutable JSON manifest parts (`part-000001.json`) under `asdy/persistence/<storage_owner_uuid>/...`.

### 1.3 Independent Sizing Budgets & Headroom
| Dimension | Budget Limit | Type | Purpose / Reference |
|---|---|---|---|
| **Individual Part Target Size** | `40 MiB` (41,943,040 bytes) | Recommended Target | Optimal streaming, serialization, and parsing performance. |
| **Individual Part Hard Ceiling** | `45 MiB` (47,185,920 bytes) | Hard Limit | Worker per-item limit; batch upload is capped at 50 items and 200 MiB per batch. Exceeding triggers automatic partition split. |
| **Total Generation Budget** | `500 MiB` (524,288,000 bytes) | Soft Operational Recommendation | Prompts warning in Storage Explorer if approaching plan capacity. |
| **Total Project Storage** | Subject to live plan (e.g. 1 GB Free plan) | Operational Constraint | Not an architectural guarantee; monitored via storage health diagnostics. |

- **Measurement Rule:** Always measure UTF-8 byte length (`Buffer.byteLength(str, "utf8")`). String character lengths are strictly prohibited for sizing calculations.
- **Atomicity Rule:** A single logical record must NEVER be split across manifest parts. If one individual record exceeds 45 MiB, it is rejected with a clear diagnostic.

### 1.4 Canonical Dataset Types
Collections are completely removed. Supported dataset types are strictly:
- `SAVED_ITEMS` (Global Saved Items index per owner; `entity_id IS NULL`)
- `PLAYLIST` (Per personal playlist: `entity_id = playlist_id::text`)
- `SEARCH_HISTORY` (Per executed search or consolidated search history: `entity_id = search_id::text` or `NULL`)
- `RESEARCH_QUEUE` (Research Queue per owner; `entity_id IS NULL`)
- `REFERENCES` (Saved Titles & Links per owner; `entity_id IS NULL`)

> **Naming guard:** `REFERENCES` is the dataset type. `SAVED_TITLE` and `SAVED_LINK` are *resource types* stored inside that dataset. Do not conflate the two, and do not use `SAVED_REFERENCES` as a dataset discriminator.

### 1.5 Canonical Resource Taxonomy (Manifest Discriminator)

Every manifest record carries an explicit `resourceType` and stable identity fields. The taxonomy is shared by the client, API routes, database indexes, Worker uploads, R2 parts, hydration, exports, and the Manifest Explorer:

| Resource Type | Dataset(s) | Required Evidence |
|---|---|---|
| `VIDEO` | `SAVED_ITEMS`, `PLAYLIST`, `SEARCH_HISTORY`, `RESEARCH_QUEUE` | Video ID / watch URL / authoritative video entity |
| `VIDEO_SHORT` | same as `VIDEO` | Explicit `/shorts/<id>` URL or authoritative provider field only |
| `CHANNEL` | `SAVED_ITEMS`, `PLAYLIST`, `RESEARCH_QUEUE` | `UC...` channel ID / channel URL |
| `YOUTUBE_PLAYLIST` | `SAVED_ITEMS`, `PLAYLIST`, `RESEARCH_QUEUE` | Playlist ID / `playlist?list=` URL |
| `USER_PLAYLIST` | `PLAYLIST` | Personal playlist identity |
| `SAVED_TITLE` | `REFERENCES` | Title-only reference (URL optional) |
| `SAVED_LINK` | `REFERENCES` | Valid URL required |
| `SAVED_SEARCH` | `SEARCH_HISTORY` (preset context) | Saved query preset; never search history |

- `VIDEO_SHORT` is never inferred from duration, aspect ratio, title, or the legacy `isShortsLike` heuristic.
- `SAVED_SEARCH` is never assigned to a search-history execution record.
- Unclassifiable records are surfaced as `UNKNOWN`/`LEGACY`; they are not silently relabeled.

---

## 1.6 2026 Client-Local Feature: "I Will Search For" (Zero Cloud)
In addition to the 5 canonical cloud datasets, the system provides a 100% client-local research reminder notebook:
- **Local Store:** `local_research_reminders` in IndexedDB (`idb-database` v3).
- **Isolation:** Excluded from the cloud sync outbox, zero network traffic, zero database rows, zero Worker/R2 objects.
- **Purpose:** Quick personal research reminders ("سأبحث عنه") bookmarked directly from search results.
- **Accumulated Manifest:** Client-accumulated local manifest exportable on-demand as a single JSON file.

---

## 2. Storage Hierarchy & Direct Permanent Upload Path

To eliminate the risk of accidental TTL deletion of committed parts and avoid expensive cross-folder move operations in object storage, **manifest parts are uploaded directly to immutable, generation-specific permanent paths scoped by `storage_owner_uuid`**:

```text
Bucket: new-youtube-discovery-private (Private, Cloudflare R2)
└── asdy/
    ├── persistence/
    │   └── <storage_owner_uuid>/
    │       ├── saved-items/
    │       │   ├── version.json                                      (Derived convenience pointer)
    │       │   ├── manifest.json                                     (Derived dataset index)
    │       │   └── generations/<generation-id>/
    │       │       ├── manifest.json                                 (Generation descriptor)
    │       │       └── parts/
    │       │           ├── part-000001.json                          (Immutable part <= 45 MiB)
    │       │           └── part-000002.json
    │       ├── saved-playlists/
    │       ├── saved-search-history/
    │       ├── research-queue/
    │       └── references/
    └── temp/
        └── <storage_owner_uuid>/
            ├── <sync-batch-id>/<dataset-slug>/...
            └── exports/<export-job-id>/...
```

### 2.1 The Direct Immutable Upload Architecture
1. **Permanent Scoped Destination via `storage_owner_uuid`:**
   Parts are uploaded directly to:
   `asdy/persistence/<storage_owner_uuid>/<dataset-slug>/generations/<generation-id>/parts/part-<number>.json`
   *Note:* The path root is `<storage_owner_uuid>` (from `user_profiles.storage_owner_uuid`), NOT `auth_user_id`. The canonical resolver is `src/lib/storage/canonical-paths.ts`; no other module may invent a path.
2. **Authority Decoupling:**
   Even though the physical file lives in `/persistence/`, it is **completely invisible** to standard application queries and the Manifest Storage Explorer until PostgreSQL executes Stage 4 (Atomic Commit), sets `storage_generations.state = 'COMMITTED'`, and updates `storage_datasets.current_generation_id`.
3. **Commit Ordering Rule:**
   Inside the PostgreSQL transaction for Stage 4:
   - `storage_generations.state` is updated to `'COMMITTED'` first.
   - `storage_datasets.current_generation_id` is updated second.
   This guarantees that the database trigger `trg_dataset_current_generation_guard` verifies the generation is already in `COMMITTED` state.
4. **No Storage Move/Rename:**
   Upon successful commit, zero storage API calls are needed to "promote" the files. The database transaction completes the commit atomically.
5. **Compensating Cleanup of Abandoned Generations:**
   If a generation fails verification or is abandoned (`created_at < now() - INTERVAL '24 hours' AND state != 'COMMITTED'`), a background cleanup worker deletes the uncommitted parts from R2 and transitions the generation to `ABANDONED`.
6. **Zero Risk to Committed Generations:**
   A generation with `state = 'COMMITTED'` is NEVER targeted by cleanup workers. The NEW Worker also refuses to overwrite generation objects and permits DELETE only under `asdy/temp/<owner>/...`.
7. **Batch Upload Limits (NEW Worker):**
   `POST /v1/batches/upload` accepts at most 50 items per batch, 45 MiB per item, and 200 MiB per batch. It rejects duplicate keys, verifies each item's byte count and SHA-256, and treats identical existing objects as idempotent. Conflicting immutable objects return `409`.

---

## 3. Cryptographic Hash Specifications

Data integrity in YouTube Discovery relies on two levels of cryptographic hashing:

### 3.1 Individual Part SHA-256
Every manifest part file (`part-XXXXXX.json`) has its raw UTF-8 payload hashed with SHA-256:
- **Input:** The exact byte array of the JSON part file as written to storage.
- **Algorithm:** Standard `crypto.createHash('sha256').update(buffer).digest('hex')`.
- **Format:** Lowercase 64-character hexadecimal string stored in `storage_manifest_parts.sha256`.

### 3.2 Deterministic Aggregate Generation SHA-256
To detect tampering, part substitution, missing chunks, or reordering within a generation, a generation-wide aggregate checksum is computed over all parts in binary sequence:

```text
Aggregate SHA-256 Construction:
1. Initialize SHA-256 hasher.
2. Feed UTF-8 domain separator prefix:
   "YOUTUBE-DISCOVERY-GENERATION-V1\0"
3. For each manifest part in the generation sorted by part_number ASC (1 .. N):
   a. Write 4-byte big-endian unsigned integer of part_number (uint32_be)
   b. Write 8-byte big-endian unsigned integer of byte_count (uint64_be)
   c. Write 8-byte big-endian unsigned integer of record_count (uint64_be)
   d. Write 32 raw bytes of the individual part's SHA-256 (decoded from 64-char hex)
4. Finalize hasher and output 64-character lowercase hexadecimal string.
```

This aggregate hash is stored in `storage_generations.aggregate_sha256` and recorded in the derived generation descriptor.

---

## 4. Manifest Data Contracts

### 4.1 Immutable Manifest Part Contract (`part-000001.json`, taxonomy v2)

```json
{
  "$schema": "https://youtube-discovery.app/schemas/manifest-part-v2.json",
  "schemaVersion": 2,
  "resourceSchemaVersion": 2,
  "datasetType": "SAVED_ITEMS",
  "datasetId": "b1f7c3e2-89a1-4321-9988-123456789abc",
  "ownerId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "storageOwnerUuid": "e7b0c442-98fc-4c14-9afb-f4c8996fb924",
  "generationId": "4f2a5c1e-8f0b-4f1a-9e3d-2b6c7d8e9f01",
  "partNumber": 1,
  "totalPartsInGeneration": 2,
  "createdAt": "2026-11-05T12:00:00.000Z",
  "recordCount": 2,
  "resourceTypeCounts": { "VIDEO": 1, "VIDEO_SHORT": 1 },
  "items": [
    {
      "recordId": "video:dQw4w9WgXcQ",
      "resourceType": "VIDEO",
      "resourceId": "dQw4w9WgXcQ",
      "classificationSource": "platform_url",
      "classificationEvidence": "youtube watch URL",
      "platformItemId": "dQw4w9WgXcQ",
      "entityType": "video",
      "title": "Example Video Title",
      "channelTitle": "Example Channel",
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "isShortsLike": false,
      "isAgeRestricted": false,
      "publishedAt": "2024-01-15T08:00:00Z",
      "viewsCount": 1450000,
      "likesCount": 85000,
      "commentsCount": 12400,
      "durationSeconds": 212,
      "savedAt": "2026-11-05T10:15:30Z",
      "savedDate": "2026-11-05"
    },
    {
      "recordId": "video_short:AbCdEf12345",
      "resourceType": "VIDEO_SHORT",
      "resourceId": "AbCdEf12345",
      "classificationSource": "explicit_url",
      "classificationEvidence": "explicit /shorts/ URL",
      "platformItemId": "AbCdEf12345",
      "entityType": "video",
      "title": "Example Short Title",
      "url": "https://www.youtube.com/shorts/AbCdEf12345",
      "durationSeconds": 42,
      "savedAt": "2026-11-05T10:16:00Z",
      "savedDate": "2026-11-05"
    }
  ]
}
```

- `resourceType` is mandatory and authoritative. `entityType` is only a coarse relational bucket and must never override it.
- `recordId` is the stable application record identity; `resourceId` is the platform or application entity identity. Neither is derived from title, filename, index, or date.
- `isShortsLike` is a legacy presentation heuristic only. It is not evidence for `VIDEO_SHORT`.
- Records that lack reliable evidence keep `UNKNOWN`/`LEGACY` classification rather than being coerced.

### 4.2 Derived Root Manifest Contract (`manifest.json`)

```json
{
  "$schema": "https://youtube-discovery.app/schemas/manifest-root-v2.json",
  "schemaVersion": 2,
  "resourceSchemaVersion": 2,
  "datasetId": "b1f7c3e2-89a1-4321-9988-123456789abc",
  "datasetType": "SAVED_ITEMS",
  "ownerId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "storageOwnerUuid": "e7b0c442-98fc-4c14-9afb-f4c8996fb924",
  "currentRevision": 4,
  "currentGenerationId": "4f2a5c1e-8f0b-4f1a-9e3d-2b6c7d8e9f01",
  "aggregateSha256": "4a7d1ed414474e4033ac29ccb8653d9b002c9a583921b79f82d23018e698ee5a",
  "lastCommittedAt": "2026-11-05T12:00:00.000Z",
  "totalRecords": 1000,
  "totalBytes": 83886080,
  "resourceTypeCounts": { "VIDEO": 990, "VIDEO_SHORT": 10 },
  "parts": [
    {
      "partNumber": 1,
      "storagePath": "asdy/persistence/e7b0c442-98fc-4c14-9afb-f4c8996fb924/saved-items/generations/4f2a5c1e-8f0b-4f1a-9e3d-2b6c7d8e9f01/parts/part-000001.json",
      "byteCount": 41943040,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "recordCount": 500
    },
    {
      "partNumber": 2,
      "storagePath": "asdy/persistence/e7b0c442-98fc-4c14-9afb-f4c8996fb924/saved-items/generations/4f2a5c1e-8f0b-4f1a-9e3d-2b6c7d8e9f01/parts/part-000002.json",
      "byteCount": 41943040,
      "sha256": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
      "recordCount": 500
    }
  ]
}
```

---

## 5. Manifest Storage Explorer Specification

The `/manifests` route is a real, physical storage inspection and management workbench:

### 5.1 Visual Hierarchy
```text
Owner: asdy (Storage UUID: c987539d-246a-4817-b958-b0ea32c590f9)
  ├── Dataset: Saved Items (SAVED_ITEMS)
  │     ├── Revision: 4 (COMMITTED)
  │     └── Generation: 4f2a5c1e... (Aggregate SHA: 4a7d1ed...)
  │           ├── Part 1: part-000001.json (40.0 MiB, 500 items, VERIFIED)
  │           └── Part 2: part-000002.json (40.0 MiB, 500 items, VERIFIED)
  ├── Dataset: Saved Titles & Links (REFERENCES)
  │     └── Resource badges: SAVED_TITLE | SAVED_LINK
  └── Dataset: Personal Playlist "AI Research" (PLAYLIST)
        └── ...
```

### 5.2 The 6 Real-Time Reconciliation States
1. **`VERIFIED`:** PostgreSQL registry row and physical R2 object match in existence, byte count, and SHA-256 hash.
2. **`MISSING_FROM_STORAGE`:** PostgreSQL records a part for a committed generation, but the physical object is missing from the bucket.
3. **`UNTRACKED_ORPHAN`:** Object exists in R2 under `asdy/persistence/<storage_owner_uuid>/`, but no database row references it.
4. **`METADATA_MISMATCH`:** Physical object exists, but its byte length or SHA-256 hash does not match `storage_manifest_parts`.
5. **`UNCOMMITTED_GENERATION`:** Objects belong to an active or in-flight generation (`PREPARING`, `UPLOADING`, `VERIFYING`).
6. **`INCOMPLETE_PARTS`:** A generation where some parts were uploaded but others failed or are missing.

### 5.3 Explorer Operations
- **Download Individual Part:** Streams raw UTF-8 JSON bytes directly from R2 with SHA-256 verification.
- **Export Complete Generation (ZIP):** Server validates all parts' SHA-256 digests, packages them into a ZIP archive with a root index descriptor, and streams the download.
- **Export Dataset:** Exports the current committed generation snapshot along with historical revision metadata.
- **Reconciliation Scan:** Compares PostgreSQL `storage_manifest_parts` against R2 object listings and surfaces discrepancies in the UI.
- **Record Cards:** The Explorer classifies each record through `classifyResourceRecord` and displays the canonical `resourceType` badge, classification source/evidence, `recordId`, origin device, and canonical URL. It never infers type from `itemType`, `type`, or `kind` string matching alone.

---

## 6. 2026 Authoritative Canonical Cloudflare R2 Paths & Cloud Hydration

### 6.1 Canonical Cloudflare R2 Storage Hierarchy
In 2026 production, all permanent dataset generations and manifest parts are stored in the private Cloudflare R2 bucket `new-youtube-discovery-private` using the authoritative `asdy/` root prefix:

```text
Bucket: new-youtube-discovery-private
├── asdy/
│   ├── persistence/
│   │   └── <storage_owner_uuid>/
│   │       ├── saved-items/
│   │       │   ├── version.json
│   │       │   └── generations/<gen_id>/
│   │       │       ├── manifest.json
│   │       │       └── parts/
│   │       │           ├── part-000001.json
│   │       │           └── part-000002.json
│   │       ├── saved-playlists/
│   │       │   └── ...
│   │       ├── saved-search-history/
│   │       │   └── ...
│   │       ├── research-queue/
│   │       │   └── ...
│   │       └── references/
│   │           └── ...
│   └── temp/
│       └── <storage_owner_uuid>/
│           └── <sync_batch_id>/
│               └── <dataset-slug>/
│                   └── ...
```

### 6.2 Canonical Dataset Slugs
| Dataset Type | Canonical Kebab-Case Slug | Description |
|---|---|---|
| `SAVED_ITEMS` | `saved-items` | User's global saved YouTube videos, channels, and playlists |
| `PLAYLIST` | `saved-playlists` | Custom curated playlists created by the user |
| `SEARCH_HISTORY` | `saved-search-history` | Automated and manually saved YouTube search queries |
| `RESEARCH_QUEUE` | `research-queue` | Queued items prioritized for deep study and AI analysis |
| `REFERENCES` | `references` | Saved titles and links (`SAVED_TITLE` / `SAVED_LINK`) |

### 6.3 Legacy Path Read Compatibility
Historical paths created under `<owner-id>/persistence/...` are fully supported for reading, tree rendering, and streaming without modifying or deleting historical Cloudflare R2 objects. Newly uploaded generations strictly write to `asdy/persistence/<storage_owner_uuid>/...`. The NEW Worker permits legacy paths only for reads; all writes and deletes are owner-namespace enforced.

### 6.4 9-State Cloud Hydration State Machine
When a user launches YouTube Discovery on a fresh device or clean browser profile, the client hydration service restores the local IndexedDB library from Supabase PostgreSQL and Cloudflare R2 through 9 explicit lifecycle phases:
1. `NOT_HYDRATED`
2. `CHECKING_REGISTRY`
3. `FETCHING_MANIFEST`
4. `FETCHING_PARTS`
5. `VERIFYING` (mandatory SHA-256 + byte count + record count + envelope identity)
6. `RESTORING_LOCAL_INDEX` (snapshot replacement into IndexedDB)
7. `MERGING_PENDING_CHANGES` (outbox preservation)
8. `READY`
9. `PARTIAL_FAILURE` / `FAILED`

**Snapshot semantics:** An incoming committed generation is the complete snapshot of its dataset, not a delta. Hydration replaces the dataset projection, removes records that no longer exist in the snapshot, and preserves pending outbox entities. Missing or invalid SHA-256 fails closed; legacy parts without checksums are not hydrated.

**Save pipeline semantics:** `POST /api/sync/save-all` resolves the canonical `storage_owner_uuid`, requires a profile, validates the expected revision, uploads manifest + parts, calls the Worker `batch_verify`, and only then commits the database transaction. A missing or failed verification prevents the DB commit and returns an explicit failure, never a false `ok`.

### 6.5 IndexedDB v4 Synchronized Stores
- `local_dataset_catalog`: Tracks local vs remote authoritative revisions per dataset.
- `sync_journal`: Records immutable batches (`UPLOADING` -> `COMMITTED` / `FAILED`).
- `sync_leases`: Mutex lease locks preventing concurrent multi-tab sync races.

### 6.6 Saved Titles & Links (`REFERENCES`)

The `/saved-titles-links` page is the canonical workspace for `SAVED_TITLE` and `SAVED_LINK` records. It is local-first: edits commit to IndexedDB and the `REFERENCES` outbox before any network call, then synchronize through the same snapshot pipeline as other datasets. `SAVED_LINK` requires a valid URL; `SAVED_TITLE` may be title-only. The database mirror is `saved_references`, with `record_id`, `resource_type`, `resource_id`, and origin-device fields.

### 6.7 Manifest Explorer Taxonomy Display

The Manifest Explorer uses the shared classifier (`src/lib/resources/resource-taxonomy.ts`), not ad-hoc string matching. For each record it displays:
- canonical `resourceType` badge and tone;
- classification source/evidence (`explicit`, `platform_url`, `provider_field`, etc.);
- stable `recordId` and canonical URL fallback;
- origin device label when present.

`UNKNOWN` and `LEGACY` are valid, visible outcomes. They must never be silently converted into `VIDEO`, `SAVED_TITLE`, or another plausible type.
