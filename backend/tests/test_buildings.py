"""Buildings for the walk view: footprints from the SDK's meshes, the corridor, the source, the cache and the API.
The SDK is never called: read_area is faked with boxes in its metre frame."""
import math
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import buildings as buildings_app
from app.main import app, full_cfg
from tool import buildings as tool

ORIGIN = (16.370, 48.208)  # lon, lat of the fake frame's south-west corner
PER_LON = tool.M_PER_DEG * math.cos(math.radians(ORIGIN[1]))


def box_mesh(x0, y0, w, d, h):
    """A box w x d metres from (x0, y0), h high, as a mesh: 8 corners, 12 triangles."""
    xs, ys = (x0, x0 + w), (y0, y0 + d)
    corners = [(x, y, z) for z in (0, h) for y in ys for x in xs]  # 0..3 bottom, 4..7 top
    coords = [c for p in corners for c in p]
    faces = [(0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5), (0, 4, 5), (0, 5, 1),
             (2, 3, 7), (2, 7, 6), (0, 2, 6), (0, 6, 4), (1, 5, 7), (1, 7, 3)]
    return SimpleNamespace(coordinates=coords, indices=[i for f in faces for i in f])


def lonlat(x, y):
    return [ORIGIN[0] + x / PER_LON, ORIGIN[1] + y / tool.M_PER_DEG]


def fake_area(bodies):
    """bodies: {key: (x0, y0, w, d, h, source_id)}"""
    return SimpleNamespace(
        origin=ORIGIN, total_buildings=len(bodies),
        buildings={k: box_mesh(*v[:5]) for k, v in bodies.items()},
        attributes={k: {"height": v[4], "min_height": 0.0, "source_id": v[5]} for k, v in bodies.items()},
    )


# A line due east along y = 100 m, from x = 0 to x = 300 m.
LINE = [lonlat(0, 100), lonlat(300, 100)]
BODIES = {
    "near": (100, 110, 20, 10, 18.4, "FMZKBKMOGD.1"),     # 10 m from the line
    "far": (100, 600, 20, 10, 25.0, "FMZKBKMOGD.2"),      # 500 m away: left out
    "low": (150, 90, 4, 4, 1.0, "FMZKBKMOGD.3"),          # under min_height_m
}


def test_footprint_is_the_ground_outline():
    m = box_mesh(10, 20, 30, 15, 12)
    shape = tool.footprint_xy(m.coordinates, m.indices)
    assert shape.area == pytest.approx(450)
    assert shape.bounds == pytest.approx((10, 20, 40, 35))


def test_along_keeps_bodies_near_the_line(monkeypatch):
    monkeypatch.setattr(tool, "read_area", lambda polygon, cfg: fake_area(BODIES))
    out = tool.along(LINE, full_cfg)
    assert [f["properties"] for f in out["features"]] == [{"h": 18.4, "b": 0.0}]
    ring = out["features"][0]["geometry"]["coordinates"][0]
    lons, lats = [p[0] for p in ring], [p[1] for p in ring]
    assert min(lons) == pytest.approx(lonlat(100, 0)[0], abs=1e-6)
    assert min(lats) == pytest.approx(lonlat(0, 110)[1], abs=1e-6)
    assert out["source"] == "Stadt Wien – data.wien.gv.at"


def test_source_other_than_the_city_is_overture():
    assert tool.source_label(["08b1e5f0abc"], full_cfg) == "Overture Maps"
    assert tool.source_label(["FMZKBKMOGD.1", "x"], full_cfg) == "Stadt Wien – data.wien.gv.at and Overture Maps"


def test_failure_has_a_message_for_the_app(monkeypatch):
    def broken(polygon, cfg):
        raise RuntimeError("network")
    monkeypatch.setattr(tool, "read_area", broken)
    with pytest.raises(tool.BuildingsError, match="could not be loaded"):
        tool.along(LINE, full_cfg)


def test_cache_does_not_hold_the_line(monkeypatch):
    calls = []

    def read(polygon, cfg):
        calls.append(1)
        return fake_area(BODIES)
    monkeypatch.setattr(tool, "read_area", read)
    first, cached = buildings_app.buildings_for(LINE, full_cfg)
    again, cached_again = buildings_app.buildings_for(LINE[::-1], full_cfg)  # either way round
    assert (cached, cached_again, len(calls)) == (False, True, 1)
    assert again == first
    text = (buildings_app.cache_dir(full_cfg) / f"{buildings_app.line_key(LINE, full_cfg)}.json").read_text(encoding="utf-8")
    assert f"{LINE[0][0]:.5f}" not in text  # the walked line's first point is not in the file


def test_api(monkeypatch):
    monkeypatch.setattr(tool, "read_area", lambda polygon, cfg: fake_area(BODIES))
    client = TestClient(app)
    res = client.post("/api/buildings", json={"line": LINE})
    assert res.status_code == 200
    assert len(res.json()["features"]) == 1
    too_long = [lonlat(0, 0), lonlat(0, 5000)]
    assert client.post("/api/buildings", json={"line": too_long}).status_code == 422
    assert client.post("/api/buildings", json={"line": [LINE[0]]}).status_code == 422


def test_api_failure_is_503(monkeypatch):
    def broken(polygon, cfg):
        raise tool.BuildingsError("Buildings are not set up on the server.")
    monkeypatch.setattr(tool, "read_area", broken)
    res = TestClient(app).post("/api/buildings", json={"line": LINE})
    assert res.status_code == 503
    assert res.json()["detail"] == "Buildings are not set up on the server."
