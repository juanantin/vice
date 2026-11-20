// Map art drawn with PixiJS Graphics: an isometric Miami at night (neon linework, glowing
// windows) or at golden hour. Every drawing here is original. Each district keeps its own ink
// on roofs, signs and tops. Height floors are procedural so levels have no cap.

import { Graphics } from "pixi.js";
import { DISTRICTS } from "./config";
import type { Theme } from "./theme";

/** Palette by role. Dark = Miami night: deep navy bay, violet land, neon-pink linework, cyan
 *  shoreline glow. Light = golden hour: teal bay, warm sand, cream stucco with plum outlines.
 *  (Role names come from the older Volta theme: `mint` is the linework, `void` the sea.) */
const PALETTES = {
  dark: {
    void: 0x0b1634, // sea
    plate: 0x2a1640, // shaded faces
    forest: 0x221838, // land
    panel: 0x3a2350, // lit faces
    panel2: 0x45295c,
    emerald: 0x6b3a7a,
    mint: 0xff6fae, // linework
    ivory: 0xfff0f6,
    muted: 0xc79ac0,
    cliff: 0x100a20,
    shadow: 0x000000,
    shadowAlpha: 0.35,
    lineAlpha: 0.07,
    surf: 0x3ff5ff, // shoreline glow
    road: 0x3ff5ff, // expressways and causeways
    street: 0xff6fae, // boulevards
    glass: 0x2e4f8a,
    glow: 0xffd36e, // lit windows
    palm: 0x2fd3a0,
    trunk: 0x8a5f7a,
    pool: 0x3fd9f5,
    sand: 0x3a2a48,
    ornate: false,
  },
  light: {
    void: 0x27b4c3,
    plate: 0xefc0ae,
    forest: 0xf8dfbd,
    panel: 0xfff6ea,
    panel2: 0xfde9d6,
    emerald: 0xd29a78,
    mint: 0x5b2340,
    ivory: 0x2a0f22,
    muted: 0x8a5a6e,
    cliff: 0xd9a27c,
    shadow: 0x5b2340,
    shadowAlpha: 0.14,
    lineAlpha: 0.12,
    surf: 0xffffff,
    road: 0xffffff,
    street: 0xfff3e2,
    glass: 0x8fd6e8,
    glow: 0xfff6ea,
    palm: 0x2e9a6a,
    trunk: 0x9a6a4a,
    pool: 0x3fc6e0,
    sand: 0xfbe8c8,
    ornate: false,
  },
};

export const V = { ...PALETTES.dark };
let artTheme: Theme = "dark";

export function applyArtTheme(t: Theme) {
  artTheme = t;
  Object.assign(V, PALETTES[t]);
}

/** A city's ink for the current theme (light mode uses its darker ink). */
export function cityInk(d: number): number {
  const D = DISTRICTS[d];
  return hex(artTheme === "light" ? D.dark : D.colour);
}

const OUTLINE = {
  width: 1.2,
  get color() {
    return V.mint;
  },
  join: "round" as const,
};
const FINE = {
  width: 0.6,
  get color() {
    return V.mint;
  },
  alpha: 0.45,
};

const hex = (c: string) => parseInt(c.slice(1), 16);

export function mix(a: number, b: number, t: number): number {
  const ar = a >> 16, ag = (a >> 8) & 255, ab = a & 255;
  const br = b >> 16, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)
  );
}

export interface Palette {
  lit: number;
  shade: number;
  top: number;
  roof: number;
  roofShade: number;
  window: number;
  accent: number;
}

/** Walls share one palette in every district; the district's ink colours roofs, tops and signs. */
export function districtPalette(d: number): Palette {
  const ink = cityInk(d);
  return {
    lit: V.panel,
    shade: V.plate,
    top: mix(ink, V.forest, 0.55),
    roof: mix(ink, V.forest, 0.35),
    roofShade: mix(ink, V.plate, 0.6),
    window: V.glow,
    accent: ink,
  };
}

export function mayorPalette(): Palette {
  return {
    lit: mix(V.panel, V.mint, 0.08),
    shade: mix(V.plate, V.mint, 0.04),
    top: mix(V.forest, V.mint, 0.18),
    roof: mix(V.mint, V.forest, 0.25),
    roofShade: mix(V.mint, V.plate, 0.55),
    window: V.ivory,
    accent: V.mint,
  };
}

