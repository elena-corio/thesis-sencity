"""Sampling the UTCI grid onto segments (tool/thermal.py): pure, no API calls."""
import numpy as np
import pytest
from shapely.geometry import LineString, Polygon, mapping

from tool.geo import LocalProjection
from tool.thermal import cell_centres, segment_values

LAT, LON = 48.2085, 16.3721
PROJ = LocalProjection(LAT, LON)
# 200 x 200 cells of about 1 m around the centre.
D_LAT, D_LON = 100 / 111320, 100 / (111320 * np.cos(np.radians(LAT)))
BOUNDS = (LON - D_LON, LAT - D_LAT, LON + D_LON, LAT + D_LAT)


def feature(fid, geom_xy):
    geom = PROJ.geom_to_lonlat(geom_xy)
    return {"type": "Feature", "geometry": mapping(geom), "properties": {"id": fid}}


def test_row_zero_is_south_and_cells_are_one_metre():
    xs, ys = cell_centres((200, 200), BOUNDS, PROJ)
    assert ys[0, 100] < ys[199, 100]                     # row 0 is the southern edge
    assert xs[100, 1] - xs[100, 0] == pytest.approx(1.0, abs=0.01)
    assert ys[1, 100] - ys[0, 100] == pytest.approx(1.0, abs=0.01)
    assert abs(xs[100, 100]) < 1 and abs(ys[100, 100]) < 1


def test_street_takes_the_percentile_within_the_buffer():
    # Warmer to the north: value = 20 + row / 10 (row 0 south, about y = -100 m).
    grid = np.tile((20 + np.arange(200) / 10).astype(np.float32)[:, None], (1, 200))
    street = feature("s", LineString([(-30, 0), (30, 0)]))   # an east-west street at y = 0
    v = segment_values(grid, BOUNDS, [street], PROJ, buffer_m=4, percentile=75)["s"]
    # Cells from y = -4 to 4 m (rows ~96 to 104): 29.6 to 30.4 °C; the 75th percentile is ~30.2.
    assert 30.0 <= v <= 30.3


def test_park_uses_the_cells_inside_it_and_missing_cells_are_skipped():
    grid = np.full((200, 200), 25.0, dtype=np.float32)
    grid[100:, :] = np.nan                                     # no value in the northern half (buildings)
    park = feature("p", Polygon([(-20, -20), (20, -20), (20, 20), (-20, 20)]))
    hidden = feature("h", LineString([(-10, 50), (10, 50)]))   # entirely in the cells with no value
    out = segment_values(grid, BOUNDS, [park, hidden], PROJ, buffer_m=4, percentile=75)
    assert out == {"p": 25.0, "h": None}
