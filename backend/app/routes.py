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

from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep

from tool.config import REPO_ROOT
from tool.geo import LocalProjection, bearing_ahead, signed_turn
from tool.infrared import ThermalError, count_jobs
from tool import osm_local
from tool.osm import build_segments, fetch_ways_in, parse
from tool.routing import Graph, alternatives, build_graph, different_share, find_b, parts, shares, shortest_path, snap
from tool.thermal import proj_geom, thermal_state

from . import area as area_mod
from . import photos as photos_mod
from . import steps

log = logging.getLogger("sencity.api")


class RouteError(Exception):
    """A route that cannot be found; the message is safe to show in the app."""


def cache_dir(cfg: dict) -> FilePath:
    return REPO_ROOT / cfg["routes"]["cache_dir"]


def route_key(start: dict, end: dict, cfg: dict, source: str | None = None) -> str:
    """Same two points (to about a metre, either way round) and same settings → same key, so swapping
    start and end never pays for thermal comfort twice. The file name does not show the points. source: as in
    area.area_key (thermal comfort uses "mapillary", whatever PHOTO_SOURCE is)."""
    settings = {**photos_mod.settings(cfg, source), **{k: cfg[k] for k in ("osm", "segments", "routes")}}
    points = sorted([[round(start["lat"], 5), round(start["lon"], 5)], [round(end["lat"], 5), round(end["lon"], 5)]])
    raw = json.dumps({"points": points, "settings": settings}, sort_keys=True, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def corridor_key(start: dict, end: dict, cfg: dict) -> str:
    """The key of the corridor's streets and photos. Unlike route_key it keeps the direction: a street's photo faces the
    way the routes walk it (Elena, 2026-11-14), so start → end and end → start have their own photos. The walk_photos
    settings are here, not in route_key, so the thermal key does not change with them."""
    photos = {"facing": "the walk, the street ahead at a turn", **cfg["walk_photos"],
              "own_street_tolerance_m": cfg["selection"]["own_street_tolerance_m"]}
    return hashlib.sha1(json.dumps({"route": route_key(start, end, cfg), "photos": photos,
                                    "from": [round(start["lat"], 5), round(start["lon"], 5)]}).encode()).hexdigest()[:16]


def walk_directions(paths: list, ahead_m: float = 30.0) -> dict:
    """{segment id: (forward, ahead)}, from the ways found, the shortest first: forward is True if the street is walked
    along its own drawing, False against it; ahead, the way's next points after it (local metres, about ahead_m of them),
    so a photo near a turn can look along the street ahead. A street the ways walk both ways keeps the first; the photos
    are checked again against each route once the routes are found (orient_photos)."""
    out = {}
    for path in paths:
        steps = path.steps
        for i, (e, forward) in enumerate(steps):
            if e.segment_id is None or e.segment_id in out:
                continue
            tail, got = [], 0.0
            for e2, f2 in steps[i + 1:]:
                coords = list(e2.line.coords) if f2 else list(e2.line.coords)[::-1]
                tail += coords[1:]
                got += e2.length
                if got >= ahead_m:
                    break
            out[e.segment_id] = (forward, tail)
    return out


def _turnable(photo: dict) -> bool:
    """A Street View photo or a Mapillary panorama can look any way; a flat photo looks its camera's way."""
    return photo.get("source") == "streetview" or bool(photo.get("pano"))


def orient_photos(features: list, ways: list, proj: LocalProjection, cfg: dict) -> list:
    """The route streets with their photos facing the way each route walks them (Elena, 2026-11-16). The walking
    direction at a photo is the route's bearing walk_photos.ahead_m further on (at a turn, the street ahead). A Street
    View photo or a Mapillary panorama is turned to it; a flat photo is kept only within walk_photos.max_turn_deg of it.
    Each kept photo has `offset_deg`, how far it looks from that direction. Only the photos along the part of the street
    the route walks are kept, in walking order: a route starts and ends part way along a street, and a photo behind the
    start or past the end made the walk go back and forth (Elena, 2026-11-16). A street walked by several routes takes
    the first route's, A's (Elena, 2026-11-16: it should have a photo for each direction; for now A's), so on the other
    route it may face the other way. The features are copies."""
    wp = cfg["walk_photos"]
    slack = cfg["selection"]["own_street_tolerance_m"]
    photos = {f["properties"]["id"]: f["properties"].get("photos") or [] for f in features}
    streets = {f["properties"]["id"]: proj_geom(shape(f["geometry"]), proj) for f in features}
    done: set = set()
    for way in ways:
        pts, spans, walked = [], [], 0.0
        for part in way["parts"]:
            xy = [proj.to_xy(lon, lat) for lon, lat in part["coordinates"]]
            line = LineString(xy) if len(xy) > 1 else None
            spans.append((part["segment_id"], walked, line))
            walked += line.length if line is not None else 0.0
            pts += xy[1:] if pts and xy and pts[-1] == xy[0] else xy
        if len(pts) < 2:
            continue
        route = LineString(pts)
        for seg_id, start, line in spans:
            if not seg_id or line is None or seg_id not in photos or seg_id in done:
                continue
            kept = []
            for ph in photos[seg_id]:
                pt = Point(proj.to_xy(ph["lon"], ph["lat"]))
                # Along the walked part: no further from it than from the whole street (behind the start or past the end
                # of the part, it is further).
                if line.distance(pt) > streets[seg_id].distance(pt) + slack:
                    continue
                at = start + line.project(pt)
                way_at = bearing_ahead(route, at, wp["ahead_m"])
                if _turnable(ph):
                    kept.append((at, {**ph, "heading": round(way_at, 1), "offset_deg": 0.0}))
                    continue
                offset = signed_turn(ph["heading"], way_at)
                if abs(offset) <= wp["max_turn_deg"]:
                    kept.append((at, {**ph, "offset_deg": round(offset, 1)}))
            photos[seg_id] = [ph for _, ph in sorted(kept, key=lambda t: t[0])]
            done.add(seg_id)
    return [{**f, "properties": {**f["properties"], "photos": photos[f["properties"]["id"]]}}
            if f["properties"]["id"] in done else f for f in features]


def _with_photo_share(ways: list, streets: list) -> list:
    """The ways with photo_share counted again, on the photos left once they face the walk."""
    has = {f["properties"]["id"] for f in streets if f["properties"].get("photos")}
    return [{**w, "photo_share": round(sum(p["length_m"] for p in w["parts"] if p["segment_id"] in has)
                                       / (w["length_m"] or 1), 3)} for w in ways]


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


def build_corridor(start: dict, end: dict, cfg: dict, key: str | None = None):
    """Yield progress events, then {"type": "corridor", "area": FeatureCollection, "zone": polygon}.
    With a key, the finished steps of an earlier try are read back (app/steps.py): the streets and the
    photos found so far; when a lookup fails or the caller stops reading,
    what was found is kept for the next try. Start and end are not written: only the key and streets."""
    r = cfg["routes"]
    where = cache_dir(cfg)
    lat, lon = middle(start, end)
    proj = LocalProjection(lat, lon)
    a, b = proj.to_xy(start["lon"], start["lat"]), proj.to_xy(end["lon"], end["lat"])

    ellipse = search_ellipse(a, b, cfg)
    ways_data = steps.load(where, key, "ways") if key else None
    if ways_data is None:
        yield {"type": "stage", "stage": "streets"}
        ring = ring_lonlat(ellipse, proj)
        ways_data = osm_local.ways_in(ring, cfg) or fetch_ways_in(ring, cfg)
        if key:
            steps.save(where, key, "ways", ways_data)
    ways, node_xy, _areas, _dropped = parse(ways_data, proj, cfg)
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

    total = len(corridor)
    found: dict = (steps.load(where, key, "photos") if key else None) or {}
    todo = [s for s in corridor if s.id not in found]
    yield {"type": "segments", "total": total, "done": total - len(todo)}
    finished = False
    try:
        for done, seg, photos in area_mod.lookup_photos(todo, proj, cfg, walk_directions(ways_found), streets=segments):
            found[seg.id] = photos
            yield {"type": "segment", "done": total - len(todo) + done, "total": total}
        finished = True
    finally:
        if key and not finished and found:
            steps.save(where, key, "photos", found)
    fc = {"type": "FeatureCollection", "features": [area_mod.feature(s, proj, found[s.id]) for s in corridor]}
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
    streets = orient_photos([f for f in fc["features"] if f["properties"]["id"] in used], [rt for rt in (a, b) if rt], proj, cfg)
    return {
        "routes": _with_photo_share([rt for rt in (a, b) if rt], streets),
        "verdict": verdict(a, b, values, by_id, state_of, limits),
        "segments": {"type": "FeatureCollection", "features": streets},
        "values": {k: values.get(k) for k in used},
    }


def find_candidates(fc: dict, start: dict, end: dict, limit: int, cfg: dict) -> dict:
    """The ways a Senses route chooses from: the shortest, then others at most a quarter longer that really differ
    from those already kept, at most `limit` in all. The browser rates their streets and keeps the easiest as B."""
    r = cfg["routes"]
    lat, lon = middle(start, end)
    proj = LocalProjection(lat, lon)
    graph = _graph_of(fc, proj, r["connect_gap_m"])
    node_a = snap(graph, proj.to_xy(start["lon"], start["lat"]), r["snap_max_m"])
    node_b = snap(graph, proj.to_xy(end["lon"], end["lat"]), r["snap_max_m"])
    shortest = shortest_path(graph, node_a, node_b) if node_a and node_b else None
    if shortest is None:
        raise RouteError("No walking way was found between these two points.")
    kept = [shortest]
    for path in alternatives(graph, node_a, node_b, shortest, r["length_ratio"], r["candidates"], r["candidate_penalty"]):
        if len(kept) < limit and all(different_share(path, k) >= r["min_difference_share"] for k in kept):
            kept.append(path)
    by_id = {f["properties"]["id"]: f for f in fc["features"]}
    no_state = lambda _seg: None  # noqa: E731
    ways = [_summary("A" if i == 0 else f"C{i}", "shortest" if i == 0 else "candidate", p, no_state, by_id, proj, cfg)
            for i, p in enumerate(kept)]
    used = {p["segment_id"] for w in ways for p in w["parts"] if p["segment_id"]}
    streets = orient_photos([f for f in fc["features"] if f["properties"]["id"] in used], ways, proj, cfg)
    return {"candidates": _with_photo_share(ways, streets), "values": {},
            "segments": {"type": "FeatureCollection", "features": streets}}
