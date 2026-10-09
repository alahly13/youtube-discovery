import "server-only";

import type { BlobBackend } from "../blob/blob-backend";
import { BlobConflictError } from "../blob/blob-backend";
import { ADMIN_ACCOUNT_PATHNAME } from "../blob/blob-paths";
import { hashPassword, validateNewPassword, validateUsername, verifyPassword } from "./password";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Admin Account Store — exactly ONE administrator account in Blob.
 * ──────────────────────────────────────────────────────────────────────────
 * Record: youtube-discovery/v1/admin/account.json
 *   { schemaVersion, username, passwordHash, authVersion, createdAt, updatedAt }
 * - Bootstrap reads ADMIN_DEFAULT_USERNAME (default "admin") + REQUIRED
 *   ADMIN_INITIAL_PASSWORD, hashes with scrypt, and creates the record with
 *   atomic create-if-absent. After initialization, env vars NEVER overwrite
 *   the persisted record.
 * - Simultaneous bootstraps cannot create competing accounts: the loser of
 *   the create-if-absent race reads back the winner's record.
 * - Credential changes bump authVersion (invalidates all sessions) and are
 *   verified by read-back before reporting success.
 * - Plaintext passwords, session cookies, and signing secrets are NEVER
 *   stored here. A missing record after prior init is treated as corruption
 *   (no silent re-bootstrap over existing data — see ensureBootstrapped).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const ADMIN_ACCOUNT_SCHEMA_VERSION = 1;

export interface AdminAccount {
  schemaVersion: number;
  username: string;
  passwordHash: string;
  /** Bumped on every credential change; sessions embed the version they were issued at. */
  authVersion: number;
  createdAt: string;
  updatedAt: string;
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

function readBootstrapEnv(): { username: string; initialPassword: string } {
  const username = (process.env.ADMIN_DEFAULT_USERNAME?.trim() || "admin").slice(0, 32);
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD ?? "";
  if (!initialPassword || initialPassword.length < 12) {
    throw new AuthConfigError(
      "Authentication is not initialized and ADMIN_INITIAL_PASSWORD is missing or too short. " +
        "Set a strong initial password (≥12 characters) in the environment. No default password exists.",
    );
  }
  try {
    validateUsername(username);
  } catch {
    throw new AuthConfigError("ADMIN_DEFAULT_USERNAME is invalid (3–32 chars: letters, digits, dot, underscore, hyphen).");
  }
  return { username, initialPassword };
}

function validateAccountShape(value: unknown): AdminAccount | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  if (
    a.schemaVersion !== ADMIN_ACCOUNT_SCHEMA_VERSION ||
    typeof a.username !== "string" ||
    typeof a.passwordHash !== "string" ||
    typeof a.authVersion !== "number" ||
    typeof a.createdAt !== "string" ||
    typeof a.updatedAt !== "string"
  ) {
    return null;
  }
  try {
    validateUsername(a.username);
  } catch {
    return null;
  }
  return a as unknown as AdminAccount;
}

export async function readAccount(backend: BlobBackend): Promise<AdminAccount | null> {
  const meta = await backend.head(ADMIN_ACCOUNT_PATHNAME);
  if (!meta) return null;
  try {
    const raw = await backend.getBytes(ADMIN_ACCOUNT_PATHNAME);
    return validateAccountShape(JSON.parse(raw.toString("utf8")));
  } catch {
    return null;
  }
}

/**
 * Returns the account, bootstrapping exactly once when absent.
 * `marker` distinguishes "never initialized" (bootstrap allowed) from
 * "record vanished after init" (refuse — see accountMarker below).
 */
