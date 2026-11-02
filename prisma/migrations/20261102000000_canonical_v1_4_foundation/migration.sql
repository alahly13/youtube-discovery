-- ═════════════════════════════════════════════════════════════════════════════
-- YouTube Discovery — Canonical v1.4 Foundation Migration
-- ═════════════════════════════════════════════════════════════════════════════
-- Migration Name: 20261102000000_canonical_v1_4_foundation
-- Baseline Date: 2026-11-02
-- Scope: Exact 18 canonical tables, composite FKs, partial unique indexes,
--        triggers, hardened RLS functions, and Row-Level Security policies.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Create Custom Types / Enums
CREATE TYPE "UserRole" AS ENUM ('admin', 'user');
CREATE TYPE "GenerationState" AS ENUM ('PREPARING', 'UPLOADING', 'VERIFYING', 'COMMITTED', 'FAILED', 'ABANDONED');
CREATE TYPE "TempObjectStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DELETING', 'DELETED', 'FAILED');
CREATE TYPE "SyncBatchState" AS ENUM ('PENDING', 'PREPARING', 'UPLOADING', 'VERIFYING', 'COMMITTED', 'CONFLICT', 'FAILED');
CREATE TYPE "QueueItemStatus" AS ENUM ('PENDING', 'REVIEWED', 'DISMISSED');
CREATE TYPE "SavedEntityType" AS ENUM ('VIDEO', 'CHANNEL', 'PLAYLIST');
CREATE TYPE "PlaylistEntryEntityType" AS ENUM ('VIDEO', 'CHANNEL', 'PLAYLIST', 'CUSTOM');

-- 2. Create Table: user_profiles
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auth_user_id" UUID,
    "storage_owner_uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_namespace" VARCHAR(64) NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'admin',
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_user_profiles_auth_user_id" UNIQUE ("auth_user_id"),
    CONSTRAINT "uq_user_profiles_storage_owner_uuid" UNIQUE ("storage_owner_uuid"),
    CONSTRAINT "uq_user_profiles_storage_namespace" UNIQUE ("storage_namespace"),
    CONSTRAINT "uq_user_profiles_username" UNIQUE ("username")
);

-- 3. Create Table: user_preferences
CREATE TABLE "user_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "preferred_timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Los_Angeles',
    "theme" VARCHAR(16) NOT NULL DEFAULT 'system',
    "default_page_size" INTEGER NOT NULL DEFAULT 25,
    "default_max_pages" INTEGER NOT NULL DEFAULT 3,
    "default_max_items" INTEGER NOT NULL DEFAULT 150,
    "auto_save_enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_save_interval_hours" INTEGER NOT NULL DEFAULT 12,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_user_preferences_owner_id" UNIQUE ("owner_id"),
    CONSTRAINT "fk_user_preferences_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE
);

-- 4. Create Table: managed_api_keys
CREATE TABLE "managed_api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "key_nickname" VARCHAR(64) NOT NULL,
    "encrypted_key_bundle" JSONB NOT NULL,
    "key_fingerprint" VARCHAR(64) NOT NULL,
    "google_cloud_project_id" VARCHAR(64),
    "associated_account_email" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "daily_quota_limit" INTEGER NOT NULL DEFAULT 10000,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "managed_api_keys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_managed_api_keys_owner_id" UNIQUE ("owner_id", "id"),
    CONSTRAINT "uq_managed_api_keys_fingerprint" UNIQUE ("owner_id", "key_fingerprint"),
    CONSTRAINT "fk_managed_api_keys_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE
);

-- 5. Create Table: storage_datasets
CREATE TABLE "storage_datasets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "dataset_type" VARCHAR(32) NOT NULL,
    "entity_id" VARCHAR(128),
    "display_name" VARCHAR(255) NOT NULL,
    "current_revision" BIGINT NOT NULL DEFAULT 0,
    "current_generation_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_datasets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_storage_datasets_owner_id" UNIQUE ("owner_id", "id"),
    CONSTRAINT "fk_storage_datasets_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE
);

