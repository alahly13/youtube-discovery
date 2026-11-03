/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Local Filesystem Recovery Scanner (CLI)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Independent Offline Local Data Recovery Tool
 *
 * Scans allowlisted local disk storage directories (`data/playlists`,
 * `data/storage`, `data/search-storage`) or explicitly configured paths
 * without being bundled into the Next.js serverless production graph.
 *
 * SAFETY GUARDS:
 * 1. Allowlisted directory roots only. Rejects `process.cwd()`, `.next`,
 *    `node_modules`, `.git`, `src`, or system root paths.
 * 2. Strict path traversal protection: checks realpath to prevent symlink escapes.
 * 3. 100% READ-ONLY. Zero mutations, deletions, or truncations.
 * 4. SHA-256 calculation for every discovered payload.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWED_DATA_EXTENSIONS = new Set([".json", ".bin", ".ndjson", ".txt"]);

export const FORBIDDEN_SCAN_DIRECTORIES = new Set([
  "",
  ".",
  "..",
  "node_modules",
  ".next",
  ".git",
  "src",
  "dist",
  "build",
  "public",
]);

/**
 * Validates that targetDir is strictly contained within an allowlisted base directory
 * and does not escape via path traversal (..) or symlinks.
 */
export async function validateAllowlistedDirectory(targetDir, allowedRoot) {
  const resolvedTarget = path.resolve(targetDir);
  const resolvedRoot = path.resolve(allowedRoot);

  // Guard against scanning project root itself or dangerous directories
  const relFromRoot = path.relative(resolvedRoot, resolvedTarget);
  if (relFromRoot.startsWith("..") && relFromRoot !== "") {
    throw new Error(
      `Security Violation: Directory "${resolvedTarget}" is outside the allowed root "${resolvedRoot}".`
    );
  }

  const baseName = path.basename(resolvedTarget);
  if (FORBIDDEN_SCAN_DIRECTORIES.has(baseName.toLowerCase())) {
    throw new Error(
      `Security Violation: Directory "${baseName}" is forbidden from filesystem recovery scans.`
    );
  }

  // Check realpath to detect and prevent symlink escapes
  try {
    const realTarget = await fs.realpath(resolvedTarget);
    const realRoot = await fs.realpath(resolvedRoot);
    const realRel = path.relative(realRoot, realTarget);
    if (realRel.startsWith("..") && realRel !== "") {
      throw new Error(
        `Security Violation: Symlink at "${resolvedTarget}" points to "${realTarget}" outside allowed root.`
      );
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      // Directory doesn't exist yet; safe to report as missing
      return false;
    }
    throw err;
  }

  return true;
}

/**
 * Classifies a local file path into one of the 8 canonical categories.
 */
export function classifyLocalPath(relPath) {
  const lower = relPath.toLowerCase();

  if (
    lower.includes("saved-item") ||
    lower.includes("saved_item") ||
    lower.includes("saveditem") ||
    lower.includes("saved-video") ||
    lower.includes("saved_video") ||
    lower.includes("library")
  ) {
    return "SAVED_ITEMS";
  }

  if (lower.includes("playlist") || lower.includes("user_playlist")) {
    return "SAVED_PLAYLISTS";
  }

  if (
    lower.includes("search-history") ||
    lower.includes("saved-history") ||
    lower.includes("query_history") ||
    lower.includes("history")
  ) {
    return "SAVED_SEARCH_HISTORY";
  }

  if (lower.includes("preset") || lower.includes("search_preset") || lower.includes("search-preset")) {
    return "SEARCH_PRESETS";
  }

  if (
    lower.includes("title") ||
    lower.includes("saved_search") ||
    lower.includes("saved-search")
  ) {
    return "SAVED_TITLES";
  }

  if (lower.includes("research_queue") || lower.includes("research-queue") || lower.includes("queue")) {
    return "RESEARCH_QUEUE";
  }

  if (lower.includes("reference") || lower.includes("saved_ref") || lower.includes("saved-ref")) {
    return "SAVED_REFERENCES";
  }

  return "OTHER";
}

/**
 * Scans allowlisted local directories for historical manifest records.
 *
 * @param {string[]} [customCandidateDirs] - Optional custom directories to scan (must be within allowedRoot).
 * @param {string} [allowedRoot] - Allowed root directory (defaults to `<projectRoot>/data`).
 */
