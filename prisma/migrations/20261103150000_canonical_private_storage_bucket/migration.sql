-- ═════════════════════════════════════════════════════════════════════════════
-- YouTube Discovery — Canonical Private Storage Bucket Configuration
-- ═════════════════════════════════════════════════════════════════════════════
-- Migration Name: 20261103150000_canonical_private_storage_bucket
-- Baseline Date: 2026-11-03
-- Scope:
--   1. Idempotent creation and configuration of canonical private bucket:
--      'youtube-discovery-private' (public = false, limit = 50 MiB / 52428800 bytes)
--   2. Backward-compatible preservation of 'youtube-discovery' bucket configuration
--   3. Hardened Row-Level Security policies on storage.objects for canonical bucket:
--      - Strict owner isolation via storage_owner_uuid
--      - Immutable committed generation parts and ASDY/OLD/ archives
--      - Temporary-only updates and deletions under <storage_owner_uuid>/temp/%
--      - Inaccessible to suspended or deleted profiles
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 1. Ensure storage schema and buckets table exist before configuring
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    
    -- Register or update canonical private bucket: youtube-discovery-private
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('youtube-discovery-private', 'youtube-discovery-private', false, 52428800)
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = 52428800;

    -- Register or update legacy/compat private bucket: youtube-discovery
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('youtube-discovery', 'youtube-discovery', false, 52428800)
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = 52428800;

  END IF;

  -- 2. Configure RLS policies on storage.objects for canonical and legacy buckets
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    -- Drop existing storage policies
    DROP POLICY IF EXISTS "owner_storage_select" ON storage.objects;
    DROP POLICY IF EXISTS "owner_storage_insert" ON storage.objects;
    DROP POLICY IF EXISTS "owner_storage_update" ON storage.objects;
    DROP POLICY IF EXISTS "owner_storage_delete" ON storage.objects;

    -- SELECT: User can read objects belonging to their owner root or ASDY/OLD/ root
    CREATE POLICY "owner_storage_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id IN ('youtube-discovery-private', 'youtube-discovery')
      AND (
        name LIKE (public.current_user_storage_owner_uuid()::text || '/%')
        OR name LIKE ('ASDY/OLD/' || public.current_user_storage_owner_uuid()::text || '/%')
      )
    );

    -- INSERT: User can upload objects into their owner root or ASDY/OLD/ root
    CREATE POLICY "owner_storage_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id IN ('youtube-discovery-private', 'youtube-discovery')
      AND (
        name LIKE (public.current_user_storage_owner_uuid()::text || '/%')
        OR name LIKE ('ASDY/OLD/' || public.current_user_storage_owner_uuid()::text || '/%')
      )
    );

    -- UPDATE: Block updates to immutable persistence and ASDY/OLD/ objects; allow temp only
    CREATE POLICY "owner_storage_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id IN ('youtube-discovery-private', 'youtube-discovery')
      AND name LIKE (public.current_user_storage_owner_uuid()::text || '/temp/%')
    )
    WITH CHECK (
      bucket_id IN ('youtube-discovery-private', 'youtube-discovery')
      AND name LIKE (public.current_user_storage_owner_uuid()::text || '/temp/%')
    );

    -- DELETE: Block deletion of immutable persistence and ASDY/OLD/ objects; allow temp only
    CREATE POLICY "owner_storage_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id IN ('youtube-discovery-private', 'youtube-discovery')
      AND name LIKE (public.current_user_storage_owner_uuid()::text || '/temp/%')
    );

  END IF;
END $$;
