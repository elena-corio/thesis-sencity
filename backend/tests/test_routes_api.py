"""POST /api/routes with fixed streets and fakes: no Overpass, Street View or Infrared.city calls."""
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import area as area_mod
from app import main
from app import routes as routes_mod
from tool.infrared import ThermalError

# Two ways between the two points below: south along y = 48.2080 (short), or north via y = 48.2083.
LIMITS = {"heat": [26, 32], "cold": [9, -13]}
START = {"lat": 48.2080, "lon": 16.3700}
END = {"lat": 48.2080, "lon": 16.3740}
REQ = {"start": START, "end": END, "limits": LIMITS}


def line(way_id, name, coords, named=True):
    return (way_id, name, coords, named)


STREETS = [
    line(1, "Heissgasse", [(16.3700, 48.2080), (16.3720, 48.2080)]),
    line(2, "Heissgasse", [(16.3720, 48.2080), (16.3740, 48.2080)]),
    line(3, "Nordweg", [(16.3700, 48.2080), (16.3700, 48.2083)]),
    line(4, "Kuehlgasse", [(16.3700, 48.2083), (16.3740, 48.2083)]),
    line(5, "Suedweg", [(16.3740, 48.2083), (16.3740, 48.2080)]),
]


def overpass_answer():
    nodes = {}

    def node(c):
        return nodes.setdefault(c, len(nodes) + 1)

    return {"elements": [{"type": "way", "id": w, "nodes": [node(c) for c in coords],
                          "geometry": [{"lon": c[0], "lat": c[1]} for c in coords],
                          "tags": {"highway": "residential", "name": name}}
                         for w, name, coords, _ in STREETS]}


class FakeMeta:
    def __init__(self, lat, lon):
        self.photo_id, self.lat, self.lon, self.date, self.official = "PANOPANOPANOPANO", lat, lon, "2024-07", True


class FakeProvider:
    metadata_calls = 0

    def search(self, lat, lon, radius=None):
        return FakeMeta(lat, lon)


def fake_utci(calls, cooler_north=True):
    """Feels-like °C: 36 (hard) south of 48.2082, 22 (easy) north of it."""
    def run(polygon, lat, lon, season, time, cfg):
        calls.append({"season": season, "time": time, "polygon": polygon, "max_jobs": cfg["thermal"]["max_jobs"]})
        grid = np.full((400, 600), 36.0, dtype=np.float32)
        if cooler_north:
            grid[200:, :] = 22.0
        return {"grid": grid, "bounds": (16.3680, 48.2062, 16.3760, 48.2102),
                "station": {"name": "Test station", "distance_km": 1.0}, "jobs": 3}
    return run


def events(resp):
    return [json.loads(ln) for ln in resp.text.splitlines() if ln.strip()]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(routes_mod, "cache_dir", lambda cfg: tmp_path / "routes")
    monkeypatch.setattr(routes_mod, "fetch_ways_in", lambda ring, cfg: overpass_answer())
    monkeypatch.setattr(routes_mod, "fetch_buildings_in", lambda ring, cfg: {"elements": []})
    monkeypatch.setattr(routes_mod, "count_jobs", lambda polygon, cfg: 3)
    monkeypatch.setattr(main, "provider", lambda: FakeProvider())
    main._hits.clear()
    main._known_photos.clear()
    c = TestClient(main.app)
    c.tmp = tmp_path
    return c


def test_new_route_streams_progress_then_two_ways(client, monkeypatch):
    calls = []
    monkeypatch.setattr(area_mod, "run_utci", fake_utci(calls))
    evs = events(client.post("/api/routes", json=REQ))
    types = [e["type"] for e in evs]
    assert types[0] == "stage" and "segments" in types and "segment" in types
    assert types[-3:] == ["stage", "stage", "routes"]
    assert [e["stage"] for e in evs if e["type"] == "stage"] == ["streets", "thermal", "routes"]
    # Nothing on the map before the end: progress events carry counts, not streets.
    assert all("feature" not in e and "features" not in e for e in evs[:-1])

    done = evs[-1]
    a, b = done["routes"]
    assert a["id"] == "A" and a["kind"] == "shortest" and b["id"] == "B" and b["kind"] == "easiest"
    assert a["hard_share"] == 1 and b["hard_share"] < 0.5
    assert b["length_m"] > a["length_m"] and b["length_m"] <= a["length_m"] * 1.25
    assert a["minutes"] >= 1 and b["minutes"] >= a["minutes"]
    assert a["thermal_share"] == 1 and a["photo_share"] == 1
    assert "avoids the hot part of Heissgasse" in done["verdict"]  # the fixture joins the corner into one street
    # The first part starts where the walk starts, and the last part ends at the end.
    assert a["parts"][0]["coordinates"][0] == pytest.approx([START["lon"], START["lat"]], abs=1e-5)
    assert a["parts"][-1]["coordinates"][-1] == pytest.approx([END["lon"], END["lat"]], abs=1e-5)
    # Every part's street is sent, with its value and photos, so the card can show it.
    ids = {f["properties"]["id"] for f in done["segments"]["features"]}
    assert {p["segment_id"] for r in done["routes"] for p in r["parts"]} <= ids
    assert set(done["values"]) == ids
    assert calls[0]["max_jobs"] == 8


def test_thermal_is_paid_for_once_per_route_and_window(client, monkeypatch):
    calls = []
    monkeypatch.setattr(area_mod, "run_utci", fake_utci(calls))
    streets = []
    monkeypatch.setattr(routes_mod, "fetch_ways_in", lambda r, c: streets.append(1) or overpass_answer())
    first = events(client.post("/api/routes", json=REQ))[-1]
    again = events(client.post("/api/routes", json=REQ))[-1]
    winter = events(client.post("/api/routes", json={**REQ, "season": "winter"}))[-1]
    assert first["routes"] == again["routes"]
    assert [c["season"] for c in calls] == ["summer", "winter"]
    assert len(streets) == 1  # the corridor is read once
    assert winter["season"] == "winter"


