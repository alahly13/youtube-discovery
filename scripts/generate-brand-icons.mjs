/**
 * YouTube Discovery — Official Multi-Platform Icon Generator
 *
 * Generates all production icon variants from the single authoritative
 * source SVG at `public/app-icon.svg`.
 *
 * Outputs:
 * - public/icons/favicon-16x16.png (16x16, transparent, sRGB)
 * - public/icons/favicon-32x32.png (32x32, transparent, sRGB)
 * - public/icons/favicon-48x48.png (48x48, transparent, sRGB)
 * - public/icons/apple-touch-icon.png (180x180, solid #09090d, safe area centered)
 * - public/icons/icon-192x192.png (192x192, transparent, sRGB)
 * - public/icons/icon-512x512.png (512x512, transparent, sRGB)
 * - public/icons/icon-maskable-512x512.png (512x512, solid #09090d, safe area centered)
 * - public/favicon.ico (Multi-resolution ICO: 16, 32, 48)
 * - src/app/favicon.ico (App Router root favicon)
 * - src/app/icon.png (App Router root standard icon 512x512)
 * - src/app/apple-icon.png (App Router root Apple touch icon 180x180)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const SOURCE_SVG = path.join(ROOT_DIR, "public", "app-icon.svg");
const ICONS_DIR = path.join(ROOT_DIR, "public", "icons");
const PUBLIC_FAVICON = path.join(ROOT_DIR, "public", "favicon.ico");
const APP_FAVICON = path.join(ROOT_DIR, "src", "app", "favicon.ico");
const APP_ICON = path.join(ROOT_DIR, "src", "app", "icon.png");
const APP_APPLE_ICON = path.join(ROOT_DIR, "src", "app", "apple-icon.png");

// Brand design tokens
const BRAND_BG_DARK = "#09090d";

// Concurrency tuning for libvips on Windows
sharp.concurrency(1);
sharp.cache(false);

/**
 * Packs multiple PNG buffers into a standard Windows/browser multi-resolution ICO file.
 *
 * @param {Array<{ width: number, height: number, buffer: Buffer }>} images
 * @returns {Buffer}
 */
function createIco(images) {
  const count = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + count * dirEntrySize;

  const totalSize = offset + images.reduce((sum, img) => sum + img.buffer.length, 0);
  const out = Buffer.alloc(totalSize);

  // ICO Header
  out.writeUInt16LE(0, 0); // reserved
  out.writeUInt16LE(1, 2); // 1 = icon
  out.writeUInt16LE(count, 4); // count of images

  let dirOffset = headerSize;
  let dataOffset = offset;

  for (const img of images) {
    out.writeUInt8(img.width >= 256 ? 0 : img.width, dirOffset + 0);
    out.writeUInt8(img.height >= 256 ? 0 : img.height, dirOffset + 1);
    out.writeUInt8(0, dirOffset + 2); // color count (0 = >=8bpp)
    out.writeUInt8(0, dirOffset + 3); // reserved
    out.writeUInt16LE(1, dirOffset + 4); // color planes
    out.writeUInt16LE(32, dirOffset + 6); // bits per pixel
    out.writeUInt32LE(img.buffer.length, dirOffset + 8); // bytes in resource
    out.writeUInt32LE(dataOffset, dirOffset + 12); // image offset

    img.buffer.copy(out, dataOffset);

    dirOffset += dirEntrySize;
    dataOffset += img.buffer.length;
  }

  return out;
}

/**
 * Rasterizes the SVG to a transparent PNG at exact dimensions.
 *
 * @param {Buffer} svgBuffer
 * @param {number} size
 * @returns {Promise<Buffer>}
 */
async function rasterizeTransparent(svgBuffer, size) {
  // Density: calculate to maintain sharp vector rendering
  const density = Math.max(72, Math.round(72 * (size / 400)));
  return sharp(svgBuffer, { density })
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
}

/**
 * Creates a maskable or safe-area icon with solid background and inner padding.
 *
 * @param {Buffer} svgBuffer
 * @param {number} size
 * @param {number} innerScale e.g. 0.75 for safe area
 * @param {string} bgColor hex color e.g. "#09090d"
 * @returns {Promise<Buffer>}
 */
async function rasterizeWithSafeBackground(svgBuffer, size, innerScale, bgColor) {
  const innerSize = Math.round(size * innerScale);
  const density = Math.max(72, Math.round(72 * (innerSize / 400)));

  const innerLogoBuffer = await sharp(svgBuffer, { density })
    .resize(innerSize, innerSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();

  const pad = Math.floor((size - innerSize) / 2);

  // Create solid background canvas and composite inner logo centered
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: bgColor,
    },
  })
    .composite([
      {
        input: innerLogoBuffer,
        top: pad,
        left: pad,
      },
    ])
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
}

