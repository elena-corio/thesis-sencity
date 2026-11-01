"""OpenStreetMap: fetch walkable ways, parks and squares around a point (Overpass API),
and turn them into street and area segments in local metres."""
import time
from dataclasses import dataclass, field

import requests
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import linemerge, polygonize, unary_union

from .geo import LocalProjection
from .segments import Piece, Way, build_chains, clip_and_split, merge_short


@dataclass
class Segment:
    id: str
    kind: str                 # "street" or "area"
    geom: object              # LineString or Polygon, local metres
    name: str = ""
    highway: str = ""
    osm_ids: list[str] = field(default_factory=list)


def fetch_overpass(lat: float, lon: float, radius_m: float, cfg: dict, with_buildings: bool = False) -> dict:
    """Walkable ways, parks and squares around the circle; with_buildings adds the building
    footprints in the same query (one wait for the public server instead of two)."""
    osm = cfg["osm"]
    hw = "|".join(osm["walkable_highways"])
    r = int(radius_m)
    area_parts = []
    for key, values in osm["area_tags"].items():
        for v in values:
            area_parts.append(f'way(around:{r},{lat},{lon})["{key}"="{v}"];')
            area_parts.append(f'relation(around:{r},{lat},{lon})["{key}"="{v}"];')
    roads = "|".join(osm["alongside_road"]["road_highways"])
    rb = r + osm["buildings_margin_m"]
    building_parts = (f'way(around:{rb},{lat},{lon})["building"]; relation(around:{rb},{lat},{lon})["building"];'
                      if with_buildings else "")
    query = f"""
[out:json][timeout:{osm['timeout_s']}];
(
  way(around:{r},{lat},{lon})["highway"~"^({hw})$"];
  way(around:{r + 30},{lat},{lon})["highway"~"^({roads})$"];
  {' '.join(area_parts)}
  {building_parts}
);
out geom;
"""
    return _post(query, osm)


def fetch_buildings(lat: float, lon: float, radius_m: float, cfg: dict) -> dict:
    """Building footprints around the circle, used to reject photos taken indoors."""
    osm = cfg["osm"]
    r = int(radius_m) + osm["buildings_margin_m"]
    query = f"""
[out:json][timeout:{osm['timeout_s']}];
(
  way(around:{r},{lat},{lon})["building"];
  relation(around:{r},{lat},{lon})["building"];
);
out geom;
"""
    return _post(query, osm)


def _post(query: str, osm: dict) -> dict:
    # The public server answers 429/502/503/504 when busy: wait and try again.
    for attempt in range(4):
        resp = requests.post(osm["overpass_url"], data={"data": query}, timeout=osm["timeout_s"] + 30,
                             headers={"User-Agent": "SenCity thesis tool (fetch_photos)"})
        if resp.status_code not in (429, 502, 503, 504) or attempt == 3:
            break
        time.sleep(10 * (attempt + 1))
    resp.raise_for_status()
    return resp.json()


def parse_buildings(data: dict, proj: LocalProjection, inset_m: float = 0):
    """Union of building footprints, optionally shrunk by inset_m."""
    polys = []
    for el in data.get("elements", []):
        if "building" not in el.get("tags", {}):
            continue
        if el["type"] == "way" and len(el.get("geometry", [])) >= 4:
            polys.append(Polygon([proj.to_xy(g["lon"], g["lat"]) for g in el["geometry"]]).buffer(0))
        elif el["type"] == "relation":
            outers = [LineString([proj.to_xy(g["lon"], g["lat"]) for g in m["geometry"]])
                      for m in el.get("members", [])
                      if m.get("type") == "way" and m.get("role") == "outer" and len(m.get("geometry", [])) >= 2]
            polys.extend(polygonize(linemerge(outers)) if outers else [])
    if not polys:
        return None
    union = unary_union(polys)
    return union.buffer(-inset_m) if inset_m else union


def _excluded(tags: dict, exclude: dict) -> str | None:
    for key, values in exclude.items():
        if str(tags.get(key, "")) in [str(v) for v in values]:
            return f"{key}={tags[key]}"
    return None


def _is_area_way(tags: dict, nodes: list, area_tags: dict) -> bool:
    if tags.get("highway") == "pedestrian":
        return tags.get("area") == "yes" and len(nodes) > 3 and nodes[0] == nodes[-1]
    return any(tags.get(k) in v for k, v in area_tags.items() if k != "highway")