def test_verdict_says_part_of_a_street_when_b_also_walks_it():
    def seg(name):
        return {"properties": {"name": name, "named": True}}

    by_id = {"hot": seg("Rotenturmstrasse"), "cool": seg("Rotenturmstrasse"), "other": seg("Fleischmarkt")}
    values = {"hot": 35, "cool": 25, "other": 25}
    state_of = lambda s: "hard" if values[s] > 32 else "easy"  # noqa: E731
    a = {"minutes": 11, "hard_share": 0.3, "parts": [{"segment_id": "hot", "length_m": 90}]}
    b = {"minutes": 12, "hard_share": 0.0, "kind": "easiest", "parts": [{"segment_id": "cool", "length_m": 90}]}
    assert routes_mod.verdict(a, b, values, by_id, state_of, LIMITS) == "B is 1 minute longer but avoids the hot part of Rotenturmstrasse."
    b["parts"] = [{"segment_id": "other", "length_m": 90}]
    assert routes_mod.verdict(a, b, values, by_id, state_of, LIMITS) == "B is 1 minute longer but avoids the hot stretch on Rotenturmstrasse."


def test_swapping_start_and_end_is_not_paid_for_twice(client, monkeypatch):
    calls = []
    monkeypatch.setattr(area_mod, "run_utci", fake_utci(calls))
    there = events(client.post("/api/routes", json=REQ))[-1]
    back = events(client.post("/api/routes", json={**REQ, "start": END, "end": START}))[-1]
    assert len(calls) == 1
    assert back["routes"][0]["length_m"] == pytest.approx(there["routes"][0]["length_m"], abs=0.5)
    assert back["routes"][0]["parts"][0]["coordinates"][0] == pytest.approx([END["lon"], END["lat"]], abs=1e-5)


def test_cache_does_not_keep_the_start_or_the_end(client, monkeypatch):
    monkeypatch.setattr(area_mod, "run_utci", fake_utci([]))
    client.post("/api/routes", json=REQ)
    [path] = list((client.tmp / "routes").glob("*.json"))
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert "start" not in saved and "end" not in saved
    assert set(saved) == {"created", "lat", "lon", "zone", "area"}


def test_limits_decide_which_streets_are_hard(client, monkeypatch):
    monkeypatch.setattr(area_mod, "run_utci", fake_utci([]))
    # With a higher heat limit nothing is hard, so A is already easiest.
    done = events(client.post("/api/routes", json={**REQ, "limits": {"heat": [40, 42], "cold": LIMITS["cold"]}}))[-1]
    assert done["routes"][0]["hard_share"] == 0
    assert done["routes"][1]["kind"] == "second"
    assert done["verdict"].startswith("A is already the easiest way")


def test_thermal_failure_says_so_and_finds_no_routes(client, monkeypatch):
    def fail(*a, **k):
        raise ThermalError("No weather station near this area, so thermal comfort is not available here.")

    monkeypatch.setattr(area_mod, "run_utci", fail)
    evs = events(client.post("/api/routes", json=REQ))
    assert evs[-1]["type"] == "thermal_error"
    assert "routes" not in [e["type"] for e in evs]


def test_points_too_close_or_too_far_are_refused_before_any_call(client, monkeypatch):
    def no_call(*a, **k):
        raise AssertionError("nothing may be fetched")

    monkeypatch.setattr(routes_mod, "fetch_ways_in", no_call)
    near = client.post("/api/routes", json={**REQ, "end": {"lat": 48.20801, "lon": 16.37001}})
    far = client.post("/api/routes", json={**REQ, "end": {"lat": 48.25, "lon": 16.45}})
    assert near.status_code == 422 and "too close" in near.json()["detail"]
    assert far.status_code == 422 and "too far" in far.json()["detail"]


def test_a_walk_longer_than_the_limit_is_refused_before_thermal(client):
    cfg = {**main.full_cfg, "routes": {**main.full_cfg["routes"], "max_walk_m": 100}}
    with pytest.raises(routes_mod.RouteError, match="Routes go up to 0.1 km"):
        list(routes_mod.build_corridor(START, END, cfg, FakeProvider()))


def test_requests_are_checked(client):
    assert client.post("/api/routes", json={**REQ, "season": "monsoon"}).status_code == 422
    assert client.post("/api/routes", json={**REQ, "time": "15:30"}).status_code == 422
    assert client.post("/api/routes", json={"start": START, "end": END}).status_code == 422
    assert client.post("/api/routes", json={**REQ, "limits": {"heat": [1], "cold": [1]}}).status_code == 422


def test_the_corridor_is_narrowed_to_fit_the_tiles(client, monkeypatch):
    calls = []
    monkeypatch.setattr(area_mod, "run_utci", fake_utci(calls))
    previews = []

    def preview(polygon, cfg):
        previews.append(polygon)
        return 99 if len(previews) == 1 else 3

    monkeypatch.setattr(routes_mod, "count_jobs", preview)
    client.post("/api/routes", json=REQ)
    assert len(previews) == 2
    assert calls[0]["polygon"] == previews[1]


def test_route_photos_can_be_fetched(client, monkeypatch):
    monkeypatch.setattr(area_mod, "run_utci", fake_utci([]))
    done = events(client.post("/api/routes", json=REQ))[-1]
    photos = [ph for f in done["segments"]["features"] for ph in f["properties"]["photos"]]
    assert photos and all((ph["pano_id"], float(ph["heading"])) in main._known_photos for ph in photos)
