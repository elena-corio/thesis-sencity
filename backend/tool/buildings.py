"""Buildings along a walked route, for the walk view (board Routes 5): footprints and heights.

They come from the Infrared.city SDK, the call the thermal run already makes (`client.buildings.get_area`).
It reads the public building data for a polygon: in Vienna the city's own building model (Stadt Wien,
Baukörpermodell of the Flächen-Mehrzweckkarte, data.wien.gv.at), elsewhere Overture Maps footprints. The SDK
sends no request of its own to the Infrared.city API for this, so nothing is billed.

It answers with one mesh per building body, in metres from the south-west corner of the polygon's bounding
box (x east, y north, z up; the SDK's flat 111 320 m per degree), and a height per body. A footprint is the
union of the mesh's bottom triangles, turned back into lon/lat.
"""
import logging
import math

from shapely.geometry import LineString, Polygon, mapping
from shapely.ops import transform, unary_union
from shapely.prepared import prep

from tool.config import get_key
from tool.geo import LocalProjection

log = logging.getLogger("sencity.buildings")

M_PER_DEG = 111_320.0  # the SDK's frame (infrared_sdk._internal.geodata.bbox.METERS_PER_DEG_LAT)
BASE_TOLERANCE_M = 0.05  # a vertex this close to the lowest one is on the ground


class BuildingsError(Exception):
    """Buildings that cannot be read; the message is safe to show in the app."""


def read_area(polygon: dict, cfg: dict):
    """The SDK's buildings for a lon/lat GeoJSON polygon (AreaBuildings)."""
    from infrared_sdk import InfraredClient

    try:
        client = InfraredClient(api_key=get_key("INFRARED_API_KEY"), base_url="https://api.infrared.city/v2")
    except SystemExit:
        raise BuildingsError("Buildings are not set up on the server.") from None
    b = cfg["buildings"]
    return client.buildings.get_area(polygon, analysis_type=cfg["thermal"]["analysis"],
                                     timeout=b["timeout_s"], total_timeout=b["timeout_s"])


def footprint_xy(coordinates: list[float], indices: list[int]) -> Polygon | None:
    """The ground outline of one mesh (flat x, y, z list and triangle indices), in the mesh's metres."""
    pts = [(coordinates[i], coordinates[i + 1], coordinates[i + 2]) for i in range(0, len(coordinates) - 2, 3)]
    if not pts:
        return None
    zmin = min(p[2] for p in pts)
    tris = []
    for i in range(0, len(indices) - 2, 3):
        tri = [pts[j] for j in indices[i:i + 3]]
        if all(p[2] - zmin <= BASE_TOLERANCE_M for p in tri):
            t = Polygon([(p[0], p[1]) for p in tri])
            if t.area > 1e-6:
                tris.append(t)
    if not tris:
        return None
    shape = unary_union(tris)
    if shape.geom_type == "MultiPolygon":
        shape = max(shape.geoms, key=lambda g: g.area)
    return shape if shape.geom_type == "Polygon" and not shape.is_empty else None


def to_lonlat(geom, origin: tuple[float, float]):
    """Metres from the SDK's origin (lon, lat) back to lon/lat."""
    olon, olat = origin
    per_lon = M_PER_DEG * math.cos(math.radians(olat))
    return transform(lambda x, y, z=None: (olon + x / per_lon, olat + y / M_PER_DEG), geom)


def source_label(source_ids, cfg: dict) -> str:
    """Who the buildings are from, for the credits: a known city source by its id prefix, else Overture Maps."""
    b = cfg["buildings"]
    labels = []
    for sid in source_ids:
        prefix = str(sid).split(".")[0]
        label = b["sources"].get(prefix, b["default_source"])
        if label not in labels:
            labels.append(label)
    return " and ".join(labels)


def corridor(line: list[list[float]], buffer_m: float) -> Polygon:
    """The area within buffer_m of the walked line, as a lon/lat polygon."""
    lons = [p[0] for p in line]
    lats = [p[1] for p in line]
    proj = LocalProjection((min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2)
    xs, ys = proj.to_xy_many(lons, lats)
    zone = LineString(list(zip(xs, ys))).buffer(buffer_m, quad_segs=4).simplify(2.0)
    return proj.geom_to_lonlat(zone)


def along(line: list[list[float]], cfg: dict, read=None) -> dict:
    """Footprints with heights (h, and b for the base) of the bodies within the buffer of the walked line, and
    their source. read is the SDK call (read_area; a fake in tests)."""
    b = cfg["buildings"]
    zone = corridor(line, b["buffer_m"])
    try:
        area = (read or read_area)(mapping(zone), cfg)
    except BuildingsError:
        raise
    except Exception as e:  # noqa: BLE001 (any failure of the public data read)
        log.warning("buildings unavailable: %s", type(e).__name__)
        raise BuildingsError("Buildings could not be loaded here.") from None
    if area.origin is None:
        raise BuildingsError("Buildings could not be loaded here.")
    inside = prep(zone)
    features, used = [], []
    for key, mesh in area.buildings.items():
        attrs = area.attributes.get(key, {})
        height = float(attrs.get("height") or 0)
        if height < b["min_height_m"]:
            continue
        shape = footprint_xy(mesh.coordinates, mesh.indices)
        if shape is None:
            continue
        shape = to_lonlat(shape.simplify(b["simplify_m"]), area.origin)
        if not inside.intersects(shape):
            continue
        ring = [[round(x, 7), round(y, 7)] for x, y in shape.exterior.coords]
        features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]},
                         "properties": {"h": round(height, 1), "b": round(float(attrs.get("min_height") or 0), 1)}})
        used.append(attrs.get("source_id", key))
        if len(features) >= b["max_features"]:
            break
    log.info("buildings: %d of %d bodies along the route", len(features), area.total_buildings)
    return {"type": "FeatureCollection", "features": features, "source": source_label(used, cfg) if used else ""}
