# YouTube Discovery — Implementation Guide

**Document:** `implementation-guide.md`  
**Version:** 1.5 (Database Security Hardening + OLD Legacy Manifest Archive System)  
**Baseline date:** 2 November 2026  
**Project:** YouTube Discovery  
**Audience:** Coding agents, maintainers, and the project owner  
**Status:** Authoritative implementation specification (v1.5 approved); local development authorized by project owner; database migrations are generated as source files only (never applied to live DB).

---

## 0. How the Coding Agent Must Use This Guide

This document is the primary implementation specification for evolving the existing YouTube Discovery repository. Read it completely before changing code.

### Mandatory execution protocol

1. Inspect the existing repository, project ledgers, `package.json`, lockfile, environment validation, current routes, current storage adapters, and TypeScript data contracts.
2. Treat existing working application functionality as protected. Improve and migrate it; do not silently remove it.
3. Implement incrementally, with small, reviewable changes and tests.
4. Keep the current source-of-truth and migration state documented at every stage.
5. **Phase 1.4 Execution Protocol:** The project owner has approved the Phase A v1.4 architecture documents and explicitly authorized local development execution for Phases B through F. Under Phase C, **generate migration files only**; never apply or push migrations to any live database. Deployment is strictly prohibited.
6. Use the read-only Prisma 7 migration management CLI tools located in `scripts/db-migrations/` (`npm run db:migrations`, `npm run db:migrations:local`, `npm run db:migrations:check`, `npm run db:migrations:json`, `npm run test:migrations`) to inspect, monitor, and verify migration synchronization without running destructive actions. Refer to `docs/database/migration-management.md`.
7. Never connect to, inspect, mutate, or migrate the remote database unless the required connection variables exist and the owner explicitly authorizes that operation.
8. Never print, reveal, copy, or modify real secrets in `.env`, `.env.local`, Vercel environment settings, or Supabase settings.
9. Do not claim that an integration, migration, backup, or test works unless it was actually verified.
10. Use npm only. Inspect the existing package versions before changing dependencies. Do not introduce Prisma 8 or use an unqualified `prisma@latest`.
11. Before any destructive action, create and verify a recovery path. Never delete the original Vercel Blob data as part of removing the runtime dependency.

### Required reporting format

At the end of each phase, report:

- What was inspected and changed.
- Exact files created, modified, or removed.
- Data contracts and routes preserved.
- Tests actually executed and their exit codes/results.
- Verified facts versus assumptions.
- Remaining configuration or Dashboard actions required from the owner.
- Risks, rollback procedure, and next approval gate.

Do not say “complete” when only scaffolding exists. Distinguish `implemented`, `configured`, `connected`, and `verified`.

---

## 1. Product Mission and Non-Negotiable Principles

YouTube Discovery is a personal, single-administrator research and metadata intelligence application built around the official YouTube Data API. It discovers, filters, organizes, archives, and analyzes public YouTube metadata.

The platform is operated by one administrator, whose Supabase Auth account is:

`asdy@youtube.discov.com`

The email identifies the intended account, but the immutable Supabase Auth user UUID is the actual ownership and authorization key. Obtain that UUID from the authenticated Supabase project; never guess it or hard-code an email as the sole security boundary.

### Core principles

- **Administrator is the Primary Owner Today:** The application operates currently as an administrator-only platform. The administrator must have their own profile, API keys, quota records, saved items, playlists, research queue, references, presets, history, datasets, generations, and storage namespace. Every row created by the administrator is bound to `owner_id = <admin_profile_id>`. There is no global unowned data or ambiently shared user libraries.
- **Strict Multi-User Isolation for the Future:** Every future account must receive its own independent profile and ownership boundary. Owner A must never automatically read, modify, delete, export, or access Owner B's data. Enforced at Database (RLS), Service, and Object Storage levels.
- **Three Independent Identity Layers:**
  1. *Identity:* Supabase Auth (`auth.users.id`).
  2. *Role:* `user_profiles.role` (`'admin'` | `'user'`) for platform operation and diagnostics. Administrative privilege is NOT shared data ownership.
  3. *Ownership:* `owner_id` (pointing to `user_profiles.id`) for all business records.
- **Supabase Auth:** The existing administrator account in Supabase Auth is the identity authority. Do not store the password in application tables, manifests, IndexedDB, logs, or exports.
- **Prisma 7 + PostgreSQL:** Prisma 7 is the ORM and migration system for application relational data. Supabase PostgreSQL is the database provider.
- **Supabase Storage:** Private object storage bucket (`youtube-discovery`) partitioned strictly by immutable owner UUID (`<owner-uuid>/persistence/...` and `<owner-uuid>/temp/...`).
- **PostgreSQL as Sole Authoritative Truth for Current Generation:** `storage_datasets.current_generation_id` in PostgreSQL is the SOLE authoritative source for the active generation. The root `manifest.json` in object storage is a derived convenience artifact that can be regenerated from PostgreSQL.
- **Manifest Storage Explorer:** The `/manifests` domain is architected as a real dual-layer storage explorer: PostgreSQL acts as the authoritative transactional registry and search index, while Supabase Storage holds physical, immutable JSON manifest parts. The UI enables real-time inspection, reconciliation, checksum verification, downloads, and generation ZIP exports.
- **Local-first protection:** Meaningful user changes are durably recorded in IndexedDB immediately, then synchronized to the cloud in controlled batches.
- **Power-loss recovery:** A normal browser close or sudden power interruption must not discard successfully committed local work. Never rely on a final unload event to save data.
- **Manifest-based large data:** Full records and search snapshots live in versioned JSON manifest parts in Storage (target 40 MiB / ceiling 45 MiB per part; soft generation budget 500 MiB). PostgreSQL stores searchable indexes, manifest registry metadata, relationships, sync state, and operational records.
- **Explicit cloud save:** A global Save All action synchronizes pending non-urgent application changes via Option A (Single Dataset Per Batch) with row-level locks and revision checks. Automatic synchronization is configurable and defaults to 12 hours.
- **No hidden data loss:** Failed uploads, failed transactions, offline activity, or expired temporary objects must be represented explicitly. Never clear pending local changes before verified remote commit.
- **Complete removal of Collections:** Collections have been completely excised from the product architecture. They were an early grouping concept superseded by Saved Items (with daily calendar grouping), Personal Playlist Manager (with groups, manual ordering, and video galleries), and Saved Searches (pinned query presets). Legacy Collections pages are deprecated and will be safely removed in Phase B.
- **Preserve features:** Existing Search, AI Search/AI Drawer, Saved Items (Videos, Channels, Playlists with daily grouping), Personal Playlist Manager (groups, custom entries, manual ordering, export), Saved Searches, Search History, Channels, YouTube Playlists, Watch, Quota, API-key rotation, settings, archives, and existing workflows remain available.
- **Official API boundary:** Continue using the official YouTube Data API. Do not add scraping, video/audio downloading, stream ripping, or private-data extraction.

### Existing behavior that must remain correct

- Search transformations and client-side filters/sorts must not trigger extra YouTube API calls.
- Manifest-first search behavior and provenance must remain available.
- A genuine zero (`0`) view/like/comment count is different from unknown (`null`). Never coerce `null` to zero or drop valid zeroes.
- Saved Items support videos, channels, and YouTube playlists. Shorts are a video subtype/classification (`isShortsLike`), not a fourth top-level YouTube entity type unless existing source contracts prove otherwise.
- Personal playlists remain distinct from YouTube-owned playlists.
- Preserve playlist custom entries, groups/sections, order, notes, deduplication, bulk operations, and export behavior.

---

## 2. Target Architecture

```text
Next.js 16 App Router / React / TypeScript
│
├── Supabase Auth (authenticated identity)
│   ├── @supabase/ssr cookie-based clients
│   ├── browser Supabase client (publishable key only)
│   ├── single-admin gate (verifies auth.users UUID against configured admin)
│   └── user_profiles (1:1 with auth.users, role: 'admin' | 'user') & user_preferences
│
├── Application services
│   ├── Saved Items (daily date grouping) / Research Queue / Saved References
│   ├── Personal Playlist Manager (sections/groups, ordering, video galleries)
│   ├── Search History / Saved Searches (pinned presets)
│   ├── Manifest Storage Explorer (inspect, reconcile, verify, download, export)
│   ├── API Keys (AES-256-GCM) / Quota (Pacific reset) / Admin Settings
│   ├── Export Center / Import / Temporary-object lifecycle
│   └── Save Coordinator (Option A single-dataset batches) / Recovery / Audit
│
├── Local persistence (browser)
│   ├── IndexedDB domain stores (owner-scoped)
│   ├── atomic local write-ahead operation log (outbox)
│   ├── last-session/workspace snapshots
│   └── sync state and local recovery export
│
├── Server data layer
│   ├── Prisma 7 Client + PostgreSQL driver adapter (@prisma/adapter-pg)
│   ├── repositories and transaction boundaries (owner-scoped queries)
│   └── server-only Supabase Storage adapter
│
└── Supabase project
    ├── Auth: auth.users (managed by Supabase)
    ├── PostgreSQL: application tables, owner indexes, and manifest registry
    └── Storage: private bucket (`youtube-discovery`) and versioned immutable parts
```

### Existing Supabase setup supplied by the owner

The owner reports that the following setup steps have already been performed. The agent must inspect and reuse them rather than reinstalling or duplicating them blindly:

