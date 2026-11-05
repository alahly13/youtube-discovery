# YouTube Discovery — Canonical Data Dictionary (v2.0)

**Document:** `docs/data-architecture/data-dictionary.md`  
**Version:** 2.0 (Canonical Resource Taxonomy + Cloudflare R2 Reconciliation)  
**Baseline Date:** 2 November 2026  
**Reconciled:** 5 November 2026  
**Status:** **CANONICAL ARCHITECTURE SPECIFICATION**  
**Execution Mode:** AUTHORIZED LOCAL IMPLEMENTATION ACTIVE  
**Migration Boundary:** 6 MIGRATIONS APPLIED ON REMOTE SUPABASE POSTGRESQL (LATEST: `20261104230000_canonical_resource_classification`)

> **2026-11-05 reconciliation:** The live Prisma schema and applied migrations are authoritative. The physical object store is Cloudflare R2 (`new-youtube-discovery-private` / `old-youtube-discovery-private`), not Supabase Storage. Canonical paths are `asdy/persistence/<storage_owner_uuid>/<dataset-slug>/...`. `REFERENCES` is the dataset type; `SAVED_TITLE` and `SAVED_LINK` are resource types. Where this document and the live schema differ, the schema and migration SQL win.

---

## 1. Global Conventions & Standards

- **Database Engine:** PostgreSQL 15+ (Supabase).
- **ORM / Migration Tool:** Prisma 7 (`@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `pg@8.20.0`).
- **Primary Keys:** UUID v4 (`gen_random_uuid()`).
- **Timestamps:** `TIMESTAMPTZ` (UTC) across all tables.
- **Numbers & Metrics:** `BIGINT` for YouTube views/likes/comments and storage byte counts; `INTEGER` for sequence numbers, durations, and counts.
- **Zero-Value Guarantee:** `views_count`, `likes_count`, `comments_count` are nullable; `0` is a valid distinct metric and NEVER coerced to `NULL`.
- **Zero-Coercion Rule for Foreign Keys:** Missing optional parent relationships must be stored as standard SQL `NULL`, strictly forbidding synthetic zero UUIDs (`00000000-0000-0000-0000-000000000000`).
- **Strict Owner Isolation Rule:** Every user-owned table includes `owner_id UUID NOT NULL REFERENCES user_profiles(id)`. No ambient or global personal data exists.
- **Stable Storage Owner Identifier:** `user_profiles.storage_owner_uuid` is an immutable UUID generated at provisioning that permanently anchors physical storage paths (`asdy/persistence/<storage_owner_uuid>/...`), surviving authentication account detachment.
- **Composite Integrity Rule:** All parent-child relationships enforce matching `owner_id`, `dataset_id`, or `generation_id` via composite foreign keys.
- **Option A Synchronization:** Each cloud save batch operates on exactly ONE logical dataset and creates exactly ONE generation. There is NO `save_sync_batch_items` entity.
- **Linear Revision History:** Generations form a strict linear sequence (`uq_storage_generations_linear`). Branching is prohibited.
- **Collections Removal:** Collections tables (`COLLECTIONS`, `COLLECTION_ITEMS`) are completely excised.

---

## 2. Table Specifications (Exact 18 Canonical Tables)

### 2.1 Identity, Roles & User Preferences Domain (2 Tables)

#### `user_profiles`
Authoritative profile for each authenticated account, anchored to Supabase Auth.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `auth_user_id` | `uuid` | Yes | `NULL` | Unique FK to `auth.users(id)` ON DELETE SET NULL (Nullable to preserve historical audit/quota records if auth user is deleted) |
| `role` | `varchar(20)` | No | `'user'` | Role privilege: `'admin'` or `'user'` |
| `username` | `varchar(100)` | No | None | Display name (provisioned explicitly; no default) |
| `email_snapshot` | `varchar(255)` | Yes | `NULL` | Audited email; not an authorization key |
| `storage_owner_uuid`| `uuid` | No | `gen_random_uuid()` | Immutable Storage identifier for bucket path prefix; permanent even if `auth_user_id` is detached |
| `storage_namespace`| `varchar(100)` | No | None | Human-readable storage prefix label (provisioned explicitly; no default) |
| `is_suspended` | `boolean` | No | `false` | Administrative lock flag; cuts off RLS and storage access |
| `suspended_at` | `timestamptz` | Yes | `NULL` | Timestamp of account suspension |
| `is_deleted` | `boolean` | No | `false` | Soft-delete flag preserving historical audit rows |
| `deleted_at` | `timestamptz` | Yes | `NULL` | Timestamp of soft-deletion |
| `last_seen_at` | `timestamptz` | Yes | `NULL` | Last verified activity |
| `created_at` | `timestamptz` | No | `now()` | Record creation timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Last modification timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (auth_user_id)`
  - `UNIQUE (storage_owner_uuid)`
  - `CHECK (role IN ('admin', 'user'))`
- **Indexes:**
  - `idx_user_profiles_auth ON user_profiles(auth_user_id)`
  - `idx_user_profiles_storage_owner ON user_profiles(storage_owner_uuid)`
  - `idx_user_profiles_status ON user_profiles(is_suspended, is_deleted)`
- **RLS Considerations:**
  - Users can read their own profile (`auth_user_id = auth.uid()`).
  - Users CANNOT modify `role`, `auth_user_id`, `storage_owner_uuid`, `is_suspended`, `is_deleted`. Enforced via `BEFORE UPDATE` trigger.
- **Retention & Deletion:**
  - Account deletion detaches `auth_user_id = NULL` and sets `is_deleted = true`. Profile row is preserved so `quota_usage_events` and `audit_logs` remain valid.

---

#### `user_preferences`
Canonical 1:1 user settings and application options (single source of truth for preferences).

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | Unique FK to `user_profiles(id)` ON DELETE CASCADE |
| `preferred_timezone`| `varchar(100)`| No | `'UTC'` | User local display timezone (e.g. `'America/Los_Angeles'`) |
| `theme` | `varchar(20)` | No | `'system'` | `'dark'`, `'light'`, `'system'` |
| `default_page_size` | `integer` | No | `25` | Default YouTube search page size |
| `default_max_pages` | `integer` | No | `3` | Default search fetch page depth |
| `default_max_items` | `integer` | No | `150` | Default search max items ceiling |
| `auto_save_enabled` | `boolean` | No | `true` | Global auto-save enable toggle |
| `auto_save_interval_hours`| `integer`| No | `12` | Interval for automatic cloud sync |
| `custom_settings` | `jsonb` | No | `'{}'::jsonb`| Validated extra UI options |
| `updated_at` | `timestamptz` | No | `now()` | Last modification timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id)`
  - `CHECK (theme IN ('dark', 'light', 'system'))`
  - `CHECK (auto_save_interval_hours > 0)`
- **Indexes:** `idx_user_preferences_owner ON user_preferences(owner_id)`
- **RLS Considerations:** Standard owner isolation (`owner_id = current_user_profile_id()`).

---

### 2.2 Storage Registry & Manifest Explorer Domain (4 Tables)

#### `storage_datasets`
Authoritative transactional registry of logical datasets owned by users.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE RESTRICT |
| `dataset_type` | `varchar(50)` | No | None | Type enum constraint |
| `entity_id` | `varchar(100)`| Yes | `NULL` | Logical entity ID (e.g. playlist ID); NULL for singleton datasets |
| `storage_prefix`| `varchar(500)`| No | None | Object storage path prefix (`asdy/persistence/<storage_owner_uuid>/<dataset-slug>/`) |
| `current_generation_id`| `uuid`| Yes | `NULL` | Pointer to current committed generation |
| `current_revision`| `bigint` | No | `0` | Monotonic revision counter (starts at 0 when empty; advances to 1 on first commit) |
| `schema_version`| `integer` | No | `1` | Schema version of dataset items |
| `created_at` | `timestamptz` | No | `now()` | Registration timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Revision advance timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id, id)` (enables composite FKs on child generations)
  - `CHECK (dataset_type IN ('SAVED_ITEMS', 'PLAYLIST', 'SEARCH_HISTORY', 'RESEARCH_QUEUE', 'REFERENCES'))`
  - `CHECK (current_revision >= 0)`
  - `CHECK (schema_version > 0)`
  - `FOREIGN KEY (owner_id, id, current_generation_id) REFERENCES storage_generations(owner_id, dataset_id, id) ON DELETE RESTRICT` (Current generation must belong to this exact dataset and owner)