-- Partial Unique Indexes for storage_datasets
CREATE UNIQUE INDEX "uq_storage_datasets_singleton" ON "storage_datasets" ("owner_id", "dataset_type") WHERE "entity_id" IS NULL;
CREATE UNIQUE INDEX "uq_storage_datasets_entity" ON "storage_datasets" ("owner_id", "dataset_type", "entity_id") WHERE "entity_id" IS NOT NULL;

-- 6. Create Table: storage_generations
CREATE TABLE "storage_generations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "parent_generation_id" UUID,
    "source_batch_id" UUID,
    "generation_number" INTEGER NOT NULL,
    "state" "GenerationState" NOT NULL DEFAULT 'PREPARING',
    "total_parts" INTEGER NOT NULL DEFAULT 0,
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "total_bytes" BIGINT NOT NULL DEFAULT 0,
    "aggregate_sha256" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMPTZ(6),

    CONSTRAINT "storage_generations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_storage_generations_owner_dataset_id" UNIQUE ("owner_id", "dataset_id", "id"),
    CONSTRAINT "uq_storage_generations_number" UNIQUE ("owner_id", "dataset_id", "generation_number"),
    CONSTRAINT "fk_storage_generations_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_storage_generations_dataset" FOREIGN KEY ("owner_id", "dataset_id") REFERENCES "storage_datasets"("owner_id", "id") ON DELETE CASCADE,
    CONSTRAINT "fk_storage_generations_parent" FOREIGN KEY ("owner_id", "dataset_id", "parent_generation_id") REFERENCES "storage_generations"("owner_id", "dataset_id", "id") ON DELETE RESTRICT
);

-- Linear Lineage Constraint: no branching from same parent when committed
CREATE UNIQUE INDEX "uq_storage_generations_linear" ON "storage_generations" ("owner_id", "dataset_id", "parent_generation_id") WHERE "state" = 'COMMITTED';

-- 7. Create Table: storage_manifest_parts
CREATE TABLE "storage_manifest_parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "generation_id" UUID NOT NULL,
    "part_number" INTEGER NOT NULL,
    "storage_path" VARCHAR(512) NOT NULL,
    "byte_count" BIGINT NOT NULL,
    "record_count" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_manifest_parts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_storage_manifest_parts_composite" UNIQUE ("owner_id", "dataset_id", "generation_id", "id"),
    CONSTRAINT "uq_storage_manifest_parts_number" UNIQUE ("generation_id", "part_number"),
    CONSTRAINT "fk_storage_manifest_parts_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_storage_manifest_parts_gen" FOREIGN KEY ("owner_id", "dataset_id", "generation_id") REFERENCES "storage_generations"("owner_id", "dataset_id", "id") ON DELETE CASCADE
);

-- 8. Create Table: storage_temp_objects
CREATE TABLE "storage_temp_objects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "storage_path" VARCHAR(512) NOT NULL,
    "byte_count" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "status" "TempObjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "storage_temp_objects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_storage_temp_objects_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE
);

-- 9. Create Table: saved_items_index
CREATE TABLE "saved_items_index" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "entity_type" "SavedEntityType" NOT NULL,
    "platform_item_id" VARCHAR(64) NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "channel_title" VARCHAR(255),
    "thumbnail_url" VARCHAR(512),
    "is_shorts_like" BOOLEAN NOT NULL DEFAULT false,
    "is_age_restricted" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(6),
    "views_count" BIGINT,
    "likes_count" BIGINT,
    "comments_count" BIGINT,
    "duration_seconds" INTEGER,
    "saved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saved_date" VARCHAR(10) NOT NULL,
    "dataset_id" UUID,
    "generation_id" UUID,
    "manifest_part_id" UUID,
    "item_position" INTEGER,

    CONSTRAINT "saved_items_index_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_saved_items_index_platform_item" UNIQUE ("owner_id", "entity_type", "platform_item_id"),
    CONSTRAINT "fk_saved_items_index_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_saved_items_index_part" FOREIGN KEY ("owner_id", "dataset_id", "generation_id", "manifest_part_id")
        REFERENCES "storage_manifest_parts"("owner_id", "dataset_id", "generation_id", "id")
        ON DELETE SET NULL ("generation_id", "manifest_part_id"),
    CONSTRAINT "chk_saved_items_provenance" CHECK (
        ("manifest_part_id" IS NULL AND "item_position" IS NULL AND "generation_id" IS NULL) OR
        ("manifest_part_id" IS NOT NULL AND "item_position" IS NOT NULL AND "generation_id" IS NOT NULL)
    )
);