1. `@supabase/supabase-js` and `@supabase/ssr` have already been installed with npm. Verify the resolved versions with `npm ls`; do not add duplicate packages.
2. The Supabase shadcn registry block was requested/added using `npx shadcn@latest add @supabase/supabase-client-nextjs`. Inspect the generated components and registry files, then reuse only the parts that fit the existing Next.js app. Do not assume the block itself completes Auth, database, or Storage configuration. Do not run the add command again if the components are already present.
3. `.env.local` is already populated with the Supabase project URL and the public `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Read only variable names/presence for diagnostics; never print their values. Do not overwrite the file.
4. Supabase Agent Skills were requested/installed with `npx skills add supabase/agent-skills`. Locate the installed skill files and read the relevant Supabase guidance before implementing Auth, Storage, RLS, or database integration. Do not reinstall if already present.

The publishable key is safe for public client configuration, but it is not an authorization mechanism by itself. Authorization still comes from Supabase Auth and database/Storage access policies. Server-only secret keys must never enter browser bundles.

### Responsibility boundaries

| Technology | Responsibility | Must not become responsible for |
|---|---|---|
| Supabase Auth | Identity lifecycle, authentication, token refresh | Domain records, personal passwords, or business data |
| `user_profiles` + `user_preferences` | Decoupled identity role (`'admin'` vs `'user'`) and user settings | Password storage or raw authentication credentials |
| Prisma 7 | Typed relational queries, schema, migrations, transactions | Browser-side direct access or large file object storage |
| PostgreSQL | Metadata, indexes, ownership (`owner_id`), relationships, manifest registry, jobs, quota and audit state | Full archive JSON trees and large binary payloads |
| Supabase Storage | Private JSON parts, exports, staged uploads, temporary files | Relational filtering, sorting, or transaction coordination |
| IndexedDB | Immediate local durable state, pending outbox operations, workspace recovery, offline work | API secrets or sole long-term backup |
| `localStorage` | Small non-critical UI preferences only, if still needed | Authoritative application data or pending operations |

Do not maintain two independent write paths for the same relational tables. Use Prisma for server-side application tables. Use Supabase SDKs for Auth and Storage. Use the Supabase Data API only when a specific feature genuinely requires it and its security model is documented.

---

## 3. Supabase Free-Plan Constraints and Storage Budget

The official Supabase documentation checked for this guide states the following Free-plan allowances at the baseline date. Confirm the live project Dashboard before deployment because plans and limits can change:

| Resource | Free-plan reference limit |
|---|---:|
| Maximum individual Storage object | 50 MB |
| Total Storage | 1 GB |
| PostgreSQL database size | 500 MB per project |
| Egress | 5 GB |
| Cached egress | 5 GB |
| Free project inactivity | Projects may be paused after one week without activity |

Official references: [Supabase pricing](https://supabase.com/pricing), [Storage upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits), [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase).

### Manifest file limits

Use these defaults unless the owner changes them:

```env
MANIFEST_TARGET_SIZE_MIB=40
MANIFEST_MAX_SIZE_MIB=45
```

- The target is 40 MiB; the hard application ceiling is 45 MiB.
- The actual Supabase Free object limit is 50 MB. MiB and MB are not identical; retain headroom below the provider limit.
- Measure the exact UTF-8 byte length of the serialized upload payload. Do not estimate from JavaScript string character count.
- A single logical record must not be split between manifest parts.
- If one individual record exceeds the hard part limit, reject it with a clear diagnostic or move its oversized sub-payload to a separate immutable object and reference it. Never silently truncate or split a record.
- Chunk by serialized byte size, not a fixed item count. Keep a secondary item-count ceiling to protect memory and parse time.
- Track total project Storage use and database size. Per-file compliance does not prevent exhausting the 1 GB total Storage allowance.
- Show usage and low-space warnings in the admin interface. Do not claim the account has remaining capacity from a stale estimate.

### Free-plan operational warning

Supabase Free may pause an inactive project. The application must show a clear database/storage unavailable state and preserve local pending work while the project is paused or unreachable. Do not treat a failed connection as an empty database.

---

## 4. Multi-User Ready Identity, Auth, and Session Rules

### Multi-user database foundation with single-administrator operation

1. Use the existing Supabase Auth account `asdy@youtube.discov.com`.
2. Obtain its real `auth.users.id` UUID from the Supabase project.
3. Provision an authoritative application `user_profiles` row linked to that UUID with `role = 'admin'`.
4. Provision a corresponding 1:1 `user_preferences` row for settings.
5. Provisioning must be idempotent: repeated setup must not create duplicate profile or preference rows.
6. Do not create another password store, do not seed the password into PostgreSQL, and do not copy it to `.env.example`.
7. Reject any authenticated UUID that is not the configured administrator UUID during this single-admin phase.
8. The email may be displayed as profile metadata, but the Auth UUID is the security identity.

### Separation of identity privilege and data ownership

A foundational rule of the v1.1 architecture is the clean separation of **Identity Privilege** from **Data Ownership**:

- **Identity Privilege (`user_profiles.role`):** Controls platform capabilities (e.g., `'admin'` vs `'user'`). Only accounts with `role = 'admin'` can access server diagnostics, configure managed API keys, inspect system storage health, or trigger temporary cleanup.
- **Data Ownership (`owner_id`):** Every user-owned entity (Saved Items index, Personal Playlists, Research Queue, Saved References, Presets, History, Manifest Datasets, Temp Objects) contains an `owner_id UUID NOT NULL REFERENCES user_profiles(id)`. An administrator owns their own personal library data under their personal `owner_id`; their personal data is never treated as shared global data.
- **Future Multi-User Readiness:** When normal users are added in the future, they will receive `role = 'user'`, own their data via their own `owner_id`, and be isolated via RLS with zero database migrations required.

### Profile and preferences table specifications

#### `user_profiles`
- `id` (`UUID`, Primary Key, `gen_random_uuid()`)
- `auth_user_id` (`UUID`, Not Null, Unique, FK to `auth.users(id)` ON DELETE CASCADE)
- `role` (`VARCHAR(20)`, Not Null, Default `'user'`, Check constraint `role IN ('admin', 'user')`)
- `username` (`VARCHAR(100)`, Not Null, Default `'admin'`)
- `email_snapshot` (`VARCHAR(255)`, Nullable display/audit value; never an authorization key)
- `storage_namespace` (`VARCHAR(100)`, Not Null, Default `'asdy'`)
- `is_suspended` (`BOOLEAN`, Not Null, Default `false`)
- `suspended_at` (`TIMESTAMPTZ`, Nullable)
- `last_seen_at` (`TIMESTAMPTZ`, Nullable)
- `created_at`, `updated_at` (`TIMESTAMPTZ`, Not Null, `now()`)

### Profile Role Protection and Privilege Escalation Prevention
- A user can never change their own role from `user` to `admin`.
- Enforced via both RLS policy (`WITH CHECK (role = (SELECT role FROM user_profiles WHERE auth_user_id = auth.uid()))`) and a PostgreSQL `BEFORE UPDATE` trigger raising an exception if `role` or `auth_user_id` is mutated outside a service-role context.
- Administrative privileges are operational only. The administrator owns their personal data under their own `owner_id`, but cannot access another user's decrypted API keys or private data through standard APIs. Full RLS matrix and trigger code are documented in `docs/security/auth-storage-rls.md`.

#### `user_preferences`
- `id` (`UUID`, Primary Key, `gen_random_uuid()`)
- `owner_id` (`UUID`, Not Null, Unique, FK to `user_profiles(id)` ON DELETE CASCADE)
- `preferred_timezone` (`VARCHAR(100)`, Not Null, Default `'UTC'`)
- `theme` (`VARCHAR(20)`, Not Null, Default `'system'`, Check `theme IN ('dark', 'light', 'system')`)
- `default_page_size` (`INTEGER`, Not Null, Default `25`)
- `default_max_pages` (`INTEGER`, Not Null, Default `3`)
- `default_max_items` (`INTEGER`, Not Null, Default `150`)
- `auto_save_enabled` (`BOOLEAN`, Not Null, Default `true`)
- `auto_save_interval_hours` (`INTEGER`, Not Null, Default `12`)
- `custom_settings` (`JSONB`, Not Null, Default `'{}'::jsonb`)

The application table must reference Supabase Auth using a database-enforced FK. Supabase owns `auth.users`; do not create or modify that table. The Prisma schema may represent the UUID as a scalar while a reviewed SQL migration creates the cross-schema FK, depending on the chosen Prisma multi-schema approach. Document the choice and test it.

### Next.js 16 and Supabase SSR

- Use `@supabase/ssr` for cookie-backed SSR auth and `@supabase/supabase-js` as its base SDK.
- Maintain separate browser and server client factories.
- In Next.js 16, use the supported `proxy.ts` convention (not an outdated `middleware.ts` assumption) to refresh Auth cookies as required.
- Protect pages, Route Handlers, and Server Actions on the server.
- Use verified claims (`auth.getClaims()`) or a verified user (`auth.getUser()`) as appropriate. Do not trust client-supplied user IDs or an unverified cookie/session object.
- Do not rely on `getSession()` alone as server-side proof of identity.
- Ensure the same refreshed cookies are propagated correctly through the Next.js Proxy and response.
- Do not make the Proxy the only authorization boundary. Every protected server operation must independently enforce the admin identity.
- Remove the legacy Blob/scrypt login fallback only after the Supabase login, logout, refresh, and recovery flows are verified and the owner cannot be locked out.

Official references: [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side), [Creating Supabase clients for Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&router=app).

### Session duration

`ADMIN_SESSION_MAX_AGE_SECONDS` may control the application's own idle/session policy or cookie policy, but it does not independently rewrite Supabase Auth access-token, refresh-token, or project-level session settings. Coordinate the application policy with Supabase Auth Dashboard session settings and test refresh/expiry behavior. Do not promise that changing one environment variable changes Supabase's token lifecycle.

---

## 5. Database, Prisma 7, and Connection Architecture

### Required major version

- Use Prisma 7 only. The repository previously reported `7.10.1`; verify the actual stable Prisma 7 patch version at implementation time.
- Pin compatible Prisma packages to the same verified 7.x release. Do not use `prisma@latest` if it could install another major.
- Never install Prisma 8 RC for this project unless the owner explicitly changes the decision.
- Use `@prisma/adapter-pg` and `pg` for PostgreSQL runtime access.
- Use npm only.

### Prisma 7 configuration rules

Prisma ORM 7 uses `prisma.config.ts` for CLI datasource connection configuration. The `url` field has been removed from the Prisma 7 `datasource` block in `schema.prisma`. Do not copy Prisma 6 examples into this project.

- `schema.prisma`: `datasource db { provider = "postgresql" }` without a datasource URL.
- `prisma.config.ts`: point CLI migration commands to `DIRECT_URL`.
- Runtime Prisma Client: initialize the PostgreSQL adapter with pooled `DATABASE_URL`.
- Do not set a nonexistent `directUrl` property in the Prisma 7 schema.
- Use the Prisma 7 `prisma-client` generator with an explicit `output` path. `prisma-client-js` is deprecated in Prisma 7 documentation.
- Check ESM/module compatibility with the current Next.js project before changing `package.json` or `tsconfig.json`. Do not blindly add `"type": "module"` if it breaks existing scripts/configs; document and test the required compatibility change.
- Generated client imports must use the actual configured output path.

Example configuration shape (adapt paths to the existing repository; do not paste blindly):

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DIRECT_URL") },
});
```