- **Indexes & Uniqueness Guards:**
  - Partial unique index for singleton datasets:
    `CREATE UNIQUE INDEX uq_storage_datasets_singleton ON storage_datasets (owner_id, dataset_type) WHERE entity_id IS NULL;`
  - Partial unique index for entity-scoped datasets:
    `CREATE UNIQUE INDEX uq_storage_datasets_entity ON storage_datasets (owner_id, dataset_type, entity_id) WHERE entity_id IS NOT NULL;`
  - `idx_storage_datasets_owner ON storage_datasets(owner_id)`
- **Current Generation Commitment Guard (Trigger):**
  A `BEFORE UPDATE OF current_generation_id ON storage_datasets` trigger validates that `current_generation_id` references a generation where `state = 'COMMITTED'`.
- **Initial Revision Semantics:**
  - New Dataset: `current_revision = 0`, `current_generation_id = NULL`.
  - First successful commit: `current_revision = 1`, `current_generation_id = <first_committed_generation_id>`.
  - Subsequent successful commits: `current_revision = current_revision + 1`.

---

#### `storage_generations`
Committed immutable generation snapshots representing point-in-time dataset versions.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE RESTRICT |
| `dataset_id` | `uuid` | No | None | FK to `storage_datasets(id)` ON DELETE CASCADE |
| `source_batch_id` | `uuid` | Yes | `NULL` | Composite FK to originating sync batch (`save_sync_batches(owner_id, dataset_id, id)`) |
| `parent_generation_id`| `uuid` | Yes | `NULL` | Composite self-FK to previous generation (linear lineage) |
| `state` | `varchar(20)` | No | `'PREPARING'` | State machine: `PREPARING`, `UPLOADING`, `VERIFYING`, `COMMITTED`, `FAILED`, `ABANDONED` |
| `idempotency_key`| `varchar(100)`| No | None | Scoped unique key preventing duplicate generation runs |
| `item_count` | `integer` | No | `0` | Total records in generation (>= 0) |
| `part_count` | `integer` | No | `0` | Total manifest parts in generation (>= 0) |
| `total_bytes` | `bigint` | No | `0` | Total serialized UTF-8 bytes across all parts (>= 0) |
| `sha256_checksum`| `varchar(64)` | Yes | `NULL` | Canonical aggregate SHA-256 checksum across parts |
| `schema_version`| `integer` | No | `1` | JSON payload schema version (>= 1) |
| `committed_at`| `timestamptz` | Yes | `NULL` | Timestamp of successful DB commit |
| `created_at` | `timestamptz` | No | `now()` | Generation creation timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id, dataset_id, id)` (composite key for parts and current pointer)
  - `UNIQUE (dataset_id, idempotency_key)` (idempotency scoped to target dataset)
  - `UNIQUE (owner_id, dataset_id, source_batch_id)` (one generation per sync batch)
  - `FOREIGN KEY (owner_id, dataset_id) REFERENCES storage_datasets(owner_id, id) ON DELETE CASCADE`
  - `FOREIGN KEY (owner_id, dataset_id, source_batch_id) REFERENCES save_sync_batches(owner_id, dataset_id, id) ON DELETE RESTRICT`
  - `FOREIGN KEY (owner_id, dataset_id, parent_generation_id) REFERENCES storage_generations(owner_id, dataset_id, id) ON DELETE RESTRICT`
  - `CHECK (parent_generation_id IS NULL OR parent_generation_id != id)`
  - `CHECK (item_count >= 0 AND part_count >= 0 AND total_bytes >= 0 AND schema_version > 0)`
  - `CHECK (sha256_checksum IS NULL OR sha256_checksum ~* '^[a-f0-9]{64}$')`
  - `CHECK (state IN ('PREPARING', 'UPLOADING', 'VERIFYING', 'COMMITTED', 'FAILED', 'ABANDONED'))`
  - `CHECK ((state = 'COMMITTED' AND committed_at IS NOT NULL) OR (state != 'COMMITTED' AND committed_at IS NULL))`
- **Linear Lineage Constraint:**
  `CREATE UNIQUE INDEX uq_storage_generations_linear ON storage_generations (owner_id, dataset_id, parent_generation_id) WHERE state = 'COMMITTED';`
  Enforces that no two committed generations can branch from the same parent.
- **Indexes:** `idx_storage_generations_dataset ON storage_generations(dataset_id, state, created_at DESC)`
- **Retention & Immutability:** Once `state = 'COMMITTED'`, generation is immutable. Old committed generations are preserved by policy; uncommitted/abandoned generations past 24 hours are cleaned up.

---

#### `storage_manifest_parts`
Individual immutable JSON chunk files physically stored in Cloudflare R2 (<= 45 MiB).

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE RESTRICT |
| `dataset_id` | `uuid` | No | None | FK to `storage_datasets(id)` ON DELETE CASCADE |
| `generation_id`| `uuid` | No | None | FK to `storage_generations(id)` ON DELETE CASCADE |
| `part_number` | `integer` | No | None | Ordered 1-based index (`part-000001.json`) |
| `storage_path`| `varchar(500)`| No | None | Direct physical storage path (`asdy/persistence/<storage_owner_uuid>/<dataset-slug>/generations/<generation-id>/parts/part-000001.json`) |
| `record_count`| `integer` | No | None | Record count in this part file (>= 0) |
| `byte_count` | `bigint` | No | None | Exact UTF-8 byte count (Target: <= 40 MiB; Hard ceiling: <= 47,185,920 bytes) |
| `sha256_checksum`| `varchar(64)`| No | None | Hexadecimal 64-character SHA-256 digest |
| `created_at` | `timestamptz` | No | `now()` | Part creation timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (storage_path)`
  - `UNIQUE (generation_id, part_number)`
  - `UNIQUE (owner_id, dataset_id, generation_id, id)` (enables domain index composite FKs)
  - `FOREIGN KEY (owner_id, dataset_id, generation_id) REFERENCES storage_generations(owner_id, dataset_id, id) ON DELETE CASCADE`
  - `CHECK (byte_count > 0 AND byte_count <= 47185920)` (45 MiB hard ceiling)
  - `CHECK (part_number > 0 AND record_count >= 0)`
  - `CHECK (sha256_checksum ~* '^[a-f0-9]{64}$')`
