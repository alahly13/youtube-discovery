-- AlterTable: Add device identity and origin metadata to saved_items_index
ALTER TABLE "saved_items_index" ADD COLUMN IF NOT EXISTS "origin_device_id" VARCHAR(128);
ALTER TABLE "saved_items_index" ADD COLUMN IF NOT EXISTS "origin_device_label" VARCHAR(128);
CREATE INDEX IF NOT EXISTS "saved_items_index_owner_id_origin_device_id_idx" ON "saved_items_index"("owner_id", "origin_device_id");

-- AlterTable: Add device identity and origin metadata to save_sync_batches
ALTER TABLE "save_sync_batches" ADD COLUMN IF NOT EXISTS "origin_device_id" VARCHAR(128);
ALTER TABLE "save_sync_batches" ADD COLUMN IF NOT EXISTS "origin_device_label" VARCHAR(128);

-- AlterTable: Add device identity and origin metadata to storage_generations
ALTER TABLE "storage_generations" ADD COLUMN IF NOT EXISTS "origin_device_id" VARCHAR(128);
ALTER TABLE "storage_generations" ADD COLUMN IF NOT EXISTS "origin_device_label" VARCHAR(128);
