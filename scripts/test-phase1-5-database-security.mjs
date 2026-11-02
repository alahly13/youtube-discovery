import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Test Suite: Phase 1.5 Database Security Hardening Verification
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream A (A1 - A6)
 * Validates the SQL DDL, triggers, indexes, composite FKs, and RLS policies
 * in migration `20261102220000_phase1_5_security_and_old_archive`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/20261102220000_phase1_5_security_and_old_archive/migration.sql"
);

console.log("\n══════════════════════════════════════════════════════════════");
console.log("   PHASE 1.5 DATABASE SECURITY HARDENING (A1-A6) TEST SUITE   ");
console.log("══════════════════════════════════════════════════════════════\n");

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

const sql = fs.readFileSync(migrationPath, "utf8");

// A1: Provenance Deletion Trigger
test("A1: Provenance trigger handle_manifest_part_deletion_provenance exists", () => {
  assert(sql.includes("FUNCTION public.handle_manifest_part_deletion_provenance()"), "Missing trigger function");
  assert(sql.includes("BEFORE DELETE ON public.storage_manifest_parts"), "Trigger not BEFORE DELETE");
});

test("A1: Trigger atomically nullifies all three provenance columns simultaneously", () => {
  const updateSaved = /UPDATE public\.saved_items_index\s+SET generation_id = NULL,\s+manifest_part_id = NULL,\s+item_position = NULL/i;
  const updateQueue = /UPDATE public\.research_queue_items\s+SET generation_id = NULL,\s+manifest_part_id = NULL,\s+item_position = NULL/i;
  const updateRefs = /UPDATE public\.saved_references\s+SET generation_id = NULL,\s+manifest_part_id = NULL,\s+item_position = NULL/i;

  assert(updateSaved.test(sql), "saved_items_index does not nullify all 3 columns together");
  assert(updateQueue.test(sql), "research_queue_items does not nullify all 3 columns together");
  assert(updateRefs.test(sql), "saved_references does not nullify all 3 columns together");
});

// A2: Root Generation Uniqueness & Lineage
test("A2: Partial unique index for exactly one committed root generation per dataset", () => {
  assert(
    sql.includes("uq_storage_generations_committed_root"),
    "Missing uq_storage_generations_committed_root index"
  );
  assert(
    sql.includes("WHERE state = 'COMMITTED' AND parent_generation_id IS NULL"),
    "Root index condition must check parent_generation_id IS NULL"
  );
});

test("A2: Partial unique index for linear successor chain", () => {
  assert(
    sql.includes("uq_storage_generations_committed_successor"),
    "Missing uq_storage_generations_committed_successor index"
  );
  assert(
    sql.includes("WHERE state = 'COMMITTED' AND parent_generation_id IS NOT NULL"),
    "Successor index condition must check parent_generation_id IS NOT NULL"
  );
});

test("A2: No self-parenting check constraint enforced", () => {
  assert(
    sql.includes("chk_storage_generations_no_self_parent"),
    "Missing self-parenting check constraint"
  );
  assert(
    sql.includes("parent_generation_id IS NULL OR parent_generation_id <> id"),
    "Check constraint formula invalid"
  );
});

// A3: Database-Level Immutability
test("A3: Generation immutability trigger blocks UPDATE or DELETE on committed state", () => {
  assert(
    sql.includes("FUNCTION public.enforce_storage_generation_immutability()"),
    "Missing generation immutability function"
  );
  assert(
    sql.includes("BEFORE UPDATE OR DELETE ON public.storage_generations"),
    "Trigger must be BEFORE UPDATE OR DELETE on storage_generations"
  );
  assert(
    sql.includes("app.privileged_maintenance"),
    "Must support app.privileged_maintenance override"
  );
});

test("A3: Manifest part immutability trigger blocks INSERT, UPDATE, or DELETE on committed generations", () => {
  assert(
    sql.includes("FUNCTION public.enforce_storage_manifest_part_immutability()"),
    "Missing manifest part immutability function"
  );
  assert(
    sql.includes("BEFORE INSERT OR UPDATE OR DELETE ON public.storage_manifest_parts"),
    "Trigger must be BEFORE INSERT OR UPDATE OR DELETE on storage_manifest_parts"
  );
});