- **Indexes:** `idx_manifest_parts_gen ON storage_manifest_parts(generation_id, part_number)`
- **Storage Path Immutability:** Uploaded directly to permanent path. If generation is committed, path is permanent; if generation fails, file is cleaned up via compensating cleanup.

---

#### `storage_temp_objects`
Registry of managed temporary objects with hard TTL deletion deadlines.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE CASCADE |
| `storage_path`| `varchar(500)`| No | None | Path under `<storage-owner-uuid>/temp/` |
| `temp_type` | `varchar(30)` | No | None | Lifecycle classification: `EXPORT_ARTIFACT`, `TEMP_SEARCH`, `ABANDONED_GENERATION` |
| `byte_size` | `bigint` | No | `0` | Object size in bytes (>= 0) |
| `status` | `varchar(20)` | No | `'ACTIVE'` | State machine: `ACTIVE`, `EXPIRED`, `DELETING`, `DELETED`, `FAILED` |
| `expires_at` | `timestamptz` | No | None | Hard deletion deadline |
| `created_at` | `timestamptz` | No | `now()` | Object creation timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (storage_path)`
  - `CHECK (byte_size >= 0)`
  - `CHECK (temp_type IN ('EXPORT_ARTIFACT', 'TEMP_SEARCH', 'ABANDONED_GENERATION'))`
  - `CHECK (status IN ('ACTIVE', 'EXPIRED', 'DELETING', 'DELETED', 'FAILED'))`
- **Indexes:** `idx_temp_objects_cleanup ON storage_temp_objects(status, expires_at)`
- **Safety Rule:** Cleanup worker deletes objects from storage first, verifies result, then sets `status = 'DELETED'`. Committed manifest parts in `/persistence/` are NEVER entered into this table.

---

### 2.3 User Workspaces & Domain Indexes (8 Tables)

#### `saved_items_index`
Relational search, filter, and daily grouping index. Full immutable payload snapshots live in manifest parts.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE CASCADE |
| `dataset_id` | `uuid` | Yes | `NULL` | FK to `storage_datasets(id)` ON DELETE SET NULL |
| `generation_id`| `uuid` | Yes | `NULL` | FK to `storage_generations(id)` ON DELETE SET NULL |
| `manifest_part_id`| `uuid` | Yes | `NULL` | FK to `storage_manifest_parts(id)` ON DELETE SET NULL |
| `item_position`| `integer`| Yes | `NULL` | Index position within part `items[]` array (>= 0) |
| `entity_type` | `varchar(20)` | No | None | YouTube resource type: `'video'`, `'channel'`, `'playlist'` |
| `platform_item_id`| `varchar(100)`| No | None | Canonical YouTube ID |
| `title` | `varchar(500)`| No | None | Item title |
| `channel_title`| `varchar(255)`| Yes | `NULL` | Channel title |
| `thumbnail_url`| `text` | Yes | `NULL` | High-resolution thumbnail image URL |
| `is_shorts_like`| `boolean`| No | `false` | Legacy visual heuristic only; NEVER evidence for `VIDEO_SHORT` |
| `is_age_restricted`| `boolean`| No| `false` | Age restriction indicator |
| `origin_device_id`| `varchar(128)`| Yes | `NULL` | Stable device identity that created the record |
| `origin_device_label`| `varchar(128)`| Yes | `NULL` | Human-friendly device label |
| `resource_type` | `varchar(32)` | Yes | `NULL` | Canonical taxonomy discriminator (`VIDEO`, `VIDEO_SHORT`, `CHANNEL`, `YOUTUBE_PLAYLIST`, `USER_PLAYLIST`, ...) |
| `resource_id` | `varchar(128)` | Yes | `NULL` | Platform or application entity identity |
| `published_at`| `timestamptz` | Yes | `NULL` | YouTube publication date |
| `views_count` | `bigint` | Yes | `NULL` | Distinct NULL vs ZERO rule (0 is valid metric) |
| `likes_count` | `bigint` | Yes | `NULL` | Distinct NULL vs ZERO rule |
| `comments_count`| `bigint` | Yes | `NULL` | Distinct NULL vs ZERO rule |
| `duration_seconds`| `integer` | Yes | `NULL` | Video duration in seconds (>= 0) |
| `saved_at` | `timestamptz` | No | `now()` | Authoritative save instant (UTC) |
| `saved_date` | `date` | No | None | Derived calendar date cached at write time via `preferred_timezone` |
| `created_at` | `timestamptz` | No | `now()` | Record creation timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Record update timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id, entity_type, platform_item_id)` (strict deduplication per owner)
  - `CHECK (entity_type IN ('video', 'channel', 'playlist'))`
  - `CHECK (entity_type = 'video' OR is_shorts_like = false)` (shorts heuristic only applies to videos)
  - `CHECK (duration_seconds IS NULL OR duration_seconds >= 0)`
  - `CHECK (views_count IS NULL OR views_count >= 0)`
  - `CHECK (likes_count IS NULL OR likes_count >= 0)`
  - `CHECK (comments_count IS NULL OR comments_count >= 0)`
  - All-or-none provenance check constraint:
    `CHECK ((manifest_part_id IS NULL AND item_position IS NULL AND generation_id IS NULL) OR (manifest_part_id IS NOT NULL AND item_position IS NOT NULL AND generation_id IS NOT NULL))`
  - `CHECK (item_position IS NULL OR item_position >= 0)`
  - Column-specific nullification composite FK:
    ```sql
    FOREIGN KEY (owner_id, dataset_id, generation_id, manifest_part_id)
      REFERENCES storage_manifest_parts(owner_id, dataset_id, generation_id, id)
      ON DELETE SET NULL (generation_id, manifest_part_id);
    ```
    Guarantees `owner_id` is never nullified when historical generations are pruned. A trigger nullifies `item_position` when `manifest_part_id` becomes NULL.