const FLOOR_H = 5;
const GROUND_H = 9;

/** Vertical engraving lines across a parallelogram face (bottom edge p0→p1, height h). */
function hatchFace(g: Graphics, x0: number, y0: number, x1: number, y1: number, h: number, step: number) {
  const n = Math.floor(Math.abs(x1 - x0) / step);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    g.moveTo(x, y).lineTo(x, y - h);
  }
  if (n > 1) g.stroke(FINE);
}

/** Isometric box: footprint half-width `a`, ground at y = -base, `h` tall. */
function box(g: Graphics, a: number, base: number, h: number, p: Palette, windows: boolean) {
  const b = -base;
  g.poly([-a, b, 0, b + a / 2, 0, b + a / 2 - h, -a, b - h]).fill(p.lit).stroke(OUTLINE);
  g.poly([0, b + a / 2, a, b, a, b - h, 0, b + a / 2 - h]).fill(p.shade).stroke(OUTLINE);
  hatchFace(g, 0, b + a / 2, a, b, h, 1.6);
  if (!windows) return;
  const floors = Math.max(1, Math.floor((h - GROUND_H) / FLOOR_H) + 1);
  for (let k = 0; k < floors; k++) {
    const v0 = k === 0 ? 2.5 : GROUND_H + (k - 1) * FLOOR_H + 1.3;
    const v1 = v0 + (k === 0 ? 4 : 2.6);
    for (const [u0, u1] of [
      [0.22, 0.42],
      [0.58, 0.78],
    ]) {
      g.poly([
        -a + u0 * a, b + (u0 * a) / 2 - v0,
        -a + u1 * a, b + (u1 * a) / 2 - v0,
        -a + u1 * a, b + (u1 * a) / 2 - v1,
        -a + u0 * a, b + (u0 * a) / 2 - v1,
      ]).fill({ color: p.window, alpha: 0.85 });
      g.poly([
        u0 * a, b + a / 2 - (u0 * a) / 2 - v0,
        u1 * a, b + a / 2 - (u1 * a) / 2 - v0,
        u1 * a, b + a / 2 - (u1 * a) / 2 - v1,
        u0 * a, b + a / 2 - (u0 * a) / 2 - v1,
      ]).fill({ color: p.window, alpha: 0.35 });
    }
  }
}

function topDiamond(g: Graphics, a: number, y: number, color: number) {
  g.poly([-a, y, 0, y + a / 2, a, y, 0, y - a / 2]).fill(color).stroke(OUTLINE);
}

function shadow(g: Graphics, a: number) {
  g.ellipse(3, 2, a + 4, a / 2 + 3).fill({ color: V.shadow, alpha: V.shadowAlpha });
}

/** Ground floor plus one floor per level above 1 (no cap). */
export function floorsForLevel(level: number) {
  return level;
}

export function heightForLevel(level: number) {
  return GROUND_H + (level - 1) * FLOOR_H;
}

/** Lit windows: a warm glow at night, pale glass by day. */
function glassPalette(p: Palette): Palette {
  return { ...p, lit: mix(V.glass, V.panel, 0.45), shade: mix(V.glass, V.plate, 0.7), window: V.glow };
}

/** Thin horizontal floor lines across both faces of a box (glass curtain walls). */
function floorLines(g: Graphics, a: number, base: number, h: number, step: number) {
  for (let v = step; v < h - 1; v += step) {
    const y = -base - v;
    g.moveTo(-a, y).lineTo(0, y + a / 2).lineTo(a, y);
  }
  g.stroke(FINE);
}

/** A small palm, drawn at (x, y) ground point, `s` = size. */
function palm(g: Graphics, x: number, y: number, s: number) {
  g.moveTo(x, y).quadraticCurveTo(x - 1.5 * s, y - 7 * s, x + 1 * s, y - 13 * s).stroke({ width: 1.3 * s, color: V.trunk, cap: "round" });
  const tx = x + 1 * s;
  const ty = y - 13 * s;
  for (const [dx, dy] of [
    [-7, 2],
    [-5, -3],
    [0, -5],
    [5, -3],
    [7, 2.5],
    [2, 4],
  ]) {
    g.moveTo(tx, ty).quadraticCurveTo(tx + dx * 0.6 * s, ty + (dy - 3) * s, tx + dx * s, ty + dy * s);
  }
  g.stroke({ width: 1.4 * s, color: V.palm, cap: "round" });
}

