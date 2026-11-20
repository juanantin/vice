// Generates the favicon and app icons: app/icon.svg (browser tab), app/favicon.ico (16/32/48),
// app/apple-icon.png and public/icon-192.png / icon-512.png. Original mark in the Miami night
// palette: a big striped sunset over a neon horizon with one bold palm. Shapes are chunky so the
// mark still reads at 16 px in a browser tab.
// Run: node scripts/build-icon.mjs
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const NAVY = "#0b1634";
const PINK = "#ff4f8b";
const CYAN = "#3ff5ff";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a1466"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>
  <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="0.5" stop-color="#ff8a4c"/><stop offset="1" stop-color="${PINK}"/></linearGradient>
</defs>
<rect width="64" height="64" rx="14" fill="url(#bg)"/>
<circle cx="32" cy="33" r="23" fill="url(#sun)"/>
<rect x="4" y="38" width="56" height="3" fill="#2a1250"/>
<rect x="4" y="44" width="56" height="3.6" fill="#1c1442"/>
<rect x="0" y="50" width="64" height="14" fill="${NAVY}"/>
<rect x="6" y="49" width="52" height="2.4" rx="1.2" fill="${CYAN}"/>
<g stroke="${NAVY}" stroke-linecap="round" fill="none">
  <path d="M44 51 Q40 36 41 22" stroke-width="4.4"/>
  <path d="M41 22 Q32 18 25 26 M41 22 Q50 17 56 25 M41 22 Q37 12 28 12 M41 22 Q46 11 55 13" stroke-width="4"/>
</g>
</svg>
`;
writeFileSync(new URL("../app/icon.svg", import.meta.url), svg);

const png = (size) => sharp(Buffer.from(svg), { density: Math.max(72, (72 * size) / 64) * 2 }).resize(size, size).png().toBuffer();

// favicon.ico holding PNG images (supported by every current browser).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
writeFileSync(new URL("../app/favicon.ico", import.meta.url), Buffer.concat([header, ...images]));

for (const [file, size] of [
  ["../app/apple-icon.png", 180],
  ["../public/icon-192.png", 192],
  ["../public/icon-512.png", 512],
]) {
  writeFileSync(new URL(file, import.meta.url), await png(size));
}
console.log("icons written: icon.svg, favicon.ico, apple-icon.png, icon-192.png, icon-512.png");