- **Indexes:**
  - `idx_saved_items_owner_date ON saved_items_index(owner_id, saved_date DESC, saved_at DESC)`
  - `idx_saved_items_owner_type ON saved_items_index(owner_id, entity_type)`
  - `idx_saved_items_owner_resource_type ON saved_items_index(owner_id, resource_type)`
  - `idx_saved_items_owner_device ON saved_items_index(owner_id, origin_device_id)`
  - `idx_saved_items_owner_published ON saved_items_index(owner_id, published_at)`
- **Role of Manifest:** PostgreSQL is authoritative for live mutable index; Manifest parts store immutable snapshots. Pruning old generation snapshots sets foreign keys to NULL without deleting the user's bookmarks.
- **Taxonomy Rule:** `resource_type` is the exact discriminator. `entity_type` is only a coarse relational bucket. `VIDEO_SHORT` requires explicit `/shorts/` evidence; duration and `is_shorts_like` never decide it.

---

#### `user_playlists`
Personal playlists owned by users (distinct from original YouTube playlists).

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE CASCADE |
| `dataset_id` | `uuid` | No | None | 1:1 FK to `storage_datasets(id)` ON DELETE RESTRICT |
| `name` | `varchar(255)`| No | None | Playlist display title |
| `description` | `text` | Yes | `NULL` | Playlist description |
| `display_order`| `integer` | No | `0` | Manual workspace display order |
| `cached_item_count`| `integer`| No | `0` | Derived total entries count (>= 0) |
| `cached_group_count`| `integer`| No | `0` | Derived total groups count (>= 0) |
| `cached_thumbnails`| `jsonb` | No | `'[]'::jsonb`| Array of up to 4 thumbnail URLs for gallery |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Last modification timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id, id)` (enables composite FKs on groups and entries)
  - `UNIQUE (dataset_id)` (exact 1:1 relationship with its dedicated storage dataset)
  - `CHECK (cached_item_count >= 0 AND cached_group_count >= 0)`
  - `FOREIGN KEY (owner_id, dataset_id) REFERENCES storage_datasets(owner_id, id) ON DELETE RESTRICT`
- **Indexes:** `idx_user_playlists_owner ON user_playlists(owner_id, display_order)`
- **Creation Strategy:** Pre-generate `playlist_id` (UUID v4). In one transaction: insert `storage_datasets` with `dataset_type = 'PLAYLIST', entity_id = playlist_id::text`, then insert `user_playlists` referencing `dataset_id`. Prevents circular FK deadlock.

---

#### `user_playlist_groups`
User-defined sections/groups inside personal playlists.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE CASCADE |
| `playlist_id` | `uuid` | No | None | FK to `user_playlists(id)` ON DELETE CASCADE |
| `title` | `varchar(255)`| No | None | Group title |
| `description` | `text` | Yes | `NULL` | Group note or description |
| `position` | `integer` | No | `0` | Manual display position inside playlist |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Last modification timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (playlist_id, id)` (enables composite FK from entries)
  - `FOREIGN KEY (owner_id, playlist_id) REFERENCES user_playlists(owner_id, id) ON DELETE CASCADE`