def parse(data: dict, proj: LocalProjection, cfg: dict):
    """Split Overpass elements into street ways, area polygons and the road centrelines
    used for the alongside-road test. Returns (ways, node_xy, areas, dropped)."""
    osm = cfg["osm"]
    walkable = set(osm["walkable_highways"])
    roads = set(osm["alongside_road"]["road_highways"])
    ways: list[Way] = []
    node_xy: dict[int, tuple[float, float]] = {}
    areas: list[tuple[str, dict, Polygon]] = []
    road_lines: list[LineString] = []
    dropped: dict[str, int] = {}

    for el in data.get("elements", []):
        tags = el.get("tags", {})
        if el["type"] == "way":
            nodes, geom = el.get("nodes", []), el.get("geometry", [])
            if len(nodes) < 2 or len(nodes) != len(geom):
                continue
            xy = [proj.to_xy(g["lon"], g["lat"]) for g in geom]
            if _is_area_way(tags, nodes, osm["area_tags"]):
                if len(xy) >= 4:
                    areas.append((f"way/{el['id']}", tags, Polygon(xy).buffer(0)))
                continue
            hw = tags.get("highway")
            if hw in roads:
                road_lines.append(LineString(xy))
            if hw not in walkable:
                continue
            reason = _excluded(tags, osm["exclude_tags"])
            if reason:
                dropped[reason] = dropped.get(reason, 0) + 1
                continue
            for n, p in zip(nodes, xy):
                node_xy[n] = p
            ways.append(Way(el["id"], nodes, tags))
        elif el["type"] == "relation":
            if not any(tags.get(k) in v for k, v in osm["area_tags"].items()):
                continue  # e.g. a building relation from a combined query
            outers = [LineString([proj.to_xy(g["lon"], g["lat"]) for g in m["geometry"]])
                      for m in el.get("members", [])
                      if m.get("type") == "way" and m.get("role") in ("outer", "") and len(m.get("geometry", [])) >= 2]
            polys = list(polygonize(linemerge(outers))) if outers else []
            if polys:
                areas.append((f"relation/{el['id']}", tags, unary_union(polys)))

    # Footways with no footway=* tag that run alongside a road are sidewalks drawn as plain footways.
    along = osm["alongside_road"]
    if road_lines:
        road_zone = unary_union(road_lines).buffer(along["distance_m"])
        kept = []
        for w in ways:
            if w.tags.get("highway") == "footway" and "footway" not in w.tags:
                line = LineString([node_xy[n] for n in w.nodes])
                if line.length > 0 and line.intersection(road_zone).length / line.length >= along["min_share"]:
                    dropped["footway alongside road"] = dropped.get("footway alongside road", 0) + 1
                    continue
            kept.append(w)
        ways = kept
    return ways, node_xy, areas, dropped


def is_courtyard(tags: dict, poly: Polygon, buildings, cfg: dict) -> bool:
    """An unnamed area whose edge runs mostly along buildings: likely a courtyard,
    often private and photographed from inside. Named squares and courtyards are kept."""
    c = cfg["osm"]["courtyard"]
    if buildings is None or tags.get("name"):
        return False
    ring = poly.boundary  # the whole area, not clipped to the circle; works for multipolygons too
    return ring.intersection(buildings.buffer(c["building_distance_m"])).length / ring.length >= c["min_enclosed_share"]


def build_segments(ways, node_xy, areas, circle: Polygon, cfg: dict, buildings=None,
                   dropped: dict | None = None) -> list[Segment]:
    """Street and area segments. buildings (footprint union, local metres) enables the courtyard rule;
    dropped areas are counted in `dropped`."""
    seg_cfg = cfg["segments"]
    dropped = dropped if dropped is not None else {}
    by_id = {w.id: w for w in ways}
    segments: list[Segment] = []
    pieces: list[Piece] = []
    highway: dict[str, str] = {}
    for chain in build_chains(ways):
        line = LineString([node_xy[n] for n in chain.nodes])
        first = by_id[chain.way_ids[0]].tags
        base = f"s{chain.way_ids[0]}-{chain.nodes[0]}-{chain.nodes[-1]}"
        for i, part in enumerate(clip_and_split(line, circle, seg_cfg["target_length_m"],
                                                seg_cfg["min_isolated_length_m"])):
            pieces.append(Piece(f"{base}-{i}", part, first.get("name", ""), [f"way/{w}" for w in chain.way_ids]))
            highway[f"{base}-{i}"] = first.get("highway", "")
    # Leftover pieces under ~10 m join a neighbour instead of being dropped (no gaps at junctions).
    for p in merge_short(pieces, seg_cfg["merge_below_m"]):
        segments.append(Segment(p.id, "street", p.line, p.name, highway[p.id], p.osm_ids))
    kept_areas: list[Polygon] = []
    # Parks and squares first, then pedestrian areas, so a double-mapped square keeps its square.
    for osm_id, tags, poly in sorted(areas, key=lambda a: ("highway" in a[1] and "place" not in a[1]
                                                           and "leisure" not in a[1], a[0])):
        clipped = poly.intersection(circle)
        if clipped.is_empty or clipped.area < seg_cfg["min_area_m2"]:
            continue
        if isinstance(clipped, MultiPolygon):
            clipped = max(clipped.geoms, key=lambda g: g.area)
        if any(clipped.intersection(k).area / min(clipped.area, k.area) >= seg_cfg["max_area_overlap"]
               for k in kept_areas):
            continue
        if is_courtyard(tags, poly, buildings, cfg):
            dropped["courtyard"] = dropped.get("courtyard", 0) + 1
            continue
        kept_areas.append(clipped)
        kind = tags.get("leisure") or tags.get("place") or tags.get("highway") or "area"
        segments.append(Segment(f"a{osm_id.replace('/', '')}", "area", clipped, tags.get("name", ""),
                                kind, [osm_id]))
    segments.sort(key=lambda s: s.id)
    return segments
