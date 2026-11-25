import "server-only";

import { prisma } from "@/lib/db/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Canonical Admin Profile Resolver (Server-Only)
 * ──────────────────────────────────────────────────────────────────────────
 * Resolves the active administrator profile from Supabase PostgreSQL when a
 * server service (API keys, quota pools, search archive) is invoked inside an
 * authenticated admin workflow that did not pass an explicit `ownerId`.
 * Never synthesizes fake profiles; returns null if no active admin exists.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface CanonicalAdminProfile {
  profileId: string;
  storageOwnerUuid: string;
  username: string;
}

export async function resolveCanonicalAdminProfile(
  preferredOwnerId?: string | null
): Promise<CanonicalAdminProfile | null> {
  try {
    if (preferredOwnerId && preferredOwnerId.trim().length > 0) {
      const clean = preferredOwnerId.trim();
      const matched = await prisma.userProfile.findFirst({
        where: {
          OR: [{ id: clean }, { storage_owner_uuid: clean }, { auth_user_id: clean }],
          is_deleted: false,
          is_suspended: false,
        },
        select: {
          id: true,
          storage_owner_uuid: true,
          username: true,
        },
      });
      if (matched) {
        return {
          profileId: matched.id,
          storageOwnerUuid: matched.storage_owner_uuid,
          username: matched.username || "asdy",
        };
      }
    }

    const adminProfile = await prisma.userProfile.findFirst({
      where: {
        role: "admin",
        is_deleted: false,
        is_suspended: false,
      },
      orderBy: { created_at: "asc" },
      select: {
        id: true,
        storage_owner_uuid: true,
        username: true,
      },
    });

    if (!adminProfile) return null;
    return {
      profileId: adminProfile.id,
      storageOwnerUuid: adminProfile.storage_owner_uuid,
      username: adminProfile.username || "asdy",
    };
  } catch {
    return null;
  }
}
