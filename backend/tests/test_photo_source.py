"""PHOTO_SOURCE (Elena, 2026-11-16): Street View in the local prototype, with Mapillary where it has no photo; Mapillary
in any public version. No call leaves the machine: Street View's metadata and images are faked here, Mapillary's
search too (conftest refuses the real ones)."""
import json

import pytest
from fastapi.testclient import TestClient
from shapely.geometry import LineString, Polygon

from app import main
from app import photos as photos_mod
from app import senses as senses_mod
from tool.config import load_config, photo_source
from tool.geo import LocalProjection
from tool.osm import Segment
from tool.photos import mapillary as mly
from tool.photos.provider import PhotoMeta
from tool.photos.streetview import StreetViewProvider

CFG = load_config()
LAT, LON = 48.2085, 16.3721


def test_the_setting_comes_from_the_environment_first(monkeypatch):
    monkeypatch.setenv("PHOTO_SOURCE", "streetview")
    assert photo_source({"photo_source": "mapillary"}) == "streetview"
    monkeypatch.setenv("PHOTO_SOURCE", "")
    assert photo_source({"photo_source": "mapillary"}) == "mapillary"
    assert photo_source({}) == "streetview"  # the default: the local prototype


def test_an_unknown_source_and_street_view_on_render_are_refused(monkeypatch):
    monkeypatch.setenv("PHOTO_SOURCE", "flickr")
    with pytest.raises(SystemExit):
        photo_source(CFG)
    monkeypatch.setenv("PHOTO_SOURCE", "streetview")
    monkeypatch.setenv("RENDER", "true")
    with pytest.raises(SystemExit):
        photo_source(CFG)
    monkeypatch.setenv("PHOTO_SOURCE", "mapillary")
    assert photo_source(CFG) == "mapillary"


def test_cache_keys_change_with_the_source(monkeypatch):
    monkeypatch.setenv("PHOTO_SOURCE", "mapillary")
    mapillary_settings = photos_mod.settings(CFG)
    monkeypatch.setenv("PHOTO_SOURCE", "streetview")
    streetview_settings = photos_mod.settings(CFG)
    assert mapillary_settings["photos"] == "mapillary" and "streetview" not in mapillary_settings
    assert streetview_settings["photos"] == "streetview" and streetview_settings["streetview"]["walk_min_spacing_m"] == 10


# Street View, faked: one official pano every 4 m along a street running east from the centre, dated 2024-06.

PROJ = LocalProjection(LAT, LON)
STREET = Segment("s1", "street", LineString([(0, 0), (60, 0)]), "Graben", "pedestrian")
PARK = Segment("a1", "area", Polygon([(0, 30), (40, 30), (40, 70), (0, 70)]), "Park", "park")


def fake_search(official=True, where=lambda x, y: -1 <= y <= 1):
    def search(self, lat, lon, radius_m=None):
        x, y = PROJ.to_xy(lon, lat)
        if not where(x, y):
            return None
        x5, y5 = round(x / 4) * 4, round(y / 4) * 4
        lon5, lat5 = PROJ.to_lonlat(x5, y5)
        return PhotoMeta(photo_id=f"pano{int(x5):03d}{int(y5):03d}xxxxxx", lat=lat5, lon=lon5, date="2024-06", official=official,
                         copyright="© Google" if official else "© Anna")
    return search


@pytest.fixture
def streetview(monkeypatch):
    monkeypatch.setenv("PHOTO_SOURCE", "streetview")
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")
    monkeypatch.setattr(StreetViewProvider, "search", fake_search())


def test_a_street_gets_up_to_three_street_view_photos(streetview):
    found = photos_mod.Finder(CFG, PROJ).photos(STREET)
    assert 1 <= len(found) <= CFG["selection"]["max_photos"]
    p = found[0]
    assert p["source"] == "streetview" and p["id"] == "sv:" + p["pano_id"]
    assert p["date"] == "2024-06" and p["year"] == 2024 and p["contributor"] is False
    assert set(p) >= {"lat", "lon", "heading"}
    assert "thumb_url" not in p  # nothing to load without our API


