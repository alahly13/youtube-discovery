# YouTube Discovery — Phase 1: Manifest Dataset, Generations & Storage Explorer Specification (v1.4)

**Document:** `docs/data-architecture/manifest-format.md`  
**Version:** 1.4 (Final Architecture Correction + Full Local Implementation Execution)  
**Baseline Date:** 2 November 2026  
**Status:** **APPROVED ARCHITECTURE SPECIFICATION & IMPLEMENTATION FOUNDATION**  
**Execution Mode:** AUTHORIZED LOCAL IMPLEMENTATION & RUNTIME FOUNDATION  

---

## 1. Core Principles, Authority & Sizing Budgets

### 1.1 Single Source of Truth: PostgreSQL is Authoritative
- **PostgreSQL (`storage_datasets.current_generation_id`) is the SOLE authoritative source of truth for which generation is active and committed.**
- The root `manifest.json` file in Supabase Storage is purely a **derived convenience artifact**.
  - It is NOT authoritative.
  - If it is missing, stale, or fails to upload, the database current generation pointer remains 100% authoritative.
  - It can be deterministically regenerated from PostgreSQL at any time.
  - The Manifest Storage Explorer always reads the active generation from PostgreSQL and verifies physical storage parts against database registry rows.

### 1.2 Dual-Layer Architecture
- **PostgreSQL (Authoritative Registry & Index):** Maintains `storage_datasets`, `storage_generations`, `storage_manifest_parts`, and `storage_temp_objects`. It coordinates revisions, locks datasets during commits, tracks SHA-256 hashes, exact byte counts, item counts, and relations.
- **Supabase Storage (Physical Immutable Chunks):** Private bucket `youtube-discovery` stores physical, immutable JSON manifest parts (`part-000001.json`).

### 1.3 Independent Sizing Budgets & Headroom
| Dimension | Budget Limit | Type | Purpose / Reference |
|---|---|---|---|
| **Individual Part Target Size** | `40 MiB` (41,943,040 bytes) | Recommended Target | Optimal streaming, serialization, and parsing performance. |
| **Individual Part Hard Ceiling** | `45 MiB` (47,185,920 bytes) | Hard Limit | Ensures 5 MB safety buffer below Supabase 50 MB Free object limit. Exceeding triggers automatic partition split. |
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
- `SAVED_REFERENCES` (Saved References per owner; `entity_id IS NULL`)

---

## 2. Storage Hierarchy & Direct Permanent Upload Path

To eliminate the risk of accidental TTL deletion of committed parts and avoid expensive cross-folder move operations in Supabase Storage, **manifest parts are uploaded directly to immutable, generation-specific permanent paths scoped by `storage_owner_uuid`**:

```text
Bucket: youtube-discovery (Private)
└── <storage_owner_uuid>/
    ├── persistence/
    │   └── datasets/
    │       ├── <dataset-id>/
    │       │   ├── manifest.json                                      (Derived convenience pointer)
    │       │   └── generations/<generation-id>/
    │       │       ├── manifest.json                                  (Generation descriptor)
    │       │       └── parts/
    │       │           ├── part-000001.json                           (Immutable part <= 45 MiB)
    │       │           └── part-000002.json
    │       └── ...
    └── temp/
        ├── exports/<export-job-id>/workspace-<date>.zip
        └── query-cache/<query-id>.json
```

### 2.1 The Direct Immutable Upload Architecture
1. **Permanent Scoped Destination via `storage_owner_uuid`:**
   Parts are uploaded directly to:
   `<storage_owner_uuid>/persistence/datasets/<dataset-id>/generations/<generation-id>/parts/part-<number>.json`
   *Note:* The path root is `<storage_owner_uuid>` (from `user_profiles.storage_owner_uuid`), NOT `auth_user_id`. This guarantees physical paths remain permanently valid even if the user's Supabase Auth user record is deleted or modified.
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
   If a generation fails verification or is abandoned (`created_at < now() - INTERVAL '24 hours' AND state != 'COMMITTED'`), a background cleanup worker deletes the uncommitted parts from Supabase Storage and transitions the generation to `ABANDONED`.
6. **Zero Risk to Committed Generations:**
   A generation with `state = 'COMMITTED'` is NEVER targeted by cleanup workers.

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

### 4.1 Immutable Manifest Part Contract (`part-000001.json`)

