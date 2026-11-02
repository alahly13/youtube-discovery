import zlib from "node:zlib";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Pure Node.js Standard ZIP Archive Generator (Zero Dependencies)
 * ──────────────────────────────────────────────────────────────────────────
 * Implements standard PKZIP 2.0 format compatible with all operating systems
 * and zip extractors (Windows Explorer, macOS Archive Utility, Linux unzip).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface ZipFileEntry {
  filename: string;
  data: Buffer | string;
}

function crc32(buffer: Buffer): number {
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

export function createZipArchive(files: ZipFileEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const content = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const nameBuf = Buffer.from(file.filename, "utf8");
    const checksum = crc32(content);
    const uncompressedSize = content.length;
    // Deflate content using Node's zlib.deflateRawSync
    const compressed = zlib.deflateRawSync(content);
    const compressedSize = compressed.length;

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);          // version needed
    localHeader.writeUInt16LE(0, 6);           // general purpose flags
    localHeader.writeUInt16LE(8, 8);           // compression method (8 = Deflate)
    localHeader.writeUInt16LE(0, 10);          // file time
    localHeader.writeUInt16LE(0, 12);          // file date
    localHeader.writeUInt32LE(checksum, 14);   // crc-32
    localHeader.writeUInt32LE(compressedSize, 18);   // compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);   // filename length
    localHeader.writeUInt16LE(0, 28);          // extra field length
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressed);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4);          // version made by
    centralHeader.writeUInt16LE(20, 6);          // version needed
    centralHeader.writeUInt16LE(0, 8);           // general purpose flags
    centralHeader.writeUInt16LE(8, 10);          // compression method (8 = Deflate)
    centralHeader.writeUInt16LE(0, 12);          // file time
    centralHeader.writeUInt16LE(0, 14);          // file date
    centralHeader.writeUInt32LE(checksum, 16);   // crc-32
    centralHeader.writeUInt32LE(compressedSize, 20);   // compressed size
    centralHeader.writeUInt32LE(uncompressedSize, 24); // uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28);   // filename length
    centralHeader.writeUInt16LE(0, 30);          // extra field length
    centralHeader.writeUInt16LE(0, 32);          // file comment length
    centralHeader.writeUInt16LE(0, 34);          // disk number start
    centralHeader.writeUInt16LE(0, 36);          // internal file attributes
    centralHeader.writeUInt32LE(0, 38);          // external file attributes
    centralHeader.writeUInt32LE(offset, 42);     // relative offset of local header
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    offset += localHeader.length + compressed.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((acc, h) => acc + h.length, 0);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // signature
  eocd.writeUInt16LE(0, 4);                // disk number
  eocd.writeUInt16LE(0, 6);                // central dir disk
  eocd.writeUInt16LE(files.length, 8);     // total entries on disk
  eocd.writeUInt16LE(files.length, 10);    // total entries overall
  eocd.writeUInt32LE(centralDirSize, 12);  // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16);// central dir offset
  eocd.writeUInt16LE(0, 20);               // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}
