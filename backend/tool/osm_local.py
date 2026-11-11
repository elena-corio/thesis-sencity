"""A local copy of OpenStreetMap for one city, so a new area or route does not wait for the public Overpass server.

  python -m tool.osm_local              # downloads what is missing into data/osm/vienna/ (free, resumes)
  python -m tool.osm_local --limit 2    # only two tiles, to try it
  python -m tool.osm_local --refresh    # downloads every tile again

The city is cut into square tiles, each the raw Overpass answer for walkable ways, parks, squares and buildings. A
request reads the tiles it touches. Street segments are still cut per circle, from the same data and by the same code as
before. If a tile is missing, or the request is outside the city, the caller asks Overpass as usual. Only OpenStreetMap
data is stored: no photos, nothing about the person.
"""
import argparse
import json
import math
import os
import time
from pathlib import Path

import requests

from .config import REPO_ROOT, load_config
from .osm import _post

M_PER_DEG_LAT = 111_320


def _indexes(low: float, high: float, origin: float, size: float, count: int) -> range:
    first = max(0, math.floor((low - origin) / size))
    return range(first, min(count - 1, math.floor((high - origin) / size)) + 1)


def _grid(local: dict) -> tuple[int, int]:
    west, south, east, north = local["bbox"]
    return math.ceil(round((east - west) / local["tile_deg"], 9)), math.ceil(round((north - south) / local["tile_deg"], 9))


def tiles_for(box: tuple, local: dict) -> list[tuple[int, int]] | None:
    """The (column, row) of every tile a (west, south, east, north) box touches, or None if it leaves the city."""
    west0, south0, east0, north0 = local["bbox"]
    west, south, east, north = box
    if west < west0 or south < south0 or east > east0 or north > north0:
        return None
    cols, rows = _grid(local)
    size = local["tile_deg"]
    return [(c, r) for c in _indexes(west, east, west0, size, cols) for r in _indexes(south, north, south0, size, rows)]


def tile_path(tile: tuple[int, int], local: dict) -> Path:
    return REPO_ROOT / local["dir"] / f"{tile[0]}_{tile[1]}.json"


def _bounds(el: dict) -> tuple | None:
    """(west, south, east, north) of an element from Overpass "out geom"."""
    b = el.get("bounds")
    if b:
        return b["minlon"], b["minlat"], b["maxlon"], b["maxlat"]
    points = el.get("geometry") or [g for m in el.get("members", []) for g in m.get("geometry") or []]
    if not points:
        return None
    lons, lats = [p["lon"] for p in points], [p["lat"] for p in points]
    return min(lons), min(lats), max(lons), max(lats)


def _touches(a: tuple, b: tuple) -> bool:
    return a[0] <= b[2] and a[2] >= b[0] and a[1] <= b[3] and a[3] >= b[1]


def _read(box: tuple, cfg: dict, keep=None) -> dict | None:
    """The elements near the box, once each, in Overpass's shape; None when the local copy cannot answer."""
    local = cfg.get("osm_local")
    tiles = tiles_for(box, local) if local else None
    if not tiles:
        return None
    found = {}
    for tile in tiles:
        try:
            data = json.loads(tile_path(tile, local).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        for el in data["elements"]:
            key = (el["type"], el["id"])
            if key in found or (keep and not keep(el)):
                continue
            bounds = _bounds(el)
            if bounds and _touches(bounds, box):
                found[key] = el
    return {"elements": list(found.values())}


def around(lat: float, lon: float, radius_m: float, cfg: dict) -> dict | None:
    """Everything for a circle (fetch_overpass with buildings). A little more than the circle is fine: it is clipped."""
    margin = radius_m + max(30, cfg["osm"]["buildings_margin_m"])
    dlat = margin / M_PER_DEG_LAT
    dlon = dlat / math.cos(math.radians(lat))
    return _read((lon - dlon, lat - dlat, lon + dlon, lat + dlat), cfg)


def _ring_box(ring_lonlat: list) -> tuple:
    lons, lats = [p[0] for p in ring_lonlat], [p[1] for p in ring_lonlat]
    return min(lons), min(lats), max(lons), max(lats)


def ways_in(ring_lonlat: list, cfg: dict) -> dict | None:
    """Walkable ways for a polygon (fetch_ways_in)."""
    return _read(_ring_box(ring_lonlat), cfg, lambda el: "highway" in el.get("tags", {}))


def buildings_in(ring_lonlat: list, cfg: dict) -> dict | None:
    """Building footprints for a polygon (fetch_buildings_in)."""
    return _read(_ring_box(ring_lonlat), cfg, lambda el: "building" in el.get("tags", {}))


def tile_query(tile: tuple[int, int], cfg: dict) -> str:
    local, osm = cfg["osm_local"], cfg["osm"]
    west0, south0, _east, _north = local["bbox"]
    size = local["tile_deg"]
    bbox = f"{south0 + tile[1] * size:.5f},{west0 + tile[0] * size:.5f},{south0 + (tile[1] + 1) * size:.5f},{west0 + (tile[0] + 1) * size:.5f}"
    hw = "|".join(osm["walkable_highways"])
    areas = " ".join(f'way["{k}"="{v}"]({bbox}); relation["{k}"="{v}"]({bbox});' for k, values in osm["area_tags"].items() for v in values)
    return f"""
[out:json][timeout:{local['timeout_s']}];
(
  way["highway"~"^({hw})$"]({bbox});
  {areas}
  way["building"]({bbox}); relation["building"]({bbox});
);
out geom;
"""


def download(cfg: dict, limit: int | None = None, refresh: bool = False) -> int:
    """Fetch the tiles still missing, gently, one at a time. Returns how many failed."""
    local = cfg["osm_local"]
    cols, rows = _grid(local)
    todo = [(c, r) for c in range(cols) for r in range(rows) if refresh or not tile_path((c, r), local).exists()]
    todo.sort(key=lambda t: (t[0] - cols / 2) ** 2 + (t[1] - rows / 2) ** 2)  # the centre first: usable early
    print(f"{cols * rows} tiles in all, {len(todo)} to fetch", flush=True)
    server = {"overpass_url": cfg["osm"]["overpass_url"], "timeout_s": local["timeout_s"]}
    failed = 0
    for i, tile in enumerate(todo[:limit] if limit else todo, 1):
        started = time.perf_counter()
        try:
            data = _post(tile_query(tile, cfg), server)
        except (requests.RequestException, ValueError) as e:
            failed += 1
            print(f"{i}/{len(todo)} tile {tile}: failed ({type(e).__name__}), run the script again to retry", flush=True)
            time.sleep(local["pause_s"] * 5)
            continue
        path = tile_path(tile, local)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"elements": data["elements"]}, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, path)
        print(f"{i}/{len(todo)} tile {tile}: {len(data['elements'])} elements, {time.perf_counter() - started:.0f} s", flush=True)
        time.sleep(local["pause_s"])
    return failed


def main() -> None:
    ap = argparse.ArgumentParser(description="Download a local copy of OpenStreetMap for the city in config/tool.yaml (osm_local).")
    ap.add_argument("--limit", type=int, default=None, help="fetch at most this many tiles")
    ap.add_argument("--refresh", action="store_true", help="fetch every tile again")
    args = ap.parse_args()
    failed = download(load_config(), args.limit, args.refresh)
    print("done" if not failed else f"{failed} tiles failed: run the script again to fetch only those")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