export function drawBuilding(g: Graphics, district: number, style: number, level: number) {
  const p = districtPalette(district);
  const h = heightForLevel(level);
  if (style === 0) {
    // Glass tower: slim, curtain-wall floors, a crown in the district's ink and a beacon.
    const a = 8;
    const hh = h + 14;
    shadow(g, a);
    box(g, a, 0, hh, glassPalette(p), true);
    floorLines(g, a, 0, hh, 2.5);
    g.moveTo(-a, -hh).lineTo(-a, 0).stroke({ width: 1.4, color: p.accent, alpha: 0.9 });
    topDiamond(g, a, -hh, p.top);
    box(g, a * 0.55, hh, 4, { ...p, lit: p.roof, shade: p.roofShade }, false);
    g.moveTo(1, -hh - 5).lineTo(1, -hh - 13).stroke({ width: 1, color: V.mint });
    g.circle(1, -hh - 14, 1.6).fill(p.accent);
  } else if (style === 1) {
    // Art Deco block: ink "eyebrow" ledges, a stepped parapet and a neon fin on top.
    const a = 10;
    shadow(g, a);
    box(g, a, 0, h, p, true);
    for (let v = 9; v < h; v += 10) {
      g.poly([-a, -v, 0, a / 2 - v, 0, a / 2 - v - 1.2, -a, -v - 1.2]).fill({ color: p.accent, alpha: 0.85 });
      g.poly([0, a / 2 - v, a, -v, a, -v - 1.2, 0, a / 2 - v - 1.2]).fill({ color: p.accent, alpha: 0.5 });
    }
    topDiamond(g, a, -h, p.top);
    box(g, a * 0.62, h, 3, p, false);
    topDiamond(g, a * 0.62, -h - 3, p.top);
    // the fin: a tall sign standing on the lit face
    g.poly([-3.5, -h - 3, -1.5, -h - 2, -1.5, -h - 15, -3.5, -h - 16]).fill(p.accent).stroke({ width: 0.8, color: V.ivory });
  } else {
    // Low-rise with a rooftop pool and a palm.
    const a = 11;
    const hh = Math.max(7, h - 2);
    shadow(g, a);
    box(g, a, 0, hh, p, true);
    topDiamond(g, a, -hh, p.top);
    g.poly([-a * 0.7, -hh, -a * 0.1, -hh + a * 0.3, a * 0.35, -hh + a * 0.07, -a * 0.25, -hh - a * 0.23]).fill(V.pool).stroke({ width: 0.7, color: V.ivory, alpha: 0.8 });
    g.poly([a * 0.15, -hh - a * 0.32, a * 0.7, -hh - a * 0.05, a * 0.55, -hh + a * 0.02, 0, -hh - a * 0.25]).fill(p.accent);
    palm(g, a * 0.55, -hh + 1, 0.55);
  }
}

/** Building #0, the Mayor's: a civic Art Deco hall on Watson Island with a flag. */
export function drawMayor(g: Graphics) {
  const p = mayorPalette();
  const a = 24;
  shadow(g, a);
  box(g, a + 4, 0, 5, { ...p, lit: V.forest, shade: V.plate }, false);
  topDiamond(g, a + 4, -5, V.panel);
  box(g, a, 5, 22, p, true);
  // pilasters on the lit face
  for (let i = 0; i < 5; i++) {
    const u = 0.1 + i * 0.2;
    const x = -a + u * a;
    const yb = -5 + (u * a) / 2;
    g.rect(x - 1, yb - 22, 2, 22).fill({ color: V.ivory, alpha: 0.5 });
  }
  topDiamond(g, a, -27, p.top);
  // stepped deco tower in the middle
  box(g, a * 0.5, 27, 12, p, true);
  topDiamond(g, a * 0.5, -39, p.top);
  box(g, a * 0.3, 39, 8, { ...p, lit: p.roof, shade: p.roofShade }, false);
  topDiamond(g, a * 0.3, -47, p.roof);
  g.moveTo(0, -47).lineTo(0, -66).stroke({ width: 1.4, color: V.mint });
  // flag: an original orange / white / green pennant
  g.rect(0, -66, 16, 3).fill(0xff8a4c);
  g.rect(0, -63, 16, 3).fill(0xfff6ea);
  g.rect(0, -60, 16, 3).fill(0x2fbf7a);
  g.rect(0, -66, 16, 9).stroke({ width: 0.8, color: V.mint });
  palm(g, -a - 6, 4, 1);
  palm(g, a + 4, 6, 1.1);
}

