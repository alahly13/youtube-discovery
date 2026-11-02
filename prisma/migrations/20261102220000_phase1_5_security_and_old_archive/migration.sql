-- ═════════════════════════════════════════════════════════════════════════════
-- YouTube Discovery — Phase 1.5 Database Security Hardening + OLD Archive
-- ═════════════════════════════════════════════════════════════════════════════
-- Migration Name: 20261102220000_phase1_5_security_and_old_archive
-- Baseline Date: 2026-11-02
-- Scope:
--   Workstream A: Database Security Hardening (A1 - A6)
--     A1: Atomic provenance nullification on manifest part deletion trigger
--     A2: Single committed root generation uniqueness & no self-parenting check
--     A3: Database-level immutability triggers for committed generations & parts
--     A4: Composite FK from storage_generations to save_sync_batches
--     A5: Storage authorization policies on storage.objects for ASDY/OLD/ and persistence
--     A6: Hardened SECURITY DEFINER functions with SET search_path = ''
--   Workstream B: Dedicated archived_manifests table, indexes, and RLS (B3)
-- ═════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- A6. Harden SECURITY DEFINER Helper Functions
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_user_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.user_profiles
  WHERE auth_user_id = auth.uid()
    AND is_deleted = false
    AND is_suspended = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_storage_owner_uuid()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT storage_owner_uuid FROM public.user_profiles
  WHERE auth_user_id = auth.uid()
    AND is_deleted = false
    AND is_suspended = false
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
      AND role = 'admin'
      AND is_deleted = false
      AND is_suspended = false
  );
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- A1. Atomic Provenance Deletion Trigger on storage_manifest_parts
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_manifest_part_deletion_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Atomically nullify generation_id, manifest_part_id, and item_position
  -- together so that the CHECK constraint ((manifest_part_id IS NULL AND item_position IS NULL AND generation_id IS NULL) OR (...))
  -- is never violated during part deletion.
  UPDATE public.saved_items_index
  SET generation_id = NULL,
      manifest_part_id = NULL,
      item_position = NULL
  WHERE manifest_part_id = OLD.id;

  UPDATE public.research_queue_items
  SET generation_id = NULL,
      manifest_part_id = NULL,
      item_position = NULL
  WHERE manifest_part_id = OLD.id;

  UPDATE public.saved_references
  SET generation_id = NULL,
      manifest_part_id = NULL,
      item_position = NULL
  WHERE manifest_part_id = OLD.id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_manifest_part_cleanup_provenance ON public.storage_manifest_parts;
CREATE TRIGGER trg_manifest_part_cleanup_provenance
BEFORE DELETE ON public.storage_manifest_parts
FOR EACH ROW
EXECUTE FUNCTION public.handle_manifest_part_deletion_provenance();

-- ───────────────────────────────────────────────────────────────────────────
-- A2. Guarantee Single Committed Root Generation per Dataset & Linear Lineage
-- ───────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.uq_storage_generations_linear;

-- Exactly one committed root generation per dataset
CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_generations_committed_root
ON public.storage_generations (owner_id, dataset_id)
WHERE state = 'COMMITTED' AND parent_generation_id IS NULL;

-- Strict linear chain: at most one committed generation can succeed a given parent
CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_generations_committed_successor
ON public.storage_generations (owner_id, dataset_id, parent_generation_id)
WHERE state = 'COMMITTED' AND parent_generation_id IS NOT NULL;

