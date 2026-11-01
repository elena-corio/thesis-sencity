"""POST /api/search with a fake Photon (no network)."""
import pytest
from fastapi.testclient import TestClient

from app import main
from app.search import label

PHOTON = {"features": [
    {"geometry": {"type": "Point", "coordinates": [16.3720438, 48.2084639]},
     "properties": {"osm_value": "station", "name": "Stephansplatz", "street": "Stephansplatz",
                    "district": "Innere Stadt", "city": "Wien", "country": "Österreich"}},
    {"geometry": {"type": "Point", "coordinates": [16.3695, 48.2089]},
     "properties": {"osm_value": "residential", "name": "Graben", "city": "Wien", "country": "Österreich",
                    "extent": [16.367, 48.2095, 16.3715, 48.2083]}},
]}


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
        calls.append(params)
        return FakeResponse(PHOTON)

    monkeypatch.setattr("app.search.requests.get", fake_get)
    main._hits.clear()
    c = TestClient(main.app)
    c.calls = calls
    return c


def test_results_with_names_details_and_bbox(client):
    r = client.post("/api/search", json={"q": "steph", "lat": 48.2, "lon": 16.37})
    assert r.status_code == 200
    first, second = r.json()["results"]
    assert first == {"name": "Stephansplatz", "detail": "Innere Stadt, Wien, Österreich",
                     "lat": 48.2084639, "lon": 16.3720438, "kind": "station"}
    assert second["bbox"] == [[16.367, 48.2083], [16.3715, 48.2095]]
    # The map centre is passed on as a bias.
    assert client.calls[0]["lat"] == "48.20000" and client.calls[0]["lon"] == "16.37000"


def test_short_query_makes_no_call(client):
    assert client.post("/api/search", json={"q": " st "}).json() == {"results": []}
    assert client.calls == []


def test_long_query_is_refused(client):
    assert client.post("/api/search", json={"q": "x" * 101}).status_code == 422


def test_rate_limit(client):
    limit = main.cfg["search"]["rate_per_minute"]
    codes = [client.post("/api/search", json={"q": "graben"}).status_code for _ in range(limit + 1)]
    assert codes[:limit] == [200] * limit and codes[-1] == 429


def test_provider_failure_is_a_clear_502(client, monkeypatch):
    import requests

    def boom(*a, **k):
        raise requests.ConnectionError("down")

    monkeypatch.setattr("app.search.requests.get", boom)
    r = client.post("/api/search", json={"q": "graben"})
    assert r.status_code == 502 and "not available" in r.json()["detail"]


def test_label_with_house_number():
    assert label({"street": "Graben", "housenumber": "21", "city": "Wien", "country": "Österreich"}) == \
        ("Graben 21", "Wien, Österreich")
