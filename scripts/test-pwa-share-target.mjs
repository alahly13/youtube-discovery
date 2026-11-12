/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PWA Web Share Target Verification Test Suite
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Automated verification for:
 *   1. Web App Manifest validity & share_target configuration
 *   2. Shared fields parsing & normalization (Android Chrome patterns)
 *   3. Strict HTTP/HTTPS URL validation & dangerous scheme rejection
 *   4. Missing/oversized parameter handling & safe text sanitization
 *   5. Deterministic link identity derivation (stable recordId)
 *   6. Local-first save orchestration & duplicate prevention
 *   7. Safe redirect sanitization (open-redirect protection)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// Load the compiled TypeScript modules
import { compileTsEntries } from "./lib/compile-ts-entry.mjs";

const compiled = compileTsEntries([
  "src/lib/pwa/share-target.ts",
  "src/lib/pwa/share-target-save.ts",
  "src/lib/navigation/safe-path.ts",
  "src/lib/saved-references/link-identity.ts",
]);

const {
  parseSharedFields,
  sanitizeSharedText,
  sanitizeSharedTitle,
  extractFirstHttpUrl,
  buildSharedLinkRecordId,
  isValidShareToken,
  sha256Hex,
} = compiled.load("lib/pwa/share-target.js");

const {
  saveSharedLink,
} = compiled.load("lib/pwa/share-target-save.js");

const {
  sanitizeRedirectPath,
} = compiled.load("lib/navigation/safe-path.js");

const {
  isValidHttpUrl,
  normalizeUrlForComparison,
} = compiled.load("lib/saved-references/link-identity.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log("\n══════════════════════════════════════════════════════════════");
console.log("   PWA WEB SHARE TARGET VERIFICATION SUITE                    ");
console.log("══════════════════════════════════════════════════════════════\n");

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: Web App Manifest & PWA Configuration
// ─────────────────────────────────────────────────────────────────────────────
console.log("── Group 1: Web App Manifest & PWA Configuration ─────────────");

const manifestRaw = fs.readFileSync(path.join(ROOT, "public", "manifest.webmanifest"), "utf-8");
const manifest = JSON.parse(manifestRaw);

assert(manifest.name === "YouTube Discovery Research Terminal", "Manifest has full application name");
assert(manifest.short_name === "YouTube Discovery", "Manifest has short_name");
assert(manifest.display === "standalone", "Display mode is standalone");
assert(manifest.start_url === "/", "Start URL is /");
assert(manifest.scope === "/", "Scope is /");
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 3, "Manifest defines at least 3 icons");

const hasMaskable = manifest.icons.some((icon) => icon.purpose === "maskable");
assert(hasMaskable, "Manifest includes a maskable icon for Android adaptive icons");

assert(manifest.share_target != null, "Manifest defines share_target");
assert(manifest.share_target.action === "/share-target", "share_target action is /share-target");
assert(manifest.share_target.method === "POST", "share_target method is POST");
assert(manifest.share_target.enctype === "multipart/form-data", "share_target enctype is multipart/form-data");
assert(manifest.share_target.params?.title === "title", "share_target maps title parameter");
assert(manifest.share_target.params?.text === "text", "share_target maps text parameter");
assert(manifest.share_target.params?.url === "url", "share_target maps url parameter");

// Service worker file presence
const swExists = fs.existsSync(path.join(ROOT, "public", "sw.js"));
assert(swExists, "public/sw.js exists for PWA Service Worker handling");

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: URL Validation & Dangerous Scheme Rejection
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 2: URL Validation & Scheme Rejection ─────────────────");

assert(isValidHttpUrl("https://example.com/article"), "Valid HTTPS URL is accepted");
assert(isValidHttpUrl("http://localhost:3000/test"), "Valid HTTP URL is accepted");
assert(isValidHttpUrl("https://en.wikipedia.org/wiki/Antigravity_(magazine)"), "URL with parentheses is accepted");

assert(!isValidHttpUrl("javascript:alert(1)"), "javascript: scheme is rejected");
assert(!isValidHttpUrl("data:text/html;base64,PHNjcmlwdD4="), "data: scheme is rejected");
assert(!isValidHttpUrl("file:///etc/passwd"), "file: scheme is rejected");
assert(!isValidHttpUrl("blob:https://example.com/uuid"), "blob: scheme is rejected");
assert(!isValidHttpUrl("ftp://ftp.example.com"), "ftp: scheme is rejected");
assert(!isValidHttpUrl("https://user:password@evil.com"), "Embedded credentials are rejected");
assert(!isValidHttpUrl("not-a-url"), "Plain text string is rejected as URL");
assert(!isValidHttpUrl(""), "Empty string is rejected as URL");

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Shared Content Parsing (Android Chrome Patterns)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 3: Shared Content Parsing ────────────────────────────");

