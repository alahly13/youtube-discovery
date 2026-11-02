import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import type { BlobBackend, BlobObjectMeta } from "../blob/blob-backend";
import { BlobConflictError, BlobNotFoundError } from "../blob/blob-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Disk Storage Backend — Safe Local Filesystem Adapter
 * ──────────────────────────────────────────────────────────────────────────
 * - Persists structured files to `data/storage/`.
 * - Acts as an automatic fallback when Supabase Storage credentials are not set.
 * - Ensures all personal playlists, saved search history, and settings
 *   remain 100% operational in offline/local environments.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class DiskStorageBackend implements BlobBackend {
  private baseDir: string;

  constructor(baseDir = path.join(process.cwd(), "data", "storage")) {
    this.baseDir = baseDir;
  }

  private resolvePath(pathname: string): string {
    const clean = pathname.replace(/^\/+/, "").replace(/\.\./g, "");
    return path.join(this.baseDir, clean);
  }

  async getBytes(pathname: string): Promise<Buffer> {
    const fullPath = this.resolvePath(pathname);
    try {
      return await fs.readFile(fullPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new BlobNotFoundError(pathname);
      }
      throw err;
    }
  }

  async head(pathname: string): Promise<BlobObjectMeta | null> {
    const fullPath = this.resolvePath(pathname);
    try {
      const stats = await fs.stat(fullPath);
      return {
        pathname,
        size: stats.size,
        etag: `disk_${stats.mtimeMs}_${stats.size}`,
        uploadedAt: stats.mtime.toISOString(),
      };
    } catch {
      return null;
    }
  }

  async putBytes(
    pathname: string,
    data: Buffer,
    options?: {
      allowOverwrite?: boolean;
      ifMatch?: string;
      contentType?: string;
      cacheSeconds?: number;
    }
  ): Promise<BlobObjectMeta> {
    const fullPath = this.resolvePath(pathname);
    const allowOverwrite = options?.allowOverwrite ?? true;

    if (!allowOverwrite) {
      const exists = await this.head(pathname);
      if (exists) {
        throw new BlobConflictError(`Disk write conflict: file already exists at ${pathname}`);
      }
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);

    const stats = await fs.stat(fullPath);
    return {
      pathname,
      size: stats.size,
      etag: `disk_${stats.mtimeMs}_${stats.size}`,
      uploadedAt: stats.mtime.toISOString(),
    };
  }

  async delete(pathname: string): Promise<void> {
    const fullPath = this.resolvePath(pathname);
    try {
      await fs.unlink(fullPath);
    } catch {
      // Ignored if missing
    }
  }

  async list(prefix: string): Promise<BlobObjectMeta[]> {
    const targetDir = this.resolvePath(prefix);
    const results: BlobObjectMeta[] = [];

    async function walk(dir: string, base: string) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const res = path.resolve(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(res, base);
          } else {
            const stats = await fs.stat(res);
            const relative = path.relative(base, res).replace(/\\/g, "/");
            results.push({
              pathname: relative,
              size: stats.size,
              etag: `disk_${stats.mtimeMs}_${stats.size}`,
              uploadedAt: stats.mtime.toISOString(),
            });
          }
        }
      } catch {
        // Missing dir returns empty list
      }
    }

    await walk(targetDir, this.baseDir);
    return results;
  }
}
