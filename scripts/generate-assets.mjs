/**
 * generate-assets — rasterises the brand mark into every icon the manifest,
 * favicon chain and social card need.
 *
 * Committed rather than hand-waved so the assets are reproducible:
 *
 *   node scripts/generate-assets.mjs
 *
 * ── One honest compromise ───────────────────────────────────────────────────
 * The site's face is Geist. `sharp` rasterises SVG through librsvg, which
 * resolves fonts through the system font stack and cannot see the Geist files
 * sitting in node_modules. So the social card is set in the *documented
 * fallback* face from DESIGN.md rather than in Geist. That is a deliberate
 * downgrade confined to one PNG — every rendered page still gets real Geist.
 * Everything else here is pure geometry and is therefore exact.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const icons = join(pub, "icons");

const INK = "#171717";
const CANVAS = "#ffffff";
const BODY = "#4d4d4d";
const MUTE = "#888888";
const HAIRLINE = "#ebebeb";

/**
 * The mark: a 3x3 pixel grid with the centre cell missing.
 *
 * Chosen because it survives 16px. At favicon size the eight surviving cells
 * read as a ring, which is unmistakable and unlike anything else in a tab bar;
 * at 512px the outlined gap makes the meaning explicit. The gap is a real hole
 * rather than a dark fill, so it works on any background.
 */
function markCells({ size, gap, radius, x, y, fill, gapStroke }) {
  const step = size + gap;
  const parts = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const cx = x + col * step;
      const cy = y + row * step;
      const isCentre = row === 1 && col === 1;
      if (isCentre) {
        if (gapStroke) {
          // Inset by half the stroke so the outline stays inside the cell box.
          const w = size - gapStroke;
          parts.push(
            `<rect x="${cx + gapStroke / 2}" y="${cy + gapStroke / 2}" width="${w}" height="${w}" rx="${Math.max(radius - gapStroke / 2, 0)}" fill="none" stroke="${fill}" stroke-opacity="0.32" stroke-width="${gapStroke}"/>`,
          );
        }
        continue;
      }
      parts.push(
        `<rect x="${cx}" y="${cy}" width="${size}" height="${size}" rx="${radius}" fill="${fill}"/>`,
      );
    }
  }
  return parts.join("");
}

