"""Geometry helpers: a local metric projection centred on the area, circles, bearings."""
import math

from pyproj import Transformer
from shapely.geometry import Point, Polygon
from shapely.ops import transform


class LocalProjection:
    """Azimuthal equidistant projection centred on (lat, lon): x/y in metres."""

    def __init__(self, lat: float, lon: float):
        crs = f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs"
        self._fwd = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        self._inv = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

    def to_xy(self, lon: float, lat: float) -> tuple[float, float]:
        return self._fwd.transform(lon, lat)

    def to_lonlat(self, x: float, y: float) -> tuple[float, float]:
        return self._inv.transform(x, y)

    def geom_to_lonlat(self, geom):
        return transform(self._inv.transform, geom)


def circle(radius_m: float, n_points: int = 64) -> Polygon:
    """Circle centred on (0, 0) in local metres, as an n-point polygon."""
    return Polygon(
        (radius_m * math.cos(2 * math.pi * i / n_points), radius_m * math.sin(2 * math.pi * i / n_points))
        for i in range(n_points)
    )


def bearing_xy(x0: float, y0: float, x1: float, y1: float) -> float:
    """Compass bearing (0 = north, clockwise) from point 0 to point 1, local metres."""
    return math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360


def line_bearing_at(line, dist: float, step: float = 2.0) -> float:
    """Street direction at a distance along a line (compass degrees)."""
    a = line.interpolate(max(0.0, dist - step))
    b = line.interpolate(min(line.length, dist + step))
    if a.distance(b) < 1e-6:
        a, b = Point(line.coords[0]), Point(line.coords[-1])
    return bearing_xy(a.x, a.y, b.x, b.y)
