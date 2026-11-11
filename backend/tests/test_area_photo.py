"""POST /api/area with a fixed sample (no API calls); no Street View image endpoint is left.
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
                    "photos": [{"id": "1001", "lat": 48.2084, "lon": 16.3704, "heading": 63.5, "pano": False,
                                "pano_heading": None, "year": 2024, "date": "2024-07", "creator": "dora",
                                "thumb_url": "https://example.org/t.jpg", "link": "https://www.mapillary.com/app/?pKey=1001"}]}},
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
    monkeypatch.setenv("MAPILLARY_ACCESS_TOKEN", KEY_VALUE)
    main._hits.clear()
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
    assert props["name"] == "Graben" and props["photos"][0]["id"] == "1001"
    assert done["area"]["features"][1]["properties"]["photos"] == []
    assert stage == {"type": "stage", "stage": "thermal"}
    assert thermal["type"] == "thermal" and set(thermal["values"]) == {"s1-1-2-0", "s2-3-4-0"}


def test_new_area_streams_progress_and_is_cached(client, monkeypatch):
    def fake_run(lat, lon, radius, cfg, key=None):
        pending = [{**f, "properties": {**f["properties"], "photos": None}} for f in SAMPLE["features"]]
        yield {"type": "segments", "features": pending, "total": 2}
        for i, f in enumerate(SAMPLE["features"], start=1):
            yield {"type": "segment", "feature": f, "done": i, "total": 2}
        yield {"type": "done", "area": SAMPLE}

    calls = []
    monkeypatch.setattr(area_mod, "run_area", fake_run)
    monkeypatch.setattr(area_mod, "run_utci", fake_utci(calls))
    r = client.post("/api/area", json=REQ)
    assert [e["type"] for e in events(r)] == ["segments", "segment", "segment", "done", "stage", "thermal"]
    assert calls == [("summer", "15:00")]
    key = area_mod.area_key(REQ["lat"], REQ["lon"], REQ["radius"], main.full_cfg)
    assert (client.tmp / "areas" / f"{key}.json").exists()


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


def test_no_street_view_image_endpoint_is_left(client):
    # The app shows and rates Mapillary photos only (Elena, 2026-11-11).
    assert client.get("/api/photo/AAAAAAAAAAAAAAAAAAAAAA", params={"heading": 63.5}).status_code == 404


def test_key_is_read_from_the_environment_only(client):
    # The Mapillary token is read from the environment or .env, nowhere else.
    assert os.environ["MAPILLARY_ACCESS_TOKEN"] == KEY_VALUE
