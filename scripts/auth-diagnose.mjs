/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Safe Authentication Diagnostics CLI
 * ──────────────────────────────────────────────────────────────────────────
 * Checks and reports authentication infrastructure status using strictly
 * booleans and safe status labels. NEVER prints secrets, keys, or passwords.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { loadProjectEnv } from "./load-project-env.mjs";
loadProjectEnv({ silent: true });

import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

export async function runAuthDiagnostics() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const pubKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secretKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const adminEmail = (process.env.ADMIN_EMAIL || "asdy@youtube.discov.com").trim().toLowerCase();
  const defaultUsername = (process.env.ADMIN_DEFAULT_USERNAME || "asdy").trim();
  const dbUrl = process.env.DATABASE_URL;

  const diagnostics = {
    configuration: {
      supabaseUrlConfigured: Boolean(url),
      supabasePublicKeyConfigured: Boolean(pubKey),
      supabaseAdminKeyConfigured: Boolean(secretKey),
      databaseUrlConfigured: Boolean(dbUrl),
      configuredUsername: defaultUsername,
      configuredAdminEmail: adminEmail,
      usernameMappingValid: Boolean(defaultUsername && adminEmail.includes("@")),
    },
    supabaseAuth: {
      reachable: false,
      accountFound: false,
      authUserIdMatch: false,
      emailConfirmed: false,
      userSuspendedOrBanned: false,
      error: null,
    },
    databaseAuthorization: {
      connected: false,
      profileFound: false,
      isAdministrator: false,
      isSuspended: false,
      isDeleted: false,
      error: null,
    },
    verdict: {
      status: "PENDING",
      reason: "",
    },
  };

  // Check Supabase Auth
  if (url && secretKey) {
    try {
      const supabase = createClient(url, secretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await supabase.auth.admin.listUsers();
      if (error) {
        diagnostics.supabaseAuth.error = error.message;
      } else {
        diagnostics.supabaseAuth.reachable = true;
        const user = data?.users?.find(
          (u) =>
            u.email?.toLowerCase() === adminEmail ||
            (u.user_metadata?.username && String(u.user_metadata.username).toLowerCase() === defaultUsername.toLowerCase())
        );

        if (user) {
          diagnostics.supabaseAuth.accountFound = true;
          diagnostics.supabaseAuth.emailConfirmed = Boolean(user.email_confirmed_at);
          diagnostics.supabaseAuth.userSuspendedOrBanned = Boolean(user.banned_until);

          // Check Database Profile
          if (dbUrl) {
            try {
              const pool = new pg.Pool({ connectionString: dbUrl });
              const adapter = new PrismaPg(pool);
              const prisma = new PrismaClient({ adapter });

              const profile = await prisma.userProfile.findFirst({
                where: {
                  OR: [
                    { auth_user_id: user.id },
                    { username: defaultUsername },
                  ],
                },
              });

              diagnostics.databaseAuthorization.connected = true;
              if (profile) {
                diagnostics.databaseAuthorization.profileFound = true;
                diagnostics.databaseAuthorization.isAdministrator = profile.role === "admin";
                diagnostics.databaseAuthorization.isSuspended = profile.is_suspended;
                diagnostics.databaseAuthorization.isDeleted = profile.is_deleted;
                diagnostics.supabaseAuth.authUserIdMatch = profile.auth_user_id === user.id;
              }

              await prisma.$disconnect();
              await pool.end();
            } catch (dbErr) {
              diagnostics.databaseAuthorization.error = dbErr instanceof Error ? dbErr.message : "Database connection failed";
            }
          }
        }
      }
    } catch (authErr) {
      diagnostics.supabaseAuth.error = authErr instanceof Error ? authErr.message : "Supabase connection failed";
    }
  }

  // Derive verdict
  if (!diagnostics.configuration.supabaseUrlConfigured || !diagnostics.configuration.supabasePublicKeyConfigured) {
    diagnostics.verdict.status = "CONFIG_MISSING";
    diagnostics.verdict.reason = "Supabase project URL or public key is missing.";
  } else if (!diagnostics.supabaseAuth.reachable) {
    diagnostics.verdict.status = "AUTH_UNREACHABLE";
    diagnostics.verdict.reason = diagnostics.supabaseAuth.error || "Cannot reach Supabase Auth.";
  } else if (!diagnostics.supabaseAuth.accountFound) {
    diagnostics.verdict.status = "ACCOUNT_MISSING";
    diagnostics.verdict.reason = `No Supabase Auth user found matching '${adminEmail}'.`;
  } else if (!diagnostics.supabaseAuth.emailConfirmed) {
    diagnostics.verdict.status = "EMAIL_UNCONFIRMED";
    diagnostics.verdict.reason = "Administrator account email is not confirmed.";
  } else if (!diagnostics.databaseAuthorization.isAdministrator) {
    diagnostics.verdict.status = "AUTHORIZATION_FAILED";
    diagnostics.verdict.reason = "User profile role is not 'admin' or profile is missing/suspended.";
  } else {
    diagnostics.verdict.status = "READY";
    diagnostics.verdict.reason = "Authentication infrastructure is healthy and ready for admin sign-in.";
  }

  return diagnostics;
}

if (process.argv[1] && process.argv[1].endsWith("auth-diagnose.mjs")) {
  runAuthDiagnostics().then((res) => {
    console.log("══════════════════════════════════════════════════════════════");
    console.log("   YouTube Discovery — Safe Authentication Diagnostics        ");
    console.log("══════════════════════════════════════════════════════════════\n");
    console.log("Configuration:");
    console.log(`  - Supabase URL:            ${res.configuration.supabaseUrlConfigured ? "Configured" : "MISSING"}`);
    console.log(`  - Public Publishable Key:  ${res.configuration.supabasePublicKeyConfigured ? "Configured" : "MISSING"}`);
    console.log(`  - Server Admin Secret Key: ${res.configuration.supabaseAdminKeyConfigured ? "Configured" : "MISSING"}`);
    console.log(`  - Database Connection:     ${res.configuration.databaseUrlConfigured ? "Configured" : "MISSING"}`);
    console.log(`  - Username Mapping:        "${res.configuration.configuredUsername}" -> "${res.configuration.configuredAdminEmail}" (${res.configuration.usernameMappingValid ? "VALID" : "INVALID"})`);

    console.log("\nSupabase Auth Status:");
    console.log(`  - Service Reachable:       ${res.supabaseAuth.reachable ? "Yes" : "NO"}`);
    console.log(`  - Admin Account Found:     ${res.supabaseAuth.accountFound ? "Yes" : "NO"}`);
    console.log(`  - Email Confirmed:         ${res.supabaseAuth.emailConfirmed ? "Yes" : "NO"}`);
    console.log(`  - Account Suspended/Banned: ${res.supabaseAuth.userSuspendedOrBanned ? "YES (BANNED)" : "No"}`);

    console.log("\nDatabase Authorization:");
    console.log(`  - Database Connected:      ${res.databaseAuthorization.connected ? "Yes" : "NO"}`);
    console.log(`  - Profile Record Found:    ${res.databaseAuthorization.profileFound ? "Yes" : "NO"}`);
    console.log(`  - Admin Role Active:       ${res.databaseAuthorization.isAdministrator ? "Yes" : "NO"}`);
    console.log(`  - Auth UUID Synchronized:  ${res.supabaseAuth.authUserIdMatch ? "Yes" : "NO"}`);

    console.log("\nVerdict:");
    console.log(`  - Status: ${res.verdict.status}`);
    console.log(`  - Details: ${res.verdict.reason}\n`);
  });
}
