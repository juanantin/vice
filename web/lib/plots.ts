// Building plots on the map. Land is real Miami (OpenStreetMap via Overture, see
// scripts/build-miami.mjs); each district owns the land closest to its centre (Brickell,
// Downtown, Wynwood, Miami Beach). Inside a district, plot 0 is the one closest to the centre and
// later plots spiral outwards, matching the NFT's plot number.

import miami from "./miami.json";

export const TILT = 0.78; // vertical squash that gives the map its isometric look
export const PLOT_SPACING = 34;
/** How much bigger than their drawn size buildings appear on the map. */
export const BUILDING_SCALE = 4.2;
export const LANDMARK_SCALE = 3.8;
/** Radius of the open plaza around each district's landmark (no plots, no scenery). */
export const PLAZA = 120;

export type Pt = [number, number];
const tilt = ([x, y]: Pt): Pt => [x, y * TILT];
const tiltAll = (rs: unknown) => (rs as Pt[][]).map((r) => r.map(tilt));

/** The playable map (land beyond it is drawn as dim scenery). */
export const WORLD = { width: miami.width, height: miami.height * TILT };
export const RINGS: Pt[][] = tiltAll(miami.rings);
/** Rivers, lakes and enclosed bays drawn over the land. */
export const WATER: Pt[][] = tiltAll(miami.water);
export const ROADS: Record<string, Pt[][]> = Object.fromEntries(
  Object.entries(miami.roads as unknown as Record<string, Pt[][]>).map(([k, ls]) => [k, tiltAll(ls)]),
);
export const MAP_ATTRIBUTION = "© OpenStreetMap contributors · Overture Maps";

export const PLACES: Record<string, Pt> = Object.fromEntries(
  Object.entries(miami.places as unknown as Record<string, Pt>).map(([k, p]) => [k, tilt(p)]),
);
export const DISTRICT_PLACES = ["brickell", "downtown", "wynwood", "miamibeach"] as const;
export const SEA_LABELS: [string, Pt][] = (miami.seas as unknown as [string, Pt][]).map(([n, p]) => [n, tilt(p)]);
export const LAND_LABELS: [string, Pt][] = (miami.lands as unknown as [string, Pt][]).map(([n, p]) => [n, tilt(p)]);

function inRing(x: number, y: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const bbox = (r: Pt[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of r) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
};
const landBoxes = RINGS.map(bbox);
const waterBoxes = WATER.map(bbox);
const hit = (rings: Pt[][], boxes: ReturnType<typeof bbox>[], x: number, y: number) =>
  rings.some((r, i) => {
    const b = boxes[i];
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && inRing(x, y, r);
  });

/** Dry land (not the bay, the ocean, a river or a lake). */
export function onLand(x: number, y: number): boolean {
  return hit(RINGS, landBoxes, x, y) && !hit(WATER, waterBoxes, x, y);
}

/** Land with no city building: the keys (parks and beaches) and PortMiami's docks. */
export function isParkland(x: number, y: number): boolean {
  const [px, py] = PLACES.port;
  // PortMiami (Dodge Island): a band east of downtown along Government Cut.
  if (Math.abs(x - px) < 230 && Math.abs(y - py) < 70) return true;
  // Fisher Island, Virginia Key and Key Biscayne: everything south-east of the port.
  return x > px - 90 && y > py + 120;
}

function wellInland(x: number, y: number, m: number): boolean {
  return (
    onLand(x, y) && onLand(x + m, y) && onLand(x - m, y) && onLand(x, y + m * TILT) && onLand(x, y - m * TILT)
  );
}

let cache: Pt[][] | null = null;

/** plots[district][plotIndex] = map position (ground point of the building). */
export function getPlots(): Pt[][] {
  if (cache) return cache;
  const centres = DISTRICT_PLACES.map((k) => PLACES[k]);
  const reserved: [Pt, number][] = [
    [PLACES.mayor, PLAZA + 10],
    ...centres.map((c) => [c, PLAZA] as [Pt, number]),
  ];
  const sx = PLOT_SPACING;
  const sy = PLOT_SPACING * TILT * 0.87;
  // Layer 0: roomy grid. Layer 1 (used once a district's roomy plots are taken): the gaps
  // between them, so a crowded district (Miami Beach is a narrow island) gets denser.
  const layer = (ox: number, oy: number) => {
    const lists: { p: Pt; d: number }[][] = centres.map(() => []);
    let row = 0;
    for (let y = sy + oy; y < WORLD.height; y += sy, row++) {
      for (let x = (row % 2) * (sx / 2) + ox; x < WORLD.width; x += sx) {
        if (!wellInland(x, y, 12)) continue;
        if (isParkland(x, y)) continue;
        if (reserved.some(([c, r]) => Math.hypot(x - c[0], (y - c[1]) / TILT) < r)) continue;
        let best = 0;
        let bestD = Infinity;
        centres.forEach((c, i) => {
          const d = Math.hypot(x - c[0], (y - c[1]) / TILT);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        lists[best].push({ p: [x, y], d: bestD });
      }
    }
    return lists.map((l) => l.sort((a, b) => a.d - b.d).map((e) => e.p));
  };
  const a = layer(0, 0);
  const b = layer(sx / 4, sy / 2);
  cache = a.map((l, i) => [...l, ...b[i]]);
  return cache;
}

/** Position for a plot; if a district ever outgrows its land, extra plots double up nearby. */
export function plotPosition(district: number, plot: number): Pt {
  const list = getPlots()[district];
  const p = list[plot % list.length];
  const layer = Math.floor(plot / list.length);
  return layer === 0 ? p : [p[0] + layer * 6, p[1] + layer * 4];
}

/** Any land (boats and wave glints keep clear of it). */
export function onAnyLand(x: number, y: number): boolean {
  return onLand(x, y);
}
