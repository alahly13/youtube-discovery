import "server-only";

import type { BlobBackend } from "../../blob/blob-backend";
import { getBlobBackend } from "../../blob/backend-factory";
import { API_KEYS_STATE_PATHNAME } from "../../blob/blob-paths";
import { decryptApiKey, encryptApiKey, isKeyEncryptionAvailable, maskStoredKey } from "../../keys/key-crypto";
import type { EncryptedBundle } from "../../keys/key-crypto";
import {
  defaultBackend,
  isPoolBucketExhausted,
  poolKeyFor,
  readPools,
  type QuotaBucket,
} from "../../keys/quota-pools";
import { MissingYouTubeApiKeyError } from "./youtube-errors";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Managed YouTube API Keys — encrypted Blob state, quota-aware rotation.
 * ──────────────────────────────────────────────────────────────────────────
 * Record: youtube-discovery/v1/api-keys/state.json
 *   { version, activeKeyId, updatedAt, customKeys: [{id,label,bundle,
 *     addedAt,lastUsed,enabled,order,quotaExhaustedAt,cooldownUntil,lastError}] }
 * - API key VALUES are AES-256-GCM encrypted (API_KEYS_ENCRYPTION_KEY) and
 *   are decrypted ONLY inside resolveApiKeyForRequest(). Plaintext NEVER
 *   reaches Blob, logs, errors, or the browser (masked last-4 only).
 * - If encryption is unavailable, ADD operations are REFUSED (no plaintext).
 * - ENV key (YOUTUBE_API_KEY) is never copied into Blob; it stays a runtime
 *   fallback. Rotation order: enabled custom keys (by `order`, skipping
 *   cooldown) → ENV key. Quota exhaustion marks cooldown and the caller
 *   advances to the next eligible key without redeploying.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const API_KEYS_STATE_VERSION = 1;
/** Cooldown after a quota-exhaustion signal (24h — quotas reset daily). */
export const QUOTA_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface StoredManagedKey {
  id: string;
  label: string;
  bundle: EncryptedBundle;
  addedAt: string;
  lastUsed?: string;
  enabled: boolean;
  order: number;
  quotaExhaustedAt?: string | null;
  cooldownUntil?: number | null;
  lastError?: string | null;
  /** User-defined Gmail/account label, e.g. "Gmail Account 1". Never a password. */
  accountLabel?: string | null;
  /** Google Cloud project ID (normalized lowercase) when the admin knows it. */
  projectId?: string | null;
  projectDisplayName?: string | null;
  /**
   * Association confidence:
   * - "verified": established through correlated exhaustion evidence or an
   *   explicitly verified mechanism — never auto-claimed for manual entries.
   * - "declared": admin-entered project ID, not independently verified.
   * - "unknown": insufficient information (each such key is its own pool).
   */
  projectAssociation: "verified" | "declared" | "unknown";
  projectEvidence?: string | null;
  /** Lifetime local counters (informational; daily truth lives in usage docs). */
  totalRequests?: number;
  totalUnits?: number;
}

export interface ManagedKeysState {
  version: number;
  activeKeyId: string | null; // "env" | custom id | null(=auto)
  updatedAt: string;
  customKeys: StoredManagedKey[];
}

export interface SafeApiKeyInfo {
  id: string;
  label: string;
  maskedKey: string;
  source: "env" | "custom";
  isActive: boolean;
  status: "active" | "available" | "missing" | "cooling-down" | "disabled";
  addedAt?: string;
  lastUsed?: string;
  accountLabel?: string | null;
  projectId?: string | null;
  projectDisplayName?: string | null;
  projectAssociation?: "verified" | "declared" | "unknown";
  order?: number;
}

/** Backwards-compatible plaintext shape (pre-encryption disk era). */
interface LegacyPlainKey {
  id: string;
  label: string;
  apiKey: string;
  addedAt: string;
  lastUsed?: string;
}

function backend(): BlobBackend {
  return keysBackendOverride ?? getBlobBackend();
}

