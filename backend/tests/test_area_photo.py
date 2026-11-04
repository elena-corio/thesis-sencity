"""POST /api/area and GET /api/photo with a fixed sample and a fake provider (no API calls).
Thermal comfort uses a fake runner (conftest refuses the real one)."""
import json
import os

import numpy as np

import pytest
from fastapi.testclient import TestClient

from app import area as area_mod
from app import main

SAMPLE = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "id": "s1-1-2-0",
     "geometry": {"type": "LineString", "coordinates": [[16.3700, 48.2083], [16.3710, 48.2085]]},
     "properties": {"id": "s1-1-2-0", "name": "Graben", "named": True, "place_type": "pedestrian",
                    "way_type": "pedestrian", "length_m": 78.4,
                    "photos": [{"pano_id": "AAAAAAAAAAAAAAAAAAAAAA", "lat": 48.2084, "lon": 16.3704,
                                "heading": 63.5, "date": "2024-07", "contributor": False}]}},
    {"type": "Feature", "id": "s2-3-4-0",
     "geometry": {"type": "LineString", "coordinates": [[16.3712, 48.2080], [16.3715, 48.2079]]},
     "properties": {"id": "s2-3-4-0", "name": "Footway", "named": False, "place_type": "street",
                    "way_type": "footway", "length_m": 24.0, "photos": []}},
]}
REQ = {"lat": 48.2085, "lon": 16.3721, "radius": 100}
KEY_VALUE = "TEST-KEY-must-never-leave-the-server"


def fake_utci(calls):
    """A runner that returns a 300 x 300 grid around REQ, warmer to the east (25 to 34 °C)."""
    def run(polygon, lat, lon, season, time, cfg):
        calls.append((season, time))
        grid = np.tile(np.linspace(25, 34, 300, dtype=np.float32), (300, 1))
        return {"grid": grid, "bounds": (lon - 0.002, lat - 0.0014, lon + 0.002, lat + 0.0014),
                "station": {"name": "Test station", "distance_km": 1.0}, "jobs": 1}
    return run


def events(resp):
    return [json.loads(line) for line in resp.text.splitlines() if line.strip()]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(area_mod, "cache_dir", lambda cfg: tmp_path / "areas")
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", KEY_VALUE)
    main._hits.clear()
    main._known_photos.clear()
    c = TestClient(main.app)
    c.tmp = tmp_path
    return c


def test_cached_area_answers_at_once_without_calls(client, monkeypatch):
    key = area_mod.area_key(REQ["lat"], REQ["lon"], REQ["radius"], main.full_cfg)
    area_mod.save_cached(key, REQ["lat"], REQ["lon"], REQ["radius"], SAMPLE, main.full_cfg)

    def no_run(*a, **k):
        raise AssertionError("the pipeline must not run for a cached area")

    calls = []
    monkeypatch.setattr(area_mod, "run_area", no_run)
    monkeypatch.setattr(area_mod, "run_utci", fake_utci(calls))
    r = client.post("/api/area", json=REQ)
    assert r.status_code == 200
    done, stage, thermal = events(r)
    assert done["type"] == "done" and done["cached"] is True
    props = done["area"]["features"][0]["properties"]
    assert props["name"] == "Graben" and props["photos"][0]["pano_id"] == "AAAAAAAAAAAAAAAAAAAAAA"
    assert done["area"]["features"][1]["properties"]["photos"] == []
    assert stage == {"type": "stage", "stage": "thermal"}
    assert thermal["type"] == "thermal" and set(thermal["values"]) == {"s1-1-2-0", "s2-3-4-0"}


def test_new_area_streams_progress_and_is_cached(client, monkeypatch):
    def fake_run(lat, lon, radius, cfg, prov):
        pending = [{**f, "properties": {**f["properties"], "photos": None}} for f in SAMPLE["features"]]
        yield {"type": "segments", "features": pending, "total": 2}
        for i, f in enumerate(SAMPLE["features"], start=1):
            yield {"type": "segment", "feature": f, "done": i, "total": 2}
        yield {"type": "done", "area": SAMPLE, "metadata_calls": 0}

    calls = []
    monkeypatch.setattr(area_mod, "run_area", fake_run)
    monkeypatch.setattr(area_mod, "run_utci", fake_utci(calls))
    monkeypatch.setattr(main, "provider", lambda: object())
    r = client.post("/api/area", json=REQ)
    assert [e["type"] for e in events(r)] == ["segments", "segment", "segment", "done", "stage", "thermal"]
    assert calls == [("summer", "15:00")]
    key = area_mod.area_key(REQ["lat"], REQ["lon"], REQ["radius"], main.full_cfg)
    assert (client.tmp / "areas" / f"{key}.json").exists()
    assert ("AAAAAAAAAAAAAAAAAAAAAA", 63.5) in main._known_photos


