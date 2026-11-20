// Builds lib/miami.json from scripts/data/miami-src.geojson (real Miami geography from
// OpenStreetMap via Overture Maps, fetched by scripts/fetch-miami.py): land, the bay and
// ocean, rivers and lakes, the main roads and causeways, all projected to map pixels, plus
// the projected positions of the four districts, the Mayor and the map labels.
// Run: node scripts/build-miami.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { geoMercator } from "d3-geo";

const src = JSON.parse(readFileSync(new URL("./data/miami-src.geojson", import.meta.url), "utf8"));
const byKind = (k) => src.features.filter((f) => f.properties.kind === k);

// The playable map: Wynwood in the north, Brickell and Downtown on the bay, Miami Beach across
// it, Key Biscayne to the south-east. Land outside it is still drawn (as dim scenery).
const CORE = { w: -80.226, e: -80.104, s: 25.662, n: 25.858 };
const WIDTH = 2000;
const projection = geoMercator().fitWidth(WIDTH, {
  type: "MultiPoint",
  coordinates: [
    [CORE.w, CORE.s],
    [CORE.e, CORE.n],
  ],
});
const [, top] = projection([CORE.w, CORE.n]);
const [, bottom] = projection([CORE.w, CORE.s]);
projection.translate([projection.translate()[0], projection.translate()[1] - top]);
const HEIGHT = Math.ceil(bottom - top);

const P = (c) => projection(c).map((v) => Math.round(v * 10) / 10);
const area = (r) => Math.abs(r.reduce((s, p, i) => s + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2);
const polys = (g) => (g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : []);
const lines = (g) => (g.type === "MultiLineString" ? g.coordinates : g.type === "LineString" ? [g.coordinates] : []);
// Drop consecutive points closer than `d` px (keeps the file small; the data is already ~5 m).
const thin = (pts, d) => pts.filter((p, i) => i === 0 || i === pts.length - 1 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) >= d);

const rings = [];
const water = [];
for (const f of byKind("land")) {
  for (const poly of polys(f.geometry)) {
    const outer = thin(poly[0].map(P), 1.2);
    if (area(outer) > 120) rings.push(outer);
    // Bays enclosed by land (holes) are water too.
    for (const hole of poly.slice(1)) {
      const h = thin(hole.map(P), 1.2);
      if (area(h) > 120) water.push(h);
    }
  }
}
rings.sort((a, b) => area(b) - area(a));
for (const f of byKind("water")) {
  for (const poly of polys(f.geometry)) {
    const r = thin(poly[0].map(P), 1.2);
    if (area(r) > 120) water.push(r);
  }
}

const roads = {};
for (const f of byKind("road")) {
  roads[f.properties.cls] = lines(f.geometry)
    .map((l) => thin(l.map(P), 2))
    .filter((l) => l.length > 1);
}

const out = {
  width: WIDTH,
  height: HEIGHT,
  attribution: src.attribution,
  rings,
  water,
  roads,
  places: {
    brickell: P([-80.1925, 25.7622]),
    downtown: P([-80.1912, 25.7768]),
    wynwood: P([-80.1985, 25.8012]),
    miamibeach: P([-80.1338, 25.7845]),
    // The Mayor's building stands on Watson Island, between the mainland and the beach.
    mayor: P([-80.1745, 25.7852]),
    port: P([-80.1640, 25.7735]),
    lighthouse: P([-80.1572, 25.6680]),
  },
  seas: [
    ["Biscayne Bay", P([-80.2005, 25.7235])],
    ["Biscayne Bay", P([-80.1620, 25.8240])],
    ["Atlantic Ocean", P([-80.1150, 25.7300])],
  ],
  lands: [
    ["Government Cut", P([-80.1390, 25.7640])],
    ["Miami River", P([-80.2140, 25.7810])],
    ["Key Biscayne", P([-80.1600, 25.6900])],
    ["Virginia Key", P([-80.1560, 25.7390])],
    ["Fisher Island", P([-80.1425, 25.7590])],
    ["PortMiami", P([-80.1640, 25.7790])],
    ["Little Havana", P([-80.2140, 25.7680])],
    ["Little Haiti", P([-80.1960, 25.8330])],
    ["Allapattah", P([-80.2150, 25.8040])],
    ["Venetian Islands", P([-80.1590, 25.7950])],
    ["North Bay Village", P([-80.1500, 25.8480])],
    ["Coconut Grove", P([-80.2200, 25.7330])],
  ],
};
writeFileSync(new URL("../lib/miami.json", import.meta.url), JSON.stringify(out));
const size = JSON.stringify(out).length;
console.log(`miami.json: ${WIDTH}x${HEIGHT}, ${rings.length} land rings, ${water.length} water rings, ${Object.values(roads).flat().length} road lines, ${Math.round(size / 1024)} KB`);