-- 10. Create Table: user_playlists
CREATE TABLE "user_playlists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "total_items_count" INTEGER NOT NULL DEFAULT 0,
    "thumbnail_urls" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_playlists_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_user_playlists_owner_id" UNIQUE ("owner_id", "id"),
    CONSTRAINT "fk_user_playlists_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE
);

-- 11. Create Table: user_playlist_groups
CREATE TABLE "user_playlist_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_collapsed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_playlist_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_user_playlist_groups_playlist_id" UNIQUE ("playlist_id", "id"),
    CONSTRAINT "fk_user_playlist_groups_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_user_playlist_groups_playlist" FOREIGN KEY ("owner_id", "playlist_id") REFERENCES "user_playlists"("owner_id", "id") ON DELETE CASCADE
);

-- 12. Create Table: user_playlist_entries
CREATE TABLE "user_playlist_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "group_id" UUID,
    "entity_type" "PlaylistEntryEntityType" NOT NULL,
    "platform_item_id" VARCHAR(64),
    "custom_title" VARCHAR(512),
    "custom_url" VARCHAR(1024),
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_playlist_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_user_playlist_entries_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_user_playlist_entries_playlist" FOREIGN KEY ("owner_id", "playlist_id") REFERENCES "user_playlists"("owner_id", "id") ON DELETE CASCADE,
    CONSTRAINT "fk_user_playlist_entries_group" FOREIGN KEY ("playlist_id", "group_id") REFERENCES "user_playlist_groups"("playlist_id", "id") ON DELETE SET NULL ("group_id")
);

-- Partial Unique Index: deduplicate YouTube items inside the same playlist
CREATE UNIQUE INDEX "idx_playlist_youtube_unique" ON "user_playlist_entries" ("playlist_id", "platform_item_id") WHERE "platform_item_id" IS NOT NULL;

-- 13. Create Table: research_queue_items
CREATE TABLE "research_queue_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "query_text" VARCHAR(512) NOT NULL,
    "source_origin" VARCHAR(64) NOT NULL,
    "source_entity_id" VARCHAR(64),
    "status" "QueueItemStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dataset_id" UUID,
    "generation_id" UUID,
    "manifest_part_id" UUID,
    "item_position" INTEGER,
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "research_queue_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_research_queue_items_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_research_queue_items_part" FOREIGN KEY ("owner_id", "dataset_id", "generation_id", "manifest_part_id")
        REFERENCES "storage_manifest_parts"("owner_id", "dataset_id", "generation_id", "id")
        ON DELETE SET NULL ("generation_id", "manifest_part_id"),
    CONSTRAINT "chk_research_queue_provenance" CHECK (
        ("manifest_part_id" IS NULL AND "item_position" IS NULL AND "generation_id" IS NULL) OR
        ("manifest_part_id" IS NOT NULL AND "item_position" IS NOT NULL AND "generation_id" IS NOT NULL)
    )
);

-- 14. Create Table: saved_references
CREATE TABLE "saved_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "notes" TEXT,
    "dataset_id" UUID,
    "generation_id" UUID,
    "manifest_part_id" UUID,
    "item_position" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_references_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_saved_references_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_saved_references_part" FOREIGN KEY ("owner_id", "dataset_id", "generation_id", "manifest_part_id")
        REFERENCES "storage_manifest_parts"("owner_id", "dataset_id", "generation_id", "id")
        ON DELETE SET NULL ("generation_id", "manifest_part_id"),
    CONSTRAINT "chk_saved_references_provenance" CHECK (
        ("manifest_part_id" IS NULL AND "item_position" IS NULL AND "generation_id" IS NULL) OR
        ("manifest_part_id" IS NOT NULL AND "item_position" IS NOT NULL AND "generation_id" IS NOT NULL)
    )
);

