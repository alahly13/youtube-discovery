# YouTube Discovery — Global Manifest Naming, Directory & Versioning Standard (2026)

**Specification Version:** `2026.1`  
**Classification:** Canonical Architecture Standard  
**Authority Boundary:** Client Repositories, Next.js Server Routes, Cloudflare Workers, Storage Backends, Local Durability (IndexedDB) & Export Packages  
**Owner Namespace:** `asdy` (Authoritative Administrator: `asdy@youtube.discov.com`)

---

## 1. Executive Summary & Objective

This document defines the unified, production-grade **Manifest Naming, Directory Organization, Metadata Envelope, and Versioning System** across the entire YouTube Discovery SaaS platform.

The core mission is to make every persisted file, snapshot, part, archive, and export package immediately identifiable and verifiable by:
- **Its business entity and related application page** (e.g. `saved_items`, `playlists`, `saved_titles_links`, `search_history`).
- **Its actual content or purpose** via sanitized, human-readable slugs.
- **Its original creation date and update timestamp** using standardized UTC formats.
- **Its immutable version progression** (`v001` → `v002` → `v003`).
- **Its authenticated owner and storage location**.
- **Its lineage and relationship** to previous and child versions.

---

## 2. Canonical Directory Architecture

All authoritative persisted objects for the administrator belong to the canonical namespace `asdy/`.

### 2.1 Entity Namespaces

| Business Entity | Application Page | Canonical Directory Prefix | Purpose |
| :--- | :--- | :--- | :--- |
| `saved_items` | `/saved` | `asdy/saved-items/` | Saved YouTube Videos, Shorts, Channels, and Playlists |
| `playlists` | `/playlist-manager` | `asdy/playlists/` | Personal user playlists, groups, and membership records |
| `saved_searches` | `/saved-searches` | `asdy/saved-searches/` | Reusable pinned query presets and filter snapshots |
| `search_history` | `/history` | `asdy/search-history/` | Chronological search history records with raw manifest links |
| `saved_titles_links` | `/saved-titles-links` | `asdy/saved-titles-links/` | External links and user-saved reference titles (`REFERENCES`) |
| `collections` | `/collections` | `asdy/collections/` | Topic collections and research groupings |
| `search_manifests` | `/manifests` | `asdy/search-manifests/` | Ephemeral & durable YouTube Data API search result manifests |
| `api_keys` | `/settings` | `asdy/api-keys/` | Encrypted managed YouTube API v3 key snapshots |
| `admin_settings` | `/settings` | `asdy/admin-settings/` | User preferences, fetch controls, and security posture snapshots |
| `exports` | `/download-center` | `asdy/exports/` | Generated export ZIP packages, backups, and checksum tables |
| `temp` | Staging | `asdy/temp/` | Ephemeral upload staging and chunk aggregation |

### 2.2 Date-Based Directory Hierarchy

Permanent versioned datasets use a date-based directory hierarchy representing the **dataset's original creation date**:

```
{namespace}/{YYYY}/{MM}/{YYYY-MM-DD}/
```

**Examples:**
- `asdy/saved-items/2026/11/2026-11-09/`
- `asdy/saved-titles-links/2026/11/2026-11-09/`
- `asdy/search-history/2026/11/2026-11-09/`

> [!IMPORTANT]
> **Creation Date Invariance:**  
> The directory date represents the dataset's **original creation date** and must remain unchanged when new versions are committed. New versions (`v002`, `v003`) remain under the original dataset directory to preserve lineage and identity.

### 2.3 Individual Playlists & Entity Isolation

For independently managed entities with stable IDs (such as personal playlists):
```
asdy/playlists/{playlistId}/{YYYY}/{MM}/{YYYY-MM-DD}/
```
Example:
```
asdy/playlists/science_lectures_2026/2026/11/2026-11-09/
```

### 2.4 Temporary Staging Hierarchy

Temporary and uncommitted upload objects are strictly partitioned away from permanent archives:
```
asdy/temp/{entityType}/{uploadId}/
```
Example:
```
asdy/temp/saved-items/batch_01JBCDEF12345/
```
Temporary objects have an automatic TTL expiration (default: 86,400 seconds / 24 hours).

---

## 3. Professional File Naming Convention

All manifest documents and structured JSON data files must be named using the centralized naming grammar:

```
{entity}_{contentSlug}_{createdAt}_{version}.{extension}
```

### 3.1 Filename Examples

- `saved_items_ai_research_20261109T153000Z_v001.json`
- `playlist_molecular_biology_20261109T153000Z_v001.json`
- `search_history_chromatography_20261109T153000Z_v001.json`
- `saved_titles_links_references_20261109T153000Z_v001.json`
- `saved_searches_quantum_computing_20261109T153000Z_v001.json`

### 3.2 Naming Rules & Safety Constraints

1. **UTC Timestamps:** Filenames use compact UTC ISO timestamps (`YYYYMMDDTHHmmssZ`).
2. **Filesystem Safety:** Slugs are sanitized to lowercase ASCII alphanumeric characters, underscores, and hyphens (`[a-z0-9_-]`). Spaces, special characters, and non-ASCII glyphs are converted or removed.
3. **Sequential Versioning:** Versions are formatted with zero-padded sequential identifiers (`v001`, `v002`, etc., minimum 3 digits).
4. **Collision Resistance:** Each committed version is uniquely named and immutable.
5. **No Blind Overwrites:** A filename is never reused for different content; historical versions are never overwritten.
6. **Browser Storage Structured Keys:** In local browser storage (IndexedDB / localStorage), records follow the equivalent structured key:
   `yd:manifest:{entity}:{contentSlug}:{version}` (e.g. `yd:manifest:saved_items:ai_research:v001`).

