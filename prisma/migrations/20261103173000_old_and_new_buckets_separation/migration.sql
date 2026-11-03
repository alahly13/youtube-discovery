-- ═════════════════════════════════════════════════════════════════════════════
-- YouTube Discovery — OLD and NEW Buckets Separation & Registry Enhancement
-- ═════════════════════════════════════════════════════════════════════════════
-- Migration Name: 20261103173000_old_and_new_buckets_separation
-- Baseline Date: 2026-11-03
-- Scope:
--   1. Idempotent registration of dedicated private buckets in storage.buckets:
--      - 'old-youtube-discovery-private' (public = false, limit = 50 MiB)
--      - 'new-youtube-discovery-private' (public = false, limit = 50 MiB)
--   2. Backward-compatible preservation of 'youtube-discovery-private' and 'youtube-discovery'
--   3. Hardened RLS policies on storage.objects covering all application buckets
--   4. Schema enhancement on storage_manifest_parts, storage_temp_objects, and archived_manifests:
--      - bucket_id tracking with constraints preventing cross-bucket contamination
--      - original_filename, mime_type, and status tracking on archived_manifests
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Ensure storage schema and register dedicated buckets
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    
    -- Register or update dedicated OLD bucket
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('old-youtube-discovery-private', 'old-youtube-discovery-private', false, 52428800)
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = 52428800;

    -- Register or update dedicated NEW bucket
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('new-youtube-discovery-private', 'new-youtube-discovery-private', false, 52428800)
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = 52428800;

    -- Ensure legacy/canonical buckets are preserved
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('youtube-discovery-private', 'youtube-discovery-private', false, 52428800)
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = 52428800;

    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('youtube-discovery', 'youtube-discovery', false, 52428800)
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = 52428800;

  END IF;

  -- 2. Configure RLS policies on storage.objects
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    DROP POLICY IF EXISTS "owner_storage_select" ON storage.objects;
    DROP POLICY IF EXISTS "owner_storage_insert" ON storage.objects;
    DROP POLICY IF EXISTS "owner_storage_update" ON storage.objects;
    DROP POLICY IF EXISTS "owner_storage_delete" ON storage.objects;

    -- SELECT Policy
    CREATE POLICY "owner_storage_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id IN (
        'old-youtube-discovery-private',
        'new-youtube-discovery-private',
        'youtube-discovery-private',
        'youtube-discovery'
      )
      AND (
        name LIKE (public.current_user_storage_owner_uuid()::text || '/%')
        OR name LIKE ('ASDY/OLD/' || public.current_user_storage_owner_uuid()::text || '/%')
        OR name LIKE ('asdy/old/%')
        OR name LIKE ('ASDY/OLD/%')
      )
    );

    -- INSERT Policy
    CREATE POLICY "owner_storage_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id IN (
        'old-youtube-discovery-private',
        'new-youtube-discovery-private',
        'youtube-discovery-private',
        'youtube-discovery'
      )
      AND (
        name LIKE (public.current_user_storage_owner_uuid()::text || '/%')
        OR name LIKE ('ASDY/OLD/' || public.current_user_storage_owner_uuid()::text || '/%')
        OR name LIKE ('asdy/old/%')
        OR name LIKE ('ASDY/OLD/%')
      )
    );

    -- UPDATE Policy (restricted to temp objects only)
    CREATE POLICY "owner_storage_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id IN (
        'old-youtube-discovery-private',
        'new-youtube-discovery-private',
        'youtube-discovery-private',
        'youtube-discovery'
      )
      AND name LIKE (public.current_user_storage_owner_uuid()::text || '/temp/%')
    )
    WITH CHECK (
      bucket_id IN (
        'old-youtube-discovery-private',
        'new-youtube-discovery-private',
        'youtube-discovery-private',
        'youtube-discovery'
      )
      AND name LIKE (public.current_user_storage_owner_uuid()::text || '/temp/%')
    );

    -- DELETE Policy (restricted to temp objects only)
    CREATE POLICY "owner_storage_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id IN (
        'old-youtube-discovery-private',
        'new-youtube-discovery-private',
        'youtube-discovery-private',
        'youtube-discovery'
      )
      AND name LIKE (public.current_user_storage_owner_uuid()::text || '/temp/%')
    );
  END IF;
END $$;

-- 3. Schema Alterations on Application Tables
ALTER TABLE "storage_manifest_parts" 
  ADD COLUMN IF NOT EXISTS "bucket_id" VARCHAR(64) NOT NULL DEFAULT 'new-youtube-discovery-private';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_manifest_parts_bucket'
  ) THEN
    ALTER TABLE "storage_manifest_parts"
      ADD CONSTRAINT "chk_manifest_parts_bucket"
      CHECK (bucket_id IN ('new-youtube-discovery-private', 'youtube-discovery-private', 'youtube-discovery'));
  END IF;
END $$;

ALTER TABLE "storage_temp_objects" 
  ADD COLUMN IF NOT EXISTS "bucket_id" VARCHAR(64) NOT NULL DEFAULT 'new-youtube-discovery-private';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_temp_objects_bucket'
  ) THEN
    ALTER TABLE "storage_temp_objects"
      ADD CONSTRAINT "chk_temp_objects_bucket"
      CHECK (bucket_id IN ('new-youtube-discovery-private', 'youtube-discovery-private', 'youtube-discovery'));
  END IF;
END $$;

ALTER TABLE "archived_manifests" 
  ADD COLUMN IF NOT EXISTS "bucket_id" VARCHAR(64) NOT NULL DEFAULT 'old-youtube-discovery-private',
  ADD COLUMN IF NOT EXISTS "original_filename" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "mime_type" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "status" VARCHAR(32) NOT NULL DEFAULT 'COMMITTED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_archived_manifests_bucket'
  ) THEN
    ALTER TABLE "archived_manifests"
      ADD CONSTRAINT "chk_archived_manifests_bucket"
      CHECK (bucket_id IN ('old-youtube-discovery-private', 'youtube-discovery-private', 'youtube-discovery'));
  END IF;
END $$;
