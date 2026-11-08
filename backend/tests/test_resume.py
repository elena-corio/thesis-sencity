"""Try again goes on from the failed step: the streets are not fetched again, and only the photos still
missing are looked up (app/steps.py). Made-up streets and a fake photo service; no API calls."""
import time

import pytest
import requests
from fastapi.testclient import TestClient

from app import area as area_mod
from app import main
from app import routes as routes_mod
from app import steps
from tests.test_routes_api import END, REQ as ROUTE_REQ, START, FakeMeta, events, fake_utci, overpass_answer

AREA_REQ = {"lat": 48.20815, "lon": 16.3720, "radius": 150, "season": "summer", "time": "15:00"}
NORTH = 48.20825  # Kuehlgasse lies north of this; the other streets south of it


class FlakyProvider:
    """Fails for every point north of NORTH while `broken`; counts the points it was asked for."""
    metadata_calls = 0

    def __init__(self):
        self.broken = True
        self.asked = []

    def search(self, lat, lon, radius=None):
        self.asked.append(lat)
        if self.broken and lat > NORTH:
            time.sleep(0.3)  # the other streets finish first, as when one lookup fails along the way
            raise requests.ConnectionError("lost")
        return FakeMeta(lat, lon)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    calls = {"overpass": 0}

    def overpass(*a, **k):
        calls["overpass"] += 1
        return overpass_answer()

    prov = FlakyProvider()
    monkeypatch.setattr(area_mod, "cache_dir", lambda cfg: tmp_path / "areas")
    monkeypatch.setattr(area_mod, "fetch_overpass", overpass)
    monkeypatch.setattr(routes_mod, "cache_dir", lambda cfg: tmp_path / "routes")
    monkeypatch.setattr(routes_mod, "fetch_ways_in", overpass)
    monkeypatch.setattr(routes_mod, "fetch_buildings_in", lambda ring, cfg: {"elements": []})
    monkeypatch.setattr(routes_mod, "count_jobs", lambda polygon, cfg: 3)
    monkeypatch.setattr(area_mod, "run_utci", fake_utci([]))
    monkeypatch.setattr(main, "provider", lambda: prov)
    main._hits.clear()
    main._known_photos.clear()
    return TestClient(main.app), prov, calls, tmp_path


def test_area_try_again_goes_on_from_the_failed_photos(setup):
    client, prov, calls, tmp = setup
    first = events(client.post("/api/area", json=AREA_REQ))
    assert first[-1]["type"] == "error"
    key = area_mod.area_key(AREA_REQ["lat"], AREA_REQ["lon"], AREA_REQ["radius"], main.full_cfg)
    where = tmp / "areas"
    assert steps.load(where, key, "osm") is not None
    kept = steps.load(where, key, "photos")
    assert kept and all(isinstance(v, list) for v in kept.values())
    asked_first = len(prov.asked)

    prov.broken = False
    prov.asked.clear()
    second = events(client.post("/api/area", json=AREA_REQ))
    types = [e["type"] for e in second]
    assert calls["overpass"] == 1  # the streets were not fetched again
    assert "streets" not in [e.get("stage") for e in second if e["type"] == "stage"]
    seg_event = next(e for e in second if e["type"] == "segments")
    assert seg_event["done"] == len(kept)  # progress goes on from what was found
    # Only the streets still missing were looked up: none of the ones already found.
    assert prov.asked and len(prov.asked) < asked_first
    found_ids = {f["properties"]["id"] for f in seg_event["features"] if f["properties"]["photos"] is not None}
    assert found_ids == set(kept)
    assert types[-2:] == ["stage", "thermal"] and "done" in types
    # Done: the area is cached and the kept steps are gone.
    assert (where / f"{key}.json").exists()
    assert not steps.exists(where, key)


def test_senses_skips_thermal_and_photos_are_never_skipped(setup):
    client, prov, calls, _tmp = setup
    prov.broken = False

    # Senses: the streets and photos, and no thermal run.
    senses = events(client.post("/api/area", json={**AREA_REQ, "layer": "senses"}))
    types = [e["type"] for e in senses]
    assert prov.asked
    assert "thermal" not in types and types[-1] == "done"

    # Then Thermal: the simulation, on the photos already found.
    asked = len(prov.asked)
    thermal = events(client.post("/api/area", json={**AREA_REQ, "layer": "thermal"}))
    assert thermal[-1]["type"] == "thermal"
    assert len(prov.asked) == asked and calls["overpass"] == 1
    done = next(e for e in thermal if e["type"] == "done")
    assert all(f["properties"]["photos"] is not None for f in done["area"]["features"])


def test_a_retry_is_not_counted_as_a_new_area(setup, monkeypatch):
    client, prov, _calls, _tmp = setup
    monkeypatch.setitem(main.cfg["area"], "rate_per_hour", 1)
    assert events(client.post("/api/area", json=AREA_REQ))[-1]["type"] == "error"
    prov.broken = False
    assert client.post("/api/area", json=AREA_REQ).status_code == 200


def test_route_try_again_goes_on_from_the_failed_photos(setup):
    client, prov, calls, tmp = setup
    assert events(client.post("/api/routes", json=ROUTE_REQ))[-1]["type"] == "error"
    key = routes_mod.route_key(START, END, main.full_cfg)
    where = tmp / "routes"
    assert steps.load(where, key, "ways") is not None
    kept = steps.load(where, key, "photos") or {}
    # Start and end are never written: only the key and the streets.
    for path in where.glob(f"{key}.*.json"):
        text = path.read_text(encoding="utf-8")
        assert '"start"' not in text and '"end"' not in text

    prov.broken = False
    second = events(client.post("/api/routes", json=ROUTE_REQ))
    assert calls["overpass"] == 1
    assert next(e for e in second if e["type"] == "segments")["done"] == len(kept)
    assert second[-1]["type"] == "routes"
    assert not steps.exists(where, key)
