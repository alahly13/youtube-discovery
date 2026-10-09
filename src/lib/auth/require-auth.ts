import "server-only";

import { NextResponse } from "next/server";
import { ensureBootstrapped } from "./account-store";
import { readSessionId, validateSession } from "./session";
import { getBlobBackend } from "../blob/backend-factory";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Route Guard — every protected data route calls requireAdmin() itself.
 * ──────────────────────────────────────────────────────────────────────────
 * Middleware redirects are UX only; THIS is the security boundary. Returns
 * the validated account on success, or a 401/503 JSON response object the
 * route must return. Also enforces same-origin on state-changing requests
 * (CSRF layer alongside SameSite=Lax cookies).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface AdminContext {
  username: string;
  authVersion: number;
}

export async function requireAdmin(
  request: Request,
): Promise<{ ok: true; admin: AdminContext } | { ok: false; response: NextResponse }> {
  let backend;
  try {
    backend = getBlobBackend();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Storage is not configured. Set BLOB_READ_WRITE_TOKEN and BLOB_STORE_ID." },
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
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const matches = (value: string | null) => {
    if (!value) return true;
    try {
      return new URL(value).host === host;
    } catch {
      return false;
    }
  };
  if (!matches(origin) || !matches(referer)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  return null;
}
