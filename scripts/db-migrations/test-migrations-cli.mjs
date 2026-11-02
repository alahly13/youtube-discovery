import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { inspectLocalMigrations, computeMigrationChecksums } from "./local.mjs";
import { reconcileMigrations } from "./reconcile.mjs";
import { renderDashboard, colors } from "./renderer.mjs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Mocked Verification Suite for Prisma 7 Migration Management CLI
 * ──────────────────────────────────────────────────────────────────────────
 * Tests all 8 representative scenarios mandated by implementation-guide.md:
 *   1. No migrations exist.
 *   2. All migrations are applied.
 *   3. Some migrations are pending.
 *   4. A migration failed.
 *   5. Migration exists in the database but not locally.
 *   6. Checksum mismatch.
 *   7. Database connection unavailable.
 *   8. Prisma migration table does not exist.
 * Plus tests JSON export and local-only inspection mode.
 * ═══════════════════════════════════════════════════════════════════════════
 */

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ${colors.brightGreen}✓ PASS:${colors.reset} ${message}`);
  } else {
    failedTests++;
    console.error(`  ${colors.brightRed}✗ FAIL:${colors.reset} ${message}`);
  }
}

function createTempMigrationsDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-discovery-mig-test-"));
  return tmpDir;
}

function createMigrationFile(baseDir, name, sqlContent) {
  const migDir = path.join(baseDir, name);
  fs.mkdirSync(migDir, { recursive: true });
  fs.writeFileSync(path.join(migDir, "migration.sql"), sqlContent, "utf8");
  const checksums = computeMigrationChecksums(sqlContent);
  return {
    name,
    dir: migDir,
    rawChecksum: checksums.rawChecksum,
    normalizedChecksum: checksums.normalizedChecksum,
  };
}

async function runTestSuite() {
  console.log(`\n${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}   PRISMA 7 MIGRATION MANAGEMENT CLI — VERIFICATION SUITE      ${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}\n`);

  const tmpBase = createTempMigrationsDir();

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 1: No migrations exist (clean repository, clean DB)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`${colors.bold}Scenario 1: No migrations exist anywhere${colors.reset}`);
    {
      const local = inspectLocalMigrations(tmpBase);
      const dbReport = {
        connected: true,
        status: "CONNECTED",
        tableExists: true,
        connectionInfo: { provider: "PostgreSQL / Supabase", host: "db.test.co", database: "postgres" },
        migrations: [],
      };

      const report = reconcileMigrations(local, dbReport);
      assert(report.exitCode === 0, "Scenario 1 exit code must be 0 (clean empty state)");
      assert(report.overallStatus === "EMPTY_HISTORY", "Scenario 1 overallStatus is EMPTY_HISTORY");
      assert(report.summary.applied === 0 && report.summary.pending === 0, "Zero applied and zero pending");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 2: All migrations are applied
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${colors.bold}Scenario 2: All migrations are applied and match${colors.reset}`);
    {
      const scenDir = path.join(tmpBase, "scen2");
      const mig1 = createMigrationFile(scenDir, "20261102090000_initial_schema", "CREATE TABLE test1 (id INT);");
      const mig2 = createMigrationFile(scenDir, "20261102100000_saved_items", "CREATE TABLE test2 (id INT);");

      const local = inspectLocalMigrations(scenDir);
      const dbReport = {
        connected: true,
        status: "CONNECTED",
        tableExists: true,
        connectionInfo: { provider: "PostgreSQL / Supabase", host: "db.test.co", database: "postgres" },
        migrations: [
          {
            id: "m1",
            migrationName: mig1.name,
            checksum: mig1.rawChecksum,
            startedAt: "2026-11-02T09:00:00.000Z",
            finishedAt: "2026-11-02T09:00:01.000Z",
            rolledBackAt: null,
            durationMs: 1000,
          },
          {
            id: "m2",
            migrationName: mig2.name,
            checksum: mig2.rawChecksum,
            startedAt: "2026-11-02T10:00:00.000Z",
            finishedAt: "2026-11-02T10:00:02.000Z",
            rolledBackAt: null,
            durationMs: 2000,
          },
        ],
      };

      const report = reconcileMigrations(local, dbReport);
      assert(report.exitCode === 0, "Scenario 2 exit code must be 0 (all synchronized)");
      assert(report.overallStatus === "SYNCHRONIZED", "Scenario 2 status is SYNCHRONIZED");
      assert(report.summary.applied === 2, "Applied count is 2");
      assert(report.summary.pending === 0, "Pending count is 0");
      assert(report.summary.latestSuccessful === mig2.name, "Latest successful matches second migration");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 3: Some migrations are pending
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${colors.bold}Scenario 3: Some migrations are pending${colors.reset}`);
    {
      const scenDir = path.join(tmpBase, "scen3");
      const mig1 = createMigrationFile(scenDir, "20261102090000_applied_schema", "CREATE TABLE a (id INT);");
      const mig2 = createMigrationFile(scenDir, "20261102100000_pending_items", "CREATE TABLE b (id INT);");

      const local = inspectLocalMigrations(scenDir);
      const dbReport = {
        connected: true,
        status: "CONNECTED",
        tableExists: true,
        connectionInfo: { provider: "PostgreSQL / Supabase", host: "db.test.co", database: "postgres" },
        migrations: [
          {
            id: "m1",
            migrationName: mig1.name,
            checksum: mig1.rawChecksum,
            startedAt: "2026-11-02T09:00:00.000Z",
            finishedAt: "2026-11-02T09:00:01.000Z",
            rolledBackAt: null,
          },
        ],
      };

      const report = reconcileMigrations(local, dbReport);
      assert(report.exitCode === 1, "Scenario 3 exit code must be 1 (pending exists)");
      assert(report.overallStatus === "MIGRATIONS_PENDING", "Scenario 3 status is MIGRATIONS_PENDING");
      assert(report.summary.applied === 1, "Applied count is 1");
      assert(report.summary.pending === 1, "Pending count is 1");
      const pendingItem = report.migrations.find((m) => m.migrationName === mig2.name);
      assert(pendingItem?.dbStatus === "PENDING", "Pending migration accurately flagged as PENDING");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 4: A migration failed
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${colors.bold}Scenario 4: A migration failed in database history${colors.reset}`);
    {
      const scenDir = path.join(tmpBase, "scen4");
      const mig1 = createMigrationFile(scenDir, "20261102120000_failed_migration", "BAD SQL STATEMENT;");

      const local = inspectLocalMigrations(scenDir);
      const dbReport = {
        connected: true,
        status: "CONNECTED",
        tableExists: true,
        connectionInfo: { provider: "PostgreSQL / Supabase", host: "db.test.co", database: "postgres" },
        migrations: [
          {
            id: "m_fail",
            migrationName: mig1.name,
            checksum: mig1.rawChecksum,
            startedAt: "2026-11-02T12:00:00.000Z",
            finishedAt: null, // finishedAt is null indicates crash or in-progress failure
            rolledBackAt: null,
            logs: "syntax error at or near 'BAD'",
          },
        ],
      };

      const report = reconcileMigrations(local, dbReport);
      assert(report.exitCode === 1, "Scenario 4 exit code must be 1 (failure exists)");
      assert(report.overallStatus === "MIGRATIONS_FAILED", "Scenario 4 status is MIGRATIONS_FAILED");
      assert(report.summary.failed === 1, "Failed count is 1");
      const failedItem = report.migrations.find((m) => m.migrationName === mig1.name);
      assert(failedItem?.dbStatus === "FAILED", "Item status is FAILED");
      assert(failedItem?.logs?.includes("syntax error"), "Error logs captured");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 5: Migration exists in the database but not locally (Missing Local)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${colors.bold}Scenario 5: Migration in database missing from local files${colors.reset}`);
    {
      const scenDir = path.join(tmpBase, "scen5");
      // Intentionally create zero local files in scenDir
      fs.mkdirSync(scenDir, { recursive: true });

      const local = inspectLocalMigrations(scenDir);
      const dbReport = {
        connected: true,
        status: "CONNECTED",
        tableExists: true,
        connectionInfo: { provider: "PostgreSQL / Supabase", host: "db.test.co", database: "postgres" },
        migrations: [
          {
            id: "m_deleted_local",
            migrationName: "20261102080000_deleted_from_disk",
            checksum: "a".repeat(64),
            startedAt: "2026-11-02T08:00:00.000Z",
            finishedAt: "2026-11-02T08:00:01.000Z",
            rolledBackAt: null,
          },
        ],
      };

      const report = reconcileMigrations(local, dbReport);
      assert(report.exitCode === 1, "Scenario 5 exit code must be 1 (divergent)");
      assert(report.overallStatus === "DIVERGENT", "Scenario 5 status is DIVERGENT");
      assert(report.summary.missingLocally === 1, "Missing locally count is 1");
      assert(report.migrations[0].dbStatus === "MISSING_LOCAL", "Item dbStatus is MISSING_LOCAL");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 6: Checksum mismatch (local file altered after application)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${colors.bold}Scenario 6: Checksum mismatch between local file and database${colors.reset}`);
    {
      const scenDir = path.join(tmpBase, "scen6");
      const mig1 = createMigrationFile(scenDir, "20261102090000_tampered_migration", "ALTER TABLE x ADD col1 INT;");

      const local = inspectLocalMigrations(scenDir);
      const dbReport = {
        connected: true,
        status: "CONNECTED",
        tableExists: true,
        connectionInfo: { provider: "PostgreSQL / Supabase", host: "db.test.co", database: "postgres" },
        migrations: [
          {
            id: "m_tampered",
            migrationName: mig1.name,
            checksum: "0".repeat(64), // Recorded checksum differs from actual file content
            startedAt: "2026-11-02T09:00:00.000Z",
            finishedAt: "2026-11-02T09:00:01.000Z",
            rolledBackAt: null,
          },
        ],
      };

      const report = reconcileMigrations(local, dbReport);
      assert(report.exitCode === 1, "Scenario 6 exit code must be 1 (checksum mismatch)");
      assert(report.overallStatus === "DIVERGENT", "Scenario 6 status is DIVERGENT");
      assert(report.summary.checksumMismatches === 1, "Checksum mismatches count is 1");
      assert(report.migrations[0].dbStatus === "CHECKSUM_MISMATCH", "Item dbStatus is CHECKSUM_MISMATCH");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 7: Database connection unavailable / timeout
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${colors.bold}Scenario 7: Database connection unavailable${colors.reset}`);
    {
      const local = [];
      const dbReport = {
        connected: false,
        status: "UNREACHABLE",
        error: "Database connection failed (ETIMEDOUT): Connection timed out after 5000ms",
        connectionInfo: { provider: "PostgreSQL / Supabase", host: "db.test.co", database: "postgres" },
        tableExists: false,
        migrations: [],
      };

      const report = reconcileMigrations(local, dbReport);
      assert(report.exitCode === 2, "Scenario 7 exit code must be 2 (database unavailable)");
      assert(report.overallStatus === "DATABASE_UNAVAILABLE", "Scenario 7 status is DATABASE_UNAVAILABLE");
      assert(report.database.connected === false, "Database is reported disconnected");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 8: Prisma migration table does not exist
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${colors.bold}Scenario 8: Prisma migration table not yet initialized${colors.reset}`);
    {
      const scenDir = path.join(tmpBase, "scen8");
      createMigrationFile(scenDir, "20261102090000_unapplied_initial", "CREATE TABLE init (id INT);");

      const local = inspectLocalMigrations(scenDir);
      const dbReport = {
        connected: true,
        status: "TABLE_NOT_FOUND",
        error: "Table '_prisma_migrations' does not exist in the database.",
        connectionInfo: { provider: "PostgreSQL / Supabase", host: "db.test.co", database: "postgres" },
        tableExists: false,
        migrations: [],
      };

      const report = reconcileMigrations(local, dbReport);
      assert(report.exitCode === 1, "Scenario 8 exit code must be 1 (pending initialization)");
      assert(report.overallStatus === "TABLE_NOT_INITIALIZED", "Scenario 8 status is TABLE_NOT_INITIALIZED");
      assert(report.summary.pending === 1, "Pending count matches local migrations");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional Test 9: Local-only inspection mode
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${colors.bold}Additional Test 9: Local-only inspection mode${colors.reset}`);
    {
      const scenDir = path.join(tmpBase, "scen9");
      createMigrationFile(scenDir, "20261102090000_local_only", "CREATE TABLE loc (id INT);");

      const local = inspectLocalMigrations(scenDir);
      const report = reconcileMigrations(local, {}, { localOnly: true });

      assert(report.exitCode === 0, "Local-only mode returns exit code 0");
      assert(report.overallStatus === "LOCAL_INSPECTED", "Status is LOCAL_INSPECTED");
      assert(report.summary.totalLocal === 1, "Total local is 1");
      assert(report.migrations[0].dbStatus === "NOT_CHECKED", "Database status indicates local only");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional Test 10: JSON serialization integrity
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${colors.bold}Additional Test 10: JSON export integrity${colors.reset}`);
    {
      const local = [];
      const dbReport = {
        connected: true,
        status: "CONNECTED",
        tableExists: true,
        connectionInfo: { provider: "PostgreSQL / Supabase", host: "db.test.co", database: "postgres" },
        migrations: [],
      };

      const report = reconcileMigrations(local, dbReport);
      const jsonStr = JSON.stringify(report);
      const parsed = JSON.parse(jsonStr);

      assert(typeof parsed === "object", "JSON stringifies and parses cleanly");
      assert("overallStatus" in parsed && "exitCode" in parsed && "summary" in parsed, "Required root keys present");
      assert("totalLocal" in parsed.summary && "applied" in parsed.summary, "Summary metrics present");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Additional Test 11: Terminal dashboard rendering smoke test
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${colors.bold}Additional Test 11: Terminal dashboard formatting smoke test${colors.reset}`);
    {
      const scenDir = path.join(tmpBase, "scen11");
      createMigrationFile(scenDir, "20261102090000_render_test", "SELECT 1;");
      const local = inspectLocalMigrations(scenDir);
      const dbReport = {
        connected: true,
        status: "CONNECTED",
        tableExists: true,
        connectionInfo: { provider: "PostgreSQL / Supabase", host: "db.test.co", database: "postgres" },
        migrations: [],
      };
      const report = reconcileMigrations(local, dbReport);
      const rendered = renderDashboard(report, { verbose: true });

      assert(rendered.includes("YOUTUBE DISCOVERY · DATABASE CLI"), "Dashboard header rendered");
      assert(rendered.includes("MIGRATION SUMMARY"), "Summary section rendered");
      assert(rendered.includes("MIGRATION HISTORY"), "History section rendered");
      assert(rendered.includes("No migrations were applied or modified"), "Safety notice rendered");
    }

  } finally {
    // Clean up temporary test files
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {}
  }

  console.log(`\n${colors.bold}══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}   TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})${colors.reset}`);
  console.log(`${colors.bold}══════════════════════════════════════════════════════════════${colors.reset}\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(3);
});
