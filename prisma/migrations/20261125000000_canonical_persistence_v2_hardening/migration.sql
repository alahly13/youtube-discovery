-- ═════════════════════════════════════════════════════════════════════════════
-- YouTube Discovery — Canonical Persistence v2 Hardening & Legacy Service Cutover
-- ═════════════════════════════════════════════════════════════════════════════
-- Migration Name: 20261125000000_canonical_persistence_v2_hardening
-- Additive, non-destructive migration:
--   1. Preserve original local/outbox record identifiers (`record_id`) across
--      user_playlists, user_playlist_groups, user_playlist_entries, plus full
--      `snapshot_json` on entries for lossless upl_* <-> UUID round-trips.
--   2. Extend `managed_api_keys` with canonical UI/rotation metadata columns
--      (`record_id`, `project_display_name`, `masked_key`, `priority_order`,
--       `is_selected`, `metadata_json`) so YouTube API key management runs cleanly
--      on PostgreSQL without ephemeral disk/legacy R2 state files.
--   3. Extend `search_history_records` with `record_id`, `resource_selection`,
--      `filter_snapshot`, `raw_payload_json`, `expires_at`, and `updated_at`
--      so Search Storage / History APIs persist durably in PostgreSQL.
--   4. Create `login_rate_limits` table for multi-instance Vercel auth rate
--      limiting instead of ephemeral filesystem/asdy/admin/ratelimit blobs.
--   5. Create `quota_pool_states` table for durable YouTube API key rotation,
--      active key selection, pool cooldowns, and daily usage counters.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. User Playlists: upl_* <-> UUID bidirectional identity & full entry snapshots
ALTER TABLE "user_playlists"
  ADD COLUMN IF NOT EXISTS "record_id" VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS "user_playlists_owner_id_record_id_key"
  ON "user_playlists"("owner_id", "record_id")
  WHERE "record_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "user_playlists_owner_id_record_id_idx"
  ON "user_playlists"("owner_id", "record_id");

ALTER TABLE "user_playlist_groups"
  ADD COLUMN IF NOT EXISTS "record_id" VARCHAR(128);

CREATE INDEX IF NOT EXISTS "user_playlist_groups_owner_id_record_id_idx"
  ON "user_playlist_groups"("owner_id", "record_id");

ALTER TABLE "user_playlist_entries"
  ADD COLUMN IF NOT EXISTS "record_id" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "snapshot_json" JSONB;

CREATE INDEX IF NOT EXISTS "user_playlist_entries_owner_id_record_id_idx"
  ON "user_playlist_entries"("owner_id", "record_id");

-- 2. Managed API Keys: canonical DB metadata & key selection alignment
ALTER TABLE "managed_api_keys"
  ADD COLUMN IF NOT EXISTS "record_id" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "project_display_name" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "masked_key" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "priority_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_selected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "metadata_json" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "managed_api_keys_owner_id_record_id_key"
  ON "managed_api_keys"("owner_id", "record_id")
  WHERE "record_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "managed_api_keys_owner_id_record_id_idx"
  ON "managed_api_keys"("owner_id", "record_id");

-- 3. Search History Records: lossless DB storage for Search Workspace & History APIs
ALTER TABLE "search_history_records"
  ADD COLUMN IF NOT EXISTS "record_id" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "resource_selection" JSONB,
  ADD COLUMN IF NOT EXISTS "filter_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "raw_payload_json" JSONB,
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "search_history_records_owner_id_record_id_key"
  ON "search_history_records"("owner_id", "record_id")
  WHERE "record_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "search_history_records_owner_id_record_id_idx"
  ON "search_history_records"("owner_id", "record_id");

-- 4. Durable Login Rate Limits (replaces asdy/admin/ratelimit/*.json)
CREATE TABLE IF NOT EXISTS "login_rate_limits" (
  "ip_hash" VARCHAR(128) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "window_start" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blocked_until" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "login_rate_limits_pkey" PRIMARY KEY ("ip_hash")
);

ALTER TABLE "login_rate_limits" ENABLE ROW LEVEL SECURITY;

-- 5. Durable Quota Pool States & Active Key Selection (replaces youtube-discovery/v1/api-keys/pools.json & usage-*.json)
CREATE TABLE IF NOT EXISTS "quota_pool_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_id" UUID NOT NULL,
  "pool_key" VARCHAR(64) NOT NULL DEFAULT 'default',
  "active_key_id" VARCHAR(128) NOT NULL DEFAULT 'env',
  "last_rotated_index" INTEGER NOT NULL DEFAULT -1,
  "pools_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "usage_by_day_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quota_pool_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quota_pool_states_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "user_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "quota_pool_states_owner_id_pool_key_key"
  ON "quota_pool_states"("owner_id", "pool_key");

CREATE INDEX IF NOT EXISTS "quota_pool_states_owner_id_idx"
  ON "quota_pool_states"("owner_id");

ALTER TABLE "quota_pool_states" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'quota_pool_states' AND policyname = 'owner_quota_pool_states_all'
  ) AND EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'is_active_owner'
  ) THEN
    CREATE POLICY "owner_quota_pool_states_all" ON public."quota_pool_states"
      FOR ALL TO authenticated
      USING (public.is_active_owner(owner_id))
      WITH CHECK (public.is_active_owner(owner_id));
  END IF;
END $$;