// A4: SaveSyncBatch ↔ StorageGeneration Direct Composite Relationship
test("A4: Composite unique constraint on save_sync_batches (owner_id, dataset_id, id)", () => {
  assert(
    sql.includes("uq_save_sync_batches_owner_dataset_id"),
    "Missing composite unique constraint on save_sync_batches"
  );
});

test("A4: Composite foreign key from storage_generations to save_sync_batches", () => {
  assert(
    sql.includes("fk_storage_generations_source_batch"),
    "Missing fk_storage_generations_source_batch"
  );
  assert(
    sql.includes('REFERENCES public.save_sync_batches ("owner_id", "dataset_id", "id")'),
    "FK does not reference composite (owner_id, dataset_id, id)"
  );
});

test("A4: Unique index enforces at most one generation per sync batch", () => {
  assert(
    sql.includes("uq_storage_generations_source_batch"),
    "Missing uq_storage_generations_source_batch index"
  );
  assert(
    sql.includes('WHERE "source_batch_id" IS NOT NULL'),
    "Source batch index must filter WHERE source_batch_id IS NOT NULL"
  );
});

// A5: Supabase Storage Authorization Policies
test("A5: Storage RLS policies protect youtube-discovery bucket and authorize ASDY/OLD/", () => {
  assert(sql.includes("bucket_id = 'youtube-discovery'"), "Must scope to youtube-discovery bucket");
  assert(sql.includes("ASDY/OLD/"), "Must authorize ASDY/OLD/ root in storage policies");
  assert(sql.includes("public.current_user_storage_owner_uuid()"), "Must check owner storage UUID");
});

test("A5: UPDATE and DELETE policies on storage.objects allow temp partition only", () => {
  assert(
    sql.includes("name LIKE (public.current_user_storage_owner_uuid()::text || '/temp/%')"),
    "Storage UPDATE/DELETE must be restricted to /temp/%"
  );
});

// A6: Harden SECURITY DEFINER Functions with search_path = ''
test("A6: SECURITY DEFINER functions have SET search_path = ''", () => {
  const matches = sql.match(/SECURITY DEFINER[\s\S]*?SET search_path = ''/g) || [];
  assert(matches.length >= 6, `Expected at least 6 hardened functions with search_path = '', found ${matches.length}`);
});

// B3: archived_manifests Table
test("B3: archived_manifests table DDL is properly defined", () => {
  assert(sql.includes("CREATE TABLE IF NOT EXISTS public.archived_manifests"), "Missing archived_manifests table");
  assert(sql.includes('"content_sha256" CHAR(64) NOT NULL'), "Missing content_sha256 column");
  assert(sql.includes("uq_archived_manifests_owner_sha256"), "Missing owner+sha256 unique constraint");
  assert(sql.includes("uq_archived_manifests_owner_manifest_id"), "Missing owner+manifest_id unique constraint");
});

test("B3: archived_manifests has RLS enabled with owner-scoped SELECT, INSERT, DELETE", () => {
  assert(sql.includes("ALTER TABLE public.archived_manifests ENABLE ROW LEVEL SECURITY"), "RLS not enabled");
  assert(sql.includes("owner_read_archived_manifests"), "Missing SELECT policy");
  assert(sql.includes("owner_insert_archived_manifests"), "Missing INSERT policy");
  assert(sql.includes("owner_delete_archived_manifests"), "Missing DELETE policy");
  assert(!sql.includes("owner_update_archived_manifests"), "UPDATE policy must not exist (immutable archives)");
});

console.log("\n══════════════════════════════════════════════════════════════");
console.log(`   TEST SUMMARY: ${passed} PASSED, ${total - passed} FAILED (TOTAL: ${total})`);
console.log("══════════════════════════════════════════════════════════════\n");

if (passed !== total) {
  process.exit(1);
}
