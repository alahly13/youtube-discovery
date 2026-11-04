/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Installation-Specific Device Identity
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Provides a stable, non-invasive, installation-specific device
 *        identifier and descriptive metadata per browser profile.
 *
 * Guarantees:
 *   1. Zero Invasive Fingerprinting: Uses a single cryptographically random
 *      UUID generated once and persisted in local storage.
 *   2. Strict Identity Separation:
 *        - Supabase Auth User ID: Authenticated session identity.
 *        - Database Profile ID: Relational PostgreSQL primary key.
 *        - Storage Owner UUID: Object storage partition key in R2.
 *        - Device Installation ID: Local browser installation identifier.
 *   3. Multi-Device Tracking: Preserves originDeviceId across outbox
 *      operations, Cloudflare R2 manifests, and PostgreSQL registries.
 *   4. User Control: Allows setting a friendly custom device label.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface DeviceMetadata {
  browser: string;
  os: string;
  category: "desktop" | "mobile" | "tablet" | "unknown";
  appVersion: string;
}

export interface DeviceRegistration {
  deviceId: string;
  deviceLabel: string;
  metadata: DeviceMetadata;
  createdAt: string;
  lastActiveAt: string;
}

const STORAGE_DEVICE_ID_KEY = "yt_discovery_device_id_v1";
const STORAGE_DEVICE_LABEL_KEY = "yt_discovery_device_label_v1";
const STORAGE_DEVICE_CREATED_KEY = "yt_discovery_device_created_v1";

/**
 * Detects safe, non-invasive platform family and device category.
 */
function detectSafeDeviceMetadata(): DeviceMetadata {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      browser: "Server",
      os: "Unknown",
      category: "unknown",
      appVersion: "0.1.0",
    };
  }

  const ua = navigator.userAgent || "";
  let browser = "Browser";
  if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Safari/")) browser = "Safari";

  let os = "Desktop";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Macintosh") || ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

  let category: "desktop" | "mobile" | "tablet" = "desktop";
  if (/iPad|tablet/i.test(ua)) category = "tablet";
  else if (/Mobile|Android|iPhone/i.test(ua)) category = "mobile";

  return {
    browser,
    os,
    category,
    appVersion: "0.1.0 (2026)",
  };
}

/**
 * Generates or retrieves the persistent installation UUID.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") {
    return "server-env-device";
  }

  try {
    let id = localStorage.getItem(STORAGE_DEVICE_ID_KEY);
    if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
      const randomUuid = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      id = `dev_${randomUuid.replace(/-/g, "").slice(0, 16)}`;
      localStorage.setItem(STORAGE_DEVICE_ID_KEY, id);
      localStorage.setItem(STORAGE_DEVICE_CREATED_KEY, new Date().toISOString());
    }
    return id;
  } catch {
    return "ephemeral-device";
  }
}

/**
 * Retrieves the user-friendly label for this device installation.
 */
export function getDeviceLabel(): string {
  if (typeof window === "undefined") {
    return "Server Runtime";
  }

  try {
    const existing = localStorage.getItem(STORAGE_DEVICE_LABEL_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }

    const meta = detectSafeDeviceMetadata();
    const defaultLabel = `${meta.os} ${meta.browser}`;
    return defaultLabel;
  } catch {
    return "Current Device";
  }
}

/**
 * Updates the user-friendly label for this device installation.
 */
export function setDeviceLabel(newLabel: string): void {
  if (typeof window === "undefined") return;
  const clean = (newLabel || "").trim().slice(0, 64);
  if (clean) {
    try {
      localStorage.setItem(STORAGE_DEVICE_LABEL_KEY, clean);
    } catch {
      // Storage quota or privacy restriction
    }
  }
}

/**
 * Returns full device registration details.
 */
export function getDeviceRegistration(): DeviceRegistration {
  const deviceId = getOrCreateDeviceId();
  const deviceLabel = getDeviceLabel();
  const metadata = detectSafeDeviceMetadata();

  let createdAt = new Date().toISOString();
  if (typeof window !== "undefined") {
    try {
      const storedCreated = localStorage.getItem(STORAGE_DEVICE_CREATED_KEY);
      if (storedCreated) createdAt = storedCreated;
    } catch {
      // Ignore
    }
  }

  return {
    deviceId,
    deviceLabel,
    metadata,
    createdAt,
    lastActiveAt: new Date().toISOString(),
  };
}

/**
 * Returns origin metadata bundle ready to attach to any saved record or sync batch.
 */
export function getOriginDeviceMeta(): {
  originDeviceId: string;
  originDeviceLabel: string;
  deviceMetadata: DeviceMetadata;
} {
  const reg = getDeviceRegistration();
  return {
    originDeviceId: reg.deviceId,
    originDeviceLabel: reg.deviceLabel,
    deviceMetadata: reg.metadata,
  };
}
