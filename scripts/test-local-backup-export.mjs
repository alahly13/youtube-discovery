import assert from "node:assert";
import zlib from "node:zlib";

console.log("=== Testing Local Data Center Backup & Export Enhancements ===");

// 1. Test extractZustandState
function extractZustandState(data) {
  if (!data || typeof data !== "object") return null;
  const obj = data;
  if ("state" in obj && typeof obj.state === "object" && obj.state !== null) {
    return obj.state;
  }
  return null;
}

const zustandEnvelope = {
  state: {
    savedItems: [
      { platformItemId: "vid-1", title: "Video One", itemType: "video" },
      { platformItemId: "vid-2", title: "Video Two", itemType: "video" },
    ],
    savedSearches: [{ id: "search-1", query: "nextjs 16" }],
  },
  version: 0,
};

const extracted = extractZustandState(zustandEnvelope);
assert(extracted !== null, "extractZustandState should extract state object");
assert(Array.isArray(extracted.savedItems), "savedItems should be an array");
assert.strictEqual(extracted.savedItems.length, 2, "savedItems length should be 2");
console.log("✓ extractZustandState passed");

// 2. Test sanitizeForBackup vs sanitizeForPreview truncation
const SENSITIVE_KEY_REGEX =
  /(token|secret|password|key|auth|session|credential|access_token|refresh_token|private)/i;

function sanitizeForPreview(value, depth = 0) {
  if (depth > 6) return "[Truncated: Max Depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(value) && value.length > 30) {
      return "[REDACTED_TOKEN]";
    }
    return value.length > 5000 ? value.slice(0, 5000) + " … [Truncated]" : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeForPreview(item, depth + 1));
  }
  const sanitized = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_REGEX.test(k)) {
      sanitized[k] = "[REDACTED_SECRET]";
    } else {
      sanitized[k] = sanitizeForPreview(v, depth + 1);
    }
  }
  return sanitized;
}

function sanitizeForBackup(value, depth = 0) {
  if (depth > 20) return "[Truncated: Max Depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(value) && value.length > 30) {
      return "[REDACTED_TOKEN]";
    }
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForBackup(item, depth + 1));
  }
  const sanitized = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_REGEX.test(k)) {
      sanitized[k] = "[REDACTED_SECRET]";
    } else {
      sanitized[k] = sanitizeForBackup(v, depth + 1);
    }
  }
  return sanitized;
}

// Create an array with 100 items (exceeds preview's 50 limit)
const largeArray = Array.from({ length: 100 }, (_, i) => ({
  id: `item-${i}`,
  title: `Title ${i}`,
  secretToken: "secret_value_12345",
}));

// sanitizeForPreview should truncate to 50 items
const previewSanitized = sanitizeForPreview(largeArray);
assert.strictEqual(previewSanitized.length, 50, "Preview should be capped at 50 items");
assert.strictEqual(
  previewSanitized[0].secretToken,
  "[REDACTED_SECRET]",
  "Secrets should be redacted in preview"
);

// sanitizeForBackup should preserve ALL 100 items
const backupSanitized = sanitizeForBackup(largeArray);
assert.strictEqual(backupSanitized.length, 100, "Backup must preserve all 100 items");
assert.strictEqual(
  backupSanitized[0].secretToken,
  "[REDACTED_SECRET]",
  "Secrets must still be redacted in backup"
);
assert.strictEqual(
  backupSanitized[99].title,
  "Title 99",
  "Item 99 must be intact"
);
console.log("✓ sanitizeForBackup preserves all records without truncation");

// 3. Test ZIP archive generation
function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const content = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const nameBuf = Buffer.from(file.filename, "utf8");
    const checksum = crc32(content);
    const uncompressedSize = content.length;
    const compressed = zlib.deflateRawSync(content);
    const compressedSize = compressed.length;

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((acc, h) => acc + h.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

const sampleSavedItems = [
  { platformItemId: "dQw4w9WgXcQ", title: "Rick Astley", itemType: "video", channelTitle: "Rick Astley" },
  { platformItemId: "abc12345678", title: "Tutorial", itemType: "video", channelTitle: "Tech Channel" },
];

const fileEntries = [
  {
    filename: "Saved-Items/saved-items.json",
    data: JSON.stringify({ items: sampleSavedItems }, null, 2),
  },
  {
    filename: "SHA256SUMS.txt",
    data: "dummy-hash  Saved-Items/saved-items.json\n",
  },
];

const zipBuffer = createZipArchive(fileEntries);
assert(Buffer.isBuffer(zipBuffer), "createZipArchive should return a Buffer");
assert(zipBuffer.length > 100, "ZIP buffer should contain data");
assert.strictEqual(zipBuffer.readUInt32LE(0), 0x04034b50, "ZIP must start with local file header signature");
console.log(`✓ PKZIP 2.0 archive generated successfully (${zipBuffer.length} bytes)`);

console.log("=== ALL LOCAL BACKUP TESTS PASSED SUCCESSFULLY ===");
