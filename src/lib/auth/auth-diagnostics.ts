import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/db/prisma";

export interface SafeAuthDiagnostics {
  configuration: {
    supabaseUrlConfigured: boolean;
    supabasePublicKeyConfigured: boolean;
    supabaseAdminKeyConfigured: boolean;
    databaseUrlConfigured: boolean;
    configuredUsername: string;
    configuredAdminEmail: string;
    usernameMappingValid: boolean;
  };
  supabaseAuth: {
    reachable: boolean;
    accountFound: boolean;
    authUserIdMatch: boolean;
    emailConfirmed: boolean;
    userSuspendedOrBanned: boolean;
    error: string | null;
  };
  databaseAuthorization: {
    connected: boolean;
    profileFound: boolean;
    isAdministrator: boolean;
    isSuspended: boolean;
    isDeleted: boolean;
    error: string | null;
  };
  verdict: {
    status: "READY" | "CONFIG_MISSING" | "AUTH_UNREACHABLE" | "ACCOUNT_MISSING" | "EMAIL_UNCONFIRMED" | "AUTHORIZATION_FAILED";
    reason: string;
  };
}

export async function getSafeAuthDiagnostics(): Promise<SafeAuthDiagnostics> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const pubKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secretKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const adminEmail = (process.env.ADMIN_EMAIL || "asdy@youtube.discov.com").trim().toLowerCase();
  const defaultUsername = (process.env.ADMIN_DEFAULT_USERNAME || "asdy").trim();
  const dbUrl = process.env.DATABASE_URL;

  const diagnostics: SafeAuthDiagnostics = {
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
      status: "READY",
      reason: "",
    },
  };

  const adminClient = createAdminClient();
  if (adminClient) {
    try {
      const { data, error } = await adminClient.auth.admin.listUsers();
      if (error) {
        diagnostics.supabaseAuth.error = error.message;
      } else {
        diagnostics.supabaseAuth.reachable = true;
        const user = data?.users?.find(
          (u) =>
            u.email?.toLowerCase() === adminEmail ||
            (u.user_metadata?.username &&
              String(u.user_metadata.username).toLowerCase() === defaultUsername.toLowerCase())
        );

        if (user) {
          diagnostics.supabaseAuth.accountFound = true;
          diagnostics.supabaseAuth.emailConfirmed = Boolean(user.email_confirmed_at);
          diagnostics.supabaseAuth.userSuspendedOrBanned = Boolean(user.banned_until);

          try {
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
          } catch (dbErr) {
            diagnostics.databaseAuthorization.error =
              dbErr instanceof Error ? dbErr.message : "Database check failed";
          }
        }
      }
    } catch (authErr) {
      diagnostics.supabaseAuth.error =
        authErr instanceof Error ? authErr.message : "Supabase connection error";
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