def test_a_walked_street_gets_a_photo_every_10_to_20_m_facing_the_walk(streetview):
    finder = photos_mod.Finder(CFG, PROJ)
    east = finder.photos(STREET, forward=True)
    west = finder.photos(STREET, forward=False)
    assert len(east) >= 4  # 60 m: more than the 3 of a card
    xs = [PROJ.to_xy(p["lon"], p["lat"])[0] for p in east]
    assert xs == sorted(xs)  # in the order they are walked past
    assert all(10 <= b - a <= 20.5 for a, b in zip(xs, xs[1:]))  # the projection adds a few mm
    assert all(abs(p["heading"] - 90) < 1 for p in east)  # looking east, the way it is walked
    assert all(abs(p["heading"] - 270) < 1 for p in west)
    wx = [PROJ.to_xy(p["lon"], p["lat"])[0] for p in west]
    assert wx == sorted(wx, reverse=True)


def test_where_street_view_has_none_mapillary_is_used(streetview, monkeypatch):
    monkeypatch.setenv("MAPILLARY_ACCESS_TOKEN", "test-token")
    image = {"id": 77, "computed_compass_angle": 10.0, "geometry": {"type": "Point", "coordinates": list(PROJ.to_lonlat(20, 50))},
             "is_pano": False, "captured_at": 1_720_000_000_000, "creator": {"username": "carla"},
             "thumb_1024_url": "https://example/t.jpg"}
    monkeypatch.setattr(mly, "search", lambda s, coords, cfg: [image])
    found = photos_mod.Finder(CFG, PROJ).photos(PARK)  # no pano in the park
    assert len(found) == 1 and found[0]["source"] == "mapillary" and found[0]["id"] == "77"
    assert found[0]["creator"] == "carla"


def test_with_neither_there_is_no_photo(streetview, monkeypatch):
    monkeypatch.setenv("MAPILLARY_ACCESS_TOKEN", "test-token")
    monkeypatch.setattr(mly, "search", lambda s, coords, cfg: [])
    assert photos_mod.Finder(CFG, PROJ).photos(PARK) == []


def test_without_a_mapillary_token_street_view_still_works(streetview, monkeypatch):
    monkeypatch.setenv("MAPILLARY_ACCESS_TOKEN", "")
    finder = photos_mod.Finder(CFG, PROJ)
    assert finder.photos(PARK) == []
    assert finder.photos(STREET)[0]["source"] == "streetview"


def test_a_contributor_photosphere_in_a_park_is_credited_to_its_author(monkeypatch):
    monkeypatch.setenv("PHOTO_SOURCE", "streetview")
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")
    monkeypatch.setattr(StreetViewProvider, "search", fake_search(official=False, where=lambda x, y: 30 < y < 70))
    found = photos_mod.Finder(CFG, PROJ).photos(PARK)
    assert found and found[0]["contributor"] is True and found[0]["copyright"] == "© Anna"


# The images: on demand, only photos of a loaded area, under a daily cap, never kept

AREA = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"id": "s1", "photos": [
    {"id": "sv:panoAAAAAAAAAA", "source": "streetview", "pano_id": "panoAAAAAAAAAA", "heading": 90.0},
    {"id": "123", "source": "mapillary", "heading": 10.0}]}}]}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")
    monkeypatch.setitem(main.full_cfg, "streetview", {**main.full_cfg["streetview"], "daily_image_cap": 2,
                                                      "usage_file": str(tmp_path / "usage.json")})
    calls = []

    def fetch(self, pano_id, heading):
        calls.append((pano_id, heading))
        return b"JPEG"
    monkeypatch.setattr(StreetViewProvider, "fetch_image", fetch)
    monkeypatch.setattr(main, "_streetview", None)
    main._known_photos.clear()
    main._known_photos.update(photos_mod.known_photos(AREA))
    main._hits.clear()
    c = TestClient(main.app)
    c.calls = calls
    c.usage = tmp_path / "usage.json"
    yield c
    main._known_photos.clear()
    monkeypatch.setattr(main, "_streetview", None)