/** Brickell: a cluster of glass towers, one with a crown, joined by a sky bridge. */
export function drawGlassTowers(g: Graphics) {
  const ink = cityInk(0);
  const p = glassPalette(districtPalette(0));
  g.ellipse(4, 6, 40, 16).fill({ color: V.shadow, alpha: V.shadowAlpha });
  const tower = (x: number, y: number, a: number, h: number, crown: boolean) => {
    g.save().translateTransform(x, y);
    box(g, a, 0, h, p, true);
    floorLines(g, a, 0, h, 3);
    g.moveTo(a, -h).lineTo(a, 0).stroke({ width: 1.2, color: ink, alpha: 0.8 });
    topDiamond(g, a, -h, mix(ink, V.forest, 0.5));
    if (crown) {
      g.poly([-a, -h, 0, -h + a / 2, 0, -h - 18]).fill(mix(ink, V.forest, 0.3)).stroke(OUTLINE);
      g.poly([0, -h + a / 2, a, -h, 0, -h - 18]).fill(mix(ink, V.plate, 0.55)).stroke(OUTLINE);
      g.moveTo(0, -h - 18).lineTo(0, -h - 28).stroke({ width: 1, color: V.mint });
      g.circle(0, -h - 29, 1.8).fill(V.ivory);
    }
    g.restore();
  };
  tower(-16, -4, 10, 74, false);
  tower(8, -8, 11, 104, true);
  // sky bridge between the two front towers
  g.poly([-6, -60, 2, -56, 2, -52, -6, -56]).fill(ink).stroke({ width: 0.7, color: V.ivory });
  tower(-4, 10, 9, 58, false);
  tower(22, 8, 8, 66, false);
}

/** Downtown: a Mediterranean-revival tower with a tiered top and a cupola, beside a low arena. */
export function drawFreedomTower(g: Graphics) {
  const ink = cityInk(1);
  const p: Palette = { ...districtPalette(1), lit: V.panel2, shade: V.plate, top: V.panel };
  g.ellipse(6, 4, 44, 16).fill({ color: V.shadow, alpha: V.shadowAlpha });
  // the arena: a wide low drum with a light roof
  g.save().translateTransform(18, 12);
  g.ellipse(0, 0, 26, 12).fill(V.plate).stroke(OUTLINE);
  g.rect(-26, -10, 52, 10).fill(V.panel).stroke({ width: 0, color: V.mint });
  g.moveTo(-26, -10).lineTo(-26, 0).moveTo(26, -10).lineTo(26, 0).stroke(OUTLINE);
  g.arc(0, 0, 26, 0, Math.PI).stroke(OUTLINE);
  g.ellipse(0, -10, 26, 12).fill(mix(ink, V.forest, 0.45)).stroke(OUTLINE);
  g.ellipse(0, -11, 18, 8).stroke({ width: 1, color: V.ivory, alpha: 0.6 });
  g.restore();
  // the tower
  g.save().translateTransform(-12, 0);
  box(g, 16, 0, 18, p, true);
  topDiamond(g, 16, -18, p.top);
  box(g, 8, 18, 40, p, true);
  for (const v of [30, 44]) {
    g.poly([-8, -v, 0, 4 - v, 0, 2.8 - v, -8, -v - 1.2]).fill({ color: ink, alpha: 0.8 });
    g.poly([0, 4 - v, 8, -v, 8, -v - 1.2, 0, 2.8 - v]).fill({ color: ink, alpha: 0.45 });
  }
  topDiamond(g, 8, -58, p.top);
  box(g, 5.5, 58, 9, p, false);
  // arched openings on the belfry
  g.poly([-4, -61, -1.5, -60, -1.5, -64, -4, -65]).fill(V.void);
  topDiamond(g, 5.5, -67, p.top);
  g.ellipse(0, -70, 4.5, 4.5).fill(mix(ink, V.forest, 0.35)).stroke(OUTLINE);
  g.moveTo(0, -74.5).lineTo(0, -82).stroke({ width: 1, color: V.mint });
  g.circle(0, -83, 1.6).fill(V.glow);
  g.restore();
}

