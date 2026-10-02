import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { MissingYouTubeApiKeyError } from "./youtube-errors";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube API Key Management — Single Source of Truth
 * ──────────────────────────────────────────────────────────────────────────
 * Manages multiple YouTube API keys with server-side secret security.
 * The ENV key (YOUTUBE_API_KEY) remains the default/fallback at all times.
 * Additional custom keys can be added, selected, or switched from the UI.
 *
 * Full API keys NEVER leave the server: the client receives only safe
 * masked representations (e.g. AIza...X92K).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface StoredCustomApiKey {
  id: string;
  label: string;
  apiKey: string; // Stored server-side only! Never exposed to client!
  addedAt: string;
  lastUsed?: string;
}

export interface StoredApiKeysState {
  activeKeyId?: string | null;
  customKeys: StoredCustomApiKey[];
}

export interface SafeApiKeyInfo {
  id: string;
  label: string;
  maskedKey: string;
  source: "env" | "custom";
  isActive: boolean;
  status: "active" | "available" | "missing";
  addedAt?: string;
  lastUsed?: string;
}

const KEYS_DIR = path.join(process.cwd(), "data", "keys");
const KEYS_FILE = path.join(KEYS_DIR, "api-keys.json");

/**
 * Masks an API key for safe display in the UI without leaking the secret.
 * Example: "AIzaSyD-1234567890-AbCdEf" -> "AIza...CdEf"
 */
