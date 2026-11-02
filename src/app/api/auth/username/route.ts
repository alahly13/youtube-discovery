import { NextResponse } from "next/server";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { getLoginUsername } from "@/lib/auth/account-store";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/username — PUBLIC. Returns ONLY the current username so the
 * login page can prefill it. Never exposes hashes, secrets, or metadata.
 */
export async function GET() {
  // 1. Explicit admin username environment variable
  const envUsername = process.env.ADMIN_DEFAULT_USERNAME?.trim();
  if (envUsername) {
    return NextResponse.json({ username: envUsername });
  }

  // 2. Discover admin username from Supabase Auth if configured
  try {
    const adminClient = createAdminClient();
    if (adminClient) {
      const { data, error } = await adminClient.auth.admin.listUsers();
      if (!error && data?.users && data.users.length > 0) {
        // Look for user "asdy" or first administrative user
        const asdy = data.users.find((u) => {
          const email = u.email?.toLowerCase();
          const uname = (
            u.user_metadata?.username ||
            u.user_metadata?.name ||
            u.app_metadata?.username
          )?.toString().toLowerCase();
          return email === "asdy" || email?.startsWith("asdy@") || uname === "asdy";
        });

        if (asdy) {
          const display =
            (asdy.user_metadata?.username as string) ||
            (asdy.user_metadata?.name as string) ||
            asdy.email?.split("@")[0] ||
            "asdy";
          return NextResponse.json({ username: display });
        }

        const first = data.users[0];
        const display =
          (first.user_metadata?.username as string) ||
          (first.user_metadata?.name as string) ||
          first.email?.split("@")[0] ||
          "asdy";
        return NextResponse.json({ username: display });
      }
    }
  } catch {
    // Non-fatal, fall through to storage check
  }

  // 3. Persisted storage account check or default fallback
  try {
    const backend = getBlobBackend();
    const username = await getLoginUsername(backend);
    return NextResponse.json({ username });
  } catch {
    return NextResponse.json({ username: "asdy" });
  }
}
