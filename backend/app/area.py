"""Street segments and their photos for one circle, served to the app.

One Mapillary photo per street or place (tool/photos/mapillary.py, Elena 2026-11-11): metadata lookups only (free);
no image is fetched here. The result is neutral data (segments, Mapillary image IDs, locations, dates, headings) and is
cached on disk per area (brief §6: allowed). Progress is reported as events, so the app can light streets up while the
area loads (brief §4).

Thermal comfort comes after the photos: one Infrared.city run per area and window (billed), cached as
the grid and the UTCI per segment, so the same area, season and time is never paid for twice.
"""
import hashlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

import numpy as np
from shapely.geometry import mapping

from tool.config import REPO_ROOT
from tool.geo import LocalProjection, circle
from tool.infrared import ThermalError, run_utci
from tool import osm_local
from tool.osm import build_segments, fetch_overpass, parse, parse_buildings
from tool.photos import mapillary
from tool.thermal import segment_values

from . import steps

log = logging.getLogger("sencity.api")

PLACE_TYPES = {"park": "park", "square": "square", "pedestrian": "pedestrian"}
# The Mapillary settings that change which photo a street gets (and so the cached area).
PHOTO_SETTINGS = ("radius_m", "max_turn_deg", "max_age_years", "search_limit")


def cache_dir(cfg: dict) -> Path:
    return REPO_ROOT / cfg["api"]["area"]["cache_dir"]


def area_key(lat: float, lon: float, radius: int, cfg: dict) -> str:
    """Same circle and same pipeline settings → same key (and the same cached result)."""
    settings = {"photos": "mapillary", **{k: cfg[k] for k in ("osm", "segments")},
                "mapillary": {k: cfg["mapillary"][k] for k in PHOTO_SETTINGS}}
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


def lookup_photos(segments: list, proj: LocalProjection, cfg: dict, directions: dict | None = None):
    """Yield (done, segment, [its photo] or []) as the Mapillary lookups finish, several at a time. A street counts
    either way along it, a park or square in any direction. `directions` (routes): {segment id: True if walked along its
    own drawing, False if against it}; such a street prefers a photo facing the way it is walked. Stops as soon as the
    caller stops reading."""
    s = mapillary.session()
    directions = directions or {}

    def one(seg):
        geom = proj.geom_to_lonlat(seg.geom)
        if seg.kind == "area":
            photo = mapillary.photo_for(s, [list(c) for c in geom.exterior.coords], "area", cfg)
        elif seg.id in directions:
            coords = [list(c) for c in geom.coords]
            photo = mapillary.photo_facing(s, coords if directions[seg.id] else coords[::-1], cfg)
        else:
            photo = mapillary.photo_for(s, [list(c) for c in geom.coords], "street", cfg)
        return seg, [photo] if photo else []

    pool = ThreadPoolExecutor(max_workers=cfg["mapillary"]["workers"])
    try:
        futures = [pool.submit(one, seg) for seg in segments]
        for done, fut in enumerate(as_completed(futures), start=1):
            seg, photos = fut.result()
            yield done, seg, photos
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def run_area(lat: float, lon: float, radius: int, cfg: dict, key: str | None = None):
    """Yield events: {"type": "segments"} (all segments; photos None while pending, with `done` already
    found), one {"type": "segment"} per segment once its photos are chosen, then {"type": "done", "area":
    FeatureCollection}. With a key, the finished steps of an earlier try are read back (app/steps.py):
    the Overpass answer and the photos found so far, so only the missing calls are made; when a lookup
    fails or the caller stops reading (Cancel), what was found is kept for the next try."""
    proj = LocalProjection(lat, lon)
    area_poly = circle(radius, cfg["area"]["circle_points"])
    where = cache_dir(cfg)
    data = steps.load(where, key, "osm") if key else None
    if data is None:
        yield {"type": "stage", "stage": "streets"}
        data = osm_local.around(lat, lon, radius, cfg) or fetch_overpass(lat, lon, radius, cfg, with_buildings=True)
        if key:
            steps.save(where, key, "osm", data)
    footprints = parse_buildings(data, proj, 0)
    ways, node_xy, areas, _dropped = parse(data, proj, cfg)
    segments = build_segments(ways, node_xy, areas, area_poly, cfg, footprints, {})

    found: dict = (steps.load(where, key, "photos") if key else None) or {}
    features = {s.id: feature(s, proj, found.get(s.id)) for s in segments}
    todo = [s for s in segments if s.id not in found]
    total = len(segments)
    yield {"type": "segments", "features": list(features.values()), "total": total, "done": total - len(todo)}

    finished = False
    try:
        for done, seg, photos in lookup_photos(todo, proj, cfg):
            found[seg.id] = photos
            features[seg.id] = feature(seg, proj, photos)
            yield {"type": "segment", "feature": features[seg.id], "done": total - len(todo) + done, "total": total}
        finished = True
    finally:
        if key and not finished and found:
            steps.save(where, key, "photos", found)

    fc = {"type": "FeatureCollection", "features": [features[s.id] for s in segments]}
    yield {"type": "done", "area": fc}


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


