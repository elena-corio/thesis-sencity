"""POST /api/routes with fixed streets and fakes: no Overpass, Street View or Infrared.city calls."""
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import area as area_mod
from app import main
from app import photos as photos_mod
from tool.photos.mapillary import bearing as mly_bearing
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


def fake_photo(coords, n=1001, heading=63.5):
    """A Mapillary photo in the shape tool/photos/mapillary.pick returns, a little way along the street."""
    (lon0, lat0), (lon1, lat1) = coords[0], coords[-1]
    lon, lat = lon0 + 0.25 * (lon1 - lon0), lat0 + 0.25 * (lat1 - lat0)
    return {"id": str(n), "lon": lon, "lat": lat, "heading": heading, "pano": False, "pano_heading": None, "turn": 0.0,
            "year": 2024, "date": "2024-07", "creator": "dora", "thumb_url": "https://example.org/t.jpg",
            "link": f"https://www.mapillary.com/app/?pKey={n}"}


def facing(coords, kind):
    """A fake photo as the real lookup chooses it: on a walked street looking the way it is walked."""
    return fake_photo(coords, heading=mly_bearing(coords[0], coords[-1]) if kind == "walk" else 63.5)


def fake_mapillary(monkeypatch, photo_for=None):
    """No Mapillary call: every street gets a fake photo (or what photo_for returns). A street the routes walk asks for a
    photo facing the walk (kind "walk"), with its coordinates in walking order."""
    find = photo_for or (lambda s, coords, kind, cfg: facing(coords, kind))
    monkeypatch.setattr(photos_mod.mapillary, "session", lambda: None)
    monkeypatch.setattr(photos_mod.mapillary, "photo_for", find)
    monkeypatch.setattr(photos_mod.mapillary, "photo_walking", lambda s, coords, cfg, ahead=None: find(s, coords, "walk", cfg))


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
    monkeypatch.setattr(routes_mod, "count_jobs", lambda polygon, cfg: 3)
    fake_mapillary(monkeypatch)
    main._hits.clear()
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
    # A's last street is walked south by B (a different way): its photo faces neither, so it has none (Elena, 2026-11-16).
    assert a["thermal_share"] == 1 and 0.8 < a["photo_share"] < 1
    assert "avoids the hot part of Heissgasse" in done["verdict"]  # the fixture joins the corner into one street
    # The first part starts where the walk starts, and the last part ends at the end.
    assert a["parts"][0]["coordinates"][0] == pytest.approx([START["lon"], START["lat"]], abs=1e-5)
    assert a["parts"][-1]["coordinates"][-1] == pytest.approx([END["lon"], END["lat"]], abs=1e-5)
    # Every part's street is sent, with its value and photos, so the card can show it.
    ids = {f["properties"]["id"] for f in done["segments"]["features"]}
    assert {p["segment_id"] for r in done["routes"] for p in r["parts"]} <= ids
    assert set(done["values"]) == ids
    assert calls[0]["max_jobs"] == 8


def test_a_senses_route_loads_no_thermal_comfort_and_offers_candidates(client):
    # conftest makes any thermal run fail the test.
    evs = events(client.post("/api/routes", json={**REQ, "layer": "senses"}))
    assert "thermal" not in [e.get("stage") for e in evs]
    done = evs[-1]
    assert done["type"] == "routes" and done["station"] is None and done["routes"] == []
    ways = done["candidates"]
    assert 2 <= len(ways) <= main.cfg["senses"]["route_candidates"]
    assert ways[0]["kind"] == "shortest" and ways[0]["id"] == "A" and ways[0]["photo_share"] > 0
    assert {f["properties"]["id"] for f in done["segments"]["features"]} == {p["segment_id"] for w in ways for p in w["parts"] if p["segment_id"]}


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
        list(routes_mod.build_corridor(START, END, cfg))


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


def test_route_streets_get_their_mapillary_photo_facing_the_walk(client, monkeypatch):
    # Elena, 2026-11-16: each photo faces the way the route walks it, within 60 degrees, with its offset stored.
    monkeypatch.setattr(area_mod, "run_utci", fake_utci([]))
    done = events(client.post("/api/routes", json=REQ))[-1]
    by_id = {f["properties"]["id"]: f["properties"]["photos"] for f in done["segments"]["features"]}
    walks = {}
    for r in done["routes"]:
        for p in r["parts"]:
            if p["segment_id"]:
                walks.setdefault(p["segment_id"], []).append(r["id"])
    for seg, photos in by_id.items():
        assert all(abs(p["offset_deg"]) <= 60 for p in photos)
        if len(walks[seg]) == 1:
            assert len(photos) == 1 and photos[0]["id"] == "1001"
    # The street both ways walk in different directions (A east, B south into the end): no photo faces both.
    shared = [seg for seg, ways in walks.items() if len(ways) > 1]
    assert shared and all(by_id[seg] == [] for seg in shared)