def test_area_coordinates_are_checked(client):
    assert client.post("/api/area", json={**REQ, "radius": 900}).status_code == 422
    assert client.post("/api/area", json={**REQ, "lat": 95}).status_code == 422
    assert client.post("/api/area", json={**REQ, "season": "monsoon"}).status_code == 422
    assert client.post("/api/area", json={**REQ, "time": "15:30"}).status_code == 422


def cache_sample():
    key = area_mod.area_key(REQ["lat"], REQ["lon"], REQ["radius"], main.full_cfg)
    area_mod.save_cached(key, REQ["lat"], REQ["lon"], REQ["radius"], SAMPLE, main.full_cfg)


def test_thermal_is_paid_for_once_per_area_and_window(client, monkeypatch):
    cache_sample()
    calls = []
    monkeypatch.setattr(area_mod, "run_utci", fake_utci(calls))
    first = events(client.post("/api/area", json=REQ))[-1]
    again = events(client.post("/api/area", json=REQ))[-1]
    winter = events(client.post("/api/area", json={**REQ, "season": "winter", "time": "09:00"}))[-1]
    assert calls == [("summer", "15:00"), ("winter", "09:00")]
    assert first["values"] == again["values"] and first["station"]["name"] == "Test station"
    assert winter["season"] == "winter" and winter["time"] == "09:00"


def test_thermal_failure_keeps_the_area(client, monkeypatch):
    cache_sample()

    def fail(*a, **k):
        raise area_mod.ThermalError("No weather station near this area, so thermal comfort is not available here.")

    monkeypatch.setattr(area_mod, "run_utci", fail)
    done, _stage, err = events(client.post("/api/area", json=REQ))
    assert done["type"] == "done"
    assert err == {"type": "thermal_error",
                   "message": "No weather station near this area, so thermal comfort is not available here."}


def test_thermal_without_key_says_so(client, monkeypatch):
    # The real runner, but no INFRARED_API_KEY (conftest empties it): refused before any call.
    from tool import infrared
    cache_sample()
    monkeypatch.setattr(area_mod, "run_utci", infrared.run_utci)
    err = events(client.post("/api/area", json=REQ))[-1]
    assert err == {"type": "thermal_error", "message": "Thermal comfort is not set up on the server."}


class FakeProvider:
    key = KEY_VALUE
    calls = 0

    def fetch_image(self, photo_id, heading):
        FakeProvider.calls += 1
        return b"\xff\xd8\xff\xe0fake-jpeg-bytes"


def snapshot(*dirs):
    return {str(p) for d in dirs if d.exists() for p in d.rglob("*")}


def test_photo_streams_through_without_key_or_files(client, monkeypatch):
    monkeypatch.setattr(main, "provider", lambda: FakeProvider())
    main._known_photos.add(("AAAAAAAAAAAAAAAAAAAAAA", 63.5))
    runs = main.full_cfg and (area_mod.REPO_ROOT / "runs")
    before = snapshot(client.tmp, runs)

    r = client.get("/api/photo/AAAAAAAAAAAAAAAAAAAAAA", params={"heading": 63.5})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["cache-control"] == "private, max-age=3600"
    assert r.content.startswith(b"\xff\xd8")
    # The key is in neither the body nor the headers.
    assert KEY_VALUE.encode() not in r.content
    assert all(KEY_VALUE not in v for v in r.headers.values())
    # Nothing was written to disk.
    assert snapshot(client.tmp, runs) == before


def test_photo_only_for_photos_of_a_loaded_area(client, monkeypatch):
    monkeypatch.setattr(main, "provider", lambda: FakeProvider())
    FakeProvider.calls = 0
    assert client.get("/api/photo/AAAAAAAAAAAAAAAAAAAAAA", params={"heading": 63.5}).status_code == 404
    main._known_photos.add(("AAAAAAAAAAAAAAAAAAAAAA", 63.5))
    assert client.get("/api/photo/AAAAAAAAAAAAAAAAAAAAAA", params={"heading": 120}).status_code == 404
    assert client.get("/api/photo/..%2F..%2Fsecret", params={"heading": 63.5}).status_code == 404
    assert FakeProvider.calls == 0


def test_key_is_read_from_the_environment_only(client):
    # The provider reads GOOGLE_MAPS_API_KEY from the environment or .env, nowhere else.
    assert os.environ["GOOGLE_MAPS_API_KEY"] == KEY_VALUE