```json
{
  "$schema": "https://youtube-discovery.app/schemas/manifest-part-v1.json",
  "schemaVersion": 1,
  "datasetType": "SAVED_ITEMS",
  "datasetId": "b1f7c3e2-89a1-4321-9988-123456789abc",
  "ownerId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "storageOwnerUuid": "e7b0c442-98fc-4c14-9afb-f4c8996fb924",
  "generationId": "gen_01JBCDEF1234567890ABCDEF",
  "partNumber": 1,
  "totalPartsInGeneration": 2,
  "createdAt": "2026-11-02T12:00:00.000Z",
  "recordCount": 500,
  "items": [
    {
      "platformItemId": "dQw4w9WgXcQ",
      "entityType": "video",
      "title": "Example Video Title",
      "channelTitle": "Example Channel",
      "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "isShortsLike": false,
      "isAgeRestricted": false,
      "publishedAt": "2024-01-15T08:00:00Z",
      "viewsCount": 1450000,
      "likesCount": 85000,
      "commentsCount": 12400,
      "durationSeconds": 212,
      "savedAt": "2026-11-02T10:15:30Z",
      "savedDate": "2026-11-02"
    }
  ]
}
```

### 4.2 Derived Root Manifest Contract (`manifest.json`)

```json
{
  "$schema": "https://youtube-discovery.app/schemas/manifest-root-v1.json",
  "schemaVersion": 1,
  "datasetId": "b1f7c3e2-89a1-4321-9988-123456789abc",
  "datasetType": "SAVED_ITEMS",
  "ownerId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "storageOwnerUuid": "e7b0c442-98fc-4c14-9afb-f4c8996fb924",
  "currentRevision": 4,
  "currentGenerationId": "gen_01JBCDEF1234567890ABCDEF",
  "aggregateSha256": "4a7d1ed414474e4033ac29ccb8653d9b002c9a583921b79f82d23018e698ee5a",
  "lastCommittedAt": "2026-11-02T12:00:00.000Z",
  "totalRecords": 1000,
  "totalBytes": 83886080,
  "parts": [
    {
      "partNumber": 1,
      "storagePath": "e7b0c442-98fc-4c14-9afb-f4c8996fb924/persistence/datasets/b1f7c3e2.../generations/gen_01JB.../parts/part-000001.json",
      "byteCount": 41943040,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "recordCount": 500
    },
    {
      "partNumber": 2,
      "storagePath": "e7b0c442-98fc-4c14-9afb-f4c8996fb924/persistence/datasets/b1f7c3e2.../generations/gen_01JB.../parts/part-000002.json",
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
Owner: user_profile_01 (Storage UUID: e7b0c442-98fc-4c14-9afb-f4c8996fb924)
  ├── Dataset: Saved Items (SAVED_ITEMS)
  │     ├── Revision: 4 (COMMITTED)
  │     └── Generation: gen_01JBCDEF... (Aggregate SHA: 4a7d1ed...)
  │           ├── Part 1: part-000001.json (40.0 MiB, 500 items, VERIFIED)
  │           └── Part 2: part-000002.json (40.0 MiB, 500 items, VERIFIED)
  └── Dataset: Personal Playlist "AI Research" (PLAYLIST)
        └── ...
```

### 5.2 The 6 Real-Time Reconciliation States
1. **`VERIFIED`:** PostgreSQL registry row and physical Supabase Storage object match in existence, byte count, and SHA-256 hash.
2. **`MISSING_FROM_STORAGE`:** PostgreSQL records a part for a committed generation, but the physical object is missing from the bucket.
3. **`UNTRACKED_ORPHAN`:** Object exists in Supabase Storage under `<storage_owner_uuid>/persistence/`, but no database row references it.
4. **`METADATA_MISMATCH`:** Physical object exists, but its byte length or SHA-256 hash does not match `storage_manifest_parts`.
5. **`UNCOMMITTED_GENERATION`:** Objects belong to an active or in-flight generation (`PREPARING`, `UPLOADING`, `VERIFYING`).
6. **`INCOMPLETE_PARTS`:** A generation where some parts were uploaded but others failed or are missing.

### 5.3 Explorer Operations
- **Download Individual Part:** Streams raw UTF-8 JSON bytes directly from Supabase Storage with SHA-256 verification.
- **Export Complete Generation (ZIP):** Server validates all parts' SHA-256 digests, packages them into a ZIP archive with a root index descriptor, and streams the download.
- **Export Dataset:** Exports the current committed generation snapshot along with historical revision metadata.
- **Reconciliation Scan:** Compares PostgreSQL `storage_manifest_parts` against `supabase.storage.from('youtube-discovery').list()` and surfaces discrepancies in the UI.
