/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Visual Terminal Renderer — Professional Unicode & Color Formatter
 * ──────────────────────────────────────────────────────────────────────────
 * - Renders a visually polished dashboard with unicode box drawing.
 * - Color-coded indicators matching the specification:
 *     Green: Applied / Connected
 *     Yellow: Pending / Warnings
 *     Red: Failed / Divergent
 *     Blue/Cyan: Information / Section Headers
 *     Gray: Muted / Not Available
 * - Formats responsive tables for PowerShell, CMD, macOS, and Linux.
 * - Respects NO_COLOR environment variable.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const isNoColor = Boolean(process.env.NO_COLOR) || process.env.TERM === "dumb";

export const colors = {
  reset: isNoColor ? "" : "\x1b[0m",
  bold: isNoColor ? "" : "\x1b[1m",
  dim: isNoColor ? "" : "\x1b[2m",
  italic: isNoColor ? "" : "\x1b[3m",
  underline: isNoColor ? "" : "\x1b[4m",

  // Foreground
  black: isNoColor ? "" : "\x1b[30m",
  red: isNoColor ? "" : "\x1b[31m",
  green: isNoColor ? "" : "\x1b[32m",
  yellow: isNoColor ? "" : "\x1b[33m",
  blue: isNoColor ? "" : "\x1b[34m",
  magenta: isNoColor ? "" : "\x1b[35m",
  cyan: isNoColor ? "" : "\x1b[36m",
  white: isNoColor ? "" : "\x1b[37m",
  gray: isNoColor ? "" : "\x1b[90m",

  // High Intensity
  brightRed: isNoColor ? "" : "\x1b[91m",
  brightGreen: isNoColor ? "" : "\x1b[92m",
  brightYellow: isNoColor ? "" : "\x1b[93m",
  brightBlue: isNoColor ? "" : "\x1b[94m",
  brightCyan: isNoColor ? "" : "\x1b[96m",
};

/**
 * Truncates string with ellipsis if exceeds maxWidth.
 */
function truncate(str, maxWidth) {
  if (!str) return "";
  if (str.length <= maxWidth) return str;
  return str.slice(0, maxWidth - 3) + "...";
}

/**
 * Formats a single status badge with icon and color.
 */
export function formatStatusBadge(status) {
  switch (status) {
    case "APPLIED":
      return `${colors.brightGreen}✓ Applied${colors.reset}`;
    case "PENDING":
      return `${colors.brightYellow}○ Pending${colors.reset}`;
    case "FAILED":
      return `${colors.brightRed}✗ Failed${colors.reset}`;
    case "ROLLED_BACK":
      return `${colors.yellow}↶ Rolled Back${colors.reset}`;
    case "CHECKSUM_MISMATCH":
      return `${colors.brightRed}≠ Mismatch${colors.reset}`;
    case "MISSING_LOCAL":
      return `${colors.brightRed}? Missing Local${colors.reset}`;
    case "NOT_CHECKED":
      return `${colors.gray}○ Local Only${colors.reset}`;
    case "UNAVAILABLE":
      return `${colors.brightYellow}? Unknown${colors.reset}`;
    default:
      return `${colors.gray}- Unknown${colors.reset}`;
  }
}

/**
 * Renders the terminal dashboard for migration status.
 *
 * @param {object} report - Reconciled migration report from reconcile.mjs
 * @param {object} [options]
 * @param {boolean} [options.verbose=false] - Display full checksums and error logs
 * @returns {string} Fully formatted terminal string
 */
