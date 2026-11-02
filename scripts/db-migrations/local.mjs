import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Local Migration Inspector — Safe Read-Only Filesystem Scanner
 * ──────────────────────────────────────────────────────────────────────────
 * - Inspects prisma/migrations directory without making any modifications.
 * - Extracts migration directory names, validates migration.sql existence.
 * - Computes SHA-256 checksums matching Prisma 7's internal algorithm.
 * - Supports CRLF and LF normalization for cross-platform reliability.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Computes SHA-256 checksums for migration SQL content.
 * Returns both raw content checksum and LF-normalized checksum to handle
 * Windows Git CRLF checkouts without false positives.
 */
export function computeMigrationChecksums(content) {
  const rawChecksum = crypto.createHash("sha256").update(content, "utf8").digest("hex");
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const normalizedChecksum = crypto.createHash("sha256").update(normalizedContent, "utf8").digest("hex");
  return {
    rawChecksum,
    normalizedChecksum,
  };
}

/**
 * Parses timestamp and label from standard Prisma directory naming:
 * e.g., "20261102120000_initial_schema" -> { timestamp: "2026-11-02 12:00:00", label: "initial_schema" }
 */
export function parseMigrationDirName(dirName) {
  const match = dirName.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(.+)$/);
  if (!match) {
    return {
      timestamp: null,
      label: dirName,
      rawTimestamp: null,
    };
  }
  const [, year, month, day, hour, minute, second, label] = match;
  return {
    timestamp: `${year}-${month}-${day} ${hour}:${minute}:${second} UTC`,
    label: label.replace(/_/g, " "),
    rawTimestamp: `${year}${month}${day}${hour}${minute}${second}`,
  };
}

/**
 * Inspects all local migrations in the specified migrations directory.
 * @param {string} [migrationsDir] - Custom directory path, defaults to prisma/migrations in project root.
 * @returns {Array<object>} List of local migration objects sorted by directory name.
 */
export function inspectLocalMigrations(migrationsDir) {
  const targetDir = migrationsDir || path.join(process.cwd(), "prisma", "migrations");

  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });

  const migrationDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  const localMigrations = [];

  for (const dirEntry of migrationDirs) {
    const migrationName = dirEntry.name;
    const dirPath = path.join(targetDir, migrationName);
    const sqlFilePath = path.join(dirPath, "migration.sql");
    const fileExists = fs.existsSync(sqlFilePath);

    let checksum = null;
    let normalizedChecksum = null;
    let sizeBytes = 0;
    let lineCount = 0;

    if (fileExists) {
      try {
        const content = fs.readFileSync(sqlFilePath, "utf8");
        const checksums = computeMigrationChecksums(content);
        checksum = checksums.rawChecksum;
        normalizedChecksum = checksums.normalizedChecksum;
        sizeBytes = Buffer.byteLength(content, "utf8");
        lineCount = content.split("\n").length;
      } catch {
        // Read error recorded without crashing
        checksum = null;
      }
    }

    const { timestamp, label, rawTimestamp } = parseMigrationDirName(migrationName);

    localMigrations.push({
      migrationName,
      dirPath,
      sqlFilePath,
      fileExists,
      checksum,
      normalizedChecksum,
      sizeBytes,
      lineCount,
      timestamp,
      label,
      rawTimestamp,
    });
  }

  return localMigrations;
}