-- 15. Create Table: saved_search_presets
CREATE TABLE "saved_search_presets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "query_text" VARCHAR(512) NOT NULL,
    "search_settings" JSONB NOT NULL,
    "filter_snapshot" JSONB,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] NOT NULL DEFAULT '{}'::text[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_search_presets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_saved_search_presets_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE
);

-- 16. Create Table: search_history_records
CREATE TABLE "search_history_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "query_text" VARCHAR(512) NOT NULL,
    "search_settings" JSONB NOT NULL,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "quota_units_consumed" INTEGER NOT NULL DEFAULT 100,
    "manifest_id" VARCHAR(64) NOT NULL,
    "generation_id" UUID,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_history_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_search_history_records_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_search_history_records_gen" FOREIGN KEY ("generation_id") REFERENCES "storage_generations"("id") ON DELETE RESTRICT
);

-- 17. Create Table: quota_usage_events
CREATE TABLE "quota_usage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "managed_api_key_id" UUID,
    "google_cloud_project_id" VARCHAR(64) NOT NULL,
    "endpoint_name" VARCHAR(64) NOT NULL,
    "operation_category" VARCHAR(32) NOT NULL,
    "quota_units" INTEGER NOT NULL,
    "http_status" INTEGER NOT NULL,
    "request_sha256" CHAR(64) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_usage_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_quota_usage_events_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT,
    CONSTRAINT "fk_quota_usage_events_key" FOREIGN KEY ("owner_id", "managed_api_key_id") REFERENCES "managed_api_keys"("owner_id", "id") ON DELETE SET NULL ("managed_api_key_id")
);

-- 18. Create Table: save_sync_batches
CREATE TABLE "save_sync_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_sha256" CHAR(64) NOT NULL,
    "expected_revision" BIGINT NOT NULL,
    "committed_revision" BIGINT,
    "state" "SyncBatchState" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "save_sync_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_save_sync_batches_key" UNIQUE ("owner_id", "dataset_id", "idempotency_key"),
    CONSTRAINT "fk_save_sync_batches_owner" FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE,
    CONSTRAINT "fk_save_sync_batches_dataset" FOREIGN KEY ("owner_id", "dataset_id") REFERENCES "storage_datasets"("owner_id", "id") ON DELETE RESTRICT
);

-- FK from storage_generations to source_batch_id
ALTER TABLE "storage_generations"
    ADD CONSTRAINT "fk_storage_generations_batch"
    FOREIGN KEY ("source_batch_id") REFERENCES "save_sync_batches"("id") ON DELETE SET NULL;

-- 19. Create Table: audit_logs
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_profile_id" UUID,
    "subject_owner_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(128),
    "details" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_audit_logs_actor" FOREIGN KEY ("actor_profile_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT,
    CONSTRAINT "fk_audit_logs_subject" FOREIGN KEY ("subject_owner_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT
);

-- ═════════════════════════════════════════════════════════════════════════════
-- Database Functions & Triggers
-- ═════════════════════════════════════════════════════════════════════════════

-- 20. Trigger: Protect Privileged User Profile Columns
CREATE OR REPLACE FUNCTION protect_user_profile_privileged_columns()
RETURNS trigger AS $$
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN
    IF NEW.role <> OLD.role THEN
      RAISE EXCEPTION 'Security violation: Users cannot modify their own platform role.';
    END IF;
    IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
      RAISE EXCEPTION 'Security violation: auth_user_id is immutable.';
    END IF;
    IF NEW.storage_owner_uuid IS DISTINCT FROM OLD.storage_owner_uuid THEN
      RAISE EXCEPTION 'Security violation: storage_owner_uuid is immutable.';
    END IF;
    IF NEW.is_suspended <> OLD.is_suspended THEN
      RAISE EXCEPTION 'Security violation: Users cannot modify suspension status.';
    END IF;
    IF NEW.is_deleted <> OLD.is_deleted THEN
      RAISE EXCEPTION 'Security violation: Users cannot modify deletion status.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_user_profile_privileged_columns
