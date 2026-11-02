import "server-only";

import { NextResponse } from "next/server";
import { ensureBootstrapped } from "./account-store";
import { readSessionId, validateSession } from "./session";
import { getBlobBackend } from "../blob/backend-factory";
import { createServerSupabaseClient } from "../supabase/server";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Route Guard — Administrator Security Boundary
 * ──────────────────────────────────────────────────────────────────────────
 * - First checks for an active Supabase Auth administrator session.
 * - If Supabase Auth is not configured or no session is found, checks the
 *   server session cookie.
 * - Protects against CSRF via same-origin verification on mutation requests.
 * - Server authority remains strictly on the server: browser never bypasses.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface AdminContext {
  username: string;
  authVersion: number;
  userId?: string;
}

export async function requireAdmin(
  request: Request,
): Promise<{ ok: true; admin: AdminContext } | { ok: false; response: NextResponse }> {
  // 1. Try Supabase Auth first
  try {
    const supabase = await createServerSupabaseClient();
    if (supabase) {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (!error && user) {
        return {
          ok: true,
          admin: {
            username: user.email || user.user_metadata?.username || "admin",
            authVersion: 1,
            userId: user.id,
          },
        };
      }
    }
  } catch {
    // Supabase Auth not active, fall through to session store check
  }

  // 2. Standard session check
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