/** Wynwood: painted warehouses (original abstract murals) and a water tower. */
export function drawMurals(g: Graphics) {
  const ink = cityInk(2);
  const paint = [ink, 0xff5fa2, 0x3fd9f5, 0xffd36e, 0x9b6bff];
  g.ellipse(4, 6, 46, 16).fill({ color: V.shadow, alpha: V.shadowAlpha });
  const shed = (x: number, y: number, a: number, h: number, seed: number) => {
    g.save().translateTransform(x, y);
    box(g, a, 0, h, { ...districtPalette(2), lit: V.panel, shade: V.plate }, false);
    // mural on the lit face: zigzags and dots in spray-paint colours
    for (let i = 0; i < 6; i++) {
      const c = paint[(i + seed) % paint.length];
      const u0 = i / 6;
      const u1 = (i + 1) / 6;
      const y0 = -2 - ((i + seed) % 3) * 3;
      g.poly([
        -a + u0 * a, (u0 * a) / 2 + y0,
        -a + u1 * a, (u1 * a) / 2 + y0 - 4,
        -a + u1 * a, (u1 * a) / 2 - h + 3,
        -a + u0 * a, (u0 * a) / 2 - h + 6,
      ]).fill({ color: c, alpha: 0.85 });
    }
    g.circle(-a / 2, -h / 2 + a / 4, 2.6).fill(V.ivory);
    g.poly([-a, 0, 0, a / 2, 0, a / 2 - h, -a, -h]).stroke(OUTLINE);
    // sawtooth roof
    for (let k = 0; k < 3; k++) {
      const u = k / 3;
      const bx = -a + u * a + (u * a) / 2 * 0 + a / 2;
      const by = -h - a / 2 + (u * a) / 2 + a / 4;
      g.poly([bx - a / 3, by, bx, by - 5, bx, by + a / 6]).fill(V.panel2).stroke({ width: 0.8, color: V.mint });
    }
    topDiamond(g, a, -h, mix(V.forest, V.panel, 0.5));
    g.restore();
  };
  shed(-14, -6, 18, 16, 0);
  shed(16, 6, 16, 13, 2);
  // water tower on stilts
  g.save().translateTransform(-6, -30);
  for (const dx of [-5, 5]) g.moveTo(dx, 12).lineTo(dx * 0.6, 0).stroke({ width: 1, color: V.mint });
  g.rect(-6, -10, 12, 10).fill(mix(ink, V.forest, 0.4)).stroke(OUTLINE);
  g.ellipse(0, 0, 6, 2).fill(mix(ink, V.plate, 0.5)).stroke(OUTLINE);
  g.poly([-7, -10, 7, -10, 0, -16]).fill(V.panel2).stroke(OUTLINE);
  g.restore();
}

