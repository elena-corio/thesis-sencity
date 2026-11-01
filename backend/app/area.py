"""Street segments and their photos for one circle: the step-1 pipeline (tool/), served to the app.

Metadata calls only (free); no image is fetched here. The result is neutral data (segments, pano IDs,
locations, dates, headings) and is cached on disk per area (brief §6: allowed). Progress is reported as
events, so the app can light streets up while the area loads (brief §4).
"""
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

from shapely.geometry import mapping
from shapely.prepared import prep

from tool.candidates import candidates_for, make_lookup, photos_for_segment
from tool.config import REPO_ROOT
from tool.geo import LocalProjection, circle
from tool.osm import build_segments, fetch_overpass, parse, parse_buildings
from tool.selection import select

PLACE_TYPES = {"park": "park", "square": "square", "pedestrian": "pedestrian"}


def cache_dir(cfg: dict) -> Path:
    return REPO_ROOT / cfg["api"]["area"]["cache_dir"]


def area_key(lat: float, lon: float, radius: int, cfg: dict) -> str:
    """Same circle and same pipeline settings → same key (and the same cached result)."""
    settings = {k: cfg[k] for k in ("osm", "segments", "candidates", "selection", "streetview")}
    raw = json.dumps({"lat": round(lat, 5), "lon": round(lon, 5), "radius": radius, "settings": settings},
                     sort_keys=True, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def place_type(seg) -> str:
    if seg.kind == "area":
        return PLACE_TYPES.get(seg.highway, "square")
    return "pedestrian" if seg.highway == "pedestrian" else "street"


def way_label(highway: str) -> str:
    """Name for an unnamed segment: its OSM way type ("footway" → "Footway")."""
    return (highway or "path").replace("_", " ").capitalize()


def feature(seg, proj: LocalProjection, photos: list | None) -> dict:
    size = {"length_m": round(seg.geom.length, 1)} if seg.kind == "street" else {"area_m2": round(seg.geom.area, 1)}
    return {
        "type": "Feature",
        "id": seg.id,
        "geometry": mapping(proj.geom_to_lonlat(seg.geom)),
        "properties": {
            "id": seg.id,
            "name": seg.name or way_label(seg.highway),
            "named": bool(seg.name),
            "place_type": place_type(seg),
            "way_type": seg.highway,
            **size,
            # None while the photos are still being looked up, then a list (possibly empty).
            "photos": photos,
        },
    }


def photo_props(c) -> dict:
    return {"pano_id": c.photo_id, "lat": round(c.lat, 7), "lon": round(c.lon, 7), "heading": c.heading,
            "date": c.date, "contributor": not c.official}


def run_area(lat: float, lon: float, radius: int, cfg: dict, provider):
    """Yield events: {"type": "segments"} (all segments, photos pending), one {"type": "segment"}
    per segment once its photos are chosen, then {"type": "done", "area": FeatureCollection}.
    Stops looking up photos as soon as the caller stops reading (the user pressed Cancel)."""
    proj = LocalProjection(lat, lon)
    area_poly = circle(radius, cfg["area"]["circle_points"])
    yield {"type": "stage", "stage": "streets"}
    data = fetch_overpass(lat, lon, radius, cfg, with_buildings=True)
    footprints = parse_buildings(data, proj, 0)
    ways, node_xy, areas, _dropped = parse(data, proj, cfg)
    segments = build_segments(ways, node_xy, areas, area_poly, cfg, footprints, {})
    indoor = prep(footprints.buffer(-cfg["selection"]["indoor_building_inset_m"])) if footprints is not None else None

    features = {s.id: feature(s, proj, None) for s in segments}
    yield {"type": "segments", "features": list(features.values()), "total": len(segments)}

    lookup = make_lookup(provider, proj)
    stats: dict = {}  # counts only; an occasional lost increment between threads does not matter
    today = date.today()

    def one(seg):
        metas = photos_for_segment(seg, lookup, cfg, stats)
        chosen = select(candidates_for(seg, metas, proj, indoor), cfg, today,
                        contributor_fallback=seg.kind == "area")
        return seg, [photo_props(c) for c in chosen if c.status == "kept"]

    pool = ThreadPoolExecutor(max_workers=cfg["api"]["area"]["workers"])
    try:
        futures = [pool.submit(one, s) for s in segments]
        for done, fut in enumerate(as_completed(futures), start=1):
            seg, photos = fut.result()
            features[seg.id] = feature(seg, proj, photos)
            yield {"type": "segment", "feature": features[seg.id], "done": done, "total": len(segments)}
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    fc = {"type": "FeatureCollection", "features": [features[s.id] for s in segments]}
    yield {"type": "done", "area": fc, "metadata_calls": provider.metadata_calls}


def load_cached(key: str, cfg: dict) -> dict | None:
    path = cache_dir(cfg) / f"{key}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))["area"]


def save_cached(key: str, lat: float, lon: float, radius: int, fc: dict, cfg: dict) -> None:
    d = cache_dir(cfg)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{key}.json.tmp"
    tmp.write_text(json.dumps({"lat": lat, "lon": lon, "radius": radius, "created": date.today().isoformat(),
                               "area": fc}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(d / f"{key}.json")


def known_photos(fc: dict) -> set[tuple[str, float]]:
    """(pano ID, heading) pairs an area uses: the only images /photo will fetch."""
    return {(p["pano_id"], float(p["heading"]))
            for f in fc["features"] for p in (f["properties"]["photos"] or [])}


def load_all_known(cfg: dict) -> set[tuple[str, float]]:
    known: set = set()
    d = cache_dir(cfg)
    if d.exists():
        for path in d.glob("*.json"):
            try:
                known |= known_photos(json.loads(path.read_text(encoding="utf-8"))["area"])
            except (ValueError, KeyError):
                continue
    return known
