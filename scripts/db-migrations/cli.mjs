#!/usr/bin/env node

import { inspectLocalMigrations } from "./local.mjs";
import { inspectDatabaseMigrations } from "./core.mjs";
import { reconcileMigrations } from "./reconcile.mjs";
import { renderDashboard, colors } from "./renderer.mjs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Professional Prisma 7 Migration Management CLI
 * ──────────────────────────────────────────────────────────────────────────
 * - Inspects and monitors Prisma 7 database migrations without modifying data.
 * - Modes:
 *     --mode=full   : Full visual migration dashboard (default)
 *     --mode=local  : Inspect local migration files without database access
 *     --mode=check  : Synchronization validator for CI and preflight checks
 *     --mode=json   : Machine-readable JSON export
 * - Flags:
 *     --verbose, -v : Detailed checksum comparison and failure logs
 *     --help, -h    : Display command-line usage instructions
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    mode: "full", // "full" | "local" | "check" | "json"
    verbose: false,
    migrationsDir: null,
    connectionUrl: null,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.split("=")[1].toLowerCase();
    } else if (arg === "--local") {
      options.mode = "local";
    } else if (arg === "--check") {
      options.mode = "check";
    } else if (arg === "--json") {
      options.mode = "json";
    } else if (arg.startsWith("--migrations-dir=")) {
      options.migrationsDir = arg.split("=")[1];
    } else if (arg.startsWith("--connection-url=")) {
      options.connectionUrl = arg.split("=")[1];
    }
  }

  return options;
}

export function printHelp() {
  console.log(`
${colors.bold}${colors.cyan}YouTube Discovery — Prisma 7 Migration Management CLI${colors.reset}

${colors.bold}USAGE:${colors.reset}
  npm run db:migrations [OPTIONS]
  node scripts/db-migrations/cli.mjs [OPTIONS]

${colors.bold}MODES:${colors.reset}
  ${colors.brightGreen}npm run db:migrations${colors.reset}        Full terminal migration status dashboard
  ${colors.brightGreen}npm run db:migrations:local${colors.reset}  Inspect local migration files without database access
  ${colors.brightGreen}npm run db:migrations:check${colors.reset}  Validate synchronization between local and database history
  ${colors.brightGreen}npm run db:migrations:json${colors.reset}   Export machine-readable migration status as JSON

${colors.bold}OPTIONS:${colors.reset}
  --mode=<full|local|check|json>  Execution mode (default: full)
  --verbose, -v                   Display checksum verification details and failure logs
  --migrations-dir=<path>         Custom path to migrations directory
  --connection-url=<url>          Custom database connection string (server-only)
  --help, -h                      Show this help message

${colors.bold}EXIT CODES:${colors.reset}
  0  All known migrations are synchronized / local files valid
  1  Pending, failed, divergent, or missing migrations exist
  2  Database unavailable, timeout, or configuration missing
  3  CLI or inspection error
`);
}

/**
 * Main CLI execution function.
 * @param {Array<string>} [argv]
 * @returns {Promise<number>} Exit code
 */
export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    return 0;
  }

  try {
    // 1. Inspect local migration files
    const localMigrations = inspectLocalMigrations(options.migrationsDir);

    // 2. Inspect database if not in local-only mode
    const isLocalMode = options.mode === "local";
    let dbReport = { connected: false, migrations: [], tableExists: false };

    if (!isLocalMode) {
      dbReport = await inspectDatabaseMigrations({
        connectionUrl: options.connectionUrl,
      });
    }

    // 3. Reconcile local and database migration records
    const report = reconcileMigrations(localMigrations, dbReport, {
      localOnly: isLocalMode,
    });

    // 4. Output according to selected mode
    if (options.mode === "json") {
      console.log(JSON.stringify(report, null, 2));
      return report.exitCode;
    }

    if (options.mode === "check") {
      const output = renderDashboard(report, { verbose: options.verbose });
      console.log(output);
      return report.exitCode;
    }

    // Default "full" or "local" mode
    const output = renderDashboard(report, { verbose: options.verbose });
    console.log(output);
    return report.exitCode;
  } catch (err) {
    console.error(
      `${colors.brightRed}[ERROR] Fatal migration CLI failure:${colors.reset}`,
      err instanceof Error ? err.message : String(err)
    );
    return 3;
  }
}

// Execute when invoked directly from command line
if (process.argv[1] && process.argv[1].endsWith("cli.mjs")) {
  runCli().then((exitCode) => {
    process.exit(exitCode);
  });
}