/** Test seam: unit tests inject MemoryBlobBackend; routes never call this. */
let keysBackendOverride: BlobBackend | null = null;
export function setKeysBackendForTests(backend: BlobBackend | null): void {
  keysBackendOverride = backend;
}

function emptyState(): ManagedKeysState {
  return { version: API_KEYS_STATE_VERSION, activeKeyId: "env", updatedAt: new Date().toISOString(), customKeys: [] };
}

async function readState(): Promise<ManagedKeysState> {
  try {
    const raw = await backend().getBytes(API_KEYS_STATE_PATHNAME);
    const parsed = JSON.parse(raw.toString("utf8")) as Partial<ManagedKeysState>;
    if (!parsed || !Array.isArray(parsed.customKeys)) return emptyState();
    return {
      version: API_KEYS_STATE_VERSION,
      activeKeyId: typeof parsed.activeKeyId === "string" ? parsed.activeKeyId : "env",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      customKeys: parsed.customKeys
        .filter(
          (k): k is StoredManagedKey =>
            Boolean(k) && typeof k.id === "string" && Boolean(k.bundle) && typeof k.label === "string",
        )
        .map((k) => normalizeKeyRecord(k)),
    };
  } catch {
    return emptyState();
  }
}

async function writeState(state: ManagedKeysState): Promise<ManagedKeysState> {
  const next: ManagedKeysState = { ...state, version: API_KEYS_STATE_VERSION, updatedAt: new Date().toISOString() };
  await backend().putBytes(API_KEYS_STATE_PATHNAME, Buffer.from(JSON.stringify(next), "utf8"), {
    contentType: "application/json",
    cacheSeconds: 0,
  });
  // Read-back verification before reporting success.
  const verify = await readState();
  if (verify.customKeys.length !== next.customKeys.length || verify.activeKeyId !== next.activeKeyId) {
    throw new Error("Key store write could not be verified");
  }
  return verify;
}

function inCooldown(key: StoredManagedKey, now: number): boolean {
  return typeof key.cooldownUntil === "number" && key.cooldownUntil > now;
}

/** Ordered, eligible custom keys for rotation (enabled, cooled-down). */
function eligibleKeys(state: ManagedKeysState): StoredManagedKey[] {
  const now = Date.now();
  return [...state.customKeys]
    .sort((a, b) => a.order - b.order)
    .filter((k) => k.enabled && !inCooldown(k, now));
}

/** Pool identity of a key: shared project pool, or its own pool when unknown. */
export function poolKeyForKey(key: Pick<StoredManagedKey, "id" | "projectId">): string {
  return poolKeyFor(key.projectId ?? null, key.id);
}

/**
 * Resolve the key to use for the NEXT provider request.
 * - Pinned custom key first (when eligible for the requested bucket).
 * - Otherwise auto-rotate across eligible keys, SKIPPING keys whose pool
 *   has the requested bucket exhausted (same-project keys share quota —
 *   rotating within an exhausted pool is not a new quota pool).
 * - ENV fallback last. Decrypted values stay server-side only.
 */