/** App icon: ink field, white grid, edge-to-edge. */
function appIconSvg(px, { maskable = false } = {}) {
  // Maskable icons are cropped to the inner 80% circle by the platform, so the
  // mark shrinks into the safe zone while the ink field stays full bleed.
  const scale = maskable ? 0.6 : 1;
  const cell = 72 * scale;
  const gap = 20 * scale;
  const grid = cell * 3 + gap * 2;
  const origin = (512 - grid) / 2;

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 512 512">
       <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="${INK}"/>
       ${markCells({
         size: cell,
         gap,
         radius: 10 * scale,
         x: origin,
         y: origin,
         fill: "#ffffff",
         gapStroke: 6 * scale,
       })}
     </svg>`,
  );
}

/** Favicon: transparent field, so it inverts with the browser's colour scheme. */
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <g class="mark">
${markCells({ size: 128, gap: 32, radius: 18, x: 32, y: 32, fill: "currentColor", gapStroke: 0 })
  .replace(/fill="currentColor"/g, 'fill="var(--mark)"')
  .split("<rect")
  .filter(Boolean)
  .map((s) => `    <rect${s}`)
  .join("\n")}
  </g>
  <style>
    svg { --mark: #171717; }
    @media (prefers-color-scheme: dark) { svg { --mark: #ffffff; } }
  </style>
</svg>
`;

/**
 * The social card.
 *
 * The mesh gradient is DESIGN.md's whole decorative system and is hero-scale
 * only — a 1200x630 card is hero scale, so it belongs here, at full size and
 * in full colour. Three overlapping radials, never flattened to one hue.
 */
function ogSvg() {
  // Value ramp then hue wheel: the exact sRGB fills the site actually paints.
  const swatches = [
    "#000000",
    "#1f1f1f",
    "#404040",
    "#808080",
    "#bfbfbf",
    "#ffffff",
    "#ff0000",
    "#ffff00",
    "#00ff00",
    "#00ffff",
    "#0000ff",
    "#ff00ff",
  ];
  const swW = 1200 / swatches.length;

  const cell = 26;
  const gap = 8;
  const gridOrigin = 72;

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="m1" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#7928ca" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#7928ca" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="m2" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ff0080" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="#ff0080" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="m3" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0070f3" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#0070f3" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="${CANVAS}"/>
  <ellipse cx="1060" cy="90"  rx="420" ry="330" fill="url(#m1)"/>
  <ellipse cx="1210" cy="330" rx="360" ry="300" fill="url(#m2)"/>
  <ellipse cx="900"  cy="-40" rx="380" ry="260" fill="url(#m3)"/>

  <rect x="${gridOrigin}" y="64" width="112" height="112" rx="24" fill="${INK}"/>
  ${markCells({
    size: cell,
    gap,
    radius: 4,
    x: gridOrigin + (112 - (cell * 3 + gap * 2)) / 2,
    y: 64 + (112 - (cell * 3 + gap * 2)) / 2,
    fill: "#ffffff",
    gapStroke: 2,
  })}

  <text x="${gridOrigin}" y="316" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
        font-size="88" font-weight="600" letter-spacing="-3.6" fill="${INK}">Dead Pixel Test</text>

  <text x="${gridOrigin}" y="376" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
        font-size="30" font-weight="400" letter-spacing="-0.4" fill="${BODY}">Find dead pixels, backlight bleed and panel faults in your browser.</text>
  <text x="${gridOrigin}" y="420" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
        font-size="30" font-weight="400" letter-spacing="-0.4" fill="${BODY}">13 tests. No account, no upload, works offline.</text>

  <text x="${gridOrigin}" y="530" font-family="Consolas, SF Mono, Menlo, monospace"
        font-size="24" letter-spacing="0.6" fill="${MUTE}">deadpixeltest.space</text>

  <rect x="0" y="588" width="1200" height="1" fill="${HAIRLINE}"/>
  ${swatches
    .map(
      (hex, i) =>
        `<rect x="${i * swW}" y="589" width="${swW + 0.5}" height="41" fill="${hex}"/>`,
    )
    .join("\n  ")}
</svg>`,
  );
}

/**
 * Wrap a PNG in an ICO container.
 *
 * PNG-compressed ICO entries have been supported since Windows Vista and by
 * every browser that still matters, so one 32px entry is enough — the SVG
 * favicon serves everything modern, and this is the fallback beneath it.
 */
function pngToIco(png) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(1, 4); // one image

  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); // width
  entry.writeUInt8(32, 1); // height
  entry.writeUInt8(0, 2); // palette size (0 = truecolour)
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(dir.length + entry.length, 12);

  return Buffer.concat([dir, entry, png]);
}

await mkdir(icons, { recursive: true });

const written = [];

async function emit(path, data) {
  await writeFile(path, data);
  written.push(`${path.replace(root + "\\", "").replace(root + "/", "")}  ${data.length} bytes`);
}

// App icons.
for (const px of [192, 512]) {
  await emit(
    join(icons, `icon-${px}.png`),
    await sharp(appIconSvg(px)).resize(px, px).png({ compressionLevel: 9 }).toBuffer(),
  );
}
await emit(
  join(icons, "maskable-512.png"),
  await sharp(appIconSvg(512, { maskable: true }))
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

// Favicons.
await emit(join(pub, "favicon.svg"), Buffer.from(faviconSvg, "utf8"));
const fav32 = await sharp(appIconSvg(32)).resize(32, 32).png({ compressionLevel: 9 }).toBuffer();
await emit(join(pub, "favicon.ico"), pngToIco(fav32));

// Social card.
await emit(
  join(pub, "og.png"),
  await sharp(ogSvg()).png({ compressionLevel: 9 }).toBuffer(),
);

console.log(written.join("\n"));