-- Prevent self-parenting cycles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_storage_generations_no_self_parent'
  ) THEN
    ALTER TABLE public.storage_generations
    ADD CONSTRAINT chk_storage_generations_no_self_parent
    CHECK (parent_generation_id IS NULL OR parent_generation_id <> id);
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- A3. Database-Level Immutability for Committed Generations and Parts
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_storage_generation_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Privileged maintenance override
  IF current_setting('app.privileged_maintenance', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'COMMITTED' THEN
      RAISE EXCEPTION 'Cannot delete committed storage generation % (dataset %)', OLD.id, OLD.dataset_id
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'COMMITTED' THEN
      RAISE EXCEPTION 'Cannot modify committed storage generation % (dataset %)', OLD.id, OLD.dataset_id
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_storage_generations_immutability ON public.storage_generations;
CREATE TRIGGER trg_storage_generations_immutability
BEFORE UPDATE OR DELETE ON public.storage_generations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_storage_generation_immutability();

CREATE OR REPLACE FUNCTION public.enforce_storage_manifest_part_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gen_state public."GenerationState";
BEGIN
  -- Privileged maintenance override
  IF current_setting('app.privileged_maintenance', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT state INTO v_gen_state FROM public.storage_generations WHERE id = OLD.generation_id;
    IF v_gen_state = 'COMMITTED' THEN
      RAISE EXCEPTION 'Cannot delete manifest part % belonging to committed generation %', OLD.id, OLD.generation_id
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT state INTO v_gen_state FROM public.storage_generations WHERE id = OLD.generation_id;
    IF v_gen_state = 'COMMITTED' THEN
      RAISE EXCEPTION 'Cannot modify manifest part % belonging to committed generation %', OLD.id, OLD.generation_id
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT state INTO v_gen_state FROM public.storage_generations WHERE id = NEW.generation_id;
    IF v_gen_state = 'COMMITTED' THEN
      RAISE EXCEPTION 'Cannot add manifest part to already committed generation %', NEW.generation_id
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_storage_manifest_parts_immutability ON public.storage_manifest_parts;
CREATE TRIGGER trg_storage_manifest_parts_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.storage_manifest_parts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_storage_manifest_part_immutability();

-- ───────────────────────────────────────────────────────────────────────────
-- A4. Composite FK from storage_generations to save_sync_batches
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_save_sync_batches_owner_dataset_id'
  ) THEN
    ALTER TABLE public.save_sync_batches
    ADD CONSTRAINT uq_save_sync_batches_owner_dataset_id UNIQUE ("owner_id", "dataset_id", "id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_storage_generations_source_batch'
  ) THEN
    ALTER TABLE public.storage_generations
    ADD CONSTRAINT fk_storage_generations_source_batch
    FOREIGN KEY ("owner_id", "dataset_id", "source_batch_id")
    REFERENCES public.save_sync_batches ("owner_id", "dataset_id", "id")
    ON DELETE RESTRICT;
  END IF;
END $$;

-- Enforce at most one generation per sync batch
CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_generations_source_batch
ON public.storage_generations ("owner_id", "dataset_id", "source_batch_id")
WHERE "source_batch_id" IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- A5. Supabase Storage Authorization on storage.objects
-- ───────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    -- Ensure RLS is active on storage.objects
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    -- Drop older policies if present
    DROP POLICY IF EXISTS "owner_storage_select" ON storage.objects;
    DROP POLICY IF EXISTS "owner_storage_insert" ON storage.objects;
    DROP POLICY IF EXISTS "owner_storage_update" ON storage.objects;
    DROP POLICY IF EXISTS "owner_storage_delete" ON storage.objects;

    -- SELECT: User can read objects belonging to their owner root or ASDY/OLD/ root
    CREATE POLICY "owner_storage_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'youtube-discovery'
      AND (
        name LIKE (public.current_user_storage_owner_uuid()::text || '/%')
        OR name LIKE ('ASDY/OLD/' || public.current_user_storage_owner_uuid()::text || '/%')
      )
    );

    -- INSERT: User can upload objects into their owner root or ASDY/OLD/ root
    CREATE POLICY "owner_storage_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'youtube-discovery'
      AND (
        name LIKE (public.current_user_storage_owner_uuid()::text || '/%')
        OR name LIKE ('ASDY/OLD/' || public.current_user_storage_owner_uuid()::text || '/%')
      )
    );

    -- UPDATE: Block updates to immutable persistence and ASDY/OLD/ objects; allow temp only
    CREATE POLICY "owner_storage_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'youtube-discovery'
      AND name LIKE (public.current_user_storage_owner_uuid()::text || '/temp/%')
    )
    WITH CHECK (
      bucket_id = 'youtube-discovery'
      AND name LIKE (public.current_user_storage_owner_uuid()::text || '/temp/%')
    );

    -- DELETE: Block deletion of immutable persistence and ASDY/OLD/ objects; allow temp only
    CREATE POLICY "owner_storage_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'youtube-discovery'
      AND name LIKE (public.current_user_storage_owner_uuid()::text || '/temp/%')
    );
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Workstream B: Additive archived_manifests Table (19th Table)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.archived_manifests (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "manifest_id" VARCHAR(128) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "source_format" VARCHAR(32) NOT NULL,
    "storage_path" VARCHAR(512) NOT NULL,
    "byte_count" BIGINT NOT NULL,
    "record_count" INTEGER NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "source_created_at" TIMESTAMPTZ(6),
    "source_exported_at" TIMESTAMPTZ(6),
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provenance_metadata" JSONB,
    "filter_summary" JSONB,

    CONSTRAINT "archived_manifests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_archived_manifests_owner_sha256" UNIQUE ("owner_id", "content_sha256"),
    CONSTRAINT "uq_archived_manifests_owner_manifest_id" UNIQUE ("owner_id", "manifest_id"),
    CONSTRAINT "fk_archived_manifests_owner" FOREIGN KEY ("owner_id") REFERENCES public.user_profiles("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_archived_manifests_owner_category"
ON public.archived_manifests ("owner_id", "category", "imported_at" DESC);

-- Enable RLS on archived_manifests
ALTER TABLE public.archived_manifests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_read_archived_manifests" ON public.archived_manifests;
CREATE POLICY "owner_read_archived_manifests" ON public.archived_manifests
FOR SELECT
USING ("owner_id" = public.current_user_profile_id() OR public.is_admin());

DROP POLICY IF EXISTS "owner_insert_archived_manifests" ON public.archived_manifests;
CREATE POLICY "owner_insert_archived_manifests" ON public.archived_manifests
FOR INSERT
WITH CHECK ("owner_id" = public.current_user_profile_id() OR public.is_admin());

DROP POLICY IF EXISTS "owner_delete_archived_manifests" ON public.archived_manifests;
CREATE POLICY "owner_delete_archived_manifests" ON public.archived_manifests
FOR DELETE
USING ("owner_id" = public.current_user_profile_id() OR public.is_admin());

-- Notice: No UPDATE policy is created for archived_manifests — archived historical manifests are immutable.
