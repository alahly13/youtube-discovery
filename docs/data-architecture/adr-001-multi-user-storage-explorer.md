# Architecture Decision Record (ADR-001): Multi-User Foundation, Strict Owner Isolation & Manifest Storage Explorer (v1.4)

**Document:** `docs/data-architecture/adr-001-multi-user-storage-explorer.md`  
**Status:** **APPROVED ARCHITECTURE DECISION RECORD & IMPLEMENTATION FOUNDATION**  
**Date:** 2 November 2026  
**Deciders:** Project Owner, Architecture Reviewers, Antigravity AI  

---

## 1. Context & Problem Statement

YouTube Discovery is transitioning to a scalable cloud architecture using **Supabase PostgreSQL (Prisma 7)** and **Supabase Storage**.

During the Phase 1.4 final review, the project owner directed final architectural integrity corrections and authorized local implementation:
1. **Canonical 18 Tables & Name Normalization:** Table names are strictly standardized across all documentation and models (`saved_items_index`, `user_playlists`, `user_playlist_groups`, `user_playlist_entries`, `research_queue_items`, `saved_references`, `saved_search_presets`, `search_history_records`, etc.). Obsolete proposed entities like `save_sync_batch_items` are permanently excised.
2. **Generational Storage Hierarchy & Lineage:** Ensuring a child generation cannot reference a parent generation from a different owner or dataset, and ensuring a manifest part belongs to the exact same owner, dataset, and generation. Linear history is enforced via unique index `uq_storage_generations_linear`.
3. **Commit Ordering & Current Generation State Guarantee:** The database trigger `trg_dataset_current_generation_guard` verifies `state = 'COMMITTED'`. Therefore, in Stage 4, `storage_generations.state` must transition to `'COMMITTED'` before `storage_datasets.current_generation_id` is updated.
4. **Permanent Storage Paths via `storage_owner_uuid`:** Object storage paths use `<storage_owner_uuid>` (from `user_profiles.storage_owner_uuid`) rather than ephemeral auth UUIDs. This guarantees physical paths remain valid even if auth user accounts are deleted or modified.
5. **Deterministic Binary Aggregate SHA-256:** A robust binary format guarantees aggregate checksum integrity across all parts.
6. **Column-Specific Set Null & Stale Position Guard:** Composite foreign keys from child index tables to `storage_manifest_parts` use `ON DELETE SET NULL (generation_id, manifest_part_id)`, coupled with an all-or-none check constraint to ensure `item_position` is also nullified.
7. **Request Fingerprinting on Sync Batches:** `request_sha256` prevents payload drift attacks under duplicate idempotency keys.
8. **Account Deletion vs. Historical Audit Retention:** Deleting an authentication record sets `auth_user_id` to NULL without deleting the profile or its quota/audit history.

---

## 2. Decision Outcomes & Detailed Rationale

### 2.1 Decision: Exact 18 Canonical Tables Inventory
- **Decision:** The canonical schema consists of exactly 18 tables:
  `user_profiles`, `user_preferences`, `storage_datasets`, `storage_generations`, `storage_manifest_parts`, `storage_temp_objects`, `saved_items_index`, `user_playlists`, `user_playlist_groups`, `user_playlist_entries`, `research_queue_items`, `saved_references`, `saved_search_presets`, `search_history_records`, `managed_api_keys`, `quota_usage_events`, `save_sync_batches`, `audit_logs`.
- **Excision of `save_sync_batch_items`:** Because Option A (single dataset per batch) is the approved architecture, each batch synchronizes exactly one dataset. All references to `save_sync_batch_items` are removed.

### 2.2 Decision: Direct Immutable Upload via `storage_owner_uuid`
- **Decision:** Manifest parts are uploaded directly to:
  `<storage_owner_uuid>/persistence/datasets/<dataset-id>/generations/<generation-id>/parts/part-<number>.json`.
  The files remain completely uncommitted and invisible to reads until Stage 4 database commit atomically updates `storage_datasets.current_generation_id` and marks `storage_generations.state = 'COMMITTED'`.
  Compensating cleanup removes abandoned uncommitted uploads without any rename operation.