export function renderDashboard(report, options = {}) {
  const verbose = options.verbose || false;
  const lines = [];

  const pad = (str, len) => str + " ".repeat(Math.max(0, len - str.length));

  // 1. Header Box
  lines.push(`${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
  lines.push(`${colors.cyan}║${colors.bold}${colors.white}               YOUTUBE DISCOVERY · DATABASE CLI               ${colors.reset}${colors.cyan}║${colors.reset}`);
  lines.push(`${colors.cyan}║${colors.bold}${colors.brightCyan}                  PRISMA 7 MIGRATION STATUS                   ${colors.reset}${colors.cyan}║${colors.reset}`);
  lines.push(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);
  lines.push("");

  // 2. Database Section
  lines.push(`${colors.bold}${colors.brightCyan}DATABASE${colors.reset}`);
  lines.push(`  ${pad("Provider", 18)} ${colors.white}${report.database.provider}${colors.reset}`);
  lines.push(`  ${pad("Host", 18)} ${colors.gray}${report.database.host}${colors.reset}`);
  lines.push(`  ${pad("Database", 18)} ${colors.gray}${report.database.database}${colors.reset}`);

  let connText = `${colors.gray}● Not Checked (Local Mode)${colors.reset}`;
  if (report.database.connected) {
    connText = `${colors.brightGreen}● Connected${colors.reset}`;
  } else if (report.database.status === "CONFIG_MISSING") {
    connText = `${colors.yellow}● Missing Connection URL${colors.reset}`;
  } else if (report.database.status === "UNREACHABLE") {
    connText = `${colors.brightRed}● Unreachable / Timeout${colors.reset}`;
  }
  lines.push(`  ${pad("Connection", 18)} ${connText}`);

  if (report.database.connected) {
    const tableText = report.database.tableExists
      ? `${colors.brightGreen}Initialized${colors.reset}`
      : `${colors.yellow}Not Initialized (No _prisma_migrations)${colors.reset}`;
    lines.push(`  ${pad("Migration Table", 18)} ${tableText}`);
  }

  if (report.database.error) {
    lines.push(`  ${pad("Error", 18)} ${colors.brightRed}${report.database.error}${colors.reset}`);
  }
  lines.push("");

  // 3. Migration Summary Section
  lines.push(`${colors.bold}${colors.brightCyan}MIGRATION SUMMARY${colors.reset}`);

  // When the database is unreachable, remote migration counts are unknown —
  // never display misleading zeros that imply a successful empty audit.
  const dbUnreachable = !report.database.connected && report.database.status !== undefined && report.database.status !== "NOT_CHECKED";
  const unknownLabel = `${colors.brightYellow}Unknown${colors.reset}`;

  const totalCount = Math.max(
    report.summary.totalLocal,
    report.summary.applied + report.summary.pending + report.summary.failed
  );
  lines.push(`  ${pad("Total Known", 18)} ${colors.white}${totalCount}${colors.reset}`);
  lines.push(`  ${pad("Local Files", 18)} ${colors.white}${report.summary.totalLocal}${colors.reset}`);
  lines.push(`  ${pad("Applied", 18)} ${dbUnreachable ? unknownLabel : (report.summary.applied > 0 ? colors.brightGreen : colors.gray) + report.summary.applied + colors.reset}`);
  lines.push(`  ${pad("Pending", 18)} ${dbUnreachable ? unknownLabel : (report.summary.pending > 0 ? colors.brightYellow : colors.gray) + report.summary.pending + colors.reset}`);
  lines.push(`  ${pad("Failed", 18)} ${dbUnreachable ? unknownLabel : (report.summary.failed > 0 ? colors.brightRed : colors.gray) + report.summary.failed + colors.reset}`);
  lines.push(`  ${pad("Divergent", 18)} ${dbUnreachable ? unknownLabel : (report.summary.divergent > 0 ? colors.brightRed : colors.gray) + report.summary.divergent + colors.reset}`);
  if (report.summary.missingLocally > 0) {
    lines.push(`  ${pad("Missing Locally", 18)} ${colors.brightRed}${report.summary.missingLocally}${colors.reset}`);
  }
  if (report.summary.checksumMismatches > 0) {
    lines.push(`  ${pad("Checksum Mismatch", 18)} ${colors.brightRed}${report.summary.checksumMismatches}${colors.reset}`);
  }
  lines.push("");

  // 4. Migration History List / Table
  lines.push(`${colors.bold}${colors.brightCyan}MIGRATION HISTORY${colors.reset}`);
  if (report.migrations.length === 0) {
    lines.push(`  ${colors.gray}(No migrations found in prisma/migrations or database history)${colors.reset}`);
  } else {
    // Table Header
    const colName = 34;
    const colLoc = 7;
    const colDb = 15;
    const colTime = 22;
    const colDur = 9;

    lines.push(
      `  ${colors.dim}┌─${"─".repeat(colName)}─┬─${"─".repeat(colLoc)}─┬─${"─".repeat(colDb)}─┬─${"─".repeat(colTime)}─┬─${"─".repeat(colDur)}─┐${colors.reset}`
    );
    lines.push(
      `  ${colors.dim}│${colors.reset} ${colors.bold}${pad("Migration", colName)}${colors.reset} ${colors.dim}│${colors.reset} ${colors.bold}${pad("Local", colLoc)}${colors.reset} ${colors.dim}│${colors.reset} ${colors.bold}${pad("Database", colDb)}${colors.reset} ${colors.dim}│${colors.reset} ${colors.bold}${pad("Applied At (UTC)", colTime)}${colors.reset} ${colors.dim}│${colors.reset} ${colors.bold}${pad("Duration", colDur)}${colors.reset} ${colors.dim}│${colors.reset}`
    );
    lines.push(
      `  ${colors.dim}├─${"─".repeat(colName)}─┼─${"─".repeat(colLoc)}─┼─${"─".repeat(colDb)}─┼─${"─".repeat(colTime)}─┼─${"─".repeat(colDur)}─┤${colors.reset}`
    );

    for (const m of report.migrations) {
      const icon =
        m.dbStatus === "APPLIED"
          ? `${colors.brightGreen}✓${colors.reset}`
          : m.dbStatus === "PENDING"
          ? `${colors.brightYellow}○${colors.reset}`
          : m.dbStatus === "FAILED"
          ? `${colors.brightRed}✗${colors.reset}`
          : m.dbStatus === "CHECKSUM_MISMATCH"
          ? `${colors.brightRed}≠${colors.reset}`
          : m.dbStatus === "MISSING_LOCAL"
          ? `${colors.brightRed}?${colors.reset}`
          : `${colors.gray}-${colors.reset}`;

      const nameDisplay = truncate(m.migrationName, colName - 2);
      const localText = m.localExists ? `${colors.green}Yes${colors.reset}` : `${colors.red}No${colors.reset}`;
      const statusBadge = formatStatusBadge(m.dbStatus);
      const timeDisplay = m.appliedAt ? truncate(m.appliedAt, colTime) : `${colors.gray}Pending${colors.reset}`;
      const durationDisplay = m.duration || `${colors.gray}-${colors.reset}`;

      // Clean padding accounting for ANSI codes
      const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, "");
      const padAnsi = (str, len) => str + " ".repeat(Math.max(0, len - stripAnsi(str).length));

      lines.push(
        `  ${colors.dim}│${colors.reset} ${icon} ${pad(nameDisplay, colName - 2)} ${colors.dim}│${colors.reset} ${padAnsi(localText, colLoc)} ${colors.dim}│${colors.reset} ${padAnsi(statusBadge, colDb)} ${colors.dim}│${colors.reset} ${padAnsi(timeDisplay, colTime)} ${colors.dim}│${colors.reset} ${padAnsi(durationDisplay, colDur)} ${colors.dim}│${colors.reset}`
      );

      // Verbose Checksum & Diagnostics details
      if (verbose) {
        const localCheck = m.checksum?.local ? m.checksum.local.slice(0, 16) + "..." : "none";
        const dbCheck = m.checksum?.db ? m.checksum.db.slice(0, 16) + "..." : "none";
        const checkMatchText =
          m.checksum?.matches === true
            ? `${colors.green}MATCH${colors.reset}`
            : m.checksum?.matches === false
            ? `${colors.brightRed}MISMATCH${colors.reset}`
            : `${colors.gray}N/A${colors.reset}`;

        lines.push(
          `  ${colors.dim}│   └─ Checksum: [Local: ${localCheck} | DB: ${dbCheck}] (${checkMatchText})${" ".repeat(Math.max(0, 23))}${colors.reset}${colors.dim}│${colors.reset}`
        );

        if (m.logs) {
          lines.push(
            `  ${colors.dim}│   ${colors.brightRed}└─ Error Log: ${truncate(m.logs.replace(/\n/g, " "), 70)}${colors.reset}${colors.dim}│${colors.reset}`
          );
        }
      }
    }

    lines.push(
      `  ${colors.dim}└─${"─".repeat(colName)}─┴─${"─".repeat(colLoc)}─┴─${"─".repeat(colDb)}─┴─${"─".repeat(colTime)}─┴─${"─".repeat(colDur)}─┘${colors.reset}`
    );
  }
  lines.push("");

  // 5. Latest Successful Migration
  lines.push(`${colors.bold}${colors.brightCyan}LATEST SUCCESSFUL MIGRATION${colors.reset}`);
  if (report.summary.latestSuccessful) {
    lines.push(`  ${colors.brightGreen}✓ ${report.summary.latestSuccessful}${colors.reset}`);
    lines.push(`    ${colors.gray}Applied at: ${report.summary.lastAppliedAt}${colors.reset}`);
  } else {
    lines.push(`  ${colors.gray}(None recorded yet)${colors.reset}`);
  }
  lines.push("");

  // 6. Overall Status Box
  lines.push(`${colors.bold}${colors.brightCyan}OVERALL STATUS${colors.reset}`);
  let statusBanner = "";
  if (report.overallStatus === "SYNCHRONIZED") {
    statusBanner = `${colors.bold}${colors.brightGreen}✓ SYNCHRONIZED${colors.reset} — ${report.statusMessage}`;
  } else if (report.overallStatus === "LOCAL_INSPECTED") {
    statusBanner = `${colors.bold}${colors.cyan}○ LOCAL INSPECTION COMPLETED${colors.reset} — ${report.statusMessage}`;
  } else if (report.overallStatus === "MIGRATIONS_PENDING") {
    statusBanner = `${colors.bold}${colors.brightYellow}⚠ ${report.summary.pending} PENDING MIGRATION(S)${colors.reset} — Ready to apply when authorized`;
  } else if (report.overallStatus === "MIGRATIONS_FAILED") {
    statusBanner = `${colors.bold}${colors.brightRed}✗ ${report.summary.failed} FAILED MIGRATION(S)${colors.reset} — Investigation required`;
  } else if (report.overallStatus === "DIVERGENT") {
    statusBanner = `${colors.bold}${colors.brightRed}≠ MIGRATION DIVERGENCE DETECTED${colors.reset} — Checksums or file history mismatch`;
  } else if (report.overallStatus === "TABLE_NOT_INITIALIZED") {
    statusBanner = `${colors.bold}${colors.brightYellow}⚠ DATABASE MIGRATIONS NOT INITIALIZED${colors.reset} — Table _prisma_migrations does not exist`;
  } else if (report.overallStatus === "CONFIG_MISSING" || report.overallStatus === "DATABASE_UNAVAILABLE") {
    statusBanner = `${colors.bold}${colors.brightRed}● DATABASE CONNECTION UNAVAILABLE${colors.reset} — ${report.statusMessage}`;
  } else if (report.overallStatus === "EMPTY_HISTORY") {
    statusBanner = `${colors.bold}${colors.gray}○ EMPTY MIGRATION HISTORY${colors.reset} — No migrations exist locally or in DB`;
  } else {
    statusBanner = `${colors.bold}${colors.white}${report.overallStatus}${colors.reset} — ${report.statusMessage}`;
  }

  lines.push(`  ${statusBanner}`);
  lines.push("");
  lines.push(`  ${colors.dim}No migrations were applied or modified by this command. (Read-only monitoring)${colors.reset}`);
  lines.push("");

  return lines.join("\n");
}