Runtime uses `PrismaPg` with `DATABASE_URL` and an appropriately configured `pg.Pool`.

Official references: [Prisma 7 config](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference), [Prisma 7 PostgreSQL](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql), [Prisma 7 connections](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections), [Prisma 7 generators](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators).

### Connection URLs

| Variable | Use | Exposure |
|---|---|---|
| `DATABASE_URL` | Supabase pooled connection for Vercel runtime | Server-only secret |
| `DIRECT_URL` | Direct database connection for Prisma CLI/migrations | Server-only secret |

Do not pass `DIRECT_URL` to browser code. Keep pool sizes small for Vercel serverless instances and tune based on Supabase connection limits and observed concurrency. A starting pool of 1–3 connections per warm function instance may be appropriate for a single-admin workload, but verify total instances and the provider's connection limit. Do not assume a process-global pool is globally shared across all Vercel instances.

### Do not assume RLS protects Prisma queries

Supabase RLS and Storage RLS are valuable, but a direct PostgreSQL Prisma connection does not automatically carry the browser user's Supabase JWT or `auth.uid()` context. A highly privileged database connection may bypass RLS.

Required controls:

1. Authenticate the request using Supabase Auth on the server.
2. Enforce the single-admin UUID allowlist on every protected service/API operation.
3. Pass the verified admin UUID into repository methods; include explicit ownership constraints on all owner-scoped reads, updates, and deletes.
4. Keep Prisma and database credentials server-only.
5. Use least-privilege database roles where possible.
6. If database-enforced RLS for Prisma operations is required, design a trusted per-transaction identity context using a non-bypass database role and `SET LOCAL` only after server-side Auth verification. Test pooling/transaction boundaries carefully. Do not set a request identity globally on a pooled connection.
7. Never describe RLS as protecting privileged Prisma traffic unless verified with a real test.
8. Supabase Storage RLS is a separate security system and must be configured for the private bucket.

Supabase publishable keys are public application identifiers; secret keys are server-only and bypass RLS. Use the current `sb_publishable_...` and `sb_secret_...` key model. Supabase documents deprecation of the old `anon` and `service_role` keys by the end of 2026. References: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [migrating API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).

---

## 6. Supabase Storage Layout and Access Rules

Use a private bucket:

`youtube-discovery`

The bucket must be private. Do not use public object URLs for saved records or manifests.

### Canonical object path convention

All object paths in the private bucket `youtube-discovery` are partitioned strictly by the stable owner UUID (`<owner-auth-uuid>`), never by a mutable username:

```text
<owner-auth-uuid>/
├── persistence/
│   ├── saved-items/
│   │   ├── manifest.json                                      # Derived convenience pointer (non-authoritative)
│   │   └── generations/<generation-id>/
│   │       ├── manifest.json                                  # Generation descriptor
│   │       └── parts/
│   │           ├── part-000001.json
│   │           └── part-000002.json
│   ├── playlists/<playlist-id>/
│   │   ├── manifest.json
│   │   └── generations/<generation-id>/parts/part-000001.json
│   ├── search-history/<search-id>/
│   │   └── generations/<generation-id>/parts/part-000001.json # Raw search snapshot
│   ├── items-to-research/
│   │   └── generations/<generation-id>/parts/part-000001.json
│   ├── saved-references/
│   │   └── generations/<generation-id>/parts/part-000001.json
│   ├── exports/<export-job-id>/
│   └── manifests/
└── temp/
    ├── staging/<upload-id>/chunk-<nnnn>.bin
    ├── staging/<upload-id>.session.json
    ├── uploads/
    ├── imports/
    └── exports/<export-job-id>/workspace-<date>.zip
```

The root segment `<owner-auth-uuid>` is immutable. Even if a user updates their username or display label, storage paths remain stable and immune to broken references or security leaks. Enforce access using Supabase Storage RLS policies: `(storage.foldername(name))[1] = auth.uid()::text`.

### Storage security

- The private bucket `youtube-discovery` holds all persistent and temporary files.
- Use Storage API for upload, download, move, and delete. Do not directly edit/delete `storage.objects` rows using SQL.
- Add and test `storage.objects` RLS policies for only the required operations: read, insert, update/upsert if truly required, and delete.
- Prefer immutable object names and new object versions over overwriting committed manifests.
- Use signed URLs only for short-lived downloads where required (e.g. 300s TTL); never persist long-lived signed URLs as permanent references.
- Do not expose `SUPABASE_SECRET_KEY` in the browser.
- Prefer user-scoped Supabase Storage requests with the authenticated user's JWT when feasible. If a server secret key is required for maintenance, enforce administrator authorization in the server endpoint before using it and keep it isolated.
- Set allowed content types (`application/json`, `application/zip`) and per-bucket size restrictions consistent with JSON/ZIP export needs.

Official references: [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits).

---

## 7. Manifest Dataset, Generations, Parts, and Manifest Storage Explorer

### Dual-layer storage model

Do not store an entire growing application dataset in a single JSON file. Do not create one tiny file per YouTube item either. Do not store full JSON trees in PostgreSQL.

The architecture enforces a strict dual-layer model:
1. **PostgreSQL (Authoritative Registry & Index):** Stores `storage_datasets`, `storage_generations`, `storage_manifest_parts`, and `storage_temp_objects`. It tracks generation states, part ordering, SHA-256 hashes, exact byte sizes, item counts, timestamps, and foreign key relations.
2. **Supabase Storage (Physical Immutable Payloads):** The private bucket `youtube-discovery` holds physical JSON manifest parts (`part-000001.json`). Once committed, these files are immutable.

### Sizing budgets and constraints

```env
MANIFEST_TARGET_SIZE_MIB=40
MANIFEST_MAX_SIZE_MIB=45
```

- **Target Part Size:** 40 MiB (41,943,040 bytes).
- **Hard Application Ceiling:** 45 MiB (47,185,920 bytes) to stay safely below Supabase's 50 MB Free tier object limit.
- **Recommended Maximum Generation Size:** 500 MiB (accommodating the 1 GB total Supabase Free storage allowance while leaving buffer for temporary files and ZIP exports).
- **Measurement Rule:** Always measure UTF-8 byte length (`Buffer.byteLength(payload, 'utf8')`). Never estimate using JavaScript string character count.
- **Atomicity Rule:** A single logical record must never be split across manifest parts. If one individual record exceeds 45 MiB, reject it with an explicit diagnostic or move its oversized sub-payload to a dedicated immutable object and reference it.

### Dataset types

Collections are removed. Supported dataset types are strictly:
- `SAVED_ITEMS`
- `PLAYLIST`
- `SEARCH_HISTORY`
- `RESEARCH_QUEUE`
- `SAVED_REFERENCES`

### PostgreSQL is the Sole Authoritative Truth for Current Generation

- **Authoritative Pointer:** `storage_datasets.current_generation_id` in PostgreSQL is the SOLE authoritative source of truth defining which generation snapshot is currently active and committed.
- **Derived Root Pointer:** The root `manifest.json` file in Supabase Storage is purely a derived convenience artifact.
  - It is non-authoritative.
  - If it is missing or fails to write, the database pointer remains authoritative.
  - It can be deterministically regenerated from PostgreSQL at any time.
  - The Manifest Storage Explorer reads active generations from PostgreSQL and verifies physical storage parts against registry rows.

### Registry schema specification

#### `storage_datasets`
- `id` (`UUID`, PK)
- `owner_id` (`UUID`, FK to `user_profiles(id)` ON DELETE RESTRICT)
- `dataset_type` (`VARCHAR(50)`, Check constraint on supported types)
- `entity_id` (`VARCHAR(100)`, Nullable logical ID, e.g. playlist ID or search ID)
- `storage_prefix` (`VARCHAR(500)`, e.g. `<owner-uuid>/persistence/saved-items/`)
- `current_generation_id` (`UUID`, FK to `storage_generations(id)` ON DELETE RESTRICT)
- `current_revision` (`BIGINT`, Default `1`)
- `schema_version` (`INTEGER`, Default `1`)
- `created_at`, `updated_at` (`TIMESTAMPTZ`)
- **Constraints:**
  - `UNIQUE (owner_id, id)`
  - `UNIQUE (owner_id, dataset_type, entity_id)`
  - `FOREIGN KEY (id, current_generation_id) REFERENCES storage_generations(dataset_id, id) ON DELETE RESTRICT`

#### `storage_generations`
- `id` (`UUID`, PK)
- `owner_id` (`UUID`, FK to `user_profiles(id)` ON DELETE RESTRICT)
- `dataset_id` (`UUID`, FK to `storage_datasets(id)` ON DELETE CASCADE)
- `parent_generation_id` (`UUID`, Nullable FK to `storage_generations(id)`)
- `state` (`VARCHAR(20)`, Default `'PREPARING'`, Check: `'PREPARING'`, `'UPLOADING'`, `'VERIFYING'`, `'COMMITTED'`, `'FAILED'`, `'ABANDONED'`)
- `idempotency_key` (`VARCHAR(100)`, Scoped to `dataset_id`)
- `item_count` (`INTEGER`, Default `0`)
- `part_count` (`INTEGER`, Default `0`)
- `total_bytes` (`BIGINT`, Default `0`)
- `sha256_checksum` (`VARCHAR(64)`, Aggregate checksum)
- `schema_version` (`INTEGER`, Default `1`)
- `created_at`, `committed_at` (`TIMESTAMPTZ`)
- **Constraints:**
  - `UNIQUE (dataset_id, id)`
  - `UNIQUE (dataset_id, idempotency_key)`
  - `FOREIGN KEY (owner_id, dataset_id) REFERENCES storage_datasets(owner_id, id) ON DELETE CASCADE`

#### `storage_manifest_parts`
- `id` (`UUID`, PK)
- `owner_id` (`UUID`, FK to `user_profiles(id)` ON DELETE RESTRICT)
- `dataset_id` (`UUID`, FK to `storage_datasets(id)` ON DELETE CASCADE)
- `generation_id` (`UUID`, FK to `storage_generations(id)` ON DELETE CASCADE)
- `part_number` (`INTEGER`, Ordered 1-based index)
- `storage_path` (`VARCHAR(500)`, Unique full object path in Supabase Storage)
- `record_count` (`INTEGER`)
- `byte_count` (`BIGINT`, <= 45 MiB ceiling)
- `sha256_checksum` (`VARCHAR(64)`, Hexadecimal SHA-256 hash)
- `created_at` (`TIMESTAMPTZ`)
- **Constraints:**
  - `UNIQUE (storage_path)`
  - `UNIQUE (generation_id, part_number)`
  - `FOREIGN KEY (dataset_id, generation_id) REFERENCES storage_generations(dataset_id, id) ON DELETE CASCADE`