### 2.3 Decision: Full Generational Chain Composite Foreign Keys & Linear Lineage
- **Decision:** Enforce composite foreign keys across the entire storage chain:
  - `storage_generations`: `FOREIGN KEY (owner_id, dataset_id) REFERENCES storage_datasets(owner_id, id) ON DELETE CASCADE`.
  - Parent Generation self-FK: `FOREIGN KEY (owner_id, dataset_id, parent_generation_id) REFERENCES storage_generations(owner_id, dataset_id, id) ON DELETE RESTRICT`. Linear lineage; cross-dataset parentage is mathematically impossible.
  - Partial Unique Index: `CREATE UNIQUE INDEX uq_storage_generations_linear ON storage_generations (owner_id, dataset_id, parent_generation_id) WHERE state = 'COMMITTED';` prevents branching.
  - `storage_manifest_parts`: `FOREIGN KEY (owner_id, dataset_id, generation_id) REFERENCES storage_generations(owner_id, dataset_id, id) ON DELETE CASCADE`.

### 2.4 Decision: Database Trigger for Current Generation Commitment & Commit Ordering
- **Decision:** Trigger `trg_dataset_current_generation_guard` verifies `state = 'COMMITTED'`.
- In application code, the Stage 4 transaction executes:
  1. `UPDATE storage_generations SET state = 'COMMITTED', aggregate_sha256 = ... WHERE id = :genId`
  2. `UPDATE storage_datasets SET current_generation_id = :genId, current_revision = current_revision + 1 WHERE id = :dsId`

### 2.5 Decision: Explicit Revision Semantics
- **Decision:**
  - New Dataset: `current_revision = 0`, `current_generation_id = NULL`.
  - First Commit: `current_revision` advances to `1`, `current_generation_id` points to the first committed generation.
  - Subsequent Commits: `current_revision = current_revision + 1`.

### 2.6 Decision: Dataset Uniqueness via Partial Unique Indexes
- **Decision:** Implement two explicit partial unique indexes:
  1. `uq_storage_datasets_singleton` on `(owner_id, dataset_type) WHERE entity_id IS NULL` (guarantees exactly 1 Saved Items, Research Queue, Saved References, and Search History dataset per owner).
  2. `uq_storage_datasets_entity` on `(owner_id, dataset_type, entity_id) WHERE entity_id IS NOT NULL` (guarantees exactly 1 dataset per playlist entity).

### 2.7 Decision: Domain Index Decoupling (`ON DELETE SET NULL`) & Position Guard
- **Decision:** Live domain records maintain composite provenance links with column-specific `ON DELETE SET NULL (generation_id, manifest_part_id)`.
- Accompanied by a check constraint ensuring that `item_position` is also nullified if `manifest_part_id` is null, preventing dangling position markers.

### 2.8 Decision: Account Lifecycle & Soft-Deletion Preservation
- **Decision:** `user_profiles.auth_user_id` is nullable with `ON DELETE SET NULL`. Deleting an authentication user detaches the auth UUID and marks `is_deleted = true, deleted_at = now()`. The profile record remains preserved to satisfy foreign keys from `quota_usage_events` and `audit_logs`.

### 2.9 Decision: Versioned Encryption Envelope with AAD Binding
- **Decision:** Managed YouTube API keys are encrypted at rest using AES-256-GCM and stored as a versioned JSON envelope (`v`, `alg`, `kid`, `iv`, `ct`, `tag`, `aad`). Associated Authenticated Data (AAD) binds `<owner_id>:<key_record_id>`, preventing ciphertext transplantation attacks across rows or accounts.

---

## 3. Status & Execution Boundary

This Architecture Decision Record is an **APPROVED SPECIFICATION (v1.4)**.  
The project owner has explicitly authorized execution of the local implementation plan without requesting additional approval.
Database migrations are generated as source files only; live database execution remains strictly prohibited.