async function main() {
  console.log("=== YouTube Discovery Icon Generator ===");

  if (!fs.existsSync(SOURCE_SVG)) {
    throw new Error(`Authoritative source SVG not found at ${SOURCE_SVG}`);
  }

  const svgBuffer = fs.readFileSync(SOURCE_SVG);
  const svgMeta = await sharp(svgBuffer).metadata();
  console.log(`Source SVG verified: width=${svgMeta.width}, height=${svgMeta.height}, format=${svgMeta.format}`);

  fs.mkdirSync(ICONS_DIR, { recursive: true });

  console.log("1. Generating ordinary transparent favicons (16, 32, 48)...");
  const p16 = await rasterizeTransparent(svgBuffer, 16);
  fs.writeFileSync(path.join(ICONS_DIR, "favicon-16x16.png"), p16);

  const p32 = await rasterizeTransparent(svgBuffer, 32);
  fs.writeFileSync(path.join(ICONS_DIR, "favicon-32x32.png"), p32);

  const p48 = await rasterizeTransparent(svgBuffer, 48);
  fs.writeFileSync(path.join(ICONS_DIR, "favicon-48x48.png"), p48);

  console.log("2. Generating multi-resolution favicon.ico (16, 32, 48)...");
  const icoBuffer = createIco([
    { width: 16, height: 16, buffer: p16 },
    { width: 32, height: 32, buffer: p32 },
    { width: 48, height: 48, buffer: p48 },
  ]);
  fs.writeFileSync(PUBLIC_FAVICON, icoBuffer);
  fs.writeFileSync(APP_FAVICON, icoBuffer);

  console.log("3. Generating Apple Touch Icon (180x180, safe area, brand background)...");
  const p180 = await rasterizeWithSafeBackground(svgBuffer, 180, 0.78, BRAND_BG_DARK);
  fs.writeFileSync(path.join(ICONS_DIR, "apple-touch-icon.png"), p180);
  fs.writeFileSync(APP_APPLE_ICON, p180);

  console.log("4. Generating PWA Icons (192x192, 512x512 transparent)...");
  const p192 = await rasterizeTransparent(svgBuffer, 192);
  fs.writeFileSync(path.join(ICONS_DIR, "icon-192x192.png"), p192);

  const p512 = await rasterizeTransparent(svgBuffer, 512);
  fs.writeFileSync(path.join(ICONS_DIR, "icon-512x512.png"), p512);
  fs.writeFileSync(APP_ICON, p512);

  console.log("5. Generating Maskable PWA Icon (512x512, 80% safe zone, brand background)...");
  const pMaskable512 = await rasterizeWithSafeBackground(svgBuffer, 512, 0.75, BRAND_BG_DARK);
  fs.writeFileSync(path.join(ICONS_DIR, "icon-maskable-512x512.png"), pMaskable512);

  console.log("\n=== Verification ===");
  const generatedFiles = [
    { path: "public/app-icon.svg", expectedW: 400, expectedH: 400, format: "svg" },
    { path: "public/icons/favicon-16x16.png", expectedW: 16, expectedH: 16, format: "png" },
    { path: "public/icons/favicon-32x32.png", expectedW: 32, expectedH: 32, format: "png" },
    { path: "public/icons/favicon-48x48.png", expectedW: 48, expectedH: 48, format: "png" },
    { path: "public/icons/apple-touch-icon.png", expectedW: 180, expectedH: 180, format: "png" },
    { path: "public/icons/icon-192x192.png", expectedW: 192, expectedH: 192, format: "png" },
    { path: "public/icons/icon-512x512.png", expectedW: 512, expectedH: 512, format: "png" },
    { path: "public/icons/icon-maskable-512x512.png", expectedW: 512, expectedH: 512, format: "png" },
    { path: "public/favicon.ico", expectedW: null, expectedH: null, format: "ico" },
    { path: "src/app/favicon.ico", expectedW: null, expectedH: null, format: "ico" },
    { path: "src/app/icon.png", expectedW: 512, expectedH: 512, format: "png" },
    { path: "src/app/apple-icon.png", expectedW: 180, expectedH: 180, format: "png" },
  ];

  for (const item of generatedFiles) {
    const fullPath = path.join(ROOT_DIR, item.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing generated file: ${item.path}`);
    }
    const stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      throw new Error(`Empty generated file: ${item.path}`);
    }

    if (item.format !== "ico") {
      const meta = await sharp(fullPath).metadata();
      if (meta.width !== item.expectedW || meta.height !== item.expectedH) {
        throw new Error(
          `Dimension mismatch for ${item.path}: expected ${item.expectedW}x${item.expectedH}, got ${meta.width}x${meta.height}`
        );
      }
      console.log(`[PASS] ${item.path.padEnd(42)} ${meta.width}x${meta.height} (${stat.size} bytes, ${meta.format})`);
    } else {
      // Validate ICO header
      const icoBuf = fs.readFileSync(fullPath);
      const reserved = icoBuf.readUInt16LE(0);
      const type = icoBuf.readUInt16LE(2);
      const count = icoBuf.readUInt16LE(4);
      if (reserved !== 0 || type !== 1 || count !== 3) {
        throw new Error(`Invalid ICO header in ${item.path}: count=${count}, type=${type}`);
      }
      console.log(`[PASS] ${item.path.padEnd(42)} Multi-res ICO [16, 32, 48] (${stat.size} bytes)`);
    }
  }

  console.log("\nAll icon assets successfully generated and verified!");
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
