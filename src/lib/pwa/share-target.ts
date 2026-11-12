/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PWA Web Share Target — Shared Runtime-Agnostic Contract
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Validation, sanitization, deterministic identity, cache keys, and
 *        payload types for the Android Web Share Target flow.
 *
 * Why this file exists:
 *   A share POST is received by the service worker, cached under a random
 *   token, and then reviewed by an authenticated administrator. The page and
 *   the server validation route must agree on exactly which URLs are safe,
 *   how oversized/control-character input is handled, and how a shared URL
 *   maps to a stable saved-reference identity. This module is that contract.
 *
 * Safety rules (do not weaken):
 *   - Only absolute http: and https: URLs with a hostname are accepted.
 *   - javascript:, data:, file:, blob:, ftp:, and every other scheme are
 *     rejected, including when they arrive in the explicit `url` field.
 *   - Shared text is treated as inert text. It is never rendered as HTML and
 *     is never fetched by the server or browser before the user opens it.
 *   - The deterministic record id is derived from the normalized URL only.
 *     Titles are never part of identity.
 *   - The SHA-256 implementation is local and synchronous so the browser and
 *     the Node server produce the same identity without Web Crypto support.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  SAVED_REFERENCE_LIMITS,
  isValidHttpUrl,
  normalizeUrlForComparison,
} from "../saved-references/link-identity";

export const SHARE_TARGET_PATH = "/share-target";
export const SHARE_TARGET_VALIDATE_PATH = "/api/share-target/validate";
export const SHARE_TARGET_CACHE_NAME = "youtube-discovery-share-target-v1";
export const SHARE_TARGET_CACHE_PREFIX = "/__share-target__/";
export const SHARE_TARGET_PAYLOAD_VERSION = 1;
export const SHARE_TARGET_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Hard ceilings applied before validation. They exist so a malicious or buggy
 * share sheet cannot fill Cache Storage with an unbounded payload.
 */
export const SHARE_RAW_FIELD_LIMITS = {
  title: 4096,
  text: 32768,
  url: 8192,
} as const;

/**
 * Limits for the review/save contract. These mirror the persisted reference
 * columns and the local-first outbox record shape.
 */
export const SHARE_REVIEW_LIMITS = {
  title: SAVED_REFERENCE_LIMITS.title,
  url: SAVED_REFERENCE_LIMITS.url,
  notes: SAVED_REFERENCE_LIMITS.notes,
  sharedText: SAVED_REFERENCE_LIMITS.notes,
} as const;

/** Raw fields as received from the Web Share Target form. */
export interface SharedFields {
  title?: unknown;
  text?: unknown;
  url?: unknown;
}

/** Sanitized fields stored inside the service-worker cache payload. */
export interface SharedPayloadFields {
  title: string;
  text: string;
  url: string;
}

/** Payload written by `public/sw.js` and read by the review page. */
export interface SharePayload {
  version: number;
  token: string;
  createdAt: string;
  ownerHint: string | null;
  fields: SharedPayloadFields;
}

/** Normalized review data produced by the shared parser. */
export interface NormalizedShare {
  url: string;
  suggestedTitle: string;
  suggestedNotes: string;
  sharedText: string;
  warnings: string[];
}

/** Response data returned by POST /api/share-target/validate. */
export interface ShareTargetValidationData {
  url: string;
  suggestedTitle: string;
  suggestedNotes: string;
  sharedText: string;
  warnings: string[];
}

/** Minimal duplicate summary returned to the review page. */
export interface ShareTargetDuplicateSummary {
  recordId: string | null;
  title: string;
  url: string;
}

export type ShareParseErrorCode = "MISSING_URL" | "INVALID_URL" | "OVERSIZED_URL";

export type ParseSharedFieldsResult =
  | { ok: true; value: NormalizedShare }
  | { ok: false; code: ShareParseErrorCode; message: string };

/**
 * Removes control characters and invisible formatting characters that can
 * make shared text look different from what it is. Newlines and tabs survive
 * because shared descriptions can legitimately be multi-line.
 */