### Manifest Storage Explorer

The `/manifests` route is designed as an interactive **Manifest Storage Explorer** to inspect, browse, download, and export physical manifest files in Supabase Storage.

#### 1. Navigable Browsing Hierarchy
The explorer visualizes storage as a clean nested tree:
```text
Owner: asdy (UUID: f81d4fae...)
  └── Dataset Type: SAVED_ITEMS (Dataset ID: b1f7c3e2...)
        ├── Current Generation: gen_01JBCDEF... (COMMITTED, 2 parts, 38.45 MiB, 750 items)
        │     ├── part-000001.json (500 items, 25.16 MiB, SHA-256: a591a6d4...) [VERIFIED]
        │     └── part-000002.json (250 items, 13.28 MiB, SHA-256: 4355a46b...) [VERIFIED]
        └── Historical Generation: gen_01JABC... (COMMITTED, 1 part, 18.20 MiB, 400 items)
              └── part-000001.json (400 items, 18.20 MiB, SHA-256: 7f83b165...) [VERIFIED]
```

#### 2. File Metadata Displayed Per Part
- **File Name:** `part-000001.json`
- **Full Storage Path:** `<uuid>/asdy/persistence/saved-items/generations/<gen-id>/parts/part-000001.json`
- **Owner Identity:** User profile UUID and display name.
- **Dataset Type & Entity ID:** Logical category and ID.
- **Generation ID & State:** `COMMITTED`, `PREPARING`, `FAILED`.
- **Part Number:** Sequence position (e.g. `1 of 2`).
- **Record Count & Exact Byte Count:** e.g. `500 items`, `25,165,824 bytes`.
- **SHA-256 Checksum:** 64-character hexadecimal digest.
- **Schema Version:** e.g. `v1`.
- **Timestamps:** UTC creation and commit timestamps.
- **Physical Existence:** Live check against Supabase Storage.
- **Reconciliation Status:** One of the 6 reconciliation states below.

#### 3. Explorer File Operations
- **Download Individual Part:** Streams the exact JSON file bytes directly from Supabase Storage via authenticated server stream or short-lived signed URL (300s TTL). Bytes and encoding are 100% preserved.
- **Export Complete Generation (ZIP Archive):** Creates a ZIP archive containing `manifest.json` (generation metadata and per-part checksums) and all constituent `parts/part-00000X.json` files. Performs SHA-256 pre-verification before packaging.
- **Export Dataset (Current vs. Historical):** Dropdown selector allows exporting the current active generation snapshot or any historical committed generation.
- **Integrity Diagnostic Verification:** Re-verifies physical existence, byte count, and SHA-256 checksum against database records on demand.

#### 4. Object Registry Reconciliation States
The explorer classifies every storage object into one of 6 reconciliation states:
1. `VERIFIED`: Registered in PostgreSQL, physically present in Storage, byte size and SHA-256 hash match.
2. `MISSING_FROM_STORAGE`: Registered in PostgreSQL, but 404 in Storage. Visual red alert displayed.
3. `UNTRACKED_ORPHAN`: Physical object exists in the storage prefix with no corresponding row in `storage_manifest_parts`. Displayed in an Untracked Files section; never deleted automatically.
4. `METADATA_MISMATCH`: Physical object exists, but byte count or SHA-256 hash differs from the database registry.
5. `UNCOMMITTED_GENERATION`: Generation stuck in `PREPARING` or `UPLOADING` state.
6. `INCOMPLETE_PARTS`: Number of physical parts is less than `storage_generations.part_count`.

### Manifest part format

```json
{
  "$schema": "https://youtube-discovery.app/schemas/manifest-part-v1.json",
  "schemaVersion": 1,
  "datasetType": "SAVED_ITEMS",
  "datasetId": "b1f7c3e2-89a1-4321-9988-123456789abc",
  "ownerId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "generationId": "gen_01JBCDEF1234567890ABCDEF",
  "partNumber": 1,
  "totalPartsInGeneration": 2,
  "createdAt": "2026-11-02T12:00:00.000Z",
  "recordCount": 500,
  "items": []
}
```

The checksum and exact byte count are computed over the final serialized bytes and stored in PostgreSQL.

### Commit protocol — object storage and PostgreSQL are not one transaction

Use an explicit saga/state machine:

1. Create a `PREPARING` generation and durable save-batch record with an idempotency key.
2. Serialize and split records by exact byte limit (<= 45 MiB). Never split one record.
3. Upload immutable parts to generation-specific immutable paths (`.../parts/part-000001.json`).
4. Verify object existence, actual byte size, SHA-256, record count, and parseability.
5. In one PostgreSQL transaction, register verified parts and atomically advance the dataset's current committed generation/revision using optimistic concurrency (`expected_revision`).
6. Mark the generation and save batch `COMMITTED` only after all database checks succeed.
7. Generate/update a compact root `manifest.json` as a derived index/pointer using immutable versioning or safe conditional update. The database remains authoritative if this object is temporarily stale.
8. Leave the previous committed generation untouched until the new generation is fully committed and verified.
9. If upload succeeds but DB commit fails, mark staged objects as orphan candidates and clean them only after a safety delay and a registry/reference check.
10. If DB commit succeeds but root pointer update fails, repair the pointer from the committed database registry. Do not roll back committed data merely because the derived root pointer failed.
11. Clear local outbox operations only after the server returns the committed revision and the client verifies the acknowledgement.

Every step must be idempotent and resumable after a timeout, redeploy, power loss, or duplicate request.

Every step must be idempotent and resumable after a timeout, redeploy, power loss, or duplicate request.

---

## 8. Logical Data Domains and Required Behaviors

The following is the canonical domain inventory (v1.4). Every user-owned entity contains an `owner_id UUID NOT NULL REFERENCES user_profiles(id)` foreign key.

### 8.1 User profiles and preferences

- `user_profiles`: Anchored to `auth.users(id)` via nullable `auth_user_id` with `ON DELETE SET NULL` to preserve historical audit/quota records upon account deletion. Includes `storage_owner_uuid UUID NOT NULL DEFAULT gen_random_uuid()` as the permanent physical storage partition identifier. Separates identity privilege (`role = 'admin' | 'user'`) from data ownership. Includes explicitly provisioned `storage_namespace` and `username` (no hardcoded defaults), `is_suspended`, `is_deleted`, and audit timestamps.
- `user_preferences`: Canonical 1:1 settings row for each profile. Stores `preferred_timezone` (e.g. `'America/Los_Angeles'`), `theme` (`'system'`, `'dark'`, `'light'`), search defaults (`default_page_size: 25`, `default_max_pages: 3`, `default_max_items: 150`), and `auto_save_enabled: true`, `auto_save_interval_hours: 12`.
- Single source of truth: UI settings sync from this table, eliminating split state across local storage.

### 8.2 Saved Items

Support all saved YouTube result types:
- `VIDEO`
- `CHANNEL`
- `PLAYLIST`

Shorts are a video classification (`isShortsLike: true`), not a separate entity type.

Required behavior:
- Saved Items page (`/saved`) is separate from Playlist Manager.
- Filter: All / Videos / Channels / Playlists.
- Search by title/channel/tags where available.
- Sort by saved date, title, and available metrics.
- Group visually by the user's actual `saved_at` date, newest date first.
- Distinguish save date from YouTube publication date.
- Preserve zero values (`0` views/likes/comments) and distinct `NULL` unknowns.
- Deduplicate by stable platform identity: `UNIQUE (owner_id, entity_type, platform_item_id)`.
- Traceability: `dataset_id`, `generation_id`, `manifest_part_id`, `item_position` reference storage manifest parts with `ON DELETE SET NULL` so that archiving historical generations never deletes live bookmarks.
- Lightweight PostgreSQL index (`saved_items_index`) enables instant search, filtering, and daily calendar grouping without downloading large manifest files. Complete snapshots remain in versioned manifest parts.
- Domain independence: An item may exist simultaneously in Saved Items, a Personal Playlist, and Research Queue; deleting from one area does not affect the others.

### 8.3 Personal Playlist Manager

Keep personal playlists separate from YouTube's original playlists.

Preserve:
- Playlist name, description, dates, and display order.
- Groups/sections (`user_playlist_groups`), their order and metadata.
- Entries (`user_playlist_entries`): YouTube items and custom entries.
- Entry order, group assignment, notes, custom title/note/URL.
- Drag-and-drop, bulk operations, search, sort, and export.
- Deduplication rule: `CREATE UNIQUE INDEX idx_playlist_youtube_unique ON user_playlist_entries (playlist_id, youtube_resource_type, platform_item_id) WHERE entry_kind = 'youtube'`.
- **Composite foreign key constraint:** To prevent cross-playlist group assignment at the database level and prevent nullifying `playlist_id` on delete, `user_playlist_entries` enforces:
  ```sql
  CONSTRAINT fk_playlist_group
    FOREIGN KEY (playlist_id, group_id)
    REFERENCES user_playlist_groups(playlist_id, id)
    ON DELETE SET NULL (group_id);
  ```
  Additionally, `(owner_id, playlist_id) REFERENCES user_playlists(owner_id, id) ON DELETE CASCADE` is enforced on both groups and entries.
- Each personal playlist has its own manifest dataset (`dataset_type = 'PLAYLIST'`, `entity_id = playlist_id::text`) and independent generation chain.

### 8.4 Search History and Saved Searches

These are different concepts:
- **Search History (`search_history_records`):** Permanent audit of searches executed, with query, type, settings, filters, counts, timestamps, quota attribution, and direct composite foreign key link to the stored search manifest (`storage_generations(owner_id, dataset_id, id)` with `ON DELETE RESTRICT`).
- **Saved Searches (`saved_search_presets`):** Reusable query presets with title, query, type, settings snapshot, notes, pinning, and ordering. `UNIQUE (owner_id, title)`. Stored relationally only; no manifest dataset required (architectural justification: small query configs directly consumed by UI).

Preserve permanent search history when `expiresAt: null`. Preserve raw YouTube manifest snapshots without quota consumption.

### 8.5 Research Queue — “Items I Will Search For”

