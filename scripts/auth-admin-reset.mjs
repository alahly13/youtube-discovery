/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Local Administrator Password Recovery Utility
 * ──────────────────────────────────────────────────────────────────────────
 * Explicitly invoked local CLI utility to reset the existing administrator
 * account password in Supabase Auth without requiring an email inbox,
 * verification code, OTP, or magic link.
 *
 * Usage:
 *   npm run auth:admin-reset
 *   npm run auth:admin-reset -- --hidden             (silent input)
 *   npm run auth:admin-reset -- --password="Secret123!" (direct non-interactive)
 *
 * Safety Rules:
 *   - Local only: never exposed as an unauthenticated HTTP endpoint.
 *   - Uses Supabase Admin API with server-only Service Role / Secret Key.
 *   - Targets ONLY the existing administrator account identified by ADMIN_EMAIL.
 *   - NEVER creates a new user; NEVER deletes or alters the existing UUID.
 *   - Prompts for the new password VISIBLY by default so you can see what
 *     you write to avoid confusion or typos, with optional --hidden mode.
 *   - Requires password confirmation.
 *   - Confirms the administrator email in Supabase Auth if not already confirmed.
 *   - NEVER prints passwords or secret keys in logs.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import readline from "node:readline";
import { Writable } from "node:stream";
import { loadProjectEnv } from "./load-project-env.mjs";
loadProjectEnv({ silent: true });

import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

/**
 * Prompt for input.
 * Default: visible echoing so the administrator can clearly see what they type in the terminal,
 * avoiding confusion, typos, and repeated mistakes.
 * Hidden mode: optional (--hidden), mutes stdout echoing for silent input.
 */
