// Generates the app icon (app/icon.svg, app/apple-icon.png, public/icon-192.png and
// public/icon-512.png): an original mark, a striped sunset over the bay with a palm and a
// small skyline, in the Miami night palette.
// Run: node scripts/build-icon.mjs
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const NAVY = "#0b1634";
const PINK = "#ff4f8b";
const CYAN = "#3ff5ff";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1250"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>
  <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd36e"/><stop offset="0.55" stop-color="#ff8a5c"/><stop offset="1" stop-color="${PINK}"/></linearGradient>
</defs>
<rect width="512" height="512" rx="96" fill="url(#sky)"/>
<circle cx="256" cy="262" r="150" fill="url(#sun)"/>
<g fill="url(#sky)">
  <rect x="80" y="276" width="352" height="12"/>
  <rect x="80" y="304" width="352" height="16"/>
  <rect x="80" y="336" width="352" height="22"/>
</g>
<g fill="${NAVY}">
  <rect x="120" y="300" width="34" height="112"/>
  <rect x="160" y="262" width="28" height="150"/>
  <rect x="196" y="316" width="40" height="96"/>
  <rect x="300" y="330" width="44" height="82"/>
</g>
<path d="M174 262 V236" stroke="${NAVY}" stroke-width="6"/>
<rect x="56" y="404" width="400" height="56" fill="${NAVY}"/>
<path d="M56 404 H456" stroke="${CYAN}" stroke-width="6" opacity="0.9"/>
<g stroke="${NAVY}" stroke-linecap="round" fill="none">
  <path d="M392 404 Q378 320 406 228" stroke-width="16"/>
  <path d="M406 228 Q352 206 318 246 M406 228 Q462 204 486 246 M406 228 Q388 176 344 168 M406 228 Q432 172 476 176 M406 228 Q414 196 404 150" stroke-width="13"/>
</g>
</svg>
`;
writeFileSync(new URL("../app/icon.svg", import.meta.url), svg);
for (const [file, size] of [
  ["../app/apple-icon.png", 180],
  ["../public/icon-192.png", 192],
  ["../public/icon-512.png", 512],
]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(new URL(file, import.meta.url).pathname);
}
console.log("icons written");