# Thermal comfort

def thermal_dir(cfg: dict) -> Path:
    return REPO_ROOT / cfg["thermal"]["cache_dir"]


def thermal_key(area: str, season: str, time: str, cfg: dict) -> str:
    """Same area, window and thermal settings → same key (the grid is not paid for twice)."""
    t = cfg["thermal"]
    settings = {"analysis": t["analysis"], "day": t["seasons"][season], "buffer_m": t["buffer_m"],
                "percentile": t["percentile"]}
    raw = json.dumps({"area": area, "season": season, "time": time, "settings": settings}, sort_keys=True)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def load_thermal(key: str, cfg: dict) -> dict | None:
    path = thermal_dir(cfg) / f"{key}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def save_thermal(key: str, result: dict, grid: np.ndarray, bounds: tuple, cfg: dict) -> None:
    d = thermal_dir(cfg)
    d.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(d / f"{key}.npz", grid=grid, bounds=np.asarray(bounds))
    tmp = d / f"{key}.json.tmp"
    tmp.write_text(json.dumps({**result, "created": date.today().isoformat()}), encoding="utf-8")
    tmp.replace(d / f"{key}.json")


def circle_polygon(lat: float, lon: float, radius: int, cfg: dict) -> dict:
    """The circle as a GeoJSON polygon (lon/lat)."""
    return mapping(LocalProjection(lat, lon).geom_to_lonlat(circle(radius, cfg["area"]["circle_points"])))


def run_thermal(fc: dict, lat: float, lon: float, polygon: dict, season: str, time: str, cfg: dict,
                runner=None) -> tuple[dict, np.ndarray, tuple]:
    """UTCI per segment for one window: {"season", "time", "station", "values": {id: °C or None}}."""
    proj = LocalProjection(lat, lon)
    r = (runner or run_utci)(polygon, lat, lon, season, time, cfg)
    t = cfg["thermal"]
    values = segment_values(r["grid"], r["bounds"], fc["features"], proj, t["buffer_m"], t["percentile"])
    return {"season": season, "time": time, "station": r["station"], "values": values}, r["grid"], r["bounds"]


def thermal_events(area: str, fc: dict, lat: float, lon: float, polygon: dict, season: str, time: str,
                   cfg: dict, allowed, runner=None):
    """Yield {"type": "stage", "stage": "thermal"}, then {"type": "thermal", ...} or
    {"type": "thermal_error", "message"}. allowed() is asked only before a new (billed) run."""
    yield {"type": "stage", "stage": "thermal"}
    key = thermal_key(area, season, time, cfg)
    cached = load_thermal(key, cfg)
    if cached is not None:
        yield {"type": "thermal", **{k: cached[k] for k in ("season", "time", "station", "values")}}
        return
    if not allowed():
        yield {"type": "thermal_error", "message": "Too many new thermal runs in a short time. Try again later."}
        return
    try:
        result, grid, bounds = run_thermal(fc, lat, lon, polygon, season, time, cfg, runner)
    except ThermalError as e:
        yield {"type": "thermal_error", "message": str(e)}
        return
    except Exception as e:  # noqa: BLE001 (SDK and network errors: log the type only)
        log.warning("thermal failed: %s", type(e).__name__)
        yield {"type": "thermal_error", "message": "Thermal comfort could not be loaded. Try again."}
        return
    save_thermal(key, result, grid, bounds, cfg)
    yield {"type": "thermal", **result}
