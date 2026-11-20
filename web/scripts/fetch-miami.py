#!/usr/bin/env python3
"""Fetch real Miami geography for the map from Overture Maps (open data on AWS S3, mostly
derived from OpenStreetMap, ODbL: "© OpenStreetMap contributors, Overture Maps Foundation").

Writes scripts/data/miami-src.geojson: land, the ocean / bay, rivers and lakes, and the main
roads (causeways, expressways, boulevards), clipped to the area around the four districts and
simplified to a few metres. That small file is committed, so the site builds offline;
scripts/build-miami.mjs then projects it to lib/miami.json.

Run (only needed to refresh the data):
    pip install pyarrow shapely
    python3 scripts/fetch-miami.py [release]      # e.g. 2026-11-18.0
"""
import json
import sys
from pathlib import Path

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as fs
from shapely import wkb
from shapely.geometry import box, mapping
from shapely.ops import linemerge, unary_union

RELEASE = sys.argv[1] if len(sys.argv) > 1 else "2026-11-18.0"
# Map area (the playable core is set in build-miami.mjs) plus a margin of scenery around it.
W, S, E, N = -80.42, 25.60, -80.02, 25.94
# Roads only around the core (they are drawn, never built on).
RW, RS, RE, RN = -80.30, 25.64, -80.08, 25.90
TOL = 0.00005  # simplification, degrees (~5 m)

s3 = fs.S3FileSystem(anonymous=True, region="us-west-2")


def read(theme, typ, cols, bbox, extra=None):
    w, s, e, n = bbox
    d = ds.dataset(f"overturemaps-us-west-2/release/{RELEASE}/theme={theme}/type={typ}/", filesystem=s3, format="parquet")
    f = (pc.field("bbox", "xmin") < e) & (pc.field("bbox", "xmax") > w) & (pc.field("bbox", "ymin") < n) & (pc.field("bbox", "ymax") > s)
    if extra is not None:
        f = f & extra
    return d.to_table(columns=cols + ["geometry"], filter=f).to_pylist()


def only(geom, kinds):
    """Keep only the parts of a (possibly mixed) geometry whose type is in `kinds`."""
    parts = getattr(geom, "geoms", [geom])
    keep = [g for p in parts for g in getattr(p, "geoms", [p]) if g.geom_type in kinds and not g.is_empty]
    return unary_union(keep)


def feat(kind, geom, **props):
    return {"type": "Feature", "properties": {"kind": kind, **props}, "geometry": mapping(geom)}


clip = box(W, S, E, N)
out = []

# Land: Overture's land polygons (from the OSM coastline).
land_rows = read("base", "land", ["subtype"], (W, S, E, N), pc.field("subtype") == "land")
land = unary_union([wkb.loads(r["geometry"]) for r in land_rows if r["geometry"]]).intersection(clip)
land = only(land.simplify(TOL, preserve_topology=True), ("Polygon",))
out.append(feat("land", land))

# Inland water big enough to see: the Miami River, Little River, lakes, marinas.
water_rows = read("base", "water", ["subtype", "class", "names"], (W, S, E, N))
water = []
for r in water_rows:
    g = wkb.loads(r["geometry"])
    if g.geom_type not in ("Polygon", "MultiPolygon") or r["subtype"] in ("ocean", "human_made"):
        continue
    if g.area < 3e-6:  # about 3 hectares
        continue
    water.append(g)
water = only(unary_union(water).intersection(clip).simplify(TOL, preserve_topology=True), ("Polygon",))
out.append(feat("water", water))

# Main roads, merged per class. Causeways cross the bay, so they show as bridges.
CLASSES = ("motorway", "trunk", "primary", "secondary")
road_rows = read("transportation", "segment", ["class", "names"], (RW, RS, RE, RN), pc.field("subtype") == "road")
rclip = box(RW, RS, RE, RN)
for c in CLASSES:
    lines = [wkb.loads(r["geometry"]) for r in road_rows if r["class"] == c]
    merged = only(linemerge(unary_union(lines)).intersection(rclip).simplify(TOL * 1.5), ("LineString",))
    out.append(feat("road", merged, cls=c))

dest = Path(__file__).parent / "data" / "miami-src.geojson"
dest.parent.mkdir(exist_ok=True)


def rnd(o):
    if isinstance(o, float):
        return round(o, 5)
    if isinstance(o, (list, tuple)):
        return [rnd(x) for x in o]
    if isinstance(o, dict):
        return {k: rnd(v) for k, v in o.items()}
    return o


fc = {
    "type": "FeatureCollection",
    "attribution": "© OpenStreetMap contributors (ODbL), Overture Maps Foundation, release " + RELEASE,
    "features": [rnd(f) for f in out],
}
dest.write_text(json.dumps(fc, separators=(",", ":")))
print(f"{dest}: {dest.stat().st_size // 1024} KB")
