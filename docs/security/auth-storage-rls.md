# YouTube Discovery — Phase 1: Security, Authorization & Row-Level Security (RLS) Specification (v1.4)

**Document:** `docs/security/auth-storage-rls.md`  
**Version:** 1.4 (Final Architecture Correction + Full Local Implementation Execution)  
**Baseline Date:** 2 November 2026  
**Status:** **APPROVED ARCHITECTURE SPECIFICATION & IMPLEMENTATION FOUNDATION**  
**Execution Mode:** AUTHORIZED LOCAL IMPLEMENTATION & RUNTIME FOUNDATION  

---

## 1. Security Architecture Overview

The YouTube Discovery security model enforces strict tenant isolation across three coordinated layers:

```text
Layer 1: Identity & Authentication
  └── Supabase Auth (Cookie-based SSR via @supabase/ssr; cryptographically signed JWT)
        │
Layer 2: Relational Authorization (PostgreSQL RLS)
  ├── Single-Admin Application Gate: During Phase 1, only auth.users(id) matching the administrator profile is admitted.
  ├── Role vs. Ownership Separation: user_profiles.role ('admin' | 'user') vs. owner_id UUID.
  ├── Table-Level Row Level Security (RLS): All 18 tables enforce owner_id isolation in O(1).
  └── Composite Foreign Keys: Guarantee parent-child ownership matching at database engine level.
        │
Layer 3: Physical Object Storage Authorization (Supabase Storage)
  ├── Private Bucket: 'youtube-discovery' (Zero public reads).
  ├── Path-Prefix Enforcement: (storage.foldername(name))[1] == current_user_storage_owner_uuid()::text.
  ├── Profile Suspension Lock: Storage RLS verifies that current_user_profile_id() IS NOT NULL.
  └── Short-Lived Signed URLs: 300s TTL for downloads; no permanent signed URL storage.
```

---

## 2. Hardened RLS Helper Functions

To eliminate recursive joins, prevent search-path hijacking attacks, and ensure instant account lockout on suspension:

### 2.1 `current_user_profile_id()`
```sql
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
```

### 2.2 `current_user_storage_owner_uuid()`
```sql
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
```

### Security Properties
1. **Empty / Safe `search_path`:** `SET search_path = public, pg_temp;` prevents malicious search-path interception.
2. **Instant Suspension Cutoff:** If `is_suspended = true` or `is_deleted = true`, both functions return `NULL`. All 18 tables' RLS policies immediately evaluate to false, revoking access without waiting for JWT expiration.
3. **No Parameter Injection:** Both functions derive identity strictly from `auth.uid()`. A caller cannot query or spoof another owner's profile or storage partition.

---

## 3. Table-by-Table Row-Level Security (RLS) Matrix (Exact 18 Canonical Tables)

Every user-owned table stores a direct `owner_id UUID REFERENCES user_profiles(id)`, backed by composite foreign keys on child tables. RLS evaluation executes in $O(1)$ time via an index seek on `owner_id`.

| # | Table Name | RLS Enabled | SELECT Policy | INSERT Policy | UPDATE Policy | DELETE Policy | Ownership Verification |
|---|---|---|---|---|---|---|---|
| 1 | `user_profiles` | **YES** | `auth_user_id = auth.uid()` | Service-role only / Admin bootstrap | `auth_user_id = auth.uid()` (Trigger protects privileged columns) | Service-role only (Controlled soft-deletion) | Direct (`auth.uid()`) |
| 2 | `user_preferences` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct 1:1 (`owner_id`) |
| 3 | `managed_api_keys` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` AND `role = 'admin'` | `owner_id = current_user_profile_id()` | Soft-delete / `owner_id = current_user_profile_id()` | Direct (`owner_id`) |
| 4 | `storage_datasets` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct (`owner_id`) |
| 5 | `storage_generations` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | RESTRICT / Controlled Pruning | Direct (`owner_id`) + Composite FK to dataset |
| 6 | `storage_manifest_parts` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | RESTRICT (Immutable once written) | RESTRICT / Controlled Pruning | Direct (`owner_id`) + Composite FK to generation |
| 7 | `storage_temp_objects` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct (`owner_id`) |
| 8 | `saved_items_index` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct (`owner_id`) |
| 9 | `user_playlists` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct (`owner_id`) |
| 10 | `user_playlist_groups` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct (`owner_id`) + Composite FK to playlist |
| 11 | `user_playlist_entries` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct (`owner_id`) + Composite FK to playlist |
| 12 | `research_queue_items` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct (`owner_id`) |
| 13 | `saved_references` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct (`owner_id`) |
| 14 | `saved_search_presets` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct (`owner_id`) |
| 15 | `search_history_records`| **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | Direct (`owner_id`) |
| 16 | `quota_usage_events` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | RESTRICT (Append-only) | RESTRICT (Accounting retention) | Direct (`owner_id`) + Composite FK to key |
| 17 | `save_sync_batches` | **YES** | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | `owner_id = current_user_profile_id()` | RESTRICT (Audit retention) | Direct (`owner_id`) + Composite FK to dataset |
| 18 | `audit_logs` | **YES** | `actor_profile_id = current_user_profile_id()` OR `subject_owner_id = current_user_profile_id()` | Service-role / Server-only | RESTRICT (Append-only) | RESTRICT (Append-only) | Separated Actor vs Subject |

---

## 4. Profile Role & Privileged Column Protection

To prevent privilege escalation and protect identity invariants, a `BEFORE UPDATE` trigger on `public.user_profiles` blocks users from modifying security-sensitive columns:

```sql
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
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION protect_user_profile_privileged_columns();
```

---

## 5. Supabase Storage RLS Policies (`storage.objects`)

The private bucket `youtube-discovery` enforces storage-level RLS tied directly to `current_user_storage_owner_uuid()`:

```sql
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 1. SELECT Policy (Owner-Scoped Download & Head)
CREATE POLICY "Owner read storage objects"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'youtube-discovery' AND
  (storage.foldername(name))[1] = public.current_user_storage_owner_uuid()::text AND
  public.current_user_profile_id() IS NOT NULL
);