export async function resolveApiKeyForRequest(
  excludeKeyIds: string[] = [],
  bucket: QuotaBucket = "other",
): Promise<{
  key: string;
  keyId: string;
  source: "env" | "custom";
  projectId: string | null;
  poolKey: string;
}> {
  const state = await readState();
  const excluded = new Set(excludeKeyIds);
  let pools: Awaited<ReturnType<typeof readPools>> | null = null;
  try {
    pools = await readPools(defaultBackend());
  } catch {
    pools = null; // Rotation metadata unavailable → fall back to key-level cooldowns.
  }
  const poolExhausted = (poolKey: string): boolean =>
    pools ? isPoolBucketExhausted(pools, poolKey, bucket) : false;

  const tryDecrypt = (key: StoredManagedKey): string | null => {
    try {
      const value = decryptApiKey(key.bundle).trim();
      return value || null;
    } catch {
      return null; // undecryptable (e.g. rotated encryption key) → skip
    }
  };

  // Pinned key path (explicit user selection).
  if (state.activeKeyId && state.activeKeyId !== "env" && !excluded.has(state.activeKeyId)) {
    const pinned = state.customKeys.find((k) => k.id === state.activeKeyId);
    if (
      pinned &&
      pinned.enabled &&
      !inCooldown(pinned, Date.now()) &&
      !poolExhausted(poolKeyForKey(pinned))
    ) {
      const value = tryDecrypt(pinned);
      if (value) {
        void touchLastUsed(pinned.id, 0);
        return {
          key: value,
          keyId: pinned.id,
          source: "custom",
          projectId: pinned.projectId ?? null,
          poolKey: poolKeyForKey(pinned),
        };
      }
    }
  }
  // Auto-rotation across eligible custom keys.
  for (const candidate of eligibleKeys(state)) {
    if (excluded.has(candidate.id)) continue;
    if (state.activeKeyId && state.activeKeyId !== "env" && candidate.id === state.activeKeyId) continue; // tried above
    if (poolExhausted(poolKeyForKey(candidate))) continue; // same exhausted pool ≠ new quota
    const value = tryDecrypt(candidate);
    if (value) {
      void touchLastUsed(candidate.id, 0);
      return {
        key: value,
        keyId: candidate.id,
        source: "custom",
        projectId: candidate.projectId ?? null,
        poolKey: poolKeyForKey(candidate),
      };
    }
  }
  const envKey = process.env.YOUTUBE_API_KEY?.trim();
  if (envKey && !excluded.has("env")) {
    const envPool = "project:env-fallback";
    if (!poolExhausted(envPool)) {
      return { key: envKey, keyId: "env", source: "env", projectId: null, poolKey: envPool };
    }
  }
  throw new MissingYouTubeApiKeyError();
}

/** Backwards-compatible wrapper (keeps existing callers working). */
export async function resolveActiveYouTubeApiKey(): Promise<{
  key: string;
  keyId: string;
  source: "env" | "custom";
}> {
  return resolveApiKeyForRequest();
}

/** Mark a key quota-exhausted (24h cooldown) so rotation skips it. */
export async function markKeyQuotaExhausted(keyId: string, reason?: string): Promise<void> {
  if (keyId === "env") return; // ENV fallback has no persisted state to mark
  try {
    const state = await readState();
    const key = state.customKeys.find((k) => k.id === keyId);
    if (!key) return;
    key.quotaExhaustedAt = new Date().toISOString();
    key.cooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
    key.lastError = (reason ?? "quota exhausted").slice(0, 300);
    await writeState(state);
  } catch {
    // Rotation metadata is best-effort; the request path already advanced.
  }
}

/** Clear cooldown/error flags (keys recover automatically after cooldown too). */
export async function clearKeyCooldown(keyId: string): Promise<boolean> {
  const state = await readState();
  const key = state.customKeys.find((k) => k.id === keyId);
  if (!key) return false;
  key.cooldownUntil = null;
  key.quotaExhaustedAt = null;
  key.lastError = null;
  await writeState(state);
  return true;
}

async function touchLastUsed(keyId: string, units = 0): Promise<void> {
  try {
    const state = await readState();
    const key = state.customKeys.find((k) => k.id === keyId);
    if (key) {
      key.lastUsed = new Date().toISOString();
      key.cooldownUntil = typeof key.cooldownUntil === "number" && key.cooldownUntil > Date.now() ? key.cooldownUntil : null;
      key.totalRequests = (key.totalRequests ?? 0) + 1;
      key.totalUnits = (key.totalUnits ?? 0) + units;
      await writeState(state);
    }
  } catch {
    // Best effort.
  }
}

/** Record lifetime totals after an attributed request (best-effort). */
export async function recordKeyLifetimeUsage(keyId: string, units: number): Promise<void> {
  if (keyId === "env") return;
  await touchLastUsed(keyId, units);
}