/** Miami Beach: an Art Deco hotel with a neon fin, palms and a striped lifeguard tower. */
export function drawDecoHotel(g: Graphics) {
  const ink = cityInk(3);
  const pastel = [0xf7b2c4, 0xa8e6cf, 0xffe29a];
  const p: Palette = { ...districtPalette(3), lit: mix(pastel[0], V.panel, 0.55), shade: mix(pastel[0], V.plate, 0.75) };
  g.ellipse(4, 4, 46, 16).fill({ color: V.shadow, alpha: V.shadowAlpha });
  // hotel
  g.save().translateTransform(-10, -4);
  box(g, 20, 0, 30, p, true);
  for (const v of [10, 20]) {
    g.poly([-20, -v, 0, 10 - v, 0, 8.6 - v, -20, -v - 1.4]).fill({ color: ink, alpha: 0.9 });
    g.poly([0, 10 - v, 20, -v, 20, -v - 1.4, 0, 8.6 - v]).fill({ color: ink, alpha: 0.5 });
  }
  topDiamond(g, 20, -30, p.top);
  box(g, 10, 30, 6, p, false);
  topDiamond(g, 10, -36, p.top);
  // neon fin with the sign
  g.poly([-11, -26, -7, -24, -7, -54, -11, -56]).fill(V.forest).stroke({ width: 1.2, color: ink });
  for (let k = 0; k < 4; k++) g.circle(-9, -30 - k * 6.5, 1.3).fill(ink);
  g.restore();
  // lifeguard tower: stilts, a pastel hut, a striped roof, a ramp
  g.save().translateTransform(26, 12);
  for (const dx of [-5, 5]) g.moveTo(dx, 0).lineTo(dx * 0.8, -10).stroke({ width: 1.1, color: V.mint });
  g.moveTo(-12, 4).lineTo(-5, -10).stroke({ width: 1.1, color: V.mint });
  g.rect(-7, -20, 14, 10).fill(mix(pastel[2], V.panel, 0.4)).stroke(OUTLINE);
  g.rect(-4, -17, 8, 4).fill(V.void);
  g.poly([-9, -20, 9, -20, 0, -27]).fill(ink).stroke(OUTLINE);
  g.poly([-3, -20, 3, -20, 0, -27]).fill(V.ivory);
  g.restore();
  palm(g, 12, 16, 1.5);
  palm(g, -30, 8, 1.7);
  palm(g, 40, 2, 1.3);
}

/** Cape Florida's lighthouse (scenery at the tip of Key Biscayne). */
export function drawLighthouse(g: Graphics) {
  g.ellipse(3, 2, 10, 4).fill({ color: V.shadow, alpha: V.shadowAlpha });
  g.poly([-5, 0, 5, 0, 3, -40, -3, -40]).fill(V.panel).stroke(OUTLINE);
  g.poly([0, 0, 5, 0, 3, -40, 0, -40]).fill(V.plate);
  g.rect(-4.5, -46, 9, 6).fill(V.void).stroke(OUTLINE);
  g.circle(0, -43, 2).fill(V.glow);
  g.poly([-5, -46, 5, -46, 0, -51]).fill(V.mint);
}

export function drawTree(g: Graphics, kind: number) {
  g.ellipse(2, 1, 6, 3).fill({ color: V.shadow, alpha: V.shadowAlpha * 0.85 });
  if (kind === 0) {
    palm(g, 0, 0, 1.25);
  } else if (kind === 1) {
    // royal palm: straight pale trunk, tight crown
    g.moveTo(0, 0).lineTo(0, -19).stroke({ width: 1.6, color: mix(V.trunk, V.ivory, 0.3), cap: "round" });
    for (const [dx, dy] of [
      [-6, 1],
      [-4, -4],
      [0, -6],
      [4, -4],
      [6, 1],
    ]) {
      g.moveTo(0, -19).quadraticCurveTo(dx * 0.5, -19 + dy - 3, dx, -19 + dy);
    }
    g.stroke({ width: 1.4, color: V.palm, cap: "round" });
  } else {
    // sea grape / hedge
    g.circle(-2, -4, 4).fill(mix(V.palm, V.forest, 0.45)).stroke({ width: 0.8, color: V.palm, alpha: 0.8 });
    g.circle(2.5, -3, 3.5).fill(mix(V.palm, V.forest, 0.35)).stroke({ width: 0.8, color: V.palm, alpha: 0.8 });
  }
}

/** A speedboat with a white wake, tinted with a district or token ink. */
export function drawBoat(g: Graphics, hull: number) {
  g.moveTo(-26, 3).quadraticCurveTo(-16, 1, -10, 2).moveTo(-26, 5).quadraticCurveTo(-16, 6, -10, 4).stroke({ width: 0.8, color: V.surf, alpha: 0.55 });
  g.poly([-10, 0, 8, 0, 13, -2, 9, 4, -8, 4]).fill(mix(hull, V.forest, 0.2)).stroke({ width: 0.9, color: V.mint });
  g.poly([-4, 0, 3, 0, 1, -3.5, -3, -3.5]).fill(V.panel).stroke({ width: 0.7, color: V.mint });
}

