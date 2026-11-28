"""Overpass with fallback servers (tool/osm.py `_post`, config `overpass.fallback_urls`; 2026-11-28: the deployed app
could not connect to overpass-api.de) and the area's message saying which service failed (app/main.py)."""
import pytest
import requests

from app import main as main_mod
from tool import osm

OSM = {"overpass_url": "https://main.example/api/interpreter", "timeout_s": 1}
FALLBACKS = ["https://one.example/api/interpreter", "https://two.example/api/interpreter"]


class Answer:
    def __init__(self, status, data=None):
        self.status_code, self._data = status, data or {"elements": []}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}", response=self)

    def json(self):
        return self._data


def fake_post(plan, asked):
    """plan: url → an Answer, or an exception to raise."""
    def post(url, **kw):
        asked.append(url)
        what = plan[url]
        if isinstance(what, Exception):
            raise what
        return what
    return post


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(osm.time, "sleep", lambda s: None)
    osm._dead.clear()


def test_the_next_server_answers_when_the_main_one_cannot_be_reached(monkeypatch):
    asked = []
    monkeypatch.setattr(osm.requests, "post", fake_post({OSM["overpass_url"]: requests.ConnectionError("no"),
                                                         FALLBACKS[0]: Answer(200, {"elements": [1]})}, asked))
    assert osm._post("q", OSM, FALLBACKS) == {"elements": [1]}
    assert asked == [OSM["overpass_url"], FALLBACKS[0]]


def test_a_busy_main_server_is_tried_again_then_left(monkeypatch):
    asked = []
    monkeypatch.setattr(osm.requests, "post", fake_post({OSM["overpass_url"]: Answer(504), FALLBACKS[0]: Answer(200)}, asked))
    assert osm._post("q", OSM, FALLBACKS) == {"elements": []}
    assert asked == [OSM["overpass_url"]] * 4 + [FALLBACKS[0]]


def test_a_real_error_answer_is_not_asked_elsewhere(monkeypatch):
    asked = []
    monkeypatch.setattr(osm.requests, "post", fake_post({OSM["overpass_url"]: Answer(400)}, asked))
    with pytest.raises(requests.HTTPError):
        osm._post("q", OSM, FALLBACKS)
    assert asked == [OSM["overpass_url"]]


def test_when_every_server_fails_the_last_error_is_raised(monkeypatch):
    asked = []
    plan = {u: requests.ConnectionError(u) for u in [OSM["overpass_url"], *FALLBACKS]}
    monkeypatch.setattr(osm.requests, "post", fake_post(plan, asked))
    with pytest.raises(requests.ConnectionError):
        osm._post("q", OSM, FALLBACKS)
    assert asked == [OSM["overpass_url"], *FALLBACKS]


def test_the_fallbacks_come_from_their_own_section_so_cache_keys_stay():
    from tool.config import load_config
    cfg = load_config()
    assert osm.fallback_urls() == cfg["overpass"]["fallback_urls"] and "fallback_urls" not in cfg["osm"]


def test_the_area_says_which_service_failed():
    def failed(url):
        e = requests.ConnectionError("x")
        e.request = requests.Request("POST", url).prepare()
        return e
    assert "OpenStreetMap" in main_mod._area_failure(failed("https://overpass-api.de/api/interpreter?x=1"))
    assert "Mapillary" in main_mod._area_failure(failed("https://graph.mapillary.com/images?bbox=1,2,3,4"))
    assert main_mod._failed_host(failed("https://graph.mapillary.com/images?bbox=1,2,3,4")) == "graph.mapillary.com"
    assert main_mod._area_failure(main_mod.mapillary_mod.MapillaryError("Mapillary photos are not set up on the server.")) \
        == "Mapillary photos are not set up on the server."


def test_a_server_that_cannot_be_reached_is_skipped_for_a_while(monkeypatch):
    asked = []
    plan = {OSM["overpass_url"]: requests.ConnectionError("no"), FALLBACKS[0]: Answer(200)}
    monkeypatch.setattr(osm.requests, "post", fake_post(plan, asked))
    osm._post("q", OSM, FALLBACKS)
    osm._post("q", OSM, FALLBACKS)
    assert asked == [OSM["overpass_url"], FALLBACKS[0], FALLBACKS[0]]  # the second area goes straight to a working one


def test_the_connection_is_given_up_quickly_but_the_answer_may_take_long(monkeypatch):
    seen = {}

    def post(url, **kw):
        seen.update(kw)
        return Answer(200)
    monkeypatch.setattr(osm.requests, "post", post)
    osm._post("q", OSM, [])
    assert seen["timeout"] == (osm.CONNECT_TIMEOUT_S, OSM["timeout_s"] + 30)