---

## 4. Immutable Manifest Versioning

Every versioned dataset follows linear immutable succession:
```
v001 ──► v002 ──► v003 ──► v004
```

- **Stable Dataset Identity:** Permanent UUID or stable ID (`datasetId`) that remains constant across all revisions.
- **Linear Successor:** Every new version points to its immediate parent (`previousVersionId`).
- **Immutability Trigger:** Once committed to Cloudflare R2 and Supabase PostgreSQL, a version document cannot be modified or deleted. New updates append a new version.
- **Current Version Pointer:** A lightweight pointer (`version.json`) points to the latest valid generation/version.

---

## 5. Mandatory Manifest Metadata Envelope

Every persisted manifest JSON object must contain a validated `metadata` envelope:

```json
{
  "metadata": {
    "manifestId": "mnf_12345678-1234-1234-1234-123456789abc",
    "datasetId": "dst_98765432-4321-4321-4321-cba987654321",
    "ownerId": "usr_55555555-5555-5555-5555-555555555555",
    "entityType": "saved_items",
    "page": "saved",
    "description": "Saved YouTube discovery items for quantum research",
    "schemaVersion": 1,
    "version": 3,
    "createdAt": "2026-11-09T15:30:00.000Z",
    "updatedAt": "2026-11-09T22:00:00.000Z",
    "previousVersionId": "mnf_87654321-4321-4321-4321-ba9876543210",
    "parentManifestId": null,
    "itemCount": 1250,
    "fileSizeBytes": 12500000,
    "checksumSha256": "4a5e3f6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f",
    "storageProvider": "r2",
    "storagePath": "asdy/saved-items/2026/11/2026-11-09/saved_items_quantum_research_20261109T153000Z_v003.json"
  },
  "items": []
}
```

### Field Contracts:
- `createdAt`: Set at initial dataset creation; never changes.
- `updatedAt`: Updated on each new version commit.
- `itemCount`: Exact number of records in `items`.
- `fileSizeBytes`: Exact UTF-8 serialized byte count of the document.
- `checksumSha256`: Authentic 64-character lowercase hex SHA-256 digest calculated over the serialized bytes.
- `storageProvider`: Authoritative provider (`"r2"`, `"disk"`, `"indexeddb"`, `"supabase"`).
- `storagePath`: Exact physical object key.

---

## 6. Sizing, Chunking & Storage Ceilings

To preserve performance and stay within object-storage bounds:
- **Target Part Size:** `41,943,040 bytes` (~40 MiB).
- **Hard Application Ceiling:** `47,185,920 bytes` (45 MiB).
- When a dataset exceeds 40 MiB:
  1. Records are split across sequential, immutable parts (`parts/part-000001.json`, `parts/part-000002.json`).
  2. Each part receives its own authentic byte count and SHA-256 checksum.
  3. A parent generation manifest references all parts and computes a deterministic aggregate SHA-256 digest.

---

## 7. Legacy Data Compatibility & Zero-Deletion Safety

> [!CAUTION]
> **Zero-Deletion Guarantee:**  
> Existing archives and legacy data must NEVER be deleted, purged, or overwritten.

The centralized `resolveManifestPath()` resolver transparently classifies both modern and legacy objects:
1. `CANONICAL_2026_STANDARD`: `asdy/{namespace}/{YYYY}/{MM}/{YYYY-MM-DD}/{entity}_{slug}_{timestamp}_v{version}.json`
2. `CANONICAL_GENERATION_V2`: `asdy/persistence/<ownerId>/<datasetSlug>/generations/<genId>/manifest.json`
3. `CANONICAL_HISTORICAL_V2`: `asdy/persistence/<ownerId>/<datasetSlug>/before-app-updating/...`
4. `OLD_ARCHIVE`: `asdy/old/<category>/<archiveId>/manifest.json`
5. `BROWSER_STORAGE`: `yd:manifest:{entity}:{slug}:{version}`
6. `LEGACY_PERSISTENCE`: `<ownerId>/persistence/...`

All historical objects remain permanently accessible and downloadable through the Manifest Explorer and Download Center.

---

## 8. Database Approval Gate Status

The PostgreSQL schema foundation consists of the 6 approved and applied migrations:
1. `20261102000000_canonical_v1_4_foundation`
2. `20261102220000_phase1_5_security_and_old_archive`
3. `20261103150000_canonical_private_storage_bucket`
4. `20261103173000_old_and_new_buckets_separation`
5. `20261104200000_device_identity_and_origin_metadata`
6. `20261104230000_canonical_resource_classification`

In accordance with the active **Database Approval Gate**:
- All naming utilities, path builders, and metadata validators have been implemented in the application layer.
- **Zero unapproved database migrations were created or applied.**
- No modifications were made to the remote database schema.

---

## 9. Verification & Automated Test Coverage

The standard is continuously validated by:
- `npm run test:naming`: Comprehensive unit tests covering path builders, slug sanitization, timestamp formatting, metadata envelope verification, and legacy path resolution (62/62 tests passing).
- `npm run test:manifest`: Serialization, chunking, and aggregate SHA-256 validation (97/97 tests passing).
- `npm run test:taxonomy`: Canonical resource taxonomy validation (40/40 tests passing).
