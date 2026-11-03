import "server-only";

import { prisma } from "@/lib/db/prisma";

export interface AuthoritativeProfile {
  id: string;
  auth_user_id: string;
  storage_owner_uuid: string;
  storage_namespace: string;
  username: string;
  role: "admin" | "user";
  is_suspended: boolean;
  is_deleted: boolean;
}

/**
 * Ensures and retrieves the authoritative administrator profile in user_profiles.
 * Validates that the account has role = 'admin' and is not suspended or deleted.
 */
export async function getAuthoritativeAdminProfile(
  authUserId: string,
  userEmail?: string | null
): Promise<AuthoritativeProfile | null> {
  const configuredAdminEmail = (process.env.ADMIN_EMAIL || "asdy@youtube.discov.com").trim().toLowerCase();
  const isAdminEmail = Boolean(userEmail && userEmail.trim().toLowerCase() === configuredAdminEmail);

  try {
    let profile = await prisma.userProfile.findFirst({
      where: {
        OR: [
          { auth_user_id: authUserId },
          ...(isAdminEmail ? [{ username: "asdy" }] : []),
        ],
      },
      include: { preferences: true },
    });

    // If profile doesn't exist yet and this user is the configured admin, bootstrap the profile row
    if (!profile && isAdminEmail) {
      profile = await prisma.userProfile.create({
        data: {
          auth_user_id: authUserId,
          username: "asdy",
          storage_namespace: "asdy",
          role: "admin",
          preferences: {
            create: {
              preferred_timezone: "America/Los_Angeles",
              theme: "system",
              default_page_size: 25,
              default_max_pages: 3,
              default_max_items: 150,
              auto_save_enabled: true,
              auto_save_interval_hours: 12,
            },
          },
        },
        include: { preferences: true },
      });
    } else if (profile && !profile.auth_user_id && isAdminEmail) {
      // Connect auth_user_id if previously unlinked
      profile = await prisma.userProfile.update({
        where: { id: profile.id },
        data: { auth_user_id: authUserId },
        include: { preferences: true },
      });
    }

    if (!profile) return null;

    // Validate account status and role
    if (profile.role !== "admin" || profile.is_suspended || profile.is_deleted) {
      return null;
    }

    return {
      id: profile.id,
      auth_user_id: profile.auth_user_id || authUserId,
      storage_owner_uuid: profile.storage_owner_uuid,
      storage_namespace: profile.storage_namespace,
      username: profile.username,
      role: profile.role as "admin" | "user",
      is_suspended: profile.is_suspended,
      is_deleted: profile.is_deleted,
    };
  } catch (err) {
    console.error("[user-profile] Error resolving authoritative admin profile:", err);
    return null;
  }
}