// Scenario A: Standard explicit url field
const parsedStandard = parseSharedFields({
  url: "https://nature.com/articles/s41586-026-001",
  title: "Quantum Simulation Advances",
  text: "Groundbreaking research published in Nature.",
});
assert(parsedStandard.ok === true, "Standard share parses successfully");
assert(parsedStandard.value.url === "https://nature.com/articles/s41586-026-001", "Standard URL is preserved");
assert(parsedStandard.value.suggestedTitle === "Quantum Simulation Advances", "Standard title is preserved");

// Scenario B: Android Chrome shares URL in text only
const parsedAndroidText = parseSharedFields({
  url: "",
  title: "Fascinating Paper",
  text: "Check out this article: https://arxiv.org/abs/2601.12345 worth reading",
});
assert(parsedAndroidText.ok === true, "URL embedded in text is extracted successfully");
assert(parsedAndroidText.value.url === "https://arxiv.org/abs/2601.12345", "Extracted URL matches embedded URL");
assert(parsedAndroidText.value.warnings.length > 0, "Warning emitted explaining URL source");

// Scenario C: URL with trailing punctuation (e.g. "Shared link: https://example.com/test.")
const parsedPunctuation = parseSharedFields({
  url: "",
  title: "Test",
  text: "Look at (https://example.com/test?param=1).",
});
assert(parsedPunctuation.ok === true, "Trailing punctuation stripped from URL");
assert(parsedPunctuation.value.url === "https://example.com/test?param=1", "Cleaned URL is valid");

// Scenario D: Missing title generates readable fallback title from domain/path
const parsedNoTitle = parseSharedFields({
  url: "https://github.com/deepmind/research-project",
  title: "",
  text: "",
});
assert(parsedNoTitle.ok === true, "Missing title produces valid fallback");
assert(parsedNoTitle.value.suggestedTitle === "github.com/deepmind/research-project", "Fallback title uses host and path");

// Scenario E: Missing URL fails safely
const parsedMissingUrl = parseSharedFields({
  url: "",
  title: "Just a thought",
  text: "No link included anywhere in this share",
});
assert(parsedMissingUrl.ok === false, "Missing URL fails with error result");
assert(parsedMissingUrl.code === "MISSING_URL", "Error code is MISSING_URL");

// Scenario F: Unsafe URL fails safely
const parsedUnsafeUrl = parseSharedFields({
  url: "javascript:document.cookie",
  title: "Malicious Share",
  text: "Click me",
});
assert(parsedUnsafeUrl.ok === false, "Unsafe scheme fails with error result");
assert(parsedUnsafeUrl.code === "INVALID_URL", "Error code is INVALID_URL");

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Sanitization & Control Characters
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 4: Sanitization & Control Characters ─────────────────");

const dirtyText = "Line 1\x00\x08\u200B\r\nLine 2\t\uFEFFwith unicode spaces";
const cleaned = sanitizeSharedText(dirtyText);
assert(!cleaned.includes("\x00"), "Null bytes stripped");
assert(!cleaned.includes("\u200B"), "Zero-width spaces stripped");
assert(!cleaned.includes("\uFEFF"), "Byte-order marks stripped");
assert(cleaned.includes("Line 1\nLine 2"), "Newlines normalized to LF");

const oversizedTitle = "A".repeat(1000);
const sanitizedTitle = sanitizeSharedTitle(oversizedTitle, 100);
assert(sanitizedTitle.length === 100, "Oversized title truncated to configured limit");

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: Deterministic Link Identity & Duplicate Detection
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 5: Deterministic Link Identity ───────────────────────");

const link1 = "https://example.com/page?query=1#fragment";
const link2 = "HTTPS://EXAMPLE.COM/page/?query=1";
const id1 = buildSharedLinkRecordId(link1);
const id2 = buildSharedLinkRecordId(link2);