/** Disable a single key (invalid/restricted) WITHOUT touching its pool. */
export async function disableKeyForInvalidity(keyId: string, reason: string): Promise<void> {
  if (keyId === "env") return;
  try {
    const state = await readState();
    const key = state.customKeys.find((k) => k.id === keyId);
    if (!key) return;
    key.enabled = false;
    key.lastError = reason.slice(0, 300);
    await writeState(state);
  } catch {
    // Best effort; rotation already advanced past this key.
  }
}

/**
 * Count distinct custom keys in a pool that have recorded quota exhaustion.
 * Used for behavioral verification: correlated exhaustion across ≥2 keys of
 * the same declared pool is evidence they truly share quota.
 */
export async function countPoolQuotaErrors(poolKey: string): Promise<{ keys: number; projectId: string | null }> {
  const state = await readState();
  let keys = 0;
  let projectId: string | null = null;
  for (const key of state.customKeys) {
    if (poolKeyForKey(key) === poolKey && key.quotaExhaustedAt) {
      keys += 1;
      projectId = key.projectId ?? projectId;
    }
  }
  return { keys, projectId };
}

export function maskApiKey(key: string): string {
  return maskStoredKey(key);
}

/** Backfill new project fields on older records (never invents associations). */
export function normalizeKeyRecord(k: StoredManagedKey): StoredManagedKey {
  const projectId =
    typeof k.projectId === "string" && k.projectId.trim() ? k.projectId.trim().toLowerCase().slice(0, 80) : null;
  let association = k.projectAssociation;
  if (association !== "verified" && association !== "declared" && association !== "unknown") {
    association = projectId ? "declared" : "unknown";
  }
  if (!projectId) association = "unknown";
  return {
    ...k,
    accountLabel: typeof k.accountLabel === "string" && k.accountLabel.trim() ? k.accountLabel.trim().slice(0, 80) : null,
    projectId,
    projectDisplayName:
      typeof k.projectDisplayName === "string" && k.projectDisplayName.trim()
        ? k.projectDisplayName.trim().slice(0, 120)
        : null,
    projectAssociation: association,
    projectEvidence: typeof k.projectEvidence === "string" ? k.projectEvidence.slice(0, 300) : null,
    totalRequests: typeof k.totalRequests === "number" ? k.totalRequests : 0,
    totalUnits: typeof k.totalUnits === "number" ? k.totalUnits : 0,
  };
}

export async function getSafeApiKeysList(): Promise<{
  activeKeyId: string;
  activeKeyMasked: string;
  keys: SafeApiKeyInfo[];
  encryptionAvailable: boolean;
}> {
  const envKey = process.env.YOUTUBE_API_KEY?.trim();
  const state = await readState();
  let activeKeyId = state.activeKeyId ?? "env";
  if (activeKeyId !== "env" && !state.customKeys.some((k) => k.id === activeKeyId)) {
    activeKeyId = "env";
  }
  const now = Date.now();
  const keys: SafeApiKeyInfo[] = [];
  const envActive = activeKeyId === "env";
  keys.push({
    id: "env",
    label: "ENV / Default Key",
    maskedKey: maskStoredKey(envKey ?? ""),
    source: "env",
    isActive: envActive,
    status: envKey ? (envActive ? "active" : "available") : "missing",
  });
  for (const custom of [...state.customKeys].sort((a, b) => a.order - b.order)) {
    const isActive = activeKeyId === custom.id;
    let masked = "••••";
    try {
      masked = maskStoredKey(decryptApiKey(custom.bundle));
    } catch {
      masked = "undecryptable";
    }
    keys.push({
      id: custom.id,
      label: custom.label,
      maskedKey: masked,
      source: "custom",
      isActive,
      status: !custom.enabled
        ? "disabled"
        : inCooldown(custom, now)
          ? "cooling-down"
          : isActive
            ? "active"
            : "available",
      addedAt: custom.addedAt,
      lastUsed: custom.lastUsed,
      accountLabel: custom.accountLabel ?? null,
      projectId: custom.projectId ?? null,
      projectDisplayName: custom.projectDisplayName ?? null,
      projectAssociation: custom.projectAssociation ?? "unknown",
      order: custom.order,
    });
  }
  const activeEntry = keys.find((k) => k.id === activeKeyId);
  return {
    activeKeyId,
    activeKeyMasked: activeEntry?.maskedKey ?? "Missing",
    keys,
    encryptionAvailable: isKeyEncryptionAvailable(),
  };
}