Dedicated workspace (`/items-to-research`) with `Save for Later` action from search cards.
- Supports videos, channels, and YouTube playlists (with `isShortsLike` classification).
- Stores result snapshot, channel info, thumbnails, source query/search ID, queued timestamp, priority, and notes.
- Traceability: `dataset_id`, `generation_id`, `manifest_part_id`, `item_position` with `ON DELETE SET NULL`.
- Deduplication: `UNIQUE (owner_id, platform_item_id, item_type)`.
- A new search never erases the Research Queue.

### 8.6 Saved References — “Saved Titles & Links”

Dedicated workspace (`/saved-references`) for manually curated references:
- Title, external URL/link, description, notes, tags, timestamps.
- Accepts non-YouTube URLs and plain text references.
- Traceability: `dataset_id`, `generation_id`, `manifest_part_id`, `item_position`.
- Full records stored in manifest parts; indexed in PostgreSQL for search and list rendering.

### 8.7 Complete Removal of Collections (Architectural Action)

Collections have been completely removed from the product architecture:
- **Reason:** The legacy Collections feature was an early prototype grouping mechanism that became redundant with the implementation of dedicated first-class workspaces: Saved Items with daily calendar grouping (`/saved`), Personal Playlist Manager (`/playlist-manager`), and Saved Searches (`/saved-searches`).
- **Database Action:** No Collections tables (`COLLECTIONS`, `COLLECTION_ITEMS`) exist in the canonical database schema. No manifest dataset type exists for collections.
- **Application Status:** Existing legacy route and component files (`src/app/collections`, `src/components/collections`) are deprecated and will be safely removed during Phase B.

### 8.8 Managed YouTube API keys

- AES-256-GCM encryption for stored API keys (`managed_api_keys`).
- Store ciphertext, IV/nonce, authentication tag, encryption version, masked preview, label, enabled state, priority, project association, cooldown, and last-used timestamp.
- Soft delete enabled: `is_archived BOOLEAN NOT NULL DEFAULT false`, `archived_at TIMESTAMPTZ` ensures historical quota attribution is preserved.
- Master encryption key (`API_KEYS_ENCRYPTION_KEY`) remains strictly in server environment secrets.
- Never store plaintext API keys in PostgreSQL, IndexedDB, logs, browser state, exports, or analytics.
- Administrative access only: Creating, rotating, or editing keys requires `user_profiles.role = 'admin'`.

### 8.9 Quota accounting

Preserve existing YouTube quota accounting semantics:
- Search calls and other calls are separate buckets.
- Record usage events in `quota_usage_events` immediately upon external request execution.
- Key reference enforced by composite FK:
  ```sql
  FOREIGN KEY (owner_id, managed_api_key_id)
    REFERENCES managed_api_keys(owner_id, id)
    ON DELETE SET NULL (managed_api_key_id);
  ```
- Idempotency scope: `UNIQUE (owner_id, idempotency_key)`.
- **Pacific Time Reset:** The YouTube daily quota reset date is calculated on the server using `America/Los_Angeles` (Pacific Time), correctly accounting for Daylight Saving Time (PDT / PST).
- Cooldown and error classifications are preserved.

### 8.10 User Preferences and Admin Settings

- Structured preferences stored in `user_preferences`.
- Environment variables remain deployment-level infrastructure configuration; secrets must never be editable as ordinary database settings.

### 8.11 Managed temporary objects and lifecycle

- Stored in `storage_temp_objects` with `owner_id`, `storage_path`, `temp_type` (`STAGING_UPLOAD`, `INCOMPLETE_GENERATION`, `EXPORT_ARTIFACT`, `TEMP_SEARCH`), `byte_count`, `expires_at`, and `status`.
- Logical expiration enforced at read time.
- Physical cleanup executed via server-side scheduler using Supabase Storage API; never delete internal database rows directly.
- Cleanup never touches objects referenced by active committed generations or in-flight jobs.

### 8.12 Save synchronization (Option A: Single Dataset Per Batch)

Cloud save synchronization uses the **Option A** model:
- Each cloud save batch operates on exactly **one** logical dataset (`save_sync_batches.dataset_id UUID NOT NULL REFERENCES storage_datasets(id)`).
- Composite FK: `FOREIGN KEY (owner_id, dataset_id) REFERENCES storage_datasets(owner_id, id) ON DELETE RESTRICT`.
- Idempotency scope: `UNIQUE (owner_id, dataset_id, idempotency_key)`.
- Enforces optimistic concurrency via `expected_revision`:
  ```sql
  -- Server-side commit protocol
  SELECT * FROM storage_datasets WHERE id = :dataset_id FOR UPDATE;
  -- Verify current_revision == expected_revision
  -- Advance to resulting_revision and link new storage_generation
  ```
- If a revision conflict occurs, the batch transitions to `REVISION_CONFLICT` and returns clear diagnostics to the client outbox.

### 8.13 Audit Logs (Actor vs. Subject Separation)

- `audit_logs` records security and administrative actions with explicit separation:
  - `actor_profile_id UUID NOT NULL REFERENCES user_profiles(id)`
  - `subject_owner_id UUID REFERENCES user_profiles(id)`
- For standard actions, `actor == subject`. For administrative operations, they may differ.
- Strictly append-only. Never logs secrets, passwords, or encrypted keys.

---

## 9. Local-First IndexedDB and Power-Loss Recovery

This is a critical feature, not an optional optimization.

### 9.1 IndexedDB is authoritative for pending local changes

Meaningful user actions must be committed to IndexedDB before the UI displays them as `Saved Locally` or treats them as durable.

Do not rely on:
- React component state
- Zustand memory alone
- `localStorage`
- `sessionStorage`
- an unload event
- an in-memory queue
- a timer that is expected to run at browser shutdown

Small UI-only preferences may remain in `localStorage` if they are not needed to recover user work.

### 9.2 Atomic local write + operation journal

Each local mutation must update the local entity/snapshot and append a pending operation in the same IndexedDB transaction (or another transaction design with equivalent crash atomicity).

All local entity stores include an `ownerId` property matching the authenticated `user_profiles.id`, ensuring local isolation for multi-profile workflows.

Suggested local stores (adapt to existing architecture):
- `entities_saved_items`
- `entities_playlists`
- `entities_playlist_groups`
- `entities_playlist_entries`
- `entities_research_queue`
- `entities_saved_references`
- `entities_saved_searches`
- `entities_search_history`
- `workspace_snapshots`
- `pending_operations` (write-ahead operation outbox)
- `local_sync_state`
- `local_migrations`

Every operation in `pending_operations` should have:
- globally unique `operation_id`
- monotonic local sequence number
- owner profile ID (`owner_id`)
- entity and operation type
- payload or patch
- local entity revision
- creation timestamp
- retry count and last error
- state (`PENDING`, `IN_FLIGHT`, `ACKNOWLEDGED`, `FAILED_RETRYABLE`, `CONFLICT`)
- idempotency key

Do not keep a second unrelated source of truth in Zustand. Zustand may be a UI cache over IndexedDB-backed repositories.

### 9.3 Durability and storage pressure

- Request `navigator.storage.persist()` where available and record the boolean result.
- Use `navigator.storage.estimate()` to monitor `usage` and `quota`.
- Use IndexedDB transaction durability `strict` for critical transactions where supported; treat it as a browser hint, not an absolute hardware guarantee.
- Handle `QuotaExceededError`, blocked upgrades, failed transactions, and unavailable IndexedDB explicitly.
- Never show a successful local-save indicator if the IndexedDB transaction failed.
- Warn before local storage becomes critically full.
- Provide an emergency **Download Local Recovery Export** for pending local data, without requiring cloud connectivity.
- Do not cache secret API keys or Supabase tokens in the local application database.

### 9.4 Last-session restoration

Persist and restore:
- last active route where useful
- current search query and locally available results/manifest snapshot
- active filters, sorting, and page/workspace state
- selected personal playlist and expanded group where useful
- drafts, notes, and pending edits
- pending queue and last local sequence
- last successful cloud revision

Restore local state first, then reconcile with cloud revision metadata. Never overwrite a newer local revision with an older cloud snapshot. Provide a conflict state if the same dataset was changed elsewhere.

### 9.5 Multi-tab and concurrency

Even for one administrator, the app may be open in multiple tabs. Use a single-writer lease, Web Locks where supported, `BroadcastChannel`, or a proven equivalent to coordinate operations. Ensure duplicate operation replay is idempotent. Do not assume tabs share in-memory state.

### 9.6 Browser limitations to disclose

Persistent storage may be denied, browser storage may be manually cleared, profile data may be lost, and hardware failure can destroy local data. The application can substantially improve recovery but cannot promise zero loss under those conditions. Make local durability status visible and provide cloud save/export options.

References: [IndexedDB transaction durability](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/durability), [StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist), [StorageManager.estimate](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate).

---

## 10. Global Save and Cloud Synchronization

### Default configuration

```env
AUTO_SAVE_ENABLED=true
AUTO_SAVE_INTERVAL_HOURS=12
```

The value is configurable. The app must display the actual configured interval.

### Synchronization triggers

- User clicks the global **Save All Changes** button.
- App is open and the configured interval becomes due.
- App starts and discovers an overdue pending batch.
- App regains connectivity and synchronization is due or the user explicitly retries.
- User explicitly retries a failed batch.

Do not rely on a browser timer, service worker Background Sync, Vercel Cron, or Supabase Cron to read IndexedDB while the browser is closed. The server cannot access unsynchronized data that exists only on the user's device. On next app startup, reconcile the persisted local queue and run an overdue sync.

### Save Center UI

Provide a global, easy-to-find control in the application shell with:
- current state: `Saved Locally`, `Pending Cloud Sync`, `Syncing`, `Cloud Synced`, `Sync Failed`, or `Conflict`
- pending operation count
- pending dataset count
- estimated upload size
- last successful cloud save timestamp
- next automatic save due time
- Save All action
- retry action for failures
- local recovery export
- details/diagnostics for the last batch

Also show a subtle pending-change indicator in the sidebar. Do not use green/success styling for data that is only local and not cloud-synced.

### Batch semantics (Option A: Single Dataset Per Batch)

