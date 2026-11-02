/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Migration Reconciliation Engine
 * ──────────────────────────────────────────────────────────────────────────
 * - Reconciles local filesystem migrations with recorded database migrations.
 * - Categorizes each migration: APPLIED, PENDING, FAILED, ROLLED_BACK,
 *   CHECKSUM_MISMATCH, MISSING_LOCAL.
 * - Detects migration history divergence, missing predecessors, or corrupt files.
 * - Computes overall synchronization status and authoritative exit codes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Format milliseconds into human readable duration string.
 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined) return "N/A";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Formats ISO timestamp to readable UTC date time string.
 */
export function formatTimestamp(isoStr) {
  if (!isoStr) return "N/A";
  try {
    const d = new Date(isoStr);
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  } catch {
    return isoStr;
  }
}

/**
 * Reconciles local migrations and database migrations.
 *
 * @param {Array<object>} localMigrations - From local.mjs inspectLocalMigrations()
 * @param {object} dbReport - From core.mjs inspectDatabaseMigrations()
 * @param {object} [options]
 * @param {boolean} [options.localOnly=false] - If true, evaluates local files without DB comparison
 * @returns {object} Full reconciliation report
 */
export function reconcileMigrations(localMigrations = [], dbReport = {}, options = {}) {
  const localOnly = options.localOnly || false;
  const dbMigrations = dbReport.migrations || [];

  const localMap = new Map();
  for (const m of localMigrations) {
    localMap.set(m.migrationName, m);
  }

  const dbMap = new Map();
  for (const m of dbMigrations) {
    dbMap.set(m.migrationName, m);
  }

  // Combined set of all known migration names, preserving order
  const allNamesSet = new Set([
    ...localMigrations.map((m) => m.migrationName),
    ...dbMigrations.map((m) => m.migrationName),
  ]);

  const allNames = Array.from(allNamesSet).sort((a, b) => a.localeCompare(b));

  const items = [];
  let appliedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let rolledBackCount = 0;
  let missingLocallyCount = 0;
  let checksumMismatchCount = 0;
  let divergentCount = 0;
  let latestSuccessful = null;
  let lastAppliedAt = null;

  for (const name of allNames) {
    const local = localMap.get(name);
    const db = dbMap.get(name);

    const localExists = Boolean(local && local.fileExists);
    let dbStatus = "UNKNOWN";
    let appliedAt = null;
    let duration = "N/A";
    let durationMs = null;
    let logs = null;
    let checksumMatches = null;

    if (localOnly) {
      dbStatus = "NOT_CHECKED";
      items.push({
        migrationName: name,
        localExists,
        dbStatus,
        appliedAt: null,
        duration: "N/A",
        durationMs: null,
        checksum: {
          local: local?.checksum || null,
          db: null,
          matches: null,
        },
        logs: null,
        timestamp: local?.timestamp || null,
        label: local?.label || name,
        sizeBytes: local?.sizeBytes || 0,
        lineCount: local?.lineCount || 0,
      });
      continue;
    }

    if (!dbReport.connected) {
      dbStatus = "UNAVAILABLE";
    } else if (!dbReport.tableExists) {
      dbStatus = "PENDING";
      pendingCount++;
    } else if (db) {
      appliedAt = db.finishedAt;
      durationMs = db.durationMs;
      duration = formatDuration(db.durationMs);
      logs = db.logs;

      if (db.rolledBackAt) {
        dbStatus = "ROLLED_BACK";
        rolledBackCount++;
      } else if (!db.finishedAt || (db.logs && db.logs.includes("Error"))) {
        dbStatus = "FAILED";
        failedCount++;
      } else {
        // Successful in DB, now check local presence and checksum
        if (!localExists) {
          dbStatus = "MISSING_LOCAL";
          missingLocallyCount++;
          divergentCount++;
        } else {
          // Compare checksums
          const rawMatch = local.checksum === db.checksum;
          const normMatch = local.normalizedChecksum === db.checksum;
          checksumMatches = rawMatch || normMatch;

          if (checksumMatches) {
            dbStatus = "APPLIED";
            appliedCount++;
            latestSuccessful = name;
            if (db.finishedAt) {
              lastAppliedAt = db.finishedAt;
            }
          } else {
            dbStatus = "CHECKSUM_MISMATCH";
            checksumMismatchCount++;
            divergentCount++;
          }
        }
      }
    } else {
      // Exists locally, but not in DB
      dbStatus = "PENDING";
      pendingCount++;
    }

    items.push({
      migrationName: name,
      localExists,
      dbStatus,
      appliedAt: formatTimestamp(appliedAt),
      duration,
      durationMs,
      checksum: {
        local: local?.checksum || null,
        db: db?.checksum || null,
        matches: checksumMatches,
      },
      logs,
      timestamp: local?.timestamp || (db?.startedAt ? formatTimestamp(db.startedAt) : null),
      label: local?.label || name,
      sizeBytes: local?.sizeBytes || 0,
      lineCount: local?.lineCount || 0,
    });
  }

  // Detect history divergence (e.g. an earlier migration is pending while a later one is applied)
  let seenAppliedAfterPending = false;
  let hasPending = false;
  for (const item of items) {
    if (item.dbStatus === "PENDING") {
      hasPending = true;
    } else if (hasPending && item.dbStatus === "APPLIED") {
      seenAppliedAfterPending = true;
      divergentCount++;
    }
  }

  // Compute Overall System Status
  let overallStatus = "SYNCHRONIZED";
  let exitCode = 0;
  let statusMessage = "All migrations are synchronized with the database.";

  if (localOnly) {
    overallStatus = "LOCAL_INSPECTED";
    exitCode = 0;
    statusMessage = `Inspected ${localMigrations.length} local migration(s). No database connection required.`;
  } else if (!dbReport.connected) {
    if (dbReport.status === "CONFIG_MISSING") {
      overallStatus = "CONFIG_MISSING";
      exitCode = 2;
      statusMessage = "Database configuration is missing. Set DIRECT_URL or DATABASE_URL.";
    } else {
      overallStatus = "DATABASE_UNAVAILABLE";
      exitCode = 2;
      statusMessage = `Database is unreachable: ${dbReport.error || "Connection timed out."}`;
    }
  } else if (!dbReport.tableExists) {
    if (localMigrations.length === 0) {
      overallStatus = "NOT_INITIALIZED";
      exitCode = 0;
      statusMessage = "Prisma migration table is not initialized and no local migrations exist.";
    } else {
      overallStatus = "TABLE_NOT_INITIALIZED";
      exitCode = 1;
      statusMessage = `Table '_prisma_migrations' not found. ${localMigrations.length} migration(s) pending initial application.`;
    }
  } else if (failedCount > 0) {
    overallStatus = "MIGRATIONS_FAILED";
    exitCode = 1;
    statusMessage = `${failedCount} migration(s) failed in database history.`;
  } else if (divergentCount > 0 || checksumMismatchCount > 0 || missingLocallyCount > 0 || seenAppliedAfterPending) {
    overallStatus = "DIVERGENT";
    exitCode = 1;
    statusMessage = `Migration history divergence detected (${checksumMismatchCount} checksum mismatches, ${missingLocallyCount} missing locally).`;
  } else if (pendingCount > 0) {
    overallStatus = "MIGRATIONS_PENDING";
    exitCode = 1;
    statusMessage = `${pendingCount} local migration(s) pending application to database.`;
  } else if (allNames.length === 0) {
    overallStatus = "EMPTY_HISTORY";
    exitCode = 0;
    statusMessage = "No migrations exist locally or in the database.";
  } else {
    overallStatus = "SYNCHRONIZED";
    exitCode = 0;
    statusMessage = `All ${appliedCount} migration(s) are synchronized.`;
  }

  return {
    overallStatus,
    exitCode,
    statusMessage,
    summary: {
      totalLocal: localMigrations.length,
      totalDb: dbMigrations.length,
      applied: appliedCount,
      pending: pendingCount,
      failed: failedCount,
      rolledBack: rolledBackCount,
      missingLocally: missingLocallyCount,
      checksumMismatches: checksumMismatchCount,
      divergent: divergentCount,
      latestSuccessful,
      lastAppliedAt: formatTimestamp(lastAppliedAt),
    },
    database: {
      connected: dbReport.connected,
      status: dbReport.status,
      provider: dbReport.connectionInfo?.provider || "N/A",
      host: dbReport.connectionInfo?.host || "N/A",
      database: dbReport.connectionInfo?.database || "N/A",
      tableExists: dbReport.tableExists,
      error: dbReport.error,
    },
    migrations: items,
  };
}