export async function addCustomApiKey(
  label: string,
  apiKey: string,
  project?: { accountLabel?: string | null; projectId?: string | null; projectDisplayName?: string | null },
): Promise<SafeApiKeyInfo> {
  if (!isKeyEncryptionAvailable()) {
    throw new Error(
      "API_KEYS_ENCRYPTION_KEY is not configured. Refusing to store the key without encryption.",
    );
  }
  const trimmedKey = apiKey.trim();
  const trimmedLabel = label.trim().slice(0, 120) || `API Key ${Date.now().toString().slice(-4)}`;
  if (!trimmedKey) throw new Error("API key cannot be empty");
  if (trimmedKey.length > 500) throw new Error("API key value is too long");
  const state = await readState();
  const id = `key-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const maxOrder = state.customKeys.reduce((m, k) => Math.max(m, k.order), -1);
  const stored: StoredManagedKey = normalizeKeyRecord({
    id,
    label: trimmedLabel,
    bundle: encryptApiKey(trimmedKey),
    addedAt: now,
    enabled: true,
    order: maxOrder + 1,
    quotaExhaustedAt: null,
    cooldownUntil: null,
    lastError: null,
    accountLabel: project?.accountLabel ?? null,
    projectId: project?.projectId ?? null,
    projectDisplayName: project?.projectDisplayName ?? null,
    projectAssociation: project?.projectId?.trim() ? "declared" : "unknown",
    projectEvidence: null,
    totalRequests: 0,
    totalUnits: 0,
  });
  state.customKeys.push(stored);
  await writeState(state);
  return {
    id,
    label: trimmedLabel,
    maskedKey: maskStoredKey(trimmedKey),
    source: "custom",
    isActive: state.activeKeyId === id,
    status: state.activeKeyId === id ? "active" : "available",
    addedAt: now,
    accountLabel: stored.accountLabel,
    projectId: stored.projectId,
    projectDisplayName: stored.projectDisplayName,
    projectAssociation: stored.projectAssociation,
    order: stored.order,
  };
}

export async function selectActiveApiKey(keyId: string): Promise<boolean> {
  const state = await readState();
  if (keyId === "env") {
    state.activeKeyId = "env";
    await writeState(state);
    return true;
  }
  const key = state.customKeys.find((k) => k.id === keyId);
  if (!key) return false;
  state.activeKeyId = keyId;
  // Selecting a key re-enables it and clears any stale cooldown.
  key.enabled = true;
  key.cooldownUntil = null;
  key.quotaExhaustedAt = null;
  key.lastError = null;
  await writeState(state);
  return true;
}

export async function deleteCustomApiKey(keyId: string): Promise<boolean> {
  if (keyId === "env") return false;
  const state = await readState();
  const initialLen = state.customKeys.length;
  state.customKeys = state.customKeys.filter((k) => k.id !== keyId);
  if (state.customKeys.length === initialLen) return false;
  if (state.activeKeyId === keyId) state.activeKeyId = "env";
  await writeState(state);
  return true;
}

export async function setKeyEnabled(keyId: string, enabled: boolean): Promise<boolean> {
  if (keyId === "env") return false;
  const state = await readState();
  const key = state.customKeys.find((k) => k.id === keyId);
  if (!key) return false;
  key.enabled = enabled;
  await writeState(state);
  return true;
}

export interface KeyMetadataPatch {
  label?: string;
  accountLabel?: string | null;
  projectId?: string | null;
  projectDisplayName?: string | null;
  enabled?: boolean;
  order?: number;
}

/**
 * Update admin-editable key metadata (labels, project association, priority).
 * Setting a projectId marks the association "declared" — manual entries are
 * NEVER auto-promoted to "verified" here (see promoteProjectToVerified).
 * Clearing the projectId returns the key to "unknown".
 */
export async function updateKeyMetadata(keyId: string, patch: KeyMetadataPatch): Promise<boolean> {
  if (keyId === "env") return false;
  const state = await readState();
  const key = state.customKeys.find((k) => k.id === keyId);
  if (!key) return false;
  if (patch.label !== undefined) {
    const clean = patch.label.trim().slice(0, 120);
    if (!clean) return false;
    key.label = clean;
  }
  if (patch.accountLabel !== undefined) {
    key.accountLabel = patch.accountLabel?.trim() ? patch.accountLabel.trim().slice(0, 80) : null;
  }
  if (patch.projectId !== undefined) {
    // Advisory identifier: trimmed + lowercased, never independently verified here.
    const pid = patch.projectId?.trim() ? patch.projectId.trim().toLowerCase().slice(0, 80) : null;
    key.projectId = pid;
    key.projectAssociation = pid ? (key.projectAssociation === "verified" ? "verified" : "declared") : "unknown";
    if (!pid) key.projectEvidence = null;
  }
  if (patch.projectDisplayName !== undefined) {
    key.projectDisplayName = patch.projectDisplayName?.trim()
      ? patch.projectDisplayName.trim().slice(0, 120)
      : null;
  }
  if (patch.enabled !== undefined) key.enabled = patch.enabled;
  if (patch.order !== undefined && Number.isInteger(patch.order)) key.order = patch.order;
  state.customKeys = state.customKeys.map((k) => (k.id === keyId ? normalizeKeyRecord(key) : k));
  await writeState(state);
  return true;
}

/**
 * Promote every key of a project pool to "verified" with recorded evidence.
 * Called ONLY when correlated exhaustion is actually observed across ≥2
 * distinct keys of the same declared pool (behavioral verification), or by
 * an explicit admin verification action. Never called for manual entries.
 */
export async function promoteProjectToVerified(projectId: string, evidence: string): Promise<number> {
  const pid = projectId.trim().toLowerCase();
  if (!pid) return 0;
  const state = await readState();
  let count = 0;
  for (const key of state.customKeys) {
    if (key.projectId === pid && key.projectAssociation !== "verified") {
      key.projectAssociation = "verified";
      key.projectEvidence = evidence.slice(0, 300);
      count += 1;
    }
  }
  if (count > 0) await writeState(state);
  return count;
}

/** Used by migration: import a legacy plaintext key (encrypts immediately). */
export function legacyPlainKeyToStored(legacy: LegacyPlainKey, order: number): StoredManagedKey {
  if (!isKeyEncryptionAvailable()) {
    throw new Error("API_KEYS_ENCRYPTION_KEY is not configured. Migration refuses plaintext storage.");
  }
  return normalizeKeyRecord({
    id: legacy.id,
    label: legacy.label,
    bundle: encryptApiKey(legacy.apiKey.trim()),
    addedAt: legacy.addedAt,
    lastUsed: legacy.lastUsed,
    enabled: true,
    order,
    quotaExhaustedAt: null,
    cooldownUntil: null,
    lastError: null,
    accountLabel: null,
    projectId: null,
    projectDisplayName: null,
    projectAssociation: "unknown",
    projectEvidence: null,
    totalRequests: 0,
    totalUnits: 0,
  });
}

/** Used by migration: read-modify-write hook for bulk import. Returns newly added count. */
export async function importManagedKeys(
  keys: StoredManagedKey[],
  activeKeyId: string | null,
): Promise<number> {
  const state = await readState();
  const known = new Set(state.customKeys.map((k) => k.id));
  let added = 0;
  for (const key of keys) {
    if (!known.has(key.id)) {
      state.customKeys.push(key);
      known.add(key.id);
      added += 1;
    }
  }
  if (activeKeyId && (activeKeyId === "env" || known.has(activeKeyId))) {
    state.activeKeyId = activeKeyId;
  }
  await writeState(state);
  return added;
}
