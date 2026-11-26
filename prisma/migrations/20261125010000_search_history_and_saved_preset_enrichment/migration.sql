-- ═══════════════════════════════════════════════════════════════════════════
-- Additive Migration: 20261125010000_search_history_and_saved_preset_enrichment
-- ───────────────────────────────────────────────────────────────────────────
-- Purpose:
--   1. Enrich `search_history_records` with lossless UI + R2 cloud metadata
--      (`title`, `status`, `video_count`, `channel_count`, `playlist_count`,
--       `top_thumbnails_json`, `is_pinned`, `r2_manifest_key`) so `/history`
--      renders authoritative cloud-only entries with full cards and badges
--      immediately after post-commit local storage cleanup.
--   2. Enrich `saved_search_presets` with R2 generation provenance & rich
--      preset metadata (`notes`, `resource_selection`, `dataset_id`,
--      `generation_id`, `manifest_part_id`, `r2_manifest_key`, `last_run_at`)
--      so `SAVED_SEARCH` presets match `saved_references` parity.
--   3. Enrich `saved_references` with `tags`, `is_pinned`, and
--      `r2_manifest_key` for full R2 object-key traceability.
--
-- Safety:
--   - Purely additive DDL (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
--   - Zero drops, zero truncations, zero rewrites of existing user data.
--   - Preserves existing owner-scoped RLS policies on all 3 tables.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Enrich saved_references
ALTER TABLE "saved_references"
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "is_pinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "r2_manifest_key" VARCHAR(1024);

-- 2. Enrich saved_search_presets
ALTER TABLE "saved_search_presets"
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "resource_selection" JSONB,
  ADD COLUMN IF NOT EXISTS "dataset_id" UUID,
  ADD COLUMN IF NOT EXISTS "generation_id" UUID,
  ADD COLUMN IF NOT EXISTS "manifest_part_id" UUID,
  ADD COLUMN IF NOT EXISTS "r2_manifest_key" VARCHAR(1024),
  ADD COLUMN IF NOT EXISTS "last_run_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "saved_search_presets_owner_id_dataset_id_idx"
  ON "saved_search_presets" ("owner_id", "dataset_id");

-- 3. Enrich search_history_records
ALTER TABLE "search_history_records"
  ADD COLUMN IF NOT EXISTS "title" VARCHAR(512),
  ADD COLUMN IF NOT EXISTS "status" VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS "video_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "channel_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "playlist_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "top_thumbnails_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "is_pinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "r2_manifest_key" VARCHAR(1024);

CREATE INDEX IF NOT EXISTS "search_history_records_owner_id_is_pinned_executed_at_idx"
  ON "search_history_records" ("owner_id", "is_pinned", "executed_at");