export function maskApiKey(key: string): string {
  if (!key || key.trim().length === 0) return "Missing";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

async function ensureKeysDir(): Promise<void> {
  try {
    await fs.mkdir(KEYS_DIR, { recursive: true });
  } catch {
    // Ignore already exists
  }
}

async function readKeysState(): Promise<StoredApiKeysState> {
  await ensureKeysDir();
  try {
    const raw = await fs.readFile(KEYS_FILE, "utf-8");
    const data = JSON.parse(raw) as StoredApiKeysState;
    return {
      activeKeyId: data.activeKeyId ?? "env",
      customKeys: Array.isArray(data.customKeys) ? data.customKeys : [],
    };
  } catch {
    return {
      activeKeyId: "env",
      customKeys: [],
    };
  }
}

async function writeKeysState(state: StoredApiKeysState): Promise<void> {
  await ensureKeysDir();
  await fs.writeFile(KEYS_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Resolves the currently active YouTube API key for API requests.
 * Hierarchy:
 *   1. User-selected custom key (if available)
 *   2. ENV default key (YOUTUBE_API_KEY)
 * If custom key is missing or deleted, falls back safely to ENV key.
 */
export async function resolveActiveYouTubeApiKey(): Promise<{
  key: string;
  keyId: string;
  source: "env" | "custom";
}> {
  const envKey = process.env.YOUTUBE_API_KEY?.trim();
  const state = await readKeysState();

  // If user selected a custom key, check if it's available
  if (state.activeKeyId && state.activeKeyId !== "env") {
    const custom = state.customKeys.find((k) => k.id === state.activeKeyId);
    if (custom && custom.apiKey && custom.apiKey.trim()) {
      // Touch lastUsed asynchronously
      void touchKeyLastUsed(custom.id);
      return { key: custom.apiKey.trim(), keyId: custom.id, source: "custom" };
    }
  }

  // Fall back to ENV key
  if (envKey) {
    return { key: envKey, keyId: "env", source: "env" };
  }

  throw new MissingYouTubeApiKeyError();
}

/**
 * Touches the lastUsed timestamp on a custom key.
 */
async function touchKeyLastUsed(keyId: string): Promise<void> {
  try {
    const state = await readKeysState();
    const key = state.customKeys.find((k) => k.id === keyId);
    if (key) {
      key.lastUsed = new Date().toISOString();
      await writeKeysState(state);
    }
  } catch {
    // Ignore error
  }
}

/**
 * Returns safe, masked metadata for all configured keys (ENV + Custom).
 * The client NEVER receives plaintext secrets.
 */
export async function getSafeApiKeysList(): Promise<{
  activeKeyId: string;
  activeKeyMasked: string;
  keys: SafeApiKeyInfo[];
}> {
  const envKey = process.env.YOUTUBE_API_KEY?.trim();
  const state = await readKeysState();

  // Validate active key selection; if invalid custom key, fall back to "env"
  let activeKeyId = state.activeKeyId ?? "env";
  if (activeKeyId !== "env" && !state.customKeys.some((k) => k.id === activeKeyId)) {
    activeKeyId = "env";
  }

  const keys: SafeApiKeyInfo[] = [];

  // 1. ENV default key
  const envActive = activeKeyId === "env";
  keys.push({
    id: "env",
    label: "ENV / Default Key",
    maskedKey: maskApiKey(envKey ?? ""),
    source: "env",
    isActive: envActive,
    status: envKey ? (envActive ? "active" : "available") : "missing",
  });

  // 2. Custom keys
  for (const custom of state.customKeys) {
    const isActive = activeKeyId === custom.id;
    keys.push({
      id: custom.id,
      label: custom.label,
      maskedKey: maskApiKey(custom.apiKey),
      source: "custom",
      isActive,
      status: isActive ? "active" : "available",
      addedAt: custom.addedAt,
      lastUsed: custom.lastUsed,
    });
  }

  // Determine active masked key
  let activeMasked = "Missing";
  if (activeKeyId === "env") {
    activeMasked = maskApiKey(envKey ?? "");
  } else {
    const activeCustom = state.customKeys.find((k) => k.id === activeKeyId);
    if (activeCustom) {
      activeMasked = maskApiKey(activeCustom.apiKey);
    } else {
      activeMasked = maskApiKey(envKey ?? "");
    }
  }

  return {
    activeKeyId,
    activeKeyMasked: activeMasked,
    keys,
  };
}

/**
 * Adds a new custom YouTube API key server-side.
 */
export async function addCustomApiKey(label: string, apiKey: string): Promise<SafeApiKeyInfo> {
  const trimmedKey = apiKey.trim();
  const trimmedLabel = label.trim() || `API Key ${Date.now().toString().slice(-4)}`;

  if (!trimmedKey) {
    throw new Error("API key cannot be empty");
  }

  const state = await readKeysState();
  const id = `key-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  const newKey: StoredCustomApiKey = {
    id,
    label: trimmedLabel,
    apiKey: trimmedKey,
    addedAt: now,
  };

  state.customKeys.push(newKey);
  await writeKeysState(state);

  return {
    id,
    label: trimmedLabel,
    maskedKey: maskApiKey(trimmedKey),
    source: "custom",
    isActive: state.activeKeyId === id,
    status: state.activeKeyId === id ? "active" : "available",
    addedAt: now,
  };
}

/**
 * Switches the active YouTube API key.
 * Can be "env" or a custom key ID.
 */
export async function selectActiveApiKey(keyId: string): Promise<boolean> {
  const state = await readKeysState();
  if (keyId === "env") {
    state.activeKeyId = "env";
    await writeKeysState(state);
    return true;
  }

  const exists = state.customKeys.some((k) => k.id === keyId);
  if (!exists) {
    return false;
  }

  state.activeKeyId = keyId;
  await writeKeysState(state);
  return true;
}

/**
 * Deletes a custom key. If the deleted key was active, falls back safely to "env".
 */
export async function deleteCustomApiKey(keyId: string): Promise<boolean> {
  if (keyId === "env") {
    return false; // Cannot delete ENV key from custom storage
  }

  const state = await readKeysState();
  const initialLen = state.customKeys.length;
  state.customKeys = state.customKeys.filter((k) => k.id !== keyId);

  if (state.customKeys.length === initialLen) {
    return false;
  }

  if (state.activeKeyId === keyId) {
    state.activeKeyId = "env"; // Safe fallback to ENV key
  }

  await writeKeysState(state);
  return true;
}