Synchronization uses the Option A model where each cloud save batch targets exactly one logical dataset:
- **Dataset Scoping:** The client Save Coordinator groups pending outbox operations by `dataset_id`. Batches are executed independently per dataset, preventing a failure in one dataset (e.g. large playlist) from blocking commits in another (e.g. Saved Items).
- **Concurrency Control (`expected_revision`):** The client includes `expected_revision` in the batch submission payload (`save_sync_batches`).
- **Pessimistic Row Locking:** The server acquires an exclusive lock via `SELECT * FROM storage_datasets WHERE id = :dataset_id FOR UPDATE` within the transaction boundary.
- **Revision Verification:** If `current_revision != expected_revision`, the batch transitions to `REVISION_CONFLICT` (HTTP 409) and the client outbox initiates reconciliation without corrupting the cloud dataset.
- **Atomic Advancement:** If revisions match, the server updates index tables, registers immutable parts, marks the generation `COMMITTED`, increments `current_revision`, and marks the batch `COMMITTED`.
- **Client Outbox Pruning:** The client clears pending operations from IndexedDB only after receiving server confirmation containing the newly committed revision.
- **Idempotency:** Every batch carries a unique `idempotency_key` scoped to `(owner_id, dataset_id, idempotency_key)`. Retrying a timed-out batch returns the already-committed revision safely without duplicating manifest parts or index records.
- **No Unchanged Uploads:** Do not send unchanged records or re-upload an unchanged generation. Upload immutable parts with bounded concurrency (max 3 parallel part uploads).
- **Failure Safety:** If any required part fails upload or checksum verification, the transaction aborts, leaving the previous generation active.

### The 6-Stage Storage Commit Saga

Because external HTTP operations against Supabase Storage cannot participate in a PostgreSQL ACID transaction, synchronization must be executed in 6 decoupled, crash-safe stages:

1. **Stage 1: Prepare (Client-Side)**
   - Lock local dataset store in IndexedDB.
   - Collect pending operations from outbox.
   - Build candidate generation snapshot and partition into <= 40 MiB parts.
   - Compute SHA-256 hash and byte length for every part.
   - Request batch initiation from `/api/sync/batch/prepare` with `expected_revision`.
   - Server creates `save_sync_batches` row in `PREPARING` status with TTL.

2. **Stage 2: Staged Upload (Client → Storage)**
   - Upload parts to staging path: `<owner-auth-uuid>/temp/staging/<batch-id>/parts/part-<index>.json`.
   - Upload up to 3 parts in parallel with exponential backoff on retryable HTTP errors.
   - Database remains untouched during upload; active generation remains fully online.

3. **Stage 3: Verification (Server)**
   - Client sends commit request `/api/sync/batch/commit`.
   - Server inspects all staged objects via Supabase Storage API.
   - Verifies byte count, SHA-256 content checksum, and JSON structure for every part.
   - If any part is missing or corrupted, batch transitions to `FAILED` and aborts.

4. **Stage 4: Atomic Commit (PostgreSQL Transaction)**
   - Begin PostgreSQL transaction.
   - Execute `SELECT * FROM storage_datasets WHERE id = :dataset_id FOR UPDATE`.
   - Verify `current_revision == expected_revision`.
   - Move or register objects under permanent persistence path: `<owner-auth-uuid>/persistence/datasets/<dataset-type>/generations/<gen-id>/...`.
   - Insert `storage_generations` with `status = 'COMMITTED'`.
   - Insert all `storage_manifest_parts` rows with composite FK `(generation_id, id)`.
   - Upsert/delete light relational index rows (e.g. `saved_items`, `user_playlist_entries`).
   - Update `storage_datasets` setting `current_generation_id = :gen_id` and `current_revision = current_revision + 1`.
   - Set batch status to `COMMITTED`.
   - Commit PostgreSQL transaction.

5. **Stage 5: Acknowledgement & Local Pruning (Server → Client)**
   - Server returns HTTP 200 with new `current_revision` and generation metadata.
   - Client Save Coordinator clears acknowledged operations from IndexedDB outbox.
   - Save Center UI transitions to `Cloud Synced`.

6. **Stage 6: Compensating Cleanup & Recovery**
   - Staging objects for completed or aborted batches are registered in `storage_temp_objects` with short TTL (e.g. 2 hours) for background physical deletion.
   - If a crash occurs between stages, client retry uses the same `idempotency_key` to query batch status. If already committed, the server returns the existing result safely.

### Important operations saved immediately on the server

The following are not deferred to Global Save:
- Auth/security operations.
- API-key create/update/rotate/disable.
- Actual YouTube quota usage events and key cooldown state.
- Other security-critical or server-authoritative operational state.

API key secrets must never enter IndexedDB. The browser submits a key over TLS to a protected server endpoint, and the server encrypts and stores it.

---

## 11. Temporary Data TTL and Cleanup

Suggested defaults (verify against the existing code contracts before finalizing):

```env
TEMP_DATA_TTL_HOURS=24
TEMP_CLEANUP_INTERVAL_HOURS=12
```

The previous code audit identified several existing retention behaviors that must be verified and preserved where still applicable:

- Search workspace `lastSearch`: previously reported as 168 hours / 7 days.
- Search history records: previously reported permanent (`expiresAt: null`).
- Upload staging session: previously reported 24 hours.
- Staging garbage collection: previously reported 48 hours.
- Key quota cooldown: previously reported 24 hours.
- YouTube quota daily reset: Pacific midnight.
- Admin session cookie: previously reported 7 days, configurable; Supabase Auth token policy must be treated separately.

Do not blindly replace these independent TTL policies with one global TTL.

### Cleanup lifecycle

1. Store the explicit `expires_at` timestamp when the object is created.
2. Treat expired content as unavailable to normal application reads immediately.
3. A server-side cleanup worker/scheduled invocation discovers eligible rows in bounded batches.
4. Check that no committed dataset, active batch, export, or running job references the object.
5. Mark the object `DELETING` or `DELETE_PENDING`.
6. Delete using Supabase Storage API.
7. Verify the delete result.
8. Mark cleanup completed and remove/retain metadata according to audit/retention policy.
9. Retry failures safely without deleting unrelated objects.

Changing the TTL environment variable affects new objects by default. Do not silently shorten the expiry of all existing temporary objects without an explicit migration/administrative operation.

A cleanup scheduler only runs when the chosen platform actually invokes it. Verify the current Vercel plan and cron schedule limits or use an available Supabase/server-side scheduler. Browser-side cleanup may be a supplementary trigger but cannot be the only cleanup mechanism.

---

## 12. Export, Import, and Backup/Recovery

### Export Center

Create a dedicated page/section to export:
- Saved Items (all or a selected type/date range)
- one personal playlist
- all personal playlists
- Search History and full manifest references
- Saved Searches (pinned presets)
- Research Queue
- Saved References
- Manifest Storage Explorer generations (ZIP packaging with SHA-256 validation)
- safe user preferences and exportable settings
- a Complete Workspace package

Formats:
- JSON for structured complete records and manifests
- CSV for flat tabular views where appropriate
- ZIP for a multi-file workspace package with a top-level index and checksums

An export must be reconstructable: include schema version, dataset IDs, part ordering, content checksums, creation time, and any required metadata. Never include API-key plaintext, Supabase credentials, passwords, session tokens, or encryption keys.

### Import

- Validate archive structure, file size, format, schema version, record counts, and checksums before applying data.
- Support dry-run preview with counts and conflicts.
- Deduplicate using stable domain identities.
- Preserve user-visible creation/save timestamps when importing.
- Apply in recoverable batches.
- Keep a rollback/recovery plan.
- Do not overwrite newer local/cloud data without explicit conflict handling.

### Backup reality on Free plan

Do not assume the Free plan provides automated database backups. The official pricing page lists daily backups as a paid-plan feature. A copy stored in the same Supabase project is not an independent backup. Provide downloadable local exports and document the need for an independent backup destination if the owner requires disaster recovery beyond the current project/device.