assert(id1 === id2, "Normalized URLs produce identical stable recordId (case & fragment insensitive)");
assert(id1.startsWith("shared-link-"), "Record id has shared-link- prefix");
assert(id1.length === 44, "Record id length is exactly 44 chars (VARCHAR 256 compliant)");

const norm1 = normalizeUrlForComparison(link1);
const norm2 = normalizeUrlForComparison(link2);
assert(norm1 === norm2, "normalizeUrlForComparison matches equivalent URLs");

// Token format
assert(isValidShareToken("0123456789abcdef0123456789abcdef"), "Valid 32-char hex token is recognized");
assert(!isValidShareToken("invalid-token"), "Invalid token format is rejected");

// ─────────────────────────────────────────────────────────────────────────────
// Group 6: Save Orchestration (Injectable Dependencies)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 6: Save Orchestration & Local-First Flow ────────────");

let savedRecord = null;
let saveAllCalled = false;

const mockDepsSuccess = {
  saveEntityLocally: async (owner, dataset, id, record) => {
    savedRecord = { owner, dataset, id, record };
    return { ok: true };
  },
  refreshSummary: async () => {},
  saveAll: async () => {
    saveAllCalled = true;
    return { ok: true, syncedCount: 1 };
  },
};

// Test unauthenticated save
const authFailResult = await saveSharedLink({
  draft: { url: "https://example.com", title: "Test" },
  ownerId: "",
  deps: mockDepsSuccess,
});
assert(authFailResult.status === "AUTH_REQUIRED", "Empty ownerId returns AUTH_REQUIRED");

// Test duplicate rejection
const duplicateResult = await saveSharedLink({
  draft: { url: "https://example.com", title: "Test" },
  ownerId: "owner_123",
  duplicate: { title: "Previously Saved", recordId: "existing_rec" },
  deps: mockDepsSuccess,
});
assert(duplicateResult.status === "DUPLICATE", "Duplicate record returns DUPLICATE status");

// Test successful save with cloud sync
const successResult = await saveSharedLink({
  draft: { url: "https://example.com/paper", title: "Exciting Discovery" },
  ownerId: "owner_123",
  deps: mockDepsSuccess,
});
assert(successResult.status === "SAVED", "Save succeeds");
assert(successResult.sync === "SYNCED", "Cloud sync is marked SYNCED");
assert(savedRecord != null, "Record written to local store");
assert(savedRecord.dataset === "REFERENCES", "Saved to canonical REFERENCES dataset");
assert(savedRecord.record.resourceType === "SAVED_LINK", "Resource type is SAVED_LINK");
assert(saveAllCalled === true, "Immediate saveAll was triggered");

// Test offline / cloud failure fallback
const mockDepsPending = {
  saveEntityLocally: async () => ({ ok: true }),
  refreshSummary: async () => {},
  saveAll: async () => ({ ok: false, syncedCount: 0, error: "Network timeout" }),
};
const pendingResult = await saveSharedLink({
  draft: { url: "https://example.com/offline", title: "Offline Link" },
  ownerId: "owner_123",
  deps: mockDepsPending,
});
assert(pendingResult.status === "SAVED", "Save still succeeds locally even when sync fails");
assert(pendingResult.sync === "PENDING", "Sync status is PENDING for automatic background retry");

// ─────────────────────────────────────────────────────────────────────────────
// Group 7: Safe Redirect Path Sanitizer (Open Redirect Defense)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 7: Safe Redirect Sanitizer ───────────────────────────");

assert(
  sanitizeRedirectPath("/share-target?share=abc123") === "/share-target?share=abc123",
  "Internal share-target path with token query is preserved"
);
assert(
  sanitizeRedirectPath("/saved-titles-links") === "/saved-titles-links",
  "Standard internal route is preserved"
);

// Attack attempts
assert(sanitizeRedirectPath("//attacker.example/evil") === "/search", "Protocol-relative URL falls back to default");
assert(sanitizeRedirectPath("/\\attacker.example/evil") === "/search", "Backslash evasion falls back to default");
assert(sanitizeRedirectPath("https://attacker.example") === "/search", "Absolute external URL falls back to default");
assert(sanitizeRedirectPath("/login") === "/search", "Looping back to /login falls back to default");
assert(sanitizeRedirectPath(null) === "/search", "Null falls back to default");

console.log("\n══════════════════════════════════════════════════════════════");
console.log(`   TEST RESULT: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
console.log("══════════════════════════════════════════════════════════════\n");

if (failed > 0) {
  process.exit(1);
}
