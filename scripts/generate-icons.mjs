// Regenerates the PWA / Android app icons in public/icons from the CoreTech logo mark.
// Run: node scripts/generate-icons.mjs   (uses sharp, which ships with Next.js)
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");

const gradient = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#059669"/>
      <stop offset="1" stop-color="#65a30d"/>
    </linearGradient>
  </defs>`;

const mark = (scale, offset) => `
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="M21.5 10.5a8 8 0 1 0 0 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
    <circle cx="16" cy="16" r="2.75" fill="#bef264"/>
  </g>`;

// "any" purpose: rounded tile, transparent corners (matches the site icon).
const standard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${gradient}
  <rect width="32" height="32" rx="9" fill="url(#g)"/>${mark(1, 0)}</svg>`;

// "maskable" purpose: full-bleed background, mark kept inside the 80% safe zone so any
// launcher mask shape (circle, squircle, teardrop) leaves it intact.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${gradient}
  <rect width="32" height="32" fill="url(#g)"/>${mark(0.6, 6.4)}</svg>`;

// iOS draws its own rounded corners, so the apple-touch-icon is a full-bleed square.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${gradient}
  <rect width="32" height="32" fill="url(#g)"/>${mark(0.78, 3.5)}</svg>`;

const targets = [
  { file: "icon-192.png", svg: standard, size: 192 },
  { file: "icon-512.png", svg: standard, size: 512 },
  { file: "maskable-192.png", svg: maskable, size: 192 },
  { file: "maskable-512.png", svg: maskable, size: 512 },
  { file: "apple-touch-icon.png", svg: apple, size: 180 },
];

await mkdir(outDir, { recursive: true });
for (const { file, svg, size } of targets) {
  await sharp(Buffer.from(svg), { density: 2400 }).resize(size, size).png({ compressionLevel: 9 }).toFile(join(outDir, file));
  console.log(`wrote public/icons/${file} (${size}x${size})`);
}