Reference: [Supabase pricing and backup features](https://supabase.com/pricing).

---

## 13. Environment Configuration — `.env.example`

`.env.example` is the canonical, safe configuration reference for this repository. It must be generated from actual code usage, not from guesswork.

### Audit requirements

Search and reconcile:
- `process.env.NAME`
- `process.env[dynamicName]` and other dynamic environment access
- config validators and schemas
- Next.js and Prisma configuration
- scripts, tests, deployment workflows, storage adapters, auth, encryption, YouTube provider
- any legacy read-only migration utilities

For each actual variable, document:
- exact name
- purpose
- required/optional/conditional status
- default value (if any)
- units and accepted range
- public vs server-only classification
- environments where it is required
- whether it is transitional/deprecated

Do not add variables that have no code consumer unless they are explicitly planned and labeled `planned/not yet implemented`. Prefer no unused variables.

### Expected sections (final names must match code)

1. Application / runtime.
2. Public Supabase URL and publishable key.
3. Server-only Supabase URL and secret key, only if server code requires it.
4. PostgreSQL pooled `DATABASE_URL` and direct `DIRECT_URL`.
5. Admin Auth UUID and app-specific session/idle policy.
6. Auto-save settings.
7. Manifest size limits.
8. Temporary data and staging TTL/cleanup.
9. YouTube integration and quota settings actually consumed by code.
10. API-key encryption master key.
11. Export/import settings if configured through env.
12. Legacy Vercel Blob read-only migration token, only while required for data inventory/import.
13. Any actual scheduler/cron authorization secret.

Suggested variables to reconcile (do not blindly add all of them):

```env
# Application
NODE_ENV=development
APP_URL=http://localhost:3000

# Public Supabase configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME

# Server-only Supabase configuration (only if required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_REPLACE_ME

# PostgreSQL — server-only
DATABASE_URL=postgresql://USER:PASSWORD@POOLER_HOST:PORT/postgres
DIRECT_URL=postgresql://USER:PASSWORD@DIRECT_HOST:5432/postgres

# Single administrator identity
ADMIN_AUTH_USER_ID=00000000-0000-0000-0000-000000000000
ADMIN_SESSION_MAX_AGE_SECONDS=604800

# Cloud synchronization
AUTO_SAVE_ENABLED=true
AUTO_SAVE_INTERVAL_HOURS=12

# Manifest object sizes
MANIFEST_TARGET_SIZE_MIB=40
MANIFEST_MAX_SIZE_MIB=45

# Temporary data policies
TEMP_DATA_TTL_HOURS=24
TEMP_CLEANUP_INTERVAL_HOURS=12

# Existing search/staging retention, if these names are actually used
SEARCH_STORAGE_TTL_HOURS=168
UPLOAD_STAGING_TTL_HOURS=24

# Server-only encryption key; use the exact encoding/length expected by code
API_KEYS_ENCRYPTION_KEY=REPLACE_WITH_GENERATED_SECRET

# Transitional, server-only, READ-ONLY legacy inventory/import access
BLOB_READ_WRITE_TOKEN=REPLACE_ME
```

This block is a template, not permission to invent secrets or add unused variables. If the code uses a different exact name, update the documentation and validation schema together. If a value is only needed in a migration script, document that scope explicitly. Do not copy any real `.env.local` values into `.env.example`.

### Supabase API key names

Prefer the current key names:
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for public browser/client configuration.
- `SUPABASE_SECRET_KEY` for server-only elevated operations when genuinely required.

Do not expose secret keys or legacy `service_role` values through `NEXT_PUBLIC_` variables. Supabase is migrating from legacy `anon`/`service_role` key names to publishable/secret keys; keep code and docs aligned with the current Dashboard model.

### Environment consistency checks

- `.env.example`, the runtime validation schema, deployment documentation, and code must agree exactly.
- Missing optional values must not silently cause an unsafe storage fallback in production.
- Provide clear startup errors that name the missing variable without printing its value.
- Never read/display real secret values in coding-agent reports.
- Keep `.env.example` committed; keep `.env*` real files ignored except safe examples already configured by the repository.

---

## 14. Legacy Vercel Blob Retirement and Data Preservation

The Vercel Blob SDK/runtime dependency may be removed, but the original remote objects must remain untouched until a separate, verified migration and explicit owner authorization.

### Rules

- No remote Blob delete, overwrite, purge, or mutation during inventory.
- Do not remove the old Blob token while read-only inventory or import remains necessary.
- Keep the inventory/import utility isolated from normal application runtime.
- Read-only inventory should record paths, object sizes, modification timestamps, and metadata accessible from the API.
- Read/download old objects only for an explicitly authorized migration/import.
- Compare source object counts/bytes and destination records/objects.
- Verify hashes when source and destination bytes are available.
- Preserve original IDs, timestamps, folder/path semantics, and manifest references.
- Record per-object migration status and retry failures idempotently.
- Do not switch a dataset's authoritative pointer until the new copy is fully verified.
- Do not delete the old Blob objects after successful copy unless the owner separately authorizes deletion.

Do not delete generic `src/lib/blob` files merely because of their directory name; inspect whether they implement generic manifest/chunk formats still used by the new Storage design. Remove only obsolete Vercel SDK integrations and dead runtime references.

---

## 15. UI, Navigation, and User Workflows

Preserve the existing premium visual direction while improving readability, consistency, and hierarchy. Avoid creating duplicate pages or an oversized sidebar.

### Main library grouping

Suggested grouping:

**MY LIBRARY**
- Saved Items (dedicated page with daily calendar grouping)
- Playlist Manager (personal playlists, sections/groups, manual order, thumbnail galleries)
- Saved Searches (reusable query presets with filters and pinning)
- Search History (permanent audit log with instant archive load)
- Research Queue (queued items saved from search cards)
- Saved References (manually saved titles, articles, external URLs)

**YOUTUBE EXPLORER**
- Search (general search workspace with manifest summary, local filters, and AI drawer)
- Search Guide (documented vs experimental syntax and Arabic explanations)
- Channels (saved channels library)
- YouTube Playlists (saved external playlists library)
- Watch / Link Explorer / AI Discovery where they already exist

**SYSTEM & STORAGE**
- Save Center / Export Center
- Manifest Storage Explorer (`/manifests`: real physical Supabase Storage browser)
- Settings (Preferences, SafeSearch, Fetch Controls, Security)
- API Keys & Quota Management (multi-key rotation, Pacific daily reset)

### Saved Items page

- Dedicated page, separate from personal Playlist Manager.
- Filters: All, Videos, Channels, Playlists.
- Shorts represented as a video subtype/filter if useful.
- Daily date sections based on `saved_at`, newest first.
- Clear date headers, item counts, readable cards, prominent thumbnails/titles.
- Search and sorting must use the light index, not download all manifest parts for every list interaction.

### Playlist Manager

- Dedicated workspace for personal playlists.
- Prominent thumbnails and larger readable titles.
- Clear item counts, descriptions, groups/sections, and dates.
- Drag/drop, order, search, notes, bulk operations, edit, delete confirmation, and export must remain functional.
- Do not confuse personal playlists with original YouTube playlists.

### Research Queue

- Add a `Save for Later` action to each applicable search/AI result card.
- Dedicated route/page with filtering, sort, status, notes, and source context as approved.
- A subsequent search must not replace or clear queued items.

### Saved References

- Separate page for manually saved titles and links.
- Allow non-YouTube URLs and plain titles.
- Include notes/tags and export.

### Manifest Storage Explorer

- Interactive physical storage browser replacing the old static manifest list.
- Visual nested tree: `Owner -> Dataset Type -> Dataset -> Generation -> Parts -> Storage Objects`.
- Per-part metadata display: exact byte size, record count, SHA-256 checksum, schema version, creation/commit timestamps, live storage existence check.
- Real-time reconciliation panel classifying objects into 6 states: `VERIFIED`, `MISSING_FROM_STORAGE`, `UNTRACKED_ORPHAN`, `METADATA_MISMATCH`, `UNCOMMITTED_GENERATION`, `INCOMPLETE_PARTS`.
- Direct actions: Download Individual Part (exact bytes preserved), Export Complete Generation (ZIP archive with SHA-256 pre-verification), Export Dataset, and Integrity Check.

### Save Center

- Global Save All action visible in the app shell.
- Status labels must distinguish local durable save from cloud save.
- Show pending counts, size estimate, last cloud save, next auto-save due, failure details, and retry.

### Design quality

- Consistent typography, spacing, borders, radii, contrast, focus rings, hover/active states, and responsive behavior.
- Avoid small, compressed thumbnails/titles in Playlist Manager.
- Avoid duplicate destinations or repeated pages with slightly different labels.
- Keep the sidebar logically grouped and concise.
- Test keyboard access, focus visibility, loading/empty/error states, and mobile layouts.

---

## 16. Migration Plan and Approval Gates

Implementation must proceed strictly in these sequential phases as detailed in [implementation-plan.md](file:///f:/discovery/youtube-discovery/docs/data-architecture/implementation-plan.md).

### Completed & Current Phases

#### Phase 0 — Repository and data-contract audit (Completed & Verified)
- Inspected all routes, features, components, repositories, TypeScript interfaces, current package versions, and project ledgers.
- Inventoried every current persistence source: legacy Blob, IndexedDB/localStorage/Zustand, memory maps, files, and Supabase Storage adapter.
- Mapped all data IDs, timestamps, ownership, TTL, and deduplication rules.
- Inventoried every environment variable.
- Verified Prisma 7 package/configuration correctness without remote DB calls.
- Built and verified read-only Prisma 7 migration management CLI toolkit (`scripts/db-migrations/`, `npm run db:migrations`, `npm run test:migrations` passing 43/43 tests).
- Produced `docs/data-architecture/current-state.md`.

#### Phase 1.3 — Final Relational Integrity, Owner Isolation & Storage Lifecycle (Current Deliverable)
- Finalized canonical 18-table inventory with exact normalized names (no `save_sync_batch_items`).
- Implemented full generational storage hierarchy composite foreign keys with linear parent lineage.
- Enforced direct permanent upload protocol to `<owner-auth-uuid>/persistence/...` without move/rename operations.
- Defined database trigger for `storage_datasets.current_generation_id` commitment verification.
- Established revision initialization semantics (`current_revision = 0`, advances to `1` on first commit).
- Handled dataset uniqueness with nullable `entity_id` via partial unique indexes (`uq_storage_datasets_singleton`, `uq_storage_datasets_entity`).
- Decoupled domain index records from manifest snapshots (`ON DELETE SET NULL`), preventing bookmark deletion when old generation snapshots are pruned.
- Handled account lifecycle and historical retention via nullable `auth_user_id` with `ON DELETE SET NULL` and soft-delete flags.
- Hardened RLS helper `current_user_profile_id()` with safe `search_path = public, pg_temp;` and verified instant lockout on both DB and Supabase Storage.
- Formatted complete v1.4 specifications across:
  - `docs/data-architecture/erd.md` (v1.4)
  - `docs/data-architecture/data-dictionary.md` (v1.4)
  - `docs/data-architecture/manifest-format.md` (v1.4)
  - `docs/data-architecture/sync-and-recovery.md` (v1.4)
  - `docs/data-architecture/adr-001-multi-user-storage-explorer.md` (v1.4)
  - `docs/security/auth-storage-rls.md` (v1.4)
  - `docs/data-architecture/implementation-plan.md` (v1.4)

---

### PHASE A COMPLETED & PHASE B–F AUTHORIZATION

Phase A documentation correction is complete. The project owner has explicitly authorized execution of the local implementation roadmap (Phases B through F).
**Database Migration Rule:** Generate migration files only. Do NOT apply migrations to any database.

---

### Authorized Sequential Implementation Roadmap (Phases B through G)

#### Phase B — Safe Legacy Collections Deletion
- Remove obsolete Collections route directory: `src/app/collections/`.
- Remove obsolete Collections UI components: `src/components/collections/`.
- Remove obsolete Collections types and domain interfaces from `src/types/` and `src/lib/`.
- Verify no remaining runtime imports to deleted Collections files across application routes.
- Verify TypeScript compilation (`npm run typecheck`) and ESLint (`npm run lint`).

#### Phase C — Single-Admin Database Foundation (Local Migration Generation Only)
- Formulate approved Prisma schema (`prisma/schema.prisma`) with all 18 tables and composite FKs.
- Author initial canonical migration SQL (`prisma/migrations/20261102000000_canonical_v1_4_foundation/migration.sql`).
- Run `npx prisma validate` and `npx prisma generate` to verify schema integrity and generate client types.
- STRICT RULE: Do not run `prisma migrate deploy` or `prisma db push` against any database.
- Document RLS security policies, triggers, and helper functions defined in `docs/security/auth-storage-rls.md`.
- Bootstrap initial administrator profile configuration (`user_profiles.role = 'admin'`).

#### Phase D — Storage Engine & Manifest Generation Protocol
- Configure Supabase private storage bucket `youtube-discovery`.
- Implement storage adapter with deterministic partitioning (<= 40 MiB part target, 45 MiB ceiling) and `<storage_owner_uuid>` paths.
- Implement individual SHA-256 and binary aggregate generation SHA-256 checksum computation.
- Implement generation commit protocol with Stage 4 commit ordering (generation `COMMITTED` before dataset pointer update).
- Ensure derived root `manifest.json` generation and repair routines are functional.

#### Phase E — Manifest Storage Explorer Implementation
- Redesign `/manifests` route into a full physical storage browser.
- Implement backend API routes `/api/manifests/tree`, `/api/manifests/reconcile`, and `/api/manifests/export`.
- Implement tree navigation: `Owner -> Dataset Type -> Dataset -> Generation -> Parts`.
- Implement real-time reconciliation engine classifying objects into 6 states (`VERIFIED`, `MISSING_FROM_STORAGE`, `UNTRACKED_ORPHAN`, `METADATA_MISMATCH`, `UNCOMMITTED_GENERATION`, `INCOMPLETE_PARTS`).
- Implement streaming raw part downloads and generation ZIP exports.

#### Phase F — Local-First Outbox, Cloud Save & Recovery Saga
- Upgrade IndexedDB repositories with `ownerId` scoping and transactional outboxes.
- Implement Save Coordinator executing the 6-stage Option A commit saga.
- Implement Save Center UI in application shell displaying live local vs. cloud sync status.
- Implement automatic 12-hour background save trigger and conflict resolution UI.
- Verify sudden browser termination and power-loss recovery.

#### Phase G — Future Multi-User Activation
- When multi-user operation is authorized:
  - Enable self-registration endpoints.
  - Automatically provision isolated owner namespaces (`<new-user-uuid>/persistence/...`).
  - Enforce tenant isolation via RLS policies without database redesign.

---

## 17. Testing and Acceptance Criteria

### Local durability and power-loss tests

- Every meaningful action appears in IndexedDB only after its transaction commits.
- Entity update and outbox record are atomic.
- Abruptly close the browser after transaction completion, reopen, and restore the exact pending state.
- Replaying an operation twice causes one logical result.
- Failed IndexedDB transaction never reports `Saved Locally`.
- Simulate quota exhaustion and persistence permission denial.
- Test offline create/update/delete/reorder and later reconnect.
- Test multiple tabs and stale local revisions.

### Cloud save tests

- Save All uploads only pending changes.
- Option A batch isolates updates to a single target dataset.
- Each manifest part is below configured byte ceiling (<= 45 MiB).
- No single record is split.
- Part checksums and counts verify after upload/download.
- Simulate upload success + DB failure.
- Simulate DB success + root pointer write failure.
- Simulate revision conflict (`expected_revision != current_revision`).
- Simulate retry, duplicate batch, timeout, and partial network loss.
- Old committed generation remains readable until new commit succeeds.
- Local outbox remains pending until verified server acknowledgement.

### Domain and feature regression tests

- All three Saved Item types (Videos, Channels, Playlists) and Shorts classification (`isShortsLike`).
- Daily date grouping uses save timestamp (`saved_at`).
- Duplicate saved item behavior: `UNIQUE (owner_id, entity_type, platform_item_id)`.
- Personal playlist groups, manual order, custom entries, and thumbnail galleries survive reload and export.
- Composite foreign key constraint integrity: Verify that assigning an entry to a group from another playlist fails at the database level.
- YouTube deduplication in playlists: `UNIQUE (playlist_id, platform_item_id) WHERE entry_kind = 'youtube'`.
- A Research Queue item survives a new search and may coexist with Saved Items.
- Saved References accept non-YouTube links.
- Search history preserves complete result manifests, provenance, pagination, and zero-valued metrics.
- Saved Searches remain distinct from Search History.
- API key plaintext never appears in DB rows, browser storage, logs, or exports.
- Quota accounting is concurrency-safe and Pacific-time correct (`America/Los_Angeles`).
- TTL removes only eligible temporary objects and never committed objects.

### Manifest Storage Explorer tests

- Accurate visualization of storage tree: `Owner -> Dataset Type -> Dataset -> Generation -> Parts`.
- Classification into 6 reconciliation states (`VERIFIED`, `MISSING_FROM_STORAGE`, `UNTRACKED_ORPHAN`, `METADATA_MISMATCH`, `UNCOMMITTED_GENERATION`, `INCOMPLETE_PARTS`).
- Individual part download stream preserves exact UTF-8 bytes and formatting.
- Export Complete Generation (ZIP) validates SHA-256 hashes of all parts before packaging.
- Historical generation export correctly retrieves prior committed generation snapshots.

### Auth and security tests

- Correct administrator can log in.
- Non-admin Auth UUID is rejected even if authenticated.
- Client-provided admin ID is ignored.
- Logout and token refresh work.
- Expired/invalid JWT cannot access protected endpoints.
- Secret key cannot be imported by client bundles.
- Storage bucket remains private; unauthorized object access fails.
- Prisma API endpoints reject unauthenticated requests.
- Test whether RLS is actually applied to each access path; document privileged bypass paths.

### Build and quality checks

Run existing project scripts, after inspecting their actual names:
- TypeScript typecheck (`npm run typecheck`)
- ESLint (`npm run lint`)
- production build (`npm run build`)
- unit and integration tests (`npm run test:search`, `npm run test:blob`)
- database migration CLI tests (`npm run test:migrations`)
- database migration local check (`npm run db:migrations:local`)
- database migration verification on development database (`npm run db:migrations:check`)

Never run destructive DB commands on production. Never report tests as passing if they were not executed.

### Production acceptance checklist

- [ ] Single Supabase Auth administrator is verified by UUID.
- [ ] Auth password is not stored by the application.
- [ ] Prisma 7 only; exact packages pinned compatibly.
- [ ] `prisma.config.ts` uses `DIRECT_URL`; runtime adapter uses pooled `DATABASE_URL`.
- [ ] Supabase bucket is private and policies are tested.
- [ ] All application datasets have an approved manifest/relational ownership design.
- [ ] All manifest parts are below the 45 MiB application ceiling.
- [ ] Immutable generation commit/recovery works.
- [ ] IndexedDB stores all pending work immediately.
- [ ] Local outbox and snapshots survive browser restart tests.
- [ ] Save All and Option A due-based synchronization work.
- [ ] No pending local operation is deleted before verified cloud commit.
- [ ] Search, Saved Items, Playlist Manager, History, Search Guides, Watch, AI, API keys and Quota features regressions pass.
- [ ] Manifest Storage Explorer browses, reconciles, and exports physical storage files.
- [ ] Temporary TTL cleanup is safe and verifiable.
- [ ] Export and import round-trip tests pass.
- [ ] `.env.example` matches actual env usage and contains no real secrets.
- [ ] Legacy Vercel Blob objects remain untouched unless separately authorized.
- [ ] An independent backup/export recovery procedure is documented.

---

## 18. Project Documentation and Ledgers

Maintain the following project documentation (use existing locations/names if already established):

- `implementation-guide.md` — this specification (v1.3).
- `youtube_discovery_ledger.md` — current implementation truth and architecture overview.
- `PROJECT_CHANGE_LOG_LEDGER.md` — chronological implementation decisions and changes.
- `docs/data-architecture/current-state.md` — current persistence inventory and Phase 0 audit.
- `docs/data-architecture/erd.md` — canonical ERD (v1.3).
- `docs/data-architecture/data-dictionary.md` — canonical fields, constraints, and composite keys (v1.3).
- `docs/data-architecture/manifest-format.md` — versioned manifest format, generations, and Storage Explorer (v1.3).
- `docs/data-architecture/sync-and-recovery.md` — local outbox, Option A save batching, retry, power-loss behavior (v1.3).
- `docs/data-architecture/implementation-plan.md` — implementation roadmap across Phases A through G (v1.3).
- `docs/data-architecture/adr-001-multi-user-storage-explorer.md` — Architectural Decision Record ADR-001 (v1.3).
- `docs/security/auth-storage-rls.md` — complete 18-table RLS matrix, admin bootstrap, Supabase Storage path security (v1.3).
- `docs/database/migration-management.md` — read-only Prisma 7 migration CLI, indicators, and verification.
- `docs/operations/backup-restore.md` — exports, recovery, and independent backup process.
- `.env.example` — complete safe variable reference.

Every document must distinguish implemented behavior from planned behavior.

---

## 19. Final Agent Directive

Build this as a durable, single-administrator research platform, not a disposable search UI.

The owner must be able to:

- Save videos, channels, and playlists without losing them when new searches run.
- Organize personal playlists with groups, order, notes, and custom entries.
- Queue results to research later.
- Save arbitrary titles and links for later reference.
- Preserve complete search history and manifests.
- Manage YouTube API keys and quota safely.
- Continue working offline and recover locally committed changes after a sudden browser or power interruption.
- Save all pending datasets to Supabase on demand or at the configured 12-hour interval.
- Export each dataset or the complete workspace.
- Know exactly what is local, pending, synced, failed, or conflicted.

**Never trade data safety for fewer requests.** Reduce Supabase writes by batching non-urgent domain changes, not by delaying local persistence or weakening critical server-side accounting/security.

**Never destroy existing data to simplify migration.** The original Vercel Blob objects remain read-only and recoverable until a separate, explicit authorization to delete them.

**Never create the final application schema or run migrations before the owner approves the canonical ERD, data dictionary, constraints, and migration plan.**

The first task after reading this guide is Phase 0: audit the current repository and produce the verified data inventory. The next deliverable is Phase 1's complete schema proposal for owner review.

---

## 20. Official Technical References

The agent must consult the current official documentation when implementation begins, because platform APIs, pricing, and limits can change.

### Supabase

- [Pricing and plan limits](https://supabase.com/pricing)
- [Storage upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Storage access control and RLS](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase SSR authentication](https://supabase.com/docs/guides/auth/server-side)
- [Create Supabase clients for Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&router=app)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Migrate to publishable/secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Billing and backups](https://supabase.com/docs/guides/platform/billing-on-supabase)

### Prisma 7

- [Prisma 7 configuration](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)
- [Prisma 7 PostgreSQL](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql)
- [Prisma 7 connection management](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections)
- [Prisma 7 connection pools](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/connection-pool)
- [Prisma 7 generators](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)
- [Generate Prisma Client](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/generating-prisma-client)

### Browser durability

- [IndexedDB transaction durability](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/durability)
- [StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
- [StorageManager.estimate](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate)

---

**End of implementation guide.**