- **Indexes:** `idx_user_playlist_groups_order ON user_playlist_groups(playlist_id, position)`

---

#### `user_playlist_entries`
Ordered playlist memberships: YouTube items or custom notes/links.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE CASCADE |
| `playlist_id` | `uuid` | No | None | FK to `user_playlists(id)` ON DELETE CASCADE |
| `group_id` | `uuid` | Yes | `NULL` | Nullable group reference (NULL = Ungrouped) |
| `entry_kind` | `varchar(20)` | No | `'youtube'` | `'youtube'` or `'custom'` |
| `youtube_resource_type`| `varchar(20)`| Yes | `NULL`| `'video'`, `'channel'`, `'playlist'` (Required for YouTube entries) |
| `is_shorts_like`| `boolean` | No | `false` | Visual presentation classification |
| `platform_item_id`| `varchar(100)`| Yes | `NULL`| Canonical YouTube ID (Required for YouTube entries) |
| `custom_title`| `varchar(500)`| Yes | `NULL` | Title for custom entries (Required for custom entries) |
| `url` | `text` | Yes | `NULL` | External link or video URL |
| `note` | `text` | Yes | `NULL` | User notes for entry |
| `position` | `integer` | No | `0` | Manual ordering index inside playlist |
| `added_at` | `timestamptz` | No | `now()` | Addition timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Last modification timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `FOREIGN KEY (owner_id, playlist_id) REFERENCES user_playlists(owner_id, id) ON DELETE CASCADE`
  - `FOREIGN KEY (playlist_id, group_id) REFERENCES user_playlist_groups(playlist_id, id) ON DELETE SET NULL (group_id)` (PostgreSQL 15+ column-specific nullification preserves playlist_id)
  - `CHECK (entry_kind IN ('youtube', 'custom'))`
  - `CHECK (youtube_resource_type IS NULL OR youtube_resource_type IN ('video', 'channel', 'playlist'))`
  - Check for YouTube entries:
    `CHECK (entry_kind != 'youtube' OR (platform_item_id IS NOT NULL AND youtube_resource_type IS NOT NULL AND custom_title IS NULL))`
  - Check for Custom entries:
    `CHECK (entry_kind != 'custom' OR (custom_title IS NOT NULL AND platform_item_id IS NULL AND youtube_resource_type IS NULL AND is_shorts_like = false))`
  - Check shorts only for videos:
    `CHECK (youtube_resource_type = 'video' OR is_shorts_like = false)`
- **Indexes:**
  - Unique YouTube entry per playlist:
    `CREATE UNIQUE INDEX idx_playlist_youtube_unique ON user_playlist_entries (playlist_id, youtube_resource_type, platform_item_id) WHERE entry_kind = 'youtube';`
  - `idx_playlist_entries_order ON user_playlist_entries(playlist_id, position)`

---

