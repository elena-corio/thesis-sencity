"""Thermal comfort on the streets (brief §4): sample the UTCI grid along each segment.

Pure: no API calls. The grid comes from tool/infrared.py. Its row 0 is the southern edge and
`bounds` is (min_lon, min_lat, max_lon, max_lat) of the whole grid, so a cell's centre follows
from its row and column. A street's value is the given percentile of the cells within buffer_m
either side of its line; a park or square uses the cells inside it.
"""
import numpy as np
import shapely
from shapely.geometry import shape

from tool.geo import LocalProjection


def thermal_state(utci: float, limits: dict) -> str:
    """easy, mixed or hard from a feels-like value: the same rule as frontend/src/lib/thermal.js (brief §4)."""
    h3, h2 = limits["heat"][:2]
    c4, c3 = limits["cold"][1:3]
    if utci > h2:
        return "hard"
    if utci > h3:
        return "mixed"
    if utci >= c4:
        return "easy"
    return "mixed" if utci >= c3 else "hard"


def thermal_state(utci: float, limits: dict) -> str:
    """easy, mixed or hard from a feels-like value: the same rule as frontend/src/lib/thermal.js (brief §4)."""
    h3, h2 = limits["heat"][:2]
    c4, c3 = limits["cold"][1:3]
    if utci > h2:
        return "hard"
    if utci > h3:
        return "mixed"
    if utci >= c4:
        return "easy"
    return "mixed" if utci >= c3 else "hard"


def cell_centres(shape_rc: tuple[int, int], bounds: tuple[float, float, float, float],
                 proj: LocalProjection) -> tuple[np.ndarray, np.ndarray]:
    """Local x/y in metres of every cell centre, as two (rows, cols) arrays."""
    rows, cols = shape_rc
    min_lon, min_lat, max_lon, max_lat = bounds
    lons = min_lon + (np.arange(cols) + 0.5) * (max_lon - min_lon) / cols
    lats = min_lat + (np.arange(rows) + 0.5) * (max_lat - min_lat) / rows  # row 0 = south
    lon_g, lat_g = np.meshgrid(lons, lats)
    x, y = proj.to_xy_many(lon_g.ravel(), lat_g.ravel())
    return np.asarray(x).reshape(rows, cols), np.asarray(y).reshape(rows, cols)


def segment_values(grid: np.ndarray, bounds, features: list[dict], proj: LocalProjection,
                   buffer_m: float, percentile: float) -> dict[str, float | None]:
    """UTCI (°C, one decimal) per segment id, or None where the grid has no value there."""
    xs, ys = cell_centres(grid.shape, bounds, proj)
    out: dict[str, float | None] = {}
    for f in features:
        geom = proj_geom(shape(f["geometry"]), proj)
        zone = geom.buffer(buffer_m) if geom.geom_type in ("LineString", "MultiLineString") else geom
        x0, y0, x1, y1 = zone.bounds
        box = (xs >= x0) & (xs <= x1) & (ys >= y0) & (ys <= y1)
        inside = np.zeros_like(box)
        inside[box] = shapely.contains_xy(zone, xs[box], ys[box])
        vals = grid[inside]
        vals = vals[np.isfinite(vals)]
        out[f["properties"]["id"]] = round(float(np.percentile(vals, percentile)), 1) if vals.size else None
    return out


def proj_geom(geom, proj: LocalProjection):
    """A lon/lat geometry in local metres."""
    return shapely.transform(geom, lambda c: np.column_stack(proj.to_xy_many(c[:, 0], c[:, 1])))
