import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";
import { loadProjectEnv } from "../load-project-env.mjs";

loadProjectEnv({ silent: true });

async function applyMigration(migrationName) {
  const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("Missing DIRECT_URL / DATABASE_URL in environment.");
  }

  const migrationDir = path.join(process.cwd(), "prisma", "migrations", migrationName);
  const sqlPath = path.join(migrationDir, "migration.sql");

  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Migration SQL file not found: ${sqlPath}`);
  }

  const sqlContent = fs.readFileSync(sqlPath, "utf8");
  const checksum = crypto.createHash("sha256").update(sqlContent).digest("hex");

  console.log(`Connecting to database for migration: ${migrationName}...`);
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    // Check if already applied
    const checkRes = await client.query(
      `SELECT id, migration_name, finished_at FROM _prisma_migrations WHERE migration_name = $1;`,
      [migrationName]
    );

    if (checkRes.rows.length > 0 && checkRes.rows[0].finished_at) {
      console.log(`Migration ${migrationName} has already been applied at ${checkRes.rows[0].finished_at}.`);
      return;
    }

    console.log(`Applying migration ${migrationName}...`);
    const startedAt = new Date();
    await client.query("BEGIN;");
    await client.query(sqlContent);

    const finishedAt = new Date();
    const migrationId = crypto.randomUUID();

    await client.query(
      `INSERT INTO _prisma_migrations (
        id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [migrationId, checksum, finishedAt, migrationName, "", null, startedAt, 1]
    );

    await client.query("COMMIT;");
    console.log(`✓ Migration ${migrationName} successfully applied and recorded!`);
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error(`✗ Migration failed: ${err.message}`);
    throw err;
  } finally {
    await client.end();
  }
}

const target = process.argv[2] || "20261103173000_old_and_new_buckets_separation";
applyMigration(target).catch((err) => {
  console.error(err);
  process.exit(1);
});