#### `research_queue_items`
"Items I Will Search For" saved directly from YouTube result cards.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE CASCADE |
| `dataset_id` | `uuid` | Yes | `NULL` | FK to `storage_datasets(id)` ON DELETE SET NULL |
| `generation_id`| `uuid` | Yes | `NULL` | FK to `storage_generations(id)` ON DELETE SET NULL |
| `manifest_part_id`| `uuid` | Yes | `NULL` | FK to `storage_manifest_parts(id)` ON DELETE SET NULL |
| `item_position`| `integer`| Yes | `NULL` | Index within part `items[]` (>= 0) |
| `item_type` | `varchar(20)` | No | None | `'video'`, `'channel'`, `'playlist'` |
| `platform_item_id`| `varchar(100)`| No | None | YouTube ID |
| `title` | `varchar(500)`| No | None | Item title |
| `url` | `text` | No | None | Item URL |
| `channel_title`| `varchar(255)`| Yes | `NULL` | Channel title |
| `thumbnail_url`| `text` | Yes | `NULL` | Thumbnail URL |
| `is_shorts_like`| `boolean` | No | `false` | Visual presentation flag |
| `source_query`| `varchar(500)`| Yes | `NULL` | Query that discovered item |
| `source_type` | `varchar(30)` | No | `'SEARCH'`| `'SEARCH'`, `'AI_SEARCH'`, `'LINK_EXPLORER'`, `'MANUAL'` |
| `status` | `varchar(20)` | No | `'PENDING'` | `'PENDING'`, `'REVIEWED'`, `'DISMISSED'` |
| `priority` | `integer` | No | `0` | Sorting priority |
| `notes` | `text` | Yes | `NULL` | Research notes |
| `queued_at` | `timestamptz` | No | `now()` | Queue timestamp |
| `created_at` | `timestamptz` | No | `now()` | Record creation timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Record update timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id, platform_item_id, item_type)` (prevents duplicate queue items per owner)
  - `CHECK (item_type IN ('video', 'channel', 'playlist'))`
  - `CHECK (status IN ('PENDING', 'REVIEWED', 'DISMISSED'))`
  - `CHECK (source_type IN ('SEARCH', 'AI_SEARCH', 'LINK_EXPLORER', 'MANUAL'))`
  - `CHECK (item_type = 'video' OR is_shorts_like = false)`
  - All-or-none provenance check constraint:
    `CHECK ((manifest_part_id IS NULL AND item_position IS NULL AND generation_id IS NULL) OR (manifest_part_id IS NOT NULL AND item_position IS NOT NULL AND generation_id IS NOT NULL))`
  - Column-specific nullification composite FK:
    ```sql
    FOREIGN KEY (owner_id, dataset_id, generation_id, manifest_part_id)
      REFERENCES storage_manifest_parts(owner_id, dataset_id, generation_id, id)
      ON DELETE SET NULL (generation_id, manifest_part_id);
    ```
- **Indexes:** `idx_research_queue_owner ON research_queue_items(owner_id, status, queued_at DESC)`

---

#### `saved_references`
Manually saved titles and links (`SAVED_TITLE` / `SAVED_LINK`), mirrored from the local-first `REFERENCES` dataset.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE CASCADE |
| `dataset_id` | `uuid` | Yes | `NULL` | FK to `storage_datasets(id)` ON DELETE SET NULL |
| `generation_id`| `uuid` | Yes | `NULL` | FK to `storage_generations(id)` ON DELETE SET NULL |
| `manifest_part_id`| `uuid` | Yes | `NULL` | FK to `storage_manifest_parts(id)` ON DELETE SET NULL |
| `item_position`| `integer`| Yes | `NULL` | Index within part `items[]` (>= 0) |
| `title` | `varchar(512)`| No | None | Saved title or link label |
| `url` | `varchar(2048)`| Yes | `NULL` | Required for `SAVED_LINK`; nullable for `SAVED_TITLE` |
| `notes` | `text` | Yes | `NULL` | Personal research notes |
| `record_id` | `varchar(256)`| Yes | `NULL` | Stable application record identity |
| `resource_type` | `varchar(32)`| Yes | `NULL` | `SAVED_TITLE` or `SAVED_LINK` |
| `resource_id` | `varchar(256)`| Yes | `NULL` | Platform or application entity identity |
| `origin_device_id`| `varchar(128)`| Yes | `NULL` | Stable device identity |
| `origin_device_label`| `varchar(128)`| Yes | `NULL` | Human-friendly device label |
| `saved_at` | `timestamptz` | No | `now()` | Authoritative save instant |
| `created_at` | `timestamptz` | No | `now()` | Row creation timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Last modification timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id, record_id)` (stable per-owner identity)
  - `SAVED_LINK` rows must carry a URL; the API validates this before writing.
  - All-or-none provenance check constraint:
    `CHECK ((manifest_part_id IS NULL AND item_position IS NULL AND generation_id IS NULL) OR (manifest_part_id IS NOT NULL AND item_position IS NOT NULL AND generation_id IS NOT NULL))`
  - Column-specific nullification composite FK:
    ```sql
    FOREIGN KEY (owner_id, dataset_id, generation_id, manifest_part_id)
      REFERENCES storage_manifest_parts(owner_id, dataset_id, generation_id, id)
      ON DELETE SET NULL (generation_id, manifest_part_id);
    ```
- **Indexes:** `idx_saved_references_owner ON saved_references(owner_id, created_at DESC)`, `idx_saved_references_resource_type ON saved_references(owner_id, resource_type)`, `idx_saved_references_dataset ON saved_references(owner_id, dataset_id)`