export async function scanLocalFilesystem(customCandidateDirs, allowedRoot) {
  const projectRoot = process.cwd();
  const root = allowedRoot ? path.resolve(allowedRoot) : path.join(projectRoot, "data");

  const candidateDirs = customCandidateDirs && customCandidateDirs.length > 0
    ? customCandidateDirs.map((d) => path.resolve(d))
    : [
        path.join(root, "playlists"),
        path.join(root, "storage"),
        path.join(root, "search-storage"),
      ];

  const result = {
    source: "disk_cache",
    sourceName: "Local Disk Cache & File Archives",
    recoveryCapability: "FULL",
    status: "AVAILABLE",
    scannedRoot: root,
    scannedDirectories: [],
    discoveredCount: 0,
    readableCount: 0,
    unreadableCount: 0,
    excludedCount: 0,
    totalRecoverableBytes: 0,
    items: [],
    exclusions: [],
    categoryBreakdown: {
      SAVED_ITEMS: { fileCount: 0, byteCount: 0 },
      SAVED_TITLES: { fileCount: 0, byteCount: 0 },
      SAVED_PLAYLISTS: { fileCount: 0, byteCount: 0 },
      SAVED_SEARCH_HISTORY: { fileCount: 0, byteCount: 0 },
      RESEARCH_QUEUE: { fileCount: 0, byteCount: 0 },
      SAVED_REFERENCES: { fileCount: 0, byteCount: 0 },
      SEARCH_PRESETS: { fileCount: 0, byteCount: 0 },
      OTHER: { fileCount: 0, byteCount: 0 },
    },
  };

  for (const dir of candidateDirs) {
    try {
      const isValid = await validateAllowlistedDirectory(dir, root);
      if (!isValid) {
        result.scannedDirectories.push({ path: dir, status: "MISSING", fileCount: 0 });
        continue;
      }

      const stats = await fs.stat(dir);
      if (!stats.isDirectory()) {
        result.scannedDirectories.push({ path: dir, status: "NOT_A_DIRECTORY", fileCount: 0 });
        continue;
      }

      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
      let dirFileCount = 0;

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (entry.name.startsWith(".") || !ALLOWED_DATA_EXTENSIONS.has(ext)) {
          continue;
        }

        const parent = entry.parentPath || dir;
        const fullPath = path.join(parent, entry.name);
        const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");

        try {
          const fileStats = await fs.stat(fullPath);
          const buf = await fs.readFile(fullPath);
          const sha256 = crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
          const category = classifyLocalPath(relPath);

          result.discoveredCount++;
          result.readableCount++;
          result.totalRecoverableBytes += fileStats.size;
          dirFileCount++;

          result.categoryBreakdown[category].fileCount++;
          result.categoryBreakdown[category].byteCount += fileStats.size;

          result.items.push({
            id: `disk_${sha256.slice(0, 16)}`,
            source: "disk_cache",
            category,
            originalPathname: relPath,
            originalFilename: entry.name,
            byteLength: fileStats.size,
            sha256,
            sourceCreatedAt: fileStats.birthtime.toISOString(),
            sourceExportedAt: fileStats.mtime.toISOString(),
            isRecoverable: true,
            isExcluded: false,
            localFilePath: fullPath,
          });
        } catch (readErr) {
          result.unreadableCount++;
          result.exclusions.push({
            pathname: relPath,
            reason: `Unreadable file: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
          });
        }
      }

      result.scannedDirectories.push({ path: dir, status: "SCANNED", fileCount: dirFileCount });
    } catch (dirErr) {
      if (customCandidateDirs && customCandidateDirs.length > 0) {
        throw dirErr;
      }
      result.scannedDirectories.push({
        path: dir,
        status: "ERROR",
        error: dirErr instanceof Error ? dirErr.message : String(dirErr),
        fileCount: 0,
      });
    }
  }

  return result;
}

// CLI Execution Entrypoint
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const dirArg = args.find((a) => a.startsWith("--dir="))?.split("=")[1];
  const outArg = args.find((a) => a.startsWith("--out="))?.split("=")[1];

  if (!isJson) {
    console.log("══════════════════════════════════════════════════════════════");
    console.log("   LOCAL FILESYSTEM RECOVERY SCANNER (OFFLINE CLI)             ");
    console.log("══════════════════════════════════════════════════════════════");
  }

  scanLocalFilesystem(dirArg ? [dirArg] : undefined)
    .then(async (res) => {
      const hasSecurityErrors = res.scannedDirectories.some((d) => d.status === "ERROR");
      if (hasSecurityErrors) {
        const firstErr = res.scannedDirectories.find((d) => d.status === "ERROR");
        console.error(`\nValidation Error: ${firstErr?.error || "Directory scan failed"}`);
        process.exit(1);
      }
      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`Scan Root:             ${res.scannedRoot}`);
        console.log(`Discovered Files:      ${res.discoveredCount}`);
        console.log(`Verified Readable:     ${res.readableCount}`);
        console.log(`Unreadable:            ${res.unreadableCount}`);
        console.log(`Total Bytes:           ${res.totalRecoverableBytes.toLocaleString()} bytes`);
        console.log("\nDirectories Scanned:");
        for (const d of res.scannedDirectories) {
          console.log(`  - [${d.status}] ${d.path} (${d.fileCount} files)${d.error ? ` - Error: ${d.error}` : ""}`);
        }
        console.log("\nCategory Breakdown:");
        for (const [cat, data] of Object.entries(res.categoryBreakdown)) {
          if (data.fileCount > 0) {
            console.log(`  - ${cat.padEnd(22)}: ${data.fileCount} files (${data.byteCount.toLocaleString()} bytes)`);
          }
        }
      }

      if (outArg) {
        const outPath = path.resolve(outArg);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, JSON.stringify(res, null, 2), "utf8");
        if (!isJson) console.log(`\nReport written to: ${outPath}`);
      }

      if (!isJson) {
        console.log("══════════════════════════════════════════════════════════════");
      }
    })
    .catch((err) => {
      console.error("\nScan Failed:", err.message);
      process.exit(1);
    });
}
