import "server-only";

import { NextResponse } from "next/server";
import { ensureBootstrapped } from "./account-store";
import { readSessionId, validateSession } from "./session";
import { getBlobBackend } from "../blob/backend-factory";
import { createServerSupabaseClient } from "../supabase/server";
import { getAuthoritativeAdminProfile } from "./user-profile";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Route Guard — Administrator Security Boundary
 * ──────────────────────────────────────────────────────────────────────────
 * - First checks for an active Supabase Auth administrator session.
 * - Resolves the authenticated user against authoritative user_profiles row.
 * - Enforces role = 'admin', is_suspended = false, is_deleted = false.
 * - Exposes profileId and storageOwnerUuid in AdminContext for owner-scoped data.
 * - Protects against CSRF via same-origin verification on mutation requests.
 * - Server authority remains strictly on the server: browser never bypasses.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface AdminContext {
  username: string;
  authVersion: number;
  userId?: string;
  profileId?: string;
  storageOwnerUuid?: string;
}

export async function requireAdmin(
  request: Request,
): Promise<{ ok: true; admin: AdminContext } | { ok: false; response: NextResponse }> {
  const hasSupabaseConfig = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );

  // 1. Authoritative Supabase Auth verification
  if (hasSupabaseConfig) {
    try {
      const supabase = await createServerSupabaseClient(request);
      if (supabase) {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (!error && user) {
          const profile = await getAuthoritativeAdminProfile(user.id, user.email);

          if (!profile) {
            return {
              ok: false,
              response: NextResponse.json(
                { error: "Forbidden — account lacks administrator privileges or is suspended." },
                { status: 403 },
              ),
            };
          }

          return {
            ok: true,
            admin: {
              username: profile.username,
              authVersion: 1,
              userId: user.id,
              profileId: profile.id,
              storageOwnerUuid: profile.storage_owner_uuid,
            },
          };
        }
      }
    } catch (supabaseErr) {
      console.warn("[requireAdmin] Supabase getUser verification exception:", supabaseErr);
    }

    // When Supabase Auth is configured, access requires a verified Supabase session
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized — valid administrator session required." },
        { status: 401 },
      ),
    };
  }

  // 2. Legacy fallback only when Supabase Auth is completely unconfigured
  let backend;
  try {
    backend = getBlobBackend();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Storage is not configured." },
        { status: 503 },
      ),
    };
  }

  let account;
  try {
    account = await ensureBootstrapped(backend);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication is unavailable";
    const status = message.includes("ADMIN_INITIAL_PASSWORD") ? 503 : 500;
    return { ok: false, response: NextResponse.json({ error: message }, { status }) };
  }

  const cookieHeader = request.headers.get("cookie");
  const sid = readSessionId(cookieHeader);
  const validation = await validateSession(backend, sid, account.authVersion);

  if (!validation.valid) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true, admin: { username: account.username, authVersion: account.authVersion } };
}

/**
 * Same-origin check for mutations. Allows requests with NO Origin/Referer
 * (curl, server-to-server) but rejects cross-origin browser requests.
 */
export function assertSameOrigin(request: Request): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) {
    return null;
  }
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.host.toLowerCase() !== host.toLowerCase()) {
      return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Malformed Origin header" }, { status: 403 });
  }
  return null;
}