---

#### `saved_search_presets`
Reusable query presets with filters and pinning (relational-only storage; no manifest required).

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE CASCADE |
| `title` | `varchar(255)`| No | None | Preset title |
| `query_text` | `varchar(512)`| No | None | YouTube search query string |
| `search_settings` | `jsonb` | No | `'{}'::jsonb`| Provider settings snapshot |
| `filter_snapshot` | `jsonb` | Yes | `NULL` | Local filter state snapshot |
| `is_pinned` | `boolean` | No | `false` | Pin to top of search shelf |
| `tags` | `text[]` | No | `'{}'` | Categorization tags |
| `record_id` | `varchar(256)`| Yes | `NULL` | Stable application record identity |
| `resource_type` | `varchar(32)`| Yes | `NULL` | `SAVED_SEARCH` |
| `resource_id` | `varchar(256)`| Yes | `NULL` | Platform or application entity identity |
| `origin_device_id`| `varchar(128)`| Yes | `NULL` | Stable device identity |
| `origin_device_label`| `varchar(128)`| Yes | `NULL` | Human-friendly device label |
| `saved_at` | `timestamptz` | No | `now()` | Authoritative save instant |
| `created_at` | `timestamptz` | No | `now()` | Creation timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Modification timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id, record_id)` (stable per-owner identity)
- **Architectural Justification:** Small, query-level configurations consumed directly by the search input UI; relational PostgreSQL storage is optimal with zero object storage overhead.
- **Taxonomy Rule:** A saved preset is `SAVED_SEARCH`, never a search-history execution record.
- **Indexes:** `idx_search_presets_owner ON saved_search_presets(owner_id, is_pinned DESC, title)`, `idx_search_presets_resource_type ON saved_search_presets(owner_id, resource_type)`

---

#### `search_history_records`
Permanent audit of executed searches linked directly to historical manifest generation snapshots.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE CASCADE |
| `query_text` | `varchar(512)`| No | None | Executed query string |
| `search_settings` | `jsonb` | No | None | Provider settings at execution |
| `result_count`| `integer` | No | `0` | Number of items returned (>= 0) |
| `quota_units_consumed`| `integer`| No | `100` | Quota units consumed by the execution |
| `manifest_id` | `varchar(64)`| No | None | Runtime manifest identity |
| `generation_id`| `uuid` | Yes | `NULL` | Optional immutable generation snapshot link |
| `executed_at` | `timestamptz` | No | `now()` | Execution timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `CHECK (result_count >= 0 AND quota_units_consumed >= 0)`
- **Historical Retrieval Guarantee:** When `generation_id` is present it points to the exact immutable snapshot of search results, allowing instant zero-quota reloading from storage.
- **Taxonomy Rule:** A search-history execution record is NOT a saved search preset. It must never be classified as `SAVED_SEARCH`.
- **Indexes:** `idx_search_history_owner ON search_history_records(owner_id, executed_at DESC)`

---

### 2.4 Operational, Quota & Audit Domain (4 Tables)

#### `managed_api_keys`
Encrypted YouTube Data API v3 keys with soft-delete archival.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE RESTRICT |
| `label` | `varchar(100)`| No | None | Display label |
| `masked_preview`| `varchar(20)` | No | None | Masked preview (e.g. `...3a8f`) |
| `encrypted_bundle`| `text` | No | None | Versioned JSON envelope: AES-256-GCM ciphertext + IV + auth tag + AAD |
| `project_id` | `varchar(100)`| Yes | `NULL` | Google Cloud project ID |
| `project_confidence`| `varchar(20)`| No | `'unknown'`| `'declared'`, `'verified'`, `'unknown'` |
| `is_enabled` | `boolean` | No | `true` | Active rotation toggle |
| `priority_order`| `integer` | No | `0` | Rotation priority |
| `is_archived` | `boolean` | No | `false` | Soft-delete flag (preserves quota attribution) |
| `archived_at` | `timestamptz` | Yes | `NULL` | Archival timestamp |
| `last_used_at` | `timestamptz` | Yes | `NULL` | Last successful invocation |
| `quota_exhausted_at`| `timestamptz`| Yes| `NULL` | Cooldown trigger instant |
| `cooldown_until`| `timestamptz`| Yes | `NULL` | Expiration of 24h key cooldown |
| `last_error` | `varchar(500)`| Yes | `NULL` | Sanitized error diagnostic |
| `created_at` | `timestamptz` | No | `now()` | Key creation timestamp |
| `updated_at` | `timestamptz` | No | `now()` | Key update timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id, id)` (enables composite FK from quota events)
  - `CHECK ((is_archived = false AND archived_at IS NULL) OR (is_archived = true AND archived_at IS NOT NULL))`
- **Security Rule:** Plaintext keys are NEVER stored in PostgreSQL, IndexedDB, logs, or exports. Master encryption key (`API_KEYS_ENCRYPTION_KEY`) remains strictly in server environment secrets.
- **Indexes:** `idx_managed_keys_rotation ON managed_api_keys(owner_id, is_enabled, is_archived, priority_order)`

---