function promptInput(query, { hidden = false } = {}) {
  if (hidden) {
    return new Promise((resolve) => {
      let muted = false;
      const mutableStdout = new Writable({
        write(chunk, encoding, callback) {
          if (!muted) {
            process.stdout.write(chunk, encoding);
          }
          callback();
        },
      });

      const rl = readline.createInterface({
        input: process.stdin,
        output: mutableStdout,
        terminal: true,
      });

      rl.question(query, (answer) => {
        rl.close();
        process.stdout.write("\n");
        resolve(answer.trim());
      });

      muted = true;
    });
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function validatePasswordStrength(pw) {
  if (!pw || pw.length < 8) {
    return "Password must be at least 8 characters in length.";
  }
  if (!/[A-Za-z]/.test(pw)) {
    return "Password must contain at least one letter.";
  }
  if (!/[0-9]/.test(pw) && !/[^A-Za-z0-9]/.test(pw)) {
    return "Password must contain at least one number or special character.";
  }
  return null;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: npm run auth:admin-reset [options]\n");
    console.log("Options:");
    console.log("  --hidden          Prompt without echoing characters to the terminal");
    console.log("  --password=<val>  Pass the new password directly as a command-line argument");
    console.log("  --help, -h        Display this help message\n");
    process.exit(0);
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log("   YouTube Discovery — Admin Password Recovery Utility        ");
  console.log("══════════════════════════════════════════════════════════════\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const adminEmail = (process.env.ADMIN_EMAIL || "asdy@youtube.discov.com").trim().toLowerCase();
  const defaultUsername = (process.env.ADMIN_DEFAULT_USERNAME || "asdy").trim();

  if (!supabaseUrl) {
    console.error("Error: NEXT_PUBLIC_SUPABASE_URL is not set in environment.");
    process.exit(1);
  }
  if (!secretKey) {
    console.error("Error: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is not set in environment.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  console.log(`Auditing Supabase Auth for administrator account: ${adminEmail}...`);
  const { data: usersData, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error(`Error querying Supabase Auth: ${listErr.message}`);
    process.exit(1);
  }

  const existingAdmin = usersData?.users?.find(
    (u) =>
      u.email?.toLowerCase() === adminEmail ||
      (u.user_metadata?.username && String(u.user_metadata.username).toLowerCase() === defaultUsername.toLowerCase())
  );

  if (!existingAdmin) {
    console.error(`\nError: No existing administrator account found for '${adminEmail}'.`);
    console.error("Safety policy: This utility will NEVER create a duplicate account or change identities.");
    console.error("Please verify that your Supabase project contains the administrator account.");
    process.exit(1);
  }

  console.log("Existing administrator account verified:");
  console.log(`  - User UUID: ${existingAdmin.id}`);
  console.log(`  - Email:     ${existingAdmin.email}`);
  console.log(`  - Confirmed: ${existingAdmin.email_confirmed_at ? "Yes" : "No (will be confirmed now)"}\n`);

  // Parse options for password input mode
  const isHidden = process.argv.includes("--hidden") || process.argv.includes("--silent");
  const cliPassword = (() => {
    const directArg = process.argv.find((a) => a.startsWith("--password="));
    if (directArg) return directArg.slice("--password=".length).trim();
    const idx = process.argv.indexOf("--password");
    if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("-")) {
      return process.argv[idx + 1].trim();
    }
    return null;
  })();

  let newPassword = "";

  if (cliPassword) {
    const validationError = validatePasswordStrength(cliPassword);
    if (validationError) {
      console.error(`[Validation Error] Password passed via --password failed validation:\n  ${validationError}`);
      process.exit(1);
    }
    newPassword = cliPassword;
    console.log("Using administrator password provided via command-line argument.\n");
  } else {
    if (!isHidden) {
      console.log("Note: Password characters are visible on screen as you type to prevent confusion.");
      console.log("      (Use 'npm run auth:admin-reset -- --hidden' if you prefer silent hidden input)\n");
    }

    while (true) {
      newPassword = await promptInput("Enter new administrator password: ", { hidden: isHidden });
      const validationError = validatePasswordStrength(newPassword);
      if (validationError) {
        console.log(`  [Validation Error] ${validationError} Please try again.\n`);
        continue;
      }

      const confirmPassword = await promptInput("Confirm new administrator password: ", { hidden: isHidden });
      if (newPassword !== confirmPassword) {
        console.log("  [Mismatch Error] Passwords do not match. Please try again.\n");
        continue;
      }

      break;
    }
  }

  console.log("\nUpdating administrator credentials in Supabase Auth...");

  // Update password and ensure email confirmation in Supabase Auth
  const { data: updateData, error: updateErr } = await supabase.auth.admin.updateUserById(
    existingAdmin.id,
    {
      password: newPassword,
      email_confirm: true,
      user_metadata: {
        ...(existingAdmin.user_metadata || {}),
        username: defaultUsername,
        name: defaultUsername,
        email_verified: true,
      },
    }
  );

  if (updateErr) {
    console.error(`Failed to update password in Supabase Auth: ${updateErr.message}`);
    process.exit(1);
  }

  console.log("Supabase Auth password successfully updated.");
  console.log(`  - Verified Auth UUID: ${updateData.user.id}`);
  console.log(`  - Email confirmation: Confirmed`);

  // Verify and reconcile user_profiles in PostgreSQL
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const pool = new pg.Pool({ connectionString: dbUrl });
      const adapter = new PrismaPg(pool);
      const prisma = new PrismaClient({ adapter });

      let profile = await prisma.userProfile.findFirst({
        where: {
          OR: [
            { auth_user_id: existingAdmin.id },
            { username: defaultUsername },
          ],
        },
      });

      if (!profile) {
        console.log("Bootstrapping matching user_profiles row in PostgreSQL...");
        await prisma.userProfile.create({
          data: {
            auth_user_id: existingAdmin.id,
            username: defaultUsername,
            storage_namespace: defaultUsername,
            role: "admin",
            is_suspended: false,
            is_deleted: false,
          },
        });
      } else if (profile.auth_user_id !== existingAdmin.id || profile.role !== "admin") {
        await prisma.userProfile.update({
          where: { id: profile.id },
          data: {
            auth_user_id: existingAdmin.id,
            role: "admin",
            is_suspended: false,
            is_deleted: false,
          },
        });
      }

      await prisma.$disconnect();
      await pool.end();
      console.log("Database user_profiles record verified and active with role 'admin'.");
    } catch (dbErr) {
      console.warn("Non-fatal database verification note:", dbErr.message);
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("   RECOVERY COMPLETE!                                         ");
  console.log("   You can now sign in at /login with:                        ");
  console.log(`     Username: ${defaultUsername}                             `);
  console.log("     Password: [your newly set password]                      ");
  console.log("══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Unexpected error during recovery:", err.message);
  process.exit(1);
});
