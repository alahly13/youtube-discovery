import { NextResponse } from "next/server";
import { z } from "zod";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { verifyCredentials } from "@/lib/auth/account-store";
import { clearLoginAttempts, checkLoginRateLimit, clientIpFromHeaders, hashIp, recordLoginAttempt } from "@/lib/auth/rate-limit";
import { buildSessionCookie, createSession, getSessionTtlSeconds } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

/**
 * POST /api/auth/login — generic errors (no user enumeration), Blob-backed
 * rate limiting, fixed-duration HttpOnly session cookie on success.
 */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  let backend;
  try {
    backend = getBlobBackend();
  } catch {
    return NextResponse.json({ error: "Storage is not configured" }, { status: 503 });
  }
  const ipHash = hashIp(clientIpFromHeaders(request.headers));
  const limit = await checkLoginRateLimit(backend, ipHash);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please wait and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    await recordLoginAttempt(backend, ipHash);
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }
  let account;
  try {
    account = await verifyCredentials(backend, parsed.data.username, parsed.data.password);
  } catch (err) {
    // Bootstrap misconfiguration (missing initial password) surfaces here.
    const message = err instanceof Error ? err.message : "Authentication is unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
  await recordLoginAttempt(backend, ipHash);
  if (!account) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }
  // Successful login resets the attempt counter for this IP.
  await clearLoginAttempts(backend, ipHash);
  const { sid } = await createSession(backend, account.authVersion);
  const ttl = getSessionTtlSeconds();
  const response = NextResponse.json({ success: true, username: account.username });
  response.headers.set("Set-Cookie", buildSessionCookie(sid, ttl));
  return response;
}