-- 2. INSERT Policy (Owner-Scoped Upload with Path Traversal Guard)
CREATE POLICY "Owner insert storage objects"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'youtube-discovery' AND
  (storage.foldername(name))[1] = public.current_user_storage_owner_uuid()::text AND
  public.current_user_profile_id() IS NOT NULL AND
  name NOT LIKE '%../%' AND
  name NOT LIKE '%//%' AND
  name NOT LIKE '%\%'
);

-- 3. UPDATE Policy (Deny in-place modification of immutable manifest parts)
CREATE POLICY "Owner update storage objects"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'youtube-discovery' AND
  (storage.foldername(name))[1] = public.current_user_storage_owner_uuid()::text AND
  public.current_user_profile_id() IS NOT NULL AND
  name LIKE '%/temp/%' -- Only temporary scratch files can be updated
)
WITH CHECK (
  bucket_id = 'youtube-discovery' AND
  (storage.foldername(name))[1] = public.current_user_storage_owner_uuid()::text AND
  public.current_user_profile_id() IS NOT NULL AND
  name LIKE '%/temp/%'
);

-- 4. DELETE Policy (Owner-Scoped Deletion for Temp Objects and Pruning)
CREATE POLICY "Owner delete storage objects"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'youtube-discovery' AND
  (storage.foldername(name))[1] = public.current_user_storage_owner_uuid()::text AND
  public.current_user_profile_id() IS NOT NULL
);
```

---

## 6. Complete 18-Table Account Deletion Retention Matrix

When an administrator soft-deletes an account or when an auth account is deleted in Supabase Auth, `auth_user_id` is set to `NULL` (`ON DELETE SET NULL`), but the database records remain protected according to explicit data retention policies:

| # | Table Name | Action on Auth Deletion / Soft-Delete | Retention Rationale |
|---|---|---|---|
| 1 | `user_profiles` | `auth_user_id = NULL`, `is_deleted = true`, `deleted_at = now()` | Preserved permanently for historical audit linkage and storage cleanup tracking. |
| 2 | `user_preferences` | Kept or purged based on retention policy | Tied 1:1 to profile. |
| 3 | `managed_api_keys` | Keys immediately marked `is_active = false`, decrypted access blocked | Prevents further API execution. |
| 4 | `storage_datasets` | Retained with `owner_id` | Required to locate and delete storage objects before dropping database row. |
| 5 | `storage_generations` | Retained until storage purge job runs | Prevents premature orphan files in object storage. |
| 6 | `storage_manifest_parts`| Retained until physical files are removed by storage purge job | Ensures atomic storage garbage collection. |
| 7 | `storage_temp_objects` | Queued for immediate physical deletion | Ephemeral objects purged first. |
| 8 | `saved_items_index` | Retained or purged with user data request | Domain index records cleaned up safely. |
| 9 | `user_playlists` | Retained or purged with user data request | Cascades to playlist groups and entries. |
| 10 | `user_playlist_groups` | Cascade deleted from user_playlists | Controlled hierarchical cleanup. |
| 11 | `user_playlist_entries`| Cascade deleted from user_playlists | Controlled hierarchical cleanup. |
| 12 | `research_queue_items` | Retained or purged with user data request | Preserved or cleaned per user policy. |
| 13 | `saved_references` | Retained or purged with user data request | Preserved or cleaned per user policy. |
| 14 | `saved_search_presets` | Retained or purged with user data request | Preserved or cleaned per user policy. |
| 15 | `search_history_records`| Retained for audit/forensics or anonymized | Tracks YouTube search queries. |
| 16 | `quota_usage_events` | **PERMANENTLY RETAINED** (`ON DELETE RESTRICT`) | Critical financial and YouTube API quota accounting audit trail. |
| 17 | `save_sync_batches` | Retained for audit and sync troubleshooting | Audit record of upload saga events. |
| 18 | `audit_logs` | **PERMANENTLY RETAINED** (`ON DELETE RESTRICT`) | Mandatory compliance, forensic audit, and security monitoring. |

---

## 7. Versioned API Key Encryption Envelope

Managed YouTube API v3 keys are encrypted at rest using AES-256-GCM. The encrypted bundle is serialized as a versioned JSON envelope:

```json
{
  "v": 1,
  "alg": "aes-256-gcm",
  "kid": "root_2026_v1",
  "iv": "dGhpcyBpcyBhIDEyLWJ5dGU=",
  "ct": "bXkgZW5jcnlwdGVkIGtleSBjaXBoZXJ0ZXh0",
  "tag": "c29tZSBhdXRoIHRhZw==",
  "aad": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6:key_01JBCDEF"
}
```

### Encryption Parameters
- **Cipher:** `AES-256-GCM` (authenticated encryption with associated data).
- **IV/Nonce:** 12 cryptographically random bytes generated via `crypto.randomBytes(12)` per encryption operation. Nonces are never reused.
- **Authentication Tag:** 16 bytes (128 bits) verifying ciphertext integrity.
- **Associated Authenticated Data (AAD):** Formatted as `<owner_id>:<key_record_id>`. This cryptographically binds the ciphertext to its specific owner and database row, preventing "ciphertext transplantation" attacks where an encrypted key is copied into another user's account or another key record.
- **Root Secret:** The master encryption key (`API_KEYS_ENCRYPTION_KEY`) is stored strictly in server-only environment variables and never entered into PostgreSQL, IndexedDB, or logs.
