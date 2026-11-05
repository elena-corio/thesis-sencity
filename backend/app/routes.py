"""Two walking routes between two points (brief §3, boards Routes 1–3).

Streets are read from an ellipse around start and end. A few different ways are found on them, and only
the streets close to those ways (the corridor) get photos and thermal comfort, so a route costs one
narrow thermal run instead of the whole ellipse. Then A is the shortest and B the easiest, from the
thermal states alone until rating exists.

Privacy: start and end can be someone's home and work. They travel in the POST body, are never logged,
and are not written to the cache: the key is a hash and the file holds only the corridor's streets. The
limits may become personal: they are used for this answer and not kept.
"""
import hashlib
import json
import logging
import math
from datetime import date
from pathlib import Path as FilePath

from shapely.geometry import LineString, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep

from tool.config import REPO_ROOT
from tool.geo import LocalProjection
from tool.infrared import ThermalError, count_jobs
from tool.osm import build_segments, fetch_buildings_in, fetch_ways_in, parse, parse_buildings
from tool.routing import Graph, alternatives, build_graph, find_b, parts, shares, shortest_path, snap
from tool.thermal import proj_geom, thermal_state

from . import area as area_mod

log = logging.getLogger("sencity.api")


class RouteError(Exception):
    """A route that cannot be found; the message is safe to show in the app."""


def cache_dir(cfg: dict) -> FilePath:
    return REPO_ROOT / cfg["routes"]["cache_dir"]