def test_only_photos_of_a_loaded_area_are_fetched(client):
    assert photos_mod.known_photos(AREA) == {("panoAAAAAAAAAA", 90.0)}
    assert client.get("/api/photo/panoAAAAAAAAAA?heading=45").status_code == 404
    assert client.get("/api/photo/someoneelsespano?heading=90").status_code == 404
    assert client.calls == []


def test_a_photo_is_streamed_through_and_not_kept(client):
    r = client.get("/api/photo/panoAAAAAAAAAA?heading=90")
    assert r.status_code == 200 and r.content == b"JPEG"
    assert r.headers["cache-control"] == "no-store"
    assert client.calls == [("panoAAAAAAAAAA", 90.0)]
    usage = json.loads(client.usage.read_text())
    assert usage["images"] == 1 and set(usage) == {"date", "images"}  # a count, nothing else


def test_the_daily_cap_stops_the_images(client):
    assert client.get("/api/photo/panoAAAAAAAAAA?heading=90").status_code == 200
    assert client.get("/api/photo/panoAAAAAAAAAA?heading=90").status_code == 200
    r = client.get("/api/photo/panoAAAAAAAAAA?heading=90")
    assert r.status_code == 429 and "daily limit" in r.json()["detail"]
    assert len(client.calls) == 2


def test_the_rating_cache_keeps_the_two_sources_apart():
    sv = senses_mod.cache_key("sv:panoAAAAAAAAAA", 90, "m", "c")
    assert sv.startswith("sv:panoAAAAAAAAAA|90")
    assert senses_mod.cache_key("123", 10, "m", "c").startswith("mly:123|")
    assert senses_mod._stale_reason(sv, {"prompt": senses_mod.PROMPT_VERSION}) is None
    assert senses_mod._stale_reason("panoAAAAAAAAAA|90|m|c|general") is not None  # before 2026-11-11: stale


def test_a_rating_request_takes_street_view_ids():
    assert main.SensesPhoto(id="sv:panoAAAAAAAAAA", heading=90).id == "sv:panoAAAAAAAAAA"
    assert main.SensesPhoto(id="123", heading=90).id == "123"
    with pytest.raises(ValueError):
        main.SensesPhoto(id="sv:bad id!", heading=90)


def test_the_model_gets_the_street_view_image_with_its_price(client):
    images = photos_mod.Images(main.full_cfg, main._make_streetview)
    assert images.fetch_image("sv:panoAAAAAAAAAA", 90.0) == b"JPEG"
    assert images.image_usd("sv:panoAAAAAAAAAA") == pytest.approx(0.007)
    assert images.image_usd("123") == 0.0
    with pytest.raises(mly.NotThisPhoto):
        images.fetch_image("sv:panoBBBBBBBBBB", 90.0)


def test_thermal_keys_stay_the_same_whatever_the_photo_source(monkeypatch):
    """Thermal comfort is billed and does not depend on the photos: switching PHOTO_SOURCE must find it again."""
    from app import area as area_mod
    from app import routes as routes_mod
    start, end = {"lat": 48.2085, "lon": 16.3721}, {"lat": 48.2050, "lon": 16.3700}
    monkeypatch.setenv("PHOTO_SOURCE", "mapillary")
    area_before = area_mod.area_key(LAT, LON, 200, CFG)
    route_before = routes_mod.route_key(start, end, CFG)
    monkeypatch.setenv("PHOTO_SOURCE", "streetview")
    assert area_mod.area_key(LAT, LON, 200, CFG) != area_before  # the photos are looked up again
    assert area_mod.area_key(LAT, LON, 200, CFG, source="mapillary") == area_before  # thermal: the same
    assert routes_mod.route_key(start, end, CFG, source="mapillary") == route_before
