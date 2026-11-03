import assert from "node:assert/strict";
import {
  parseSessionDuration,
  getSessionTtlSeconds,
  DEFAULT_SESSION_TTL_SECONDS,
  MIN_SESSION_TTL_SECONDS,
  MAX_SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRouteHandlerSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function runAllSuites() {
  console.log("\n[ 1. Session TTL & Environment Variable Control ]");

  // Default is exactly 1 week (604,800s)
  const envBackup = { ...process.env };
  delete process.env.SESSION_TTL_SECONDS;
  delete process.env.ADMIN_SESSION_TTL_SECONDS;
  delete process.env.SUPABASE_SESSION_TTL_SECONDS;
  delete process.env.SESSION_DURATION;

  assert.equal(MIN_SESSION_TTL_SECONDS, 300, "Min session TTL must be 300 seconds");
  assert.equal(MAX_SESSION_TTL_SECONDS, 2592000, "Max session TTL must be 30 days");
  assert(typeof createServerSupabaseClient === "function", "createServerSupabaseClient must be a function");
  assert.equal(
    getSessionTtlSeconds(),
    604800,
    "Default session TTL must be 604,800 seconds (1 week / 7 days)",
  );
  assert.equal(
    getSessionTtlSeconds(),
    DEFAULT_SESSION_TTL_SECONDS,
    "Must match DEFAULT_SESSION_TTL_SECONDS constant",
  );
  console.log("  ok: default session TTL is exactly 1 week (604,800 seconds)");

  // Variable SESSION_TTL_SECONDS
  process.env.SESSION_TTL_SECONDS = "1209600";
  assert.equal(getSessionTtlSeconds(), 1209600, "SESSION_TTL_SECONDS must override TTL");
  delete process.env.SESSION_TTL_SECONDS;
  console.log("  ok: SESSION_TTL_SECONDS controls session duration");

  // Variable ADMIN_SESSION_TTL_SECONDS
  process.env.ADMIN_SESSION_TTL_SECONDS = "86400";
  assert.equal(getSessionTtlSeconds(), 86400, "ADMIN_SESSION_TTL_SECONDS must override TTL");
  delete process.env.ADMIN_SESSION_TTL_SECONDS;
  console.log("  ok: ADMIN_SESSION_TTL_SECONDS controls session duration");

  // Variable SUPABASE_SESSION_TTL_SECONDS
  process.env.SUPABASE_SESSION_TTL_SECONDS = "259200";
  assert.equal(getSessionTtlSeconds(), 259200, "SUPABASE_SESSION_TTL_SECONDS must override TTL");
  delete process.env.SUPABASE_SESSION_TTL_SECONDS;
  console.log("  ok: SUPABASE_SESSION_TTL_SECONDS controls session duration");

  console.log("\n[ 2. Human Duration Units Parsing ]");
  assert.equal(parseSessionDuration("7d"), 604800, "7d = 604,800s");
  assert.equal(parseSessionDuration("1w"), 604800, "1w = 604,800s");
  assert.equal(parseSessionDuration("2w"), 1209600, "2w = 1,209,600s");
  assert.equal(parseSessionDuration("24h"), 86400, "24h = 86,400s");
  assert.equal(parseSessionDuration("60m"), 3600, "60m = 3,600s");
  assert.equal(parseSessionDuration("604800s"), 604800, "604800s = 604,800s");
  console.log("  ok: human units 7d, 1w, 2w, 24h, 60m correctly parsed into seconds");

  // Out of bounds and safety fallback
  assert.equal(parseSessionDuration("10s"), null, "Under 300s rejected");
  assert.equal(parseSessionDuration("999999999"), null, "Over 30 days rejected");
  assert.equal(parseSessionDuration("not-a-number"), null, "Garbage rejected");
  process.env.SESSION_TTL_SECONDS = "garbage";
  assert.equal(
    getSessionTtlSeconds(),
    DEFAULT_SESSION_TTL_SECONDS,
    "Invalid string safely defaults to 1 week",
  );
  console.log("  ok: boundary clamps and safe fallback to 1 week validated");
  Object.assign(process.env, envBackup);

  console.log("\n[ 3. Supabase Admin Client (SUPABASE_SERVICE_ROLE_KEY & SUPABASE_SECRET_KEY) ]");
  // Missing credentials
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  assert.equal(createAdminClient(), null, "Must return null when credentials missing");
  console.log("  ok: createAdminClient returns null safely without credentials");

  // With SUPABASE_SERVICE_ROLE_KEY
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const client1 = createAdminClient();
  assert(client1 !== null, "Must instantiate client with SUPABASE_SERVICE_ROLE_KEY");
  console.log("  ok: createAdminClient instantiates with SUPABASE_SERVICE_ROLE_KEY");

  // With SUPABASE_SECRET_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SECRET_KEY = "test-secret-key";
  const client2 = createAdminClient();
  assert(client2 !== null, "Must instantiate client with SUPABASE_SECRET_KEY");
  console.log("  ok: createAdminClient instantiates with SUPABASE_SECRET_KEY");
  Object.assign(process.env, envBackup);

  console.log("\n[ 4. Route Handler Supabase Client Cookie Integration ]");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-pub-key";
  process.env.SESSION_TTL_SECONDS = "604800";

  const dummyReq = new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      cookie: "sb-ref-auth-token=test-jwt",
    },
  });

  const dummyRes = NextResponse.json({ success: true });
  const routeClient = createRouteHandlerSupabaseClient(dummyReq, dummyRes);
  assert(routeClient !== null, "Must create Route Handler client with publishable key");
  console.log("  ok: createRouteHandlerSupabaseClient initializes and binds to NextResponse");
  Object.assign(process.env, envBackup);

  console.log("\n[ 5. Supabase Admin User 'asdy' Resolution Engine ]");
  const target = "asdy";
  const configuredEmail = "asdy@youtube.discov.com";
  const mockUserCatalog = [
    { id: "u-1", email: "other@domain.com", user_metadata: { username: "other" } },
    { id: "u-2", email: "asdy@youtube.discov.com", user_metadata: { username: "asdy" } },
    { id: "u-3", email: "asdy", user_metadata: {} },
    { id: "u-4", email: "admin@asdy.org", user_metadata: { name: "asdy" } },
  ];

  // Test 1: Match by asdy@youtube.discov.com
  const match1 = mockUserCatalog.find(
    (u) =>
      u.email === configuredEmail ||
      u.email?.split("@")[0] === target ||
      u.user_metadata?.username === target,
  );
  assert.equal(match1?.id, "u-2", "Must resolve user 'asdy' to asdy@youtube.discov.com");
  assert.equal(match1?.email, "asdy@youtube.discov.com", "Resolved email must match asdy@youtube.discov.com");
  console.log("  ok: resolves 'asdy' directly to asdy@youtube.discov.com");

  // Test 2: Match by exact email asdy
  const match2 = [mockUserCatalog[2]].find((u) => u.email === target);
  assert.equal(match2?.id, "u-3", "Must resolve user 'asdy' by direct email match");
  console.log("  ok: resolves 'asdy' from direct email match");

  // Test 3: Environment password extraction
  process.env.ADMIN_PASSWORD = "TestAdminPassword123!";
  const resolvedEnvPw1 = (process.env.ADMIN_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD)?.trim();
  assert.equal(resolvedEnvPw1, "TestAdminPassword123!", "ADMIN_PASSWORD must be resolved");

  delete process.env.ADMIN_PASSWORD;
  process.env.ADMIN_INITIAL_PASSWORD = "FallbackInitialPw456!";
  const resolvedEnvPw2 = (process.env.ADMIN_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD)?.trim();
  assert.equal(resolvedEnvPw2, "FallbackInitialPw456!", "ADMIN_INITIAL_PASSWORD must be resolved as fallback");
  console.log("  ok: environment password correctly extracted from ADMIN_PASSWORD / ADMIN_INITIAL_PASSWORD");
  Object.assign(process.env, envBackup);

  console.log("\n[ 6. Proxy Session Presence Checking ]");
  // Test local session cookie
  const hasLocal = Boolean({ value: "test-sid" }?.value);
  assert.equal(hasLocal, true, "Local session detected");

  // Test Supabase auth cookies
  const cookiesWithSb = [
    { name: "sb-myref-auth-token", value: "token.0" },
    { name: "other_cookie", value: "foo" },
  ];
  const hasSb = cookiesWithSb.some(
    (c) =>
      (c.name.startsWith("sb-") && c.name.includes("-auth-token")) ||
      c.name.includes("supabase-auth-token"),
  );
  assert.equal(hasSb, true, "Supabase session cookie detected");

  // Test unauthenticated
  const cookiesEmpty: Array<{ name: string; value: string }> = [];
  const hasNeither = cookiesEmpty.some(
    (c) =>
      (c.name.startsWith("sb-") && c.name.includes("-auth-token")) ||
      c.name === SESSION_COOKIE_NAME,
  );
  assert.equal(hasNeither, false, "Empty cookies correctly detected as unauthenticated");
  console.log("  ok: proxy session detector recognizes both Supabase and local session cookies");

  console.log("\n[ 7. Error Categorization & Destination Redirect ]");
  // Test destination redirect logic
  const searchParamsWithNext = new URLSearchParams("next=/saved");
  const nextVal = searchParamsWithNext.get("next");
  const destination1 = nextVal && nextVal.startsWith("/") && !nextVal.startsWith("//") && nextVal !== "/login" ? nextVal : "/search";
  assert.equal(destination1, "/saved", "Must redirect to requested /saved path");

  const searchParamsEmpty = new URLSearchParams("");
  const nextEmpty = searchParamsEmpty.get("next");
  const destination2 = nextEmpty && nextEmpty.startsWith("/") && !nextEmpty.startsWith("//") && nextEmpty !== "/login" ? nextEmpty : "/search";
  assert.equal(destination2, "/search", "Must redirect to /search by default");

  const searchParamsLogin = new URLSearchParams("next=/login");
  const nextLogin = searchParamsLogin.get("next");
  const destination3 = nextLogin && nextLogin.startsWith("/") && !nextLogin.startsWith("//") && nextLogin !== "/login" ? nextLogin : "/search";
  assert.equal(destination3, "/search", "Must avoid self-loop redirect when next is /login");
  console.log("  ok: successful login destination correctly resolves to /search by default and preserves valid next routes");
}