/** A cruise ship (docked at PortMiami, slowly bobbing). */
export function drawCruiseShip(g: Graphics) {
  g.moveTo(-50, 8).lineTo(50, 8).stroke({ width: 0.8, color: V.surf, alpha: 0.4 });
  g.poly([-46, 0, 44, 0, 52, -4, 46, 7, -42, 7]).fill(V.ivory === 0xfff0f6 ? 0xe9e4f2 : 0xffffff).stroke(OUTLINE);
  g.poly([-46, 0, 44, 0, 46, 3, -44, 3]).fill(0x2e4f8a);
  for (let k = 0; k < 4; k++) {
    const w = 80 - k * 14;
    const y = -4 - k * 4;
    g.rect(-38 + k * 4, y, w, 4).fill(k % 2 ? V.panel2 : 0xf4f0fa).stroke({ width: 0.6, color: V.mint, alpha: 0.6 });
    for (let x = -36 + k * 4; x < -38 + k * 4 + w - 2; x += 4) g.rect(x, y + 1.3, 2, 1.4).fill({ color: V.glow, alpha: 0.9 });
  }
  g.poly([10, -20, 18, -20, 17, -28, 11, -28]).fill(0xff5fa2).stroke({ width: 0.8, color: V.mint });
}

/** A soft cloud of haze drifting over the bay. */
export function drawCloud(g: Graphics) {
  for (const [x, y, r] of [
    [0, 0, 22],
    [24, 4, 17],
    [-22, 6, 15],
    [10, -10, 16],
  ]) {
    g.circle(x, y, r).fill({ color: V.void, alpha: 0.25 });
  }
  for (const [x, y, r] of [
    [0, 0, 22],
    [24, 4, 17],
    [-22, 6, 15],
    [10, -10, 16],
  ]) {
    g.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.95).stroke({ width: 0.8, color: V.mint, alpha: 0.35 });
  }
}

export function drawEmptyPlot(g: Graphics, color: number) {
  const a = 10;
  g.poly([-a, 0, 0, a / 2, a, 0, 0, -a / 2]).fill({ color, alpha: 0.12 }).stroke({ width: 1, color });
  g.moveTo(-3, 0).lineTo(3, 0).stroke({ width: 1, color: V.ivory });
  g.moveTo(0, -1.8).lineTo(0, 1.8).stroke({ width: 1, color: V.ivory });
}

/** Scenery: a small pastel stucco house with a flat roof (not an NFT). */
export function drawCottage(g: Graphics, variant: number) {
  const pastel = [0xf7b2c4, 0xa8e6cf, 0xffe29a][variant % 3];
  const night = V.ivory === 0xfff0f6;
  const p: Palette = {
    lit: mix(pastel, V.forest, night ? 0.72 : 0.15),
    shade: mix(pastel, V.plate, night ? 0.8 : 0.45),
    top: mix(pastel, V.forest, night ? 0.6 : 0.3),
    roof: V.forest,
    roofShade: V.plate,
    window: V.glow,
    accent: V.mint,
  };
  const a = 7;
  const h = variant === 2 ? 10 : 6;
  shadow(g, a);
  box(g, a, 0, h, p, false);
  g.poly([-5, -1.5 + 1, -3, 0.5, -3, -2.5, -5, -3.5]).fill({ color: V.glow, alpha: night ? 0.75 : 0.5 });
  g.poly([2, 2.5, 4.5, 1.2, 4.5, -1.8, 2, -0.5]).fill({ color: V.glow, alpha: night ? 0.4 : 0.3 });
  topDiamond(g, a, -h, p.top);
}

/**
 * Guilloche rosette (a hypotrochoid-style ring of loops), kept from the older engraved theme
 * for the logo; drawn flat (callers squash for the map tilt).
 */
export function rosette(g: Graphics, cx: number, cy: number, r: number, petals: number, color: number, width = 0.7, alpha = 1) {
  const steps = petals * 40;
  const inner = r * 0.55;
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * Math.PI * 2;
    const rr = inner + (r - inner) * Math.abs(Math.sin((petals * t) / 2));
    const x = cx + Math.cos(t) * rr;
    const y = cy + Math.sin(t) * rr;
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke({ width, color, alpha });
}