function stripUnsafeCharacters(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Sanitizes shared text while preserving paragraph structure. Oversized text
 * is truncated rather than rejected because losing part of a description is
 * safer than losing the shared link itself.
 */
export function sanitizeSharedText(
  value: unknown,
  maxLength: number = SHARE_RAW_FIELD_LIMITS.text
): string {
  const clean = stripUnsafeCharacters(asString(value)).trim();
  if (clean.length <= maxLength) return clean;
  return clean.slice(0, maxLength).trimEnd();
}

/** Collapses whitespace for a one-line title. */
function collapseSharedWhitespace(value: string): string {
  return stripUnsafeCharacters(value).replace(/\s+/g, " ").trim();
}

/** Sanitizes a one-line title and enforces the supplied maximum. */
export function sanitizeSharedTitle(
  value: unknown,
  maxLength: number = SHARE_REVIEW_LIMITS.title
): string {
  const clean = collapseSharedWhitespace(asString(value));
  if (clean.length <= maxLength) return clean;
  return clean.slice(0, maxLength).trimEnd();
}

function countCharacter(value: string, target: string): number {
  let count = 0;
  for (const character of value) {
    if (character === target) count += 1;
  }
  return count;
}

/**
 * Removes punctuation that a share sheet may attach to a URL, while keeping
 * balanced parentheses that are legitimate parts of paths (for example
 * Wikipedia article URLs).
 */
function trimUrlCandidate(value: string): string {
  let candidate = value.trim();
  candidate = candidate.replace(/^[<("'`\[]+/, "");
  candidate = candidate.replace(/[>"'`\].,;:!?。，！？]+$/, "");

  while (
    candidate.endsWith(")") &&
    countCharacter(candidate, "(") < countCharacter(candidate, ")")
  ) {
    candidate = candidate.slice(0, -1);
  }

  return candidate;
}

/**
 * Finds the first valid HTTP(S) URL inside inert shared text or a title.
 * Returns null when no safe URL exists. This never performs a network request.
 */
export function extractFirstHttpUrl(value: string): string | null {
  if (!value) return null;

  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const candidate = trimUrlCandidate(match[0]);
    if (isValidHttpUrl(candidate)) return candidate;
  }

  return null;
}

function removeFirstOccurrence(value: string, target: string): string {
  if (!target) return value;
  const index = value.indexOf(target);
  if (index < 0) return value;
  return `${value.slice(0, index)} ${value.slice(index + target.length)}`;
}

function buildFallbackTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    const candidate = `${host}${path}`.trim();
    return candidate || "Shared link";
  } catch {
    return "Shared link";
  }
}

/**
 * Derives readable notes from the shared text after removing the URL. If the
 * remaining text is just the title, notes stay empty to avoid duplication.
 */
function buildSuggestedNotes(textWithoutUrl: string, title: string): string {
  let notes = textWithoutUrl.trim();
  if (!notes) return "";

  const lowerNotes = notes.toLowerCase();
  const lowerTitle = title.trim().toLowerCase();

  if (lowerTitle) {
    if (
      lowerNotes === lowerTitle ||
      lowerNotes.startsWith(`${lowerTitle} `) ||
      lowerNotes.startsWith(`${lowerTitle}\n`)
    ) {
      notes = notes.slice(title.trim().length).trim();
    }
  }

  if (!notes) return "";

  return notes
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The canonical parser used by both the server route and automated tests.
 *
 * Precedence:
 *   1. A non-empty explicit `url` field is authoritative. If it is unsafe or
 *      oversized, the request is rejected even if the text contains a good URL.
 *   2. If the share sheet omitted `url` (common on Android), the first safe
 *      HTTP(S) URL in `text`, then `title`, is used.
 *
 * Oversized titles/text are truncated with warnings. An oversized URL is
 * rejected because truncating a URL can silently point at a different page.
 */
export function parseSharedFields(input: SharedFields): ParseSharedFieldsResult {
  const warnings = new Set<string>();

  const rawUrl = stripUnsafeCharacters(asString(input.url)).trim();
  if (rawUrl.length > SHARE_RAW_FIELD_LIMITS.url) {
    return {
      ok: false,
      code: "OVERSIZED_URL",
      message: `The shared URL exceeds the ${SHARE_RAW_FIELD_LIMITS.url}-character transport limit.`,
    };
  }
  if (rawUrl && !isValidHttpUrl(rawUrl)) {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Only absolute HTTP and HTTPS links can be saved. The shared URL uses an unsupported or unsafe scheme.",
    };
  }
  if (rawUrl.length > SHARE_REVIEW_LIMITS.url) {
    return {
      ok: false,
      code: "OVERSIZED_URL",
      message: `The shared URL exceeds the ${SHARE_REVIEW_LIMITS.url}-character library limit.`,
    };
  }

  const rawTitleLength = asString(input.title).length;
  const rawTextLength = asString(input.text).length;
  const rawTitle = sanitizeSharedText(input.title, SHARE_RAW_FIELD_LIMITS.title);
  const rawText = sanitizeSharedText(input.text, SHARE_RAW_FIELD_LIMITS.text);

  if (rawTitleLength > SHARE_RAW_FIELD_LIMITS.title) {
    warnings.add(
      `The shared title was shortened to ${SHARE_RAW_FIELD_LIMITS.title} characters before review.`
    );
  }
  if (rawTextLength > SHARE_RAW_FIELD_LIMITS.text) {
    warnings.add(
      `The shared text was shortened to ${SHARE_RAW_FIELD_LIMITS.text} characters before review.`
    );
  }

  let url = rawUrl;
  if (!url) {
    const urlFromText = extractFirstHttpUrl(rawText);
    const urlFromTitle = urlFromText ? null : extractFirstHttpUrl(rawTitle);
    const extracted = urlFromText || urlFromTitle;

    if (!extracted) {
      return {
        ok: false,
        code: "MISSING_URL",
        message:
          "The shared item did not include an HTTP or HTTPS web address. Share a web page from Chrome, or save the link manually.",
      };
    }

    if (extracted.length > SHARE_REVIEW_LIMITS.url) {
      return {
        ok: false,
        code: "OVERSIZED_URL",
        message: `The shared URL exceeds the ${SHARE_REVIEW_LIMITS.url}-character library limit.`,
      };
    }

    url = extracted;
    warnings.add(
      urlFromText
        ? "The link was found in the shared text because the share sheet did not provide a URL field."
        : "The link was found in the shared title because the share sheet did not provide a URL field."
    );
  }

  const textWithoutUrl = removeFirstOccurrence(rawText, url);

  const explicitTitleFull = collapseSharedWhitespace(rawTitle);
  const textTitleFull = collapseSharedWhitespace(textWithoutUrl);
  const titleSourceFull =
    explicitTitleFull && !isValidHttpUrl(explicitTitleFull)
      ? explicitTitleFull
      : textTitleFull || buildFallbackTitle(url);

  let suggestedTitle = titleSourceFull;
  if (suggestedTitle.length > SHARE_REVIEW_LIMITS.title) {
    suggestedTitle = suggestedTitle.slice(0, SHARE_REVIEW_LIMITS.title).trimEnd();
    warnings.add(
      `The suggested title was shortened to ${SHARE_REVIEW_LIMITS.title} characters.`
    );
  }
  if (!suggestedTitle) suggestedTitle = "Shared link";

  const notesFull = buildSuggestedNotes(textWithoutUrl, suggestedTitle);
  let suggestedNotes = notesFull;
  if (suggestedNotes.length > SHARE_REVIEW_LIMITS.notes) {
    suggestedNotes = suggestedNotes.slice(0, SHARE_REVIEW_LIMITS.notes).trimEnd();
    warnings.add(
      `The shared notes were shortened to ${SHARE_REVIEW_LIMITS.notes} characters.`
    );
  }

  let sharedText = rawText;
  if (sharedText.length > SHARE_REVIEW_LIMITS.sharedText) {
    sharedText = sharedText.slice(0, SHARE_REVIEW_LIMITS.sharedText).trimEnd();
    warnings.add(
      `The shared text preview was shortened to ${SHARE_REVIEW_LIMITS.sharedText} characters.`
    );
  }

  return {
    ok: true,
    value: {
      url,
      suggestedTitle,
      suggestedNotes,
      sharedText,
      warnings: Array.from(warnings),
    },
  };
}

/**
 * Builds the stable saved-reference record id for a shared URL. The id is
 * deterministic across devices and server requests, which makes duplicate
 * submissions idempotent instead of creating parallel rows.
 *
 * 12 characters of prefix + 32 hex characters = 44 characters, comfortably
 * below `saved_references.record_id VARCHAR(256)`.
 */
export function buildSharedLinkRecordId(url: string): string {
  const identity = normalizeUrlForComparison(url);
  return `shared-link-${sha256Hex(identity).slice(0, 32)}`;
}

/** Share-token format generated by the service worker (16 random bytes). */
export function isValidShareToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

/**
 * Absolute Cache Storage key for a share payload. The service worker uses the
 * same prefix and origin, so a token resolves to exactly one cache entry.
 */
export function buildSharePayloadKey(token: string, origin: string): string {
  if (!isValidShareToken(token)) {
    throw new Error("Invalid share token.");
  }

  const base = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${base}${SHARE_TARGET_CACHE_PREFIX}${token}`;
}

/** Internal review path used for login handoff after a session expires. */
export function buildShareTargetPagePath(token: string): string {
  return `${SHARE_TARGET_PATH}?share=${encodeURIComponent(token)}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SHA-256 (synchronous, dependency-free)
 * ──────────────────────────────────────────────────────────────────────────
 * Why not Web Crypto?
 *   `crypto.subtle` is unavailable in some non-secure development contexts and
 *   is asynchronous. The record identity must be identical in the browser and
 *   on the Node server, so this small standard implementation is shared.
 * ═══════════════════════════════════════════════════════════════════════════ */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Returns the lowercase hex SHA-256 digest of a UTF-8 string. */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);

  buffer.set(bytes);
  buffer[bytes.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }

    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15];
      const word2 = words[index - 2];
      const sigma0 =
        rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 =
        rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let index = 0; index < 64; index += 1) {
      const sigma1 =
        rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choose + SHA256_K[index] + words[index]) >>> 0;
      const sigma0 =
        rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  let hex = "";
  for (const word of hash) {
    hex += word.toString(16).padStart(8, "0");
  }
  return hex;
}