def route_key(start: dict, end: dict, cfg: dict) -> str:
    """Same two points (to about a metre, either way round) and same settings → same key, so swapping
    start and end is never paid for twice. The file name does not show the points."""
    settings = {k: cfg[k] for k in ("osm", "segments", "candidates", "selection", "streetview", "routes")}
    points = sorted([[round(start["lat"], 5), round(start["lon"], 5)], [round(end["lat"], 5), round(end["lon"], 5)]])
    raw = json.dumps({"points": points, "settings": settings}, sort_keys=True, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def load_cached(key: str, cfg: dict) -> dict | None:
    path = cache_dir(cfg) / f"{key}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def save_cached(key: str, fc: dict, zone: dict, lat: float, lon: float, cfg: dict) -> None:
    d = cache_dir(cfg)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{key}.json.tmp"
    tmp.write_text(json.dumps({"created": date.today().isoformat(), "lat": lat, "lon": lon, "zone": zone, "area": fc},
                              ensure_ascii=False), encoding="utf-8")
    tmp.replace(d / f"{key}.json")


def middle(start: dict, end: dict) -> tuple[float, float]:
    return round((start["lat"] + end["lat"]) / 2, 5), round((start["lon"] + end["lon"]) / 2, 5)


def search_ellipse(a: tuple, b: tuple, cfg: dict) -> Polygon:
    """The ellipse with a and b as its foci, in local metres: any way through its edge is
    search_ratio x the straight line, plus search_margin_m."""
    r = cfg["routes"]
    d = math.dist(a, b)
    major = (d * r["search_ratio"] + r["search_margin_m"]) / 2
    minor = math.sqrt(max(major ** 2 - (d / 2) ** 2, 1.0))
    angle = math.atan2(b[1] - a[1], b[0] - a[0])
    cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    n = r["search_points"]
    ring = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, y = major * math.cos(t), minor * math.sin(t)
        ring.append((cx + x * math.cos(angle) - y * math.sin(angle), cy + x * math.sin(angle) + y * math.cos(angle)))
    return Polygon(ring)


def ring_lonlat(poly: Polygon, proj: LocalProjection) -> list[tuple[float, float]]:
    return [proj.to_lonlat(x, y) for x, y in poly.exterior.coords[:-1]]


def path_zone(paths: list, buffer_m: float) -> Polygon:
    """One ring around the given ways: the hole between two ways is part of it (the SDK wants one ring)."""
    lines = [LineString(c for e, fwd in p.steps for c in (e.line.coords if fwd else list(e.line.coords)[::-1]))
             for p in paths]
    zone = unary_union([ln.buffer(buffer_m) for ln in lines])
    if zone.geom_type == "MultiPolygon":  # the ways share start and end, so this is only rounding
        zone = max(zone.geoms, key=lambda g: g.area)
    return Polygon(zone.exterior).simplify(2.0)


def fit_zone(paths: list, proj: LocalProjection, cfg: dict) -> Polygon:
    """The zone of as many ways as fit in routes.max_jobs thermal tiles (the free preview says how many).
    The shortest ways are kept. Without the preview the whole zone is used; the run itself checks again."""
    r = cfg["routes"]
    zone = None
    for n in range(len(paths), 0, -1):
        zone = path_zone(paths[:n], r["corridor_buffer_m"] + r["thermal_margin_m"])
        try:
            if count_jobs(mapping(proj.geom_to_lonlat(zone)), cfg) <= r["max_jobs"]:
                return zone
        except ThermalError:
            return zone
        except Exception as e:  # noqa: BLE001 (SDK and network errors: log the type only)
            log.warning("thermal preview failed: %s", type(e).__name__)
            return zone
    return zone


def build_corridor(start: dict, end: dict, cfg: dict, provider):
    """Yield progress events, then {"type": "corridor", "area": FeatureCollection, "zone": polygon}."""
    r = cfg["routes"]
    lat, lon = middle(start, end)
    proj = LocalProjection(lat, lon)
    a, b = proj.to_xy(start["lon"], start["lat"]), proj.to_xy(end["lon"], end["lat"])

    yield {"type": "stage", "stage": "streets"}
    ellipse = search_ellipse(a, b, cfg)
    ways, node_xy, _areas, _dropped = parse(fetch_ways_in(ring_lonlat(ellipse, proj), cfg), proj, cfg)
    segments = build_segments(ways, node_xy, [], ellipse, cfg, None, {})

    graph = build_graph([(s.id, s.geom) for s in segments], r["connect_gap_m"])
    node_a, node_b = snap(graph, a, r["snap_max_m"]), snap(graph, b, r["snap_max_m"])
    if node_a is None:
        raise RouteError("There is no walkable street near the start. Choose a point closer to a street.")
    if node_b is None:
        raise RouteError("There is no walkable street near the end. Choose a point closer to a street.")
    shortest = shortest_path(graph, node_a, node_b)
    if shortest is None:
        raise RouteError("No walking way was found between these two points.")
    if shortest.length > r["max_walk_m"]:
        raise RouteError(f"This walk is {shortest.length / 1000:.1f} km. Routes go up to {r['max_walk_m'] / 1000:.1f} km for now.")
    ways_found = alternatives(graph, node_a, node_b, shortest, r["length_ratio"], r["candidates"], r["candidate_penalty"])

    zone = fit_zone(ways_found, proj, cfg)
    streets_zone = zone.buffer(-r["thermal_margin_m"])
    near = prep(streets_zone)
    corridor = [s for s in segments if near.intersects(s.geom)]

    buildings = None
    try:
        footprints = parse_buildings(fetch_buildings_in(ring_lonlat(zone.simplify(10.0), proj), cfg), proj, 0)
        if footprints is not None:
            buildings = prep(footprints.buffer(-cfg["selection"]["indoor_building_inset_m"]))
    except Exception as e:  # noqa: BLE001 (the indoor test improves the photos; the route works without it)
        log.warning("route buildings unavailable: %s", type(e).__name__)

    total = len(corridor)
    yield {"type": "segments", "total": total}
    features = {}
    for done, seg, photos in area_mod.lookup_photos(corridor, proj, buildings, cfg, provider):
        features[seg.id] = area_mod.feature(seg, proj, photos)
        yield {"type": "segment", "done": done, "total": total}
    fc = {"type": "FeatureCollection", "features": [features[s.id] for s in corridor]}
    yield {"type": "corridor", "area": fc, "zone": mapping(proj.geom_to_lonlat(zone))}


def _graph_of(fc: dict, proj: LocalProjection, gap_m: float) -> Graph:
    lines = [(f["properties"]["id"], proj_geom(shape(f["geometry"]), proj))
             for f in fc["features"] if f["geometry"]["type"] == "LineString"]
    return build_graph(lines, gap_m)


def _minutes(length_m: float, cfg: dict) -> int:
    return max(1, round(length_m / cfg["routes"]["walk_m_per_min"]))


def _summary(route_id: str, kind: str, path, state_of, by_id: dict, proj: LocalProjection, cfg: dict) -> dict:
    s = shares(path, state_of)
    route_parts = parts(path)
    with_photos = sum(p["length_m"] for p in route_parts
                      if p["segment_id"] and by_id[p["segment_id"]]["properties"].get("photos"))
    return {
        "id": route_id,
        "kind": kind,
        "length_m": round(path.length, 1),
        "minutes": _minutes(path.length, cfg),
        "hard_share": round(s["hard"], 3),
        "mixed_share": round(s["mixed"], 3),
        "thermal_share": round(1 - s["none"], 3),
        "photo_share": round(with_photos / (path.length or 1), 3),
        "parts": [{"segment_id": p["segment_id"], "length_m": round(p["length_m"], 1),
                   "coordinates": [[round(v, 7) for v in proj.to_lonlat(x, y)] for x, y in p["xy"]]}
                  for p in route_parts],
    }


def _worst_stretch_name(route: dict, other: dict, values: dict, by_id: dict, state_of,
                        limits: dict) -> tuple[str, str] | None:
    """(name, "hot" or "cold") of the longest hard, named street on this route and not on the other."""
    theirs = {p["segment_id"] for p in other["parts"]}
    metres: dict[str, float] = {}
    utci: dict[str, float] = {}
    for p in route["parts"]:
        seg = p["segment_id"]
        if not seg or seg in theirs or state_of(seg) != "hard" or not by_id[seg]["properties"].get("named"):
            continue
        name = by_id[seg]["properties"]["name"]
        metres[name] = metres.get(name, 0) + p["length_m"]
        utci[name] = values[seg]
    if not metres:
        return None
    name = max(sorted(metres), key=lambda n: metres[n])
    return name, "hot" if utci[name] > limits["cold"][0] else "cold"


def verdict(a: dict, b: dict | None, values: dict, by_id: dict, state_of, limits: dict) -> str:
    """One sentence comparing the two ways (brief §3). Plain rules, no AI."""
    if b is None:
        return "There is only one sensible way here within a quarter more walking."
    extra = b["minutes"] - a["minutes"]
    took = f"B is {extra} minute{'s' if extra != 1 else ''} longer" if extra > 0 else "B takes about the same time"
    if b["kind"] == "second":
        return f"A is already the easiest way within a quarter more walking. {took}, with no less hard walking."
    if b["hard_share"] < a["hard_share"]:
        worst = _worst_stretch_name(a, b, values, by_id, state_of, limits)
        if worst:
            # B may walk another part of the same street: then it avoids only the hard part.
            on_b = {by_id[p["segment_id"]]["properties"]["name"] for p in b["parts"] if p["segment_id"]}
            where = f"part of {worst[0]}" if worst[0] in on_b else f"stretch on {worst[0]}"
            return f"{took} but avoids the {worst[1]} {where}."
        return f"{took} but has less hard walking."
    return f"{took} but has less mixed walking."


def find_routes(fc: dict, start: dict, end: dict, values: dict, limits: dict, cfg: dict) -> dict:
    """A and B on the corridor, from the feels-like values: the "routes" event without its window."""
    r = cfg["routes"]
    lat, lon = middle(start, end)
    proj = LocalProjection(lat, lon)
    graph = _graph_of(fc, proj, r["connect_gap_m"])
    node_a = snap(graph, proj.to_xy(start["lon"], start["lat"]), r["snap_max_m"])
    node_b = snap(graph, proj.to_xy(end["lon"], end["lat"]), r["snap_max_m"])
    route_a = shortest_path(graph, node_a, node_b) if node_a and node_b else None
    if route_a is None:
        raise RouteError("No walking way was found between these two points.")

    def state_of(seg_id):
        v = values.get(seg_id)
        return thermal_state(v, limits) if v is not None else None

    route_b, kind = find_b(graph, node_a, node_b, route_a, state_of, r)
    by_id = {f["properties"]["id"]: f for f in fc["features"]}
    a = _summary("A", "shortest", route_a, state_of, by_id, proj, cfg)
    b = _summary("B", kind, route_b, state_of, by_id, proj, cfg) if route_b else None
    used = {p["segment_id"] for rt in (a, b) if rt for p in rt["parts"] if p["segment_id"]}
    return {
        "routes": [rt for rt in (a, b) if rt],
        "verdict": verdict(a, b, values, by_id, state_of, limits),
        "segments": {"type": "FeatureCollection", "features": [f for f in fc["features"] if f["properties"]["id"] in used]},
        "values": {k: values.get(k) for k in used},
    }
