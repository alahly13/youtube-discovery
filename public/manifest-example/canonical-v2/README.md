# Canonical Manifest Example (Taxonomy v2)

This directory contains a **non-authoritative example** of the taxonomy-v2 manifest contract used by the active NEW Cloudflare R2 pipeline. It exists to make the format inspectable and testable; it is not read by the application at runtime.

- `manifest.json` — generation descriptor written to `asdy/persistence/<storage_owner_uuid>/<dataset-slug>/generations/<generation-id>/manifest.json`
- `part-000001.json` — immutable part envelope with `resourceSchemaVersion: 2`
- `version.json` — derived dataset pointer written after the PostgreSQL commit
- `README.md` — this file

## What is canonical

- PostgreSQL `storage_datasets.current_generation_id` is authoritative for the active generation.
- The root/version manifests are derived convenience artifacts.
- The storage owner is `user_profiles.storage_owner_uuid`; `auth.users.id` is never a path root.
- Every record carries `recordId`, `resourceType`, and `resourceId`.
- `VIDEO_SHORT` requires explicit `/shorts/` evidence; duration and `isShortsLike` never decide it.
- `SAVED_TITLE` and `SAVED_LINK` are resource types inside the `REFERENCES` dataset.
- Hydration is snapshot-based: an incoming generation replaces the dataset projection and preserves pending outbox entities.
- Parts are verified by exact UTF-8 byte count and SHA-256 before parsing.

The example intentionally uses placeholder UUIDs. The SHA-256 digests, byte counts, aggregate digest, and record counts are real for the included `part-000001.json` / `part-000002.json` files so the example can be verified mechanically. Do not copy these values into production.