BEFORE UPDATE ON "user_profiles"
FOR EACH ROW EXECUTE FUNCTION protect_user_profile_privileged_columns();

-- 21. Trigger: Verify Current Generation is COMMITTED
CREATE OR REPLACE FUNCTION verify_dataset_current_generation()
RETURNS trigger AS $$
BEGIN
  IF NEW.current_generation_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "storage_generations"
      WHERE "id" = NEW.current_generation_id
        AND "owner_id" = NEW.owner_id
        AND "dataset_id" = NEW.id
        AND "state" = 'COMMITTED'
    ) THEN
      RAISE EXCEPTION 'Integrity violation: current_generation_id % must reference a COMMITTED generation matching owner % and dataset %',
        NEW.current_generation_id, NEW.owner_id, NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_dataset_current_generation_guard
BEFORE INSERT OR UPDATE OF current_generation_id ON "storage_datasets"
FOR EACH ROW EXECUTE FUNCTION verify_dataset_current_generation();

-- 22. RLS Helper Functions (Hardened Search Path)
CREATE OR REPLACE FUNCTION public.current_user_profile_id() 
RETURNS uuid 
LANGUAGE sql 
STABLE 
SECURITY DEFINER 
SET search_path = public, pg_temp
AS $$
  SELECT id 
  FROM public.user_profiles 
  WHERE auth_user_id = auth.uid()
    AND is_suspended = false
    AND is_deleted = false;
$$;

REVOKE ALL ON FUNCTION public.current_user_profile_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_profile_id() TO service_role;

CREATE OR REPLACE FUNCTION public.current_user_storage_owner_uuid() 
RETURNS uuid 
LANGUAGE sql 
STABLE 
SECURITY DEFINER 
SET search_path = public, pg_temp
AS $$
  SELECT storage_owner_uuid 
  FROM public.user_profiles 
  WHERE auth_user_id = auth.uid()
    AND is_suspended = false
    AND is_deleted = false;
$$;

REVOKE ALL ON FUNCTION public.current_user_storage_owner_uuid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_storage_owner_uuid() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_storage_owner_uuid() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Enable Row-Level Security (RLS) on All 18 Canonical Tables
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "managed_api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "storage_datasets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "storage_generations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "storage_manifest_parts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "storage_temp_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_items_index" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_playlists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_playlist_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_playlist_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_queue_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_search_presets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_history_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quota_usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "save_sync_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

-- 23. RLS Policies
CREATE POLICY "user_profiles_select" ON "user_profiles" FOR SELECT TO authenticated USING ("auth_user_id" = auth.uid());
CREATE POLICY "user_preferences_all" ON "user_preferences" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "managed_api_keys_all" ON "managed_api_keys" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "storage_datasets_all" ON "storage_datasets" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "storage_generations_all" ON "storage_generations" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "storage_manifest_parts_all" ON "storage_manifest_parts" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "storage_temp_objects_all" ON "storage_temp_objects" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "saved_items_index_all" ON "saved_items_index" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "user_playlists_all" ON "user_playlists" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "user_playlist_groups_all" ON "user_playlist_groups" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "user_playlist_entries_all" ON "user_playlist_entries" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "research_queue_items_all" ON "research_queue_items" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "saved_references_all" ON "saved_references" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "saved_search_presets_all" ON "saved_search_presets" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "search_history_records_all" ON "search_history_records" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "quota_usage_events_select" ON "quota_usage_events" FOR SELECT TO authenticated USING ("owner_id" = public.current_user_profile_id());
CREATE POLICY "quota_usage_events_insert" ON "quota_usage_events" FOR INSERT TO authenticated WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "save_sync_batches_all" ON "save_sync_batches" FOR ALL TO authenticated USING ("owner_id" = public.current_user_profile_id()) WITH CHECK ("owner_id" = public.current_user_profile_id());
CREATE POLICY "audit_logs_select" ON "audit_logs" FOR SELECT TO authenticated USING ("actor_profile_id" = public.current_user_profile_id() OR "subject_owner_id" = public.current_user_profile_id());
