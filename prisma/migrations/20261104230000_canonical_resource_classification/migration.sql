-- ═══════════════════════════════════════════════════════════════════════════
-- Canonical Resource Classification & Saved Titles/Links Persistence
-- ──────────────────────────────────────────────────────────────────────────
-- Additive migration. It preserves every existing row and never rewrites
-- historical identity. New columns are nullable so legacy rows remain valid;
-- the application always writes them for new records.
--
-- Canonical taxonomy values:
--   VIDEO, VIDEO_SHORT, CHANNEL, YOUTUBE_PLAYLIST, USER_PLAYLIST,
--   SAVED_TITLE, SAVED_LINK, SAVED_SEARCH, UNKNOWN
--
-- IMPORTANT: VIDEO_SHORT is only assigned from authoritative evidence
-- (explicit /shorts/ URL or authoritative discriminator), never duration.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. saved_items_index — exact resource discriminator
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "saved_items_index"
  ADD COLUMN IF NOT EXISTS "resource_type" VARCHAR(32);
ALTER TABLE "saved_items_index"
  ADD COLUMN IF NOT EXISTS "resource_id" VARCHAR(128);

CREATE INDEX IF NOT EXISTS "saved_items_index_owner_id_resource_type_idx"
  ON "saved_items_index"("owner_id", "resource_type");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_items_index_resource_type_check'
  ) THEN
    ALTER TABLE "saved_items_index"
      ADD CONSTRAINT "saved_items_index_resource_type_check"
      CHECK (
        "resource_type" IS NULL OR "resource_type" IN (
          'VIDEO', 'VIDEO_SHORT', 'CHANNEL', 'YOUTUBE_PLAYLIST',
          'USER_PLAYLIST', 'SAVED_TITLE', 'SAVED_LINK', 'SAVED_SEARCH', 'UNKNOWN'
        )
      ) NOT VALID;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. saved_references — Saved Titles & Links become first-class
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "saved_references"
  ALTER COLUMN "url" TYPE VARCHAR(2048);
ALTER TABLE "saved_references"
  ALTER COLUMN "url" DROP NOT NULL;

ALTER TABLE "saved_references"
  ADD COLUMN IF NOT EXISTS "record_id" VARCHAR(256);
ALTER TABLE "saved_references"
  ADD COLUMN IF NOT EXISTS "resource_type" VARCHAR(32);
ALTER TABLE "saved_references"
  ADD COLUMN IF NOT EXISTS "resource_id" VARCHAR(256);
ALTER TABLE "saved_references"
  ADD COLUMN IF NOT EXISTS "origin_device_id" VARCHAR(128);
ALTER TABLE "saved_references"
  ADD COLUMN IF NOT EXISTS "origin_device_label" VARCHAR(128);
ALTER TABLE "saved_references"
  ADD COLUMN IF NOT EXISTS "saved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS "saved_references_owner_id_record_id_key"
  ON "saved_references"("owner_id", "record_id");
CREATE INDEX IF NOT EXISTS "saved_references_owner_id_resource_type_idx"
  ON "saved_references"("owner_id", "resource_type");
CREATE INDEX IF NOT EXISTS "saved_references_owner_id_dataset_id_idx"
  ON "saved_references"("owner_id", "dataset_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_references_resource_type_check'
  ) THEN
    ALTER TABLE "saved_references"
      ADD CONSTRAINT "saved_references_resource_type_check"
      CHECK (
        "resource_type" IS NULL OR "resource_type" IN (
          'SAVED_TITLE', 'SAVED_LINK', 'SAVED_SEARCH', 'UNKNOWN'
        )
      ) NOT VALID;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. saved_search_presets — stable identity + origin metadata
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "saved_search_presets"
  ADD COLUMN IF NOT EXISTS "record_id" VARCHAR(256);
ALTER TABLE "saved_search_presets"
  ADD COLUMN IF NOT EXISTS "resource_type" VARCHAR(32);
ALTER TABLE "saved_search_presets"
  ADD COLUMN IF NOT EXISTS "resource_id" VARCHAR(256);
ALTER TABLE "saved_search_presets"
  ADD COLUMN IF NOT EXISTS "origin_device_id" VARCHAR(128);
ALTER TABLE "saved_search_presets"
  ADD COLUMN IF NOT EXISTS "origin_device_label" VARCHAR(128);
ALTER TABLE "saved_search_presets"
  ADD COLUMN IF NOT EXISTS "saved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS "saved_search_presets_owner_id_record_id_key"
  ON "saved_search_presets"("owner_id", "record_id");
CREATE INDEX IF NOT EXISTS "saved_search_presets_owner_id_resource_type_idx"
  ON "saved_search_presets"("owner_id", "resource_type");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_search_presets_resource_type_check'
  ) THEN
    ALTER TABLE "saved_search_presets"
      ADD CONSTRAINT "saved_search_presets_resource_type_check"
      CHECK (
        "resource_type" IS NULL OR "resource_type" = 'SAVED_SEARCH'
      ) NOT VALID;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. storage_datasets — exactly one logical dataset per owner + type
-- ───────────────────────────────────────────────────────────────────────────
-- This is the database-level guarantee that concurrent save-all requests
-- cannot create duplicate datasets for the same owner/type. Any pre-existing
-- duplicates must be reconciled before this index can be created; the remote
-- registry is empty at the time of writing, so this is a safe cutover.
CREATE UNIQUE INDEX IF NOT EXISTS "storage_datasets_owner_id_dataset_type_key"
  ON "storage_datasets"("owner_id", "dataset_type");