def test_photos_are_turned_or_kept_by_the_way_each_route_walks():
    """orient_photos on its own: a street walked east, with a flat photo looking north-east, one looking west and a
    Street View photo (turned to the walk)."""
    from tool.geo import LocalProjection
    proj = LocalProjection(48.208, 16.37)
    street = {"type": "Feature", "properties": {"id": "s", "photos": [
        {"id": "ne", "source": "mapillary", "pano": False, "lon": 16.3702, "lat": 48.208, "heading": 50.0},
        {"id": "w", "source": "mapillary", "pano": False, "lon": 16.3703, "lat": 48.208, "heading": 270.0},
        {"id": "sv:p", "source": "streetview", "pano_id": "p", "lon": 16.3704, "lat": 48.208, "heading": 270.0}]}}
    east = {"parts": [{"segment_id": "s", "coordinates": [[16.37, 48.208], [16.371, 48.208]]}]}
    [f] = routes_mod.orient_photos([street], [east], proj, main.full_cfg)
    got = {p["id"]: (round(p["heading"]), p["offset_deg"]) for p in f["properties"]["photos"]}
    assert got == {"ne": (50, -40.0), "sv:p": (90, 0.0)}
    assert street["properties"]["photos"][2]["heading"] == 270.0  # the cached street is not changed
    # Walked west by a second route as well: nothing faces both ways.
    west = {"parts": [{"segment_id": "s", "coordinates": [[16.371, 48.208], [16.37, 48.208]]}]}
    [f] = routes_mod.orient_photos([street], [east, west], proj, main.full_cfg)
    assert f["properties"]["photos"] == []


def test_walk_directions_keep_the_first_way_that_walks_a_street():
    from shapely.geometry import LineString
    from tool.routing import Edge, Path

    def edge(i, seg):
        return Edge(i, (0, i), (0, i + 1), seg, LineString([(0, i), (0, i + 1)]))
    first = Path([(edge(0, "s1"), True), (edge(1, None), False), (edge(2, "s2"), False)], 3.0)
    second = Path([(edge(3, "s1"), False), (edge(4, "s3"), True)], 2.0)
    found = routes_mod.walk_directions([first, second])
    assert {k: forward for k, (forward, _) in found.items()} == {"s1": True, "s2": False, "s3": True}
    # With the way's next points: s1 is followed by the connector (walked backwards), then s2 (backwards too).
    assert found["s1"][1] == [(0.0, 1.0), (0.0, 2.0)]
    assert found["s2"][1] == []  # the end of the way


def test_route_streets_ask_for_a_photo_facing_the_walk_and_swapping_has_its_own(client, monkeypatch):
    # Elena, 2026-11-14: photos in the direction of the route first; the preview, the card and the walk show that photo.
    calls = []
    asked = []

    def photo_for(s, coords, kind, cfg):
        asked.append((kind, coords))
        return facing(coords, kind)
    fake_mapillary(monkeypatch, photo_for)
    monkeypatch.setattr(area_mod, "run_utci", fake_utci(calls))
    there = events(client.post("/api/routes", json=REQ))[-1]
    walked = {p["segment_id"] for r in there["routes"] for p in r["parts"] if p["segment_id"]}
    assert walked and {k for k, _ in asked} <= {"walk", "street"}
    walk_calls = [c for k, c in asked if k == "walk"]
    assert len(walk_calls) >= len(walked)
    # Heissgasse is walked east, so its photo is asked for looking east: coordinates in walking order.
    heiss = [c for c in walk_calls if c[0][1] == pytest.approx(48.2080) and c[-1][1] == pytest.approx(48.2080)]
    assert heiss and all(c[0][0] < c[-1][0] for c in heiss)

    asked.clear()
    back = events(client.post("/api/routes", json={**REQ, "start": END, "end": START}))[-1]
    assert back["type"] == "routes"
    heiss = [c for k, c in asked if k == "walk" and c[0][1] == pytest.approx(48.2080) and c[-1][1] == pytest.approx(48.2080)]
    assert heiss and all(c[0][0] > c[-1][0] for c in heiss)  # walked west: its own photos
    assert len(calls) == 1  # thermal comfort is still paid for once, either way round
    assert routes_mod.corridor_key(START, END, main.full_cfg) != routes_mod.corridor_key(END, START, main.full_cfg)
    assert routes_mod.route_key(START, END, main.full_cfg) == routes_mod.route_key(END, START, main.full_cfg)
