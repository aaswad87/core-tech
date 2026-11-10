// Regenerates the PWA / Android app icons in public/icons from the CoreTech hex "CT" mark.
// Keep in sync with src/components/brand/logo.tsx and src/app/icon.svg.
// Run: node scripts/generate-icons.mjs   (uses sharp, which ships with Next.js)
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");

const defs = `
  <defs>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#34d399"/>
      <stop offset="1" stop-color="#a3e635"/>
    </linearGradient>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#15231d"/>
      <stop offset="1" stop-color="#050807"/>
    </linearGradient>
    <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;

// The mark on a 64x64 grid: hexagon chip, a C whose top stroke runs into the T's bar, and a glowing node.
const mark = (scale, offset) => `
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="M32 5 L55.4 18.5 L55.4 45.5 L32 59 L8.6 45.5 L8.6 18.5 Z" fill="url(#fill)" stroke="url(#rim)" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M48.5 24.2 H34.8 A11 11 0 1 0 32.5 41.5" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M42 24.2 V37" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>
    <circle cx="42" cy="41.5" r="3.6" fill="#bef264" filter="url(#glow)"/>
  </g>`;

// "any" purpose: the hexagon on a transparent background (matches the site icon).
const standard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}${mark(1, 0)}</svg>`;

// "maskable" purpose: full-bleed background, mark kept inside the 80% safe zone so any
// launcher mask shape (circle, squircle, teardrop) leaves it intact.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}
  <rect width="64" height="64" fill="#050807"/>${mark(0.62, 12.16)}</svg>`;

// iOS draws its own rounded corners, so the apple-touch-icon is a full-bleed square.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}
  <rect width="64" height="64" fill="#050807"/>${mark(0.8, 6.4)}</svg>`;

const targets = [
  { file: "icon-192.png", svg: standard, size: 192 },
  { file: "icon-512.png", svg: standard, size: 512 },
  { file: "maskable-192.png", svg: maskable, size: 192 },
  { file: "maskable-512.png", svg: maskable, size: 512 },
  { file: "apple-touch-icon.png", svg: apple, size: 180 },
];

await mkdir(outDir, { recursive: true });
for (const { file, svg, size } of targets) {
  await sharp(Buffer.from(svg), { density: 1200 }).resize(size, size).png({ compressionLevel: 9 }).toFile(join(outDir, file));
  console.log(`wrote public/icons/${file} (${size}x${size})`);
}