#### `quota_usage_events`
Idempotent per-request quota consumption events with Pacific date calculation.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE RESTRICT |
| `managed_api_key_id`| `uuid` | Yes | `NULL` | FK to `managed_api_keys(id)` ON DELETE SET NULL |
| `idempotency_key`| `varchar(100)`| No | None | Unique request token preventing duplicate count |
| `request_sha256`| `varchar(64)` | No | None | SHA-256 fingerprint of request parameters |
| `project_id` | `varchar(100)`| Yes | `NULL` | Project ID snapshot |
| `quota_bucket`| `varchar(20)` | No | None | `'search'` (100 units) or `'other'` (1 unit) |
| `units_consumed`| `integer` | No | None | Exact YouTube quota units (>= 0) |
| `endpoint_called`| `varchar(100)`| No | None | e.g. `search.list`, `videos.list` |
| `status` | `varchar(20)` | No | None | `'SUCCESS'`, `'QUOTA_EXCEEDED'`, `'INVALID_KEY'`, `'ERROR'` |
| `pacific_date`| `date` | No | None | Calculated `America/Los_Angeles` daily anchor |
| `executed_at` | `timestamptz` | No | `now()` | Execution instant (UTC) |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id, idempotency_key)`
  - `CHECK (units_consumed >= 0)`
  - `CHECK (request_sha256 ~* '^[a-f0-9]{64}$')`
  - `FOREIGN KEY (owner_id, managed_api_key_id) REFERENCES managed_api_keys(owner_id, id) ON DELETE SET NULL (managed_api_key_id)` (Composite FK ensures key belongs to same owner)
  - `CHECK (quota_bucket IN ('search', 'other'))`
- **Timezone Guarantee:** `pacific_date` is derived strictly server-side using `executed_at AT TIME ZONE 'America/Los_Angeles'`.
- **Indexes:** `idx_quota_pacific_date ON quota_usage_events(owner_id, pacific_date, quota_bucket)`

---

#### `save_sync_batches`
Option A (Single Dataset Per Batch) synchronization transactions.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `owner_id` | `uuid` | No | None | FK to `user_profiles(id)` ON DELETE RESTRICT |
| `dataset_id` | `uuid` | No | None | FK to `storage_datasets(id)` ON DELETE RESTRICT |
| `idempotency_key`| `varchar(100)`| No | None | Scoped client batch ID |
| `request_sha256`| `varchar(64)` | No | None | Canonical SHA-256 fingerprint of batch payload items |
| `expected_revision`| `bigint` | No | None | Optimistic concurrency revision guard (>= 0) |
| `client_sequence`| `bigint` | No | None | Monotonic sequence number from IndexedDB |
| `committed_revision`| `bigint`| Yes | `NULL` | Revision assigned on commit |
| `state` | `varchar(20)` | No | `'PENDING'` | State machine: `PENDING`, `PREPARING`, `UPLOADING`, `VERIFYING`, `COMMITTED`, `FAILED`, `CONFLICT` |
| `operations_count`| `integer`| No | `0` | Number of outbox operations in batch (>= 0) |
| `completed_at`| `timestamptz` | Yes | `NULL` | Completion timestamp |
| `created_at` | `timestamptz` | No | `now()` | Submission timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
  - `UNIQUE (owner_id, dataset_id, id)` (enables composite FK from storage_generations)
  - `UNIQUE (owner_id, dataset_id, idempotency_key)`
  - `CHECK (expected_revision >= 0 AND operations_count >= 0)`
  - `CHECK (request_sha256 ~* '^[a-f0-9]{64}$')`
  - `FOREIGN KEY (owner_id, dataset_id) REFERENCES storage_datasets(owner_id, id) ON DELETE RESTRICT`
  - `CHECK (state IN ('PENDING', 'PREPARING', 'UPLOADING', 'VERIFYING', 'COMMITTED', 'FAILED', 'CONFLICT'))`
- **Indexes:** `idx_save_sync_batches ON save_sync_batches(owner_id, dataset_id, state)`
- **Option A Model:** Operates on exactly ONE dataset per batch. There is no `save_sync_batch_items` table.

---

#### `audit_logs`
Security and administrative audit log with separated Actor and Subject.

| Column | Type | Nullable | Default | Description / Constraint |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key |
| `actor_profile_id`| `uuid` | No | None | FK to `user_profiles(id)` ON DELETE RESTRICT (Who performed action) |
| `subject_owner_id`| `uuid` | Yes | `NULL` | FK to `user_profiles(id)` ON DELETE RESTRICT (Whose data was affected) |
| `action_type` | `varchar(100)`| No | None | e.g. `'KEY_ROTATED'`, `'ACCOUNT_SUSPENDED'`, `'EXPORT_DOWNLOADED'` |
| `entity_type` | `varchar(50)` | Yes | `NULL` | Target entity table |
| `entity_id` | `varchar(100)`| Yes | `NULL` | Target record UUID |
| `details` | `jsonb` | No | `'{}'::jsonb`| Sanitized operational context |
| `ip_address` | `varchar(45)` | Yes | `NULL` | Client IP address |
| `user_agent` | `varchar(255)`| Yes | `NULL` | Client user agent string |
| `created_at` | `timestamptz` | No | `now()` | Audit event timestamp |

- **Constraints:**
  - `PRIMARY KEY (id)`
- **Append-Only Rule:** Updates and deletions are strictly disabled via RLS and database triggers.
- **Indexes:** `idx_audit_logs_actor ON audit_logs(actor_profile_id, created_at DESC)`