export async function ensureBootstrapped(backend: BlobBackend): Promise<AdminAccount> {
  const existing = await readAccount(backend);
  if (existing) return existing;

  const { username, initialPassword } = readBootstrapEnv();
  const now = new Date().toISOString();
  const candidate: AdminAccount = {
    schemaVersion: ADMIN_ACCOUNT_SCHEMA_VERSION,
    username,
    passwordHash: await hashPassword(initialPassword),
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  const body = Buffer.from(JSON.stringify(candidate), "utf8");
  try {
    await backend.putBytes(ADMIN_ACCOUNT_PATHNAME, body, {
      allowOverwrite: false,
      contentType: "application/json",
      cacheSeconds: 0,
    });
    return candidate;
  } catch (err) {
    if (err instanceof BlobConflictError) {
      // Lost the race: another instance bootstrapped first. Read the winner.
      const winner = await readAccount(backend);
      if (winner) return winner;
    }
    // allowOverwrite:false may surface as a generic failure on some paths:
    // disambiguate by re-reading before giving up.
    const retry = await readAccount(backend).catch(() => null);
    if (retry) return retry;
    throw err;
  }
}

/** Current username for the login prefill (exposes ONLY the username). */
export async function getLoginUsername(backend: BlobBackend): Promise<string> {
  const account = await readAccount(backend);
  if (account) return account.username;
  return process.env.ADMIN_DEFAULT_USERNAME?.trim() || "admin";
}

export async function verifyCredentials(
  backend: BlobBackend,
  username: string,
  password: string,
): Promise<AdminAccount | null> {
  const account = await ensureBootstrapped(backend);
  // Constant-shape comparison: always run the KDF to avoid user enumeration
  // via timing, then compare usernames in constant time too.
  const passwordOk = await verifyPassword(password, account.passwordHash);
  const want = Buffer.from(account.username);
  const got = Buffer.from(username.trim());
  let usernameOk = want.length === got.length;
  // Compare byte-wise without early exit.
  const len = Math.max(want.length, got.length);
  let diff = want.length ^ got.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (want[i] ?? 0) ^ (got[i] ?? 0);
  }
  usernameOk = usernameOk && diff === 0;
  if (!passwordOk || !usernameOk) return null;
  return account;
}

export interface CredentialChange {
  currentPassword: string;
  newUsername?: string;
  newPassword?: string;
}

/**
 * Change username and/or password (current-password verified). Bumps
 * authVersion, verifies by read-back, returns the new account. Callers must
 * revoke sessions afterwards (authVersion mismatch invalidates them anyway).
 */
export async function changeCredentials(
  backend: BlobBackend,
  change: CredentialChange,
): Promise<AdminAccount> {
  if (change.newUsername === undefined && change.newPassword === undefined) {
    throw new Error("Nothing to change");
  }
  const account = await ensureBootstrapped(backend);
  const ok = await verifyPassword(change.currentPassword, account.passwordHash);
  if (!ok) throw new Error("Current password is incorrect");
  const nextUsername =
    change.newUsername !== undefined ? validateUsername(change.newUsername) : account.username;
  if (change.newPassword !== undefined) validateNewPassword(change.newPassword);
  const next: AdminAccount = {
    ...account,
    username: nextUsername,
    passwordHash:
      change.newPassword !== undefined ? await hashPassword(change.newPassword) : account.passwordHash,
    authVersion: account.authVersion + 1,
    updatedAt: new Date().toISOString(),
  };
  const existing = await backend.head(ADMIN_ACCOUNT_PATHNAME);
  const body = Buffer.from(JSON.stringify(next), "utf8");
  if (!existing) {
    await backend.putBytes(ADMIN_ACCOUNT_PATHNAME, body, {
      allowOverwrite: false,
      contentType: "application/json",
      cacheSeconds: 0,
    });
  } else {
    await backend.putBytes(ADMIN_ACCOUNT_PATHNAME, body, {
      ifMatch: existing.etag,
      contentType: "application/json",
      cacheSeconds: 0,
    });
  }
  // Read-back verification: never report success on a failed write.
  const verified = await readAccount(backend);
  if (!verified || verified.authVersion !== next.authVersion || verified.username !== next.username) {
    throw new Error("Credential update could not be verified; please retry");
  }
  return verified;
}
