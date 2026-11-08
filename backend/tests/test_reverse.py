"""POST /api/reverse with a fake Photon (no network). The features have the shapes Photon really sends."""
import pytest
import requests
from fastapi.testclient import TestClient

from app import main
from app import search as search_mod
from app.search import point_name

LAT, LON = 48.205, 16.379
STREET = {"properties": {"type": "street", "osm_key": "highway", "osm_value": "pedestrian", "name": "Barnabitengasse"}}
HOUSE = {"properties": {"type": "house", "osm_key": "place", "osm_value": "house", "street": "Wehlistraße", "housenumber": "140"}}
MEMORIAL = {"properties": {"type": "house", "osm_key": "historic", "osm_value": "memorial", "name": "Hans Makart", "street": "Parkring"}}
PARK = {"properties": {"type": "other", "osm_key": "leisure", "osm_value": "park", "name": "Stadtpark",
                       "extent": [16.3769, 48.2069, 16.3821, 48.2025]}}
FAR_PARK = {"properties": {**PARK["properties"], "name": "Other park", "extent": [16.5, 48.3, 16.6, 48.2]}}
SQUARE = {"properties": {"type": "locality", "osm_key": "place", "osm_value": "square", "name": "Heldenplatz"}}


def test_a_street_comes_first():
    assert point_name([MEMORIAL, STREET, PARK], LAT, LON) == "Barnabitengasse"


def test_a_house_address_gives_its_street_without_the_number():
    assert point_name([HOUSE], LAT, LON) == "Wehlistraße"


def test_things_in_a_park_do_not_count_as_a_street():
    assert point_name([MEMORIAL, PARK], LAT, LON) == "Stadtpark"


def test_a_park_only_when_the_point_is_inside_it():
    assert point_name([FAR_PARK], LAT, LON) is None


def test_a_square_has_no_extent():
    assert point_name([SQUARE], LAT, LON) == "Heldenplatz"


def test_nothing_near():
    assert point_name([], LAT, LON) is None


class FakeResponse:
    def __init__(self, data):
        self.data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self.data


@pytest.fixture
def client(monkeypatch):
    calls = []

    def fake_get(url, params, timeout, headers):
        calls.append({"params": params, "headers": headers})
        return FakeResponse({"features": [STREET]})

    monkeypatch.setattr("app.search.requests.get", fake_get)
    monkeypatch.setitem(main.cfg["search"], "reverse_min_interval_s", 0)
    search_mod._cache.clear()
    main._hits.clear()
    c = TestClient(main.app)
    c.calls = calls
    return c


def test_only_the_rounded_point_is_sent(client):
    r = client.post("/api/reverse", json={"lat": 48.198512, "lon": 16.353049},
                    headers={"User-Agent": "someone's browser", "X-Forwarded-For": "1.2.3.4", "Cookie": "a=b"})
    assert r.json() == {"name": "Barnabitengasse"}
    call = client.calls[0]
    assert call["params"]["lat"] == "48.1985" and call["params"]["lon"] == "16.3530"
    assert call["headers"] == {"User-Agent": search_mod.USER_AGENT}


def test_a_point_is_asked_once(client):
    for lon in (16.35304, 16.35301):  # the same to about 10 m
        client.post("/api/reverse", json={"lat": 48.1985, "lon": lon})
    assert len(client.calls) == 1


def test_calls_are_spaced(client, monkeypatch):
    monkeypatch.setitem(main.cfg["search"], "reverse_min_interval_s", 1)
    waits = []
    monkeypatch.setattr("app.search.time.sleep", waits.append)
    for lat in (48.1, 48.2):
        client.post("/api/reverse", json={"lat": lat, "lon": 16.3})
    assert waits and all(0 < w <= 1 for w in waits)


def test_rate_limit(client):
    limit = main.cfg["search"]["reverse_rate_per_minute"]
    codes = [client.post("/api/reverse", json={"lat": 48.2, "lon": 16.3}).status_code for _ in range(limit + 1)]
    assert codes[:limit] == [200] * limit and codes[-1] == 429


def test_provider_failure_is_a_clear_502_and_not_cached(client, monkeypatch):
    def boom(*a, **k):
        raise requests.ConnectionError("down")

    monkeypatch.setattr("app.search.requests.get", boom)
    assert client.post("/api/reverse", json={"lat": 48.2, "lon": 16.3}).status_code == 502
    assert search_mod._cache == {}
