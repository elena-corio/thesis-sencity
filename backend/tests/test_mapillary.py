"""Mapillary photos along a walk: which image is picked, its credit, and the API. Mapillary is never called: search is
faked with images around a stretch running due north."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app, full_cfg
from tool.photos import mapillary as mly

NORTH = [[16.3700, 48.2000], [16.3700, 48.2010]]  # about 110 m due north
NOW = datetime(2026, 11, 11, tzinfo=timezone.utc)


def ms(year):
    return int(datetime(year, 6, 1, tzinfo=timezone.utc).timestamp() * 1000)


def image(i, angle, year, lon=16.37005, lat=48.2005, pano=False, user="walker"):
    return {"id": i, "computed_compass_angle": angle, "computed_geometry": {"type": "Point", "coordinates": [lon, lat]},
            "is_pano": pano, "captured_at": ms(year), "creator": {"username": user}, "thumb_1024_url": f"https://thumb/{i}",
            "thumb_2048_url": f"https://thumb2048/{i}"}


def test_a_panorama_first_turned_to_the_walk():
    images = [
        image("flat", 2, 2025),
        image("pano", 120, 2021, pano=True, user="anna"),
        image("pano-far", 120, 2026, pano=True, lon=16.3710),   # about 75 m to the side
    ]
    p = mly.pick(images, NORTH, full_cfg, now=NOW)
    assert (p["id"], p["pano"], p["pano_heading"], p["turn"], p["creator"]) == ("pano", True, 120.0, 0.0, "anna")
    assert p["heading"] == pytest.approx(0, abs=0.1)   # the view looks along the walk (north)


def test_else_the_flat_photo_closest_to_the_walk_direction():
    images = [
        image("new-but-turned", 30, 2026),
        image("straight-far", 2, 2020, lon=16.37025),     # 2 degrees off, about 15 m away
        image("straight-near", 358, 2019),                # 2 degrees off too, nearer: wins the tie
        image("backwards", 180, 2026),
        image("ancient", 0, 2014),                        # older than 10 years
    ]
    p = mly.pick(images, NORTH, full_cfg, now=NOW)
    assert (p["id"], p["pano"], p["turn"], p["year"]) == ("straight-near", False, 2.0, 2019)
    assert p["heading"] == 358
    assert p["link"] == "https://www.mapillary.com/app/?pKey=straight-near"


def test_a_tie_in_angle_and_distance_goes_to_the_newest():
    p = mly.pick([image("a", 5, 2019), image("b", 5, 2023)], NORTH, full_cfg, now=NOW)
    assert p["id"] == "b"


def test_a_street_on_a_card_either_way_along_it():
    # No walking direction: a camera looking south along a north-south street is as good as one looking north.
    p = mly.pick([image("south", 182, 2024), image("east", 90, 2026)], NORTH, full_cfg, now=NOW, kind="street")
    assert (p["id"], p["turn"]) == ("south", 2.0)


def test_a_place_any_direction_inside_it():
    square = [[16.3700, 48.2000], [16.3710, 48.2000], [16.3710, 48.2010], [16.3700, 48.2010], [16.3700, 48.2000]]
    p = mly.pick([image("east", 90, 2026, lon=16.3705, lat=48.2005)], square, full_cfg, now=NOW, kind="area")
    assert p["id"] == "east"
    assert p["date"] == "2026-06"


def test_a_route_street_prefers_a_photo_facing_the_walk_else_either_way(monkeypatch):
    # Elena, 2026-11-14: photos in the direction of the route first. One search, judged twice.
    searches = []

    def search(s, coords, cfg):
        searches.append(coords)
        return images
    monkeypatch.setattr(mly, "search", search)
    images = [image("backwards-near", 180, 2026), image("forwards-far", 2, 2020, lon=16.37025)]
    assert mly.photo_facing(None, NORTH, full_cfg)["id"] == "forwards-far"
    # Walked the other way (south), the other photo faces the walk.
    assert mly.photo_facing(None, NORTH[::-1], full_cfg)["id"] == "backwards-near"
    # None facing the walk: one either way along the street will do.
    images = [image("backwards", 180, 2026)]
    p = mly.photo_facing(None, NORTH, full_cfg)
    assert (p["id"], p["turn"]) == ("backwards", 0.0)
    assert len(searches) == 3


def test_no_photo_when_none_fits():
    assert mly.pick([image("backwards", 180, 2026), image("ancient", 0, 2010)], NORTH, full_cfg, now=NOW) is None


def test_api(monkeypatch):
    monkeypatch.setenv("MAPILLARY_ACCESS_TOKEN", "test-token")
    monkeypatch.setattr(mly, "search", lambda s, coords, cfg: [image("new", 0, 2025)] if coords[0][0] < 16.38 else [])
    body = {"stretches": [{"key": "B-0", "coordinates": NORTH}, {"key": "B-1", "coordinates": [[16.39, 48.2], [16.39, 48.201]]}]}
    res = TestClient(app).post("/api/mapillary/along", json=body)
    assert res.status_code == 200
    photos = res.json()["photos"]
    assert photos["B-0"]["id"] == "new" and photos["B-1"] is None
    assert "test-token" not in res.text  # the token never reaches the browser


def test_api_without_a_token_is_503(monkeypatch):
    monkeypatch.setenv("MAPILLARY_ACCESS_TOKEN", "")
    res = TestClient(app).post("/api/mapillary/along", json={"stretches": [{"key": "A-0", "coordinates": NORTH}]})
    assert res.status_code == 503
    assert res.json()["detail"] == "Mapillary photos are not set up on the server."


@pytest.mark.parametrize("a,b,expected", [(350, 10, 20), (90, 270, 180), (0, 0, 0)])
def test_turn(a, b, expected):
    assert mly.turn(a, b) == expected


# The image for the model (Elena, 2026-11-11): the photo the app shows, in memory only

def _jpeg(img) -> bytes:
    import io
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


class _Resp:
    def __init__(self, status=200, data=None, content=b""):
        self.status_code, self._data, self.content = status, data, content

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise mly.requests.HTTPError(str(self.status_code))


def _images(monkeypatch, meta, content):
    class Session:
        headers = {}

        def get(self, url, params=None, timeout=None):
            return _Resp(data=meta) if meta is not None else _Resp(404)
    monkeypatch.setattr(mly, "session", lambda: Session())
    monkeypatch.setattr(mly.requests, "get", lambda url, timeout=None: _Resp(content=content))
    return mly.Images(full_cfg)


def test_a_flat_photo_goes_as_served_and_only_at_its_own_heading(monkeypatch):
    from PIL import Image
    raw = _jpeg(Image.new("RGB", (1024, 768), (120, 130, 140)))
    imgs = _images(monkeypatch, {"id": "1", "is_pano": False, "computed_compass_angle": 80.04, "thumb_1024_url": "u"}, raw)
    assert imgs.fetch_image("1", 80.0) == raw
    with pytest.raises(mly.NotThisPhoto):
        imgs.fetch_image("1", 140.0)


def test_an_unknown_image_is_not_a_photo_the_app_shows(monkeypatch):
    imgs = _images(monkeypatch, None, b"")
    with pytest.raises(mly.NotThisPhoto):
        imgs.fetch_image("1", 80.0)


def test_a_panorama_is_rendered_as_the_square_view_at_its_bearing(monkeypatch):
    import io
    import numpy as np
    from PIL import Image
    # An equirectangular panorama whose middle looks 0 degrees: red from 80 to 100 degrees (east), grey elsewhere.
    eq = np.full((512, 1024, 3), 128, dtype=np.uint8)
    x = lambda deg: int((0.5 + deg / 360) * 1024)  # noqa: E731
    eq[:, x(80):x(100)] = (220, 30, 30)
    raw = _jpeg(Image.fromarray(eq))
    imgs = _images(monkeypatch, {"id": "2", "is_pano": True, "computed_compass_angle": 0.0, "thumb_2048_url": "u"}, raw)
    east = np.asarray(Image.open(io.BytesIO(imgs.fetch_image("2", 90.0))))
    north = np.asarray(Image.open(io.BytesIO(imgs.fetch_image("2", 0.0))))
    assert east.shape == (640, 640, 3)  # mapillary.render.size_px
    assert east[320, 320, 0] > 180 and east[320, 320, 1] < 80  # looking east: red in the middle
    assert north[320, 320, 0] < 160  # looking north: grey
    # 90 degrees across: east (90) is at the right edge when looking at 45.
    side = np.asarray(Image.open(io.BytesIO(imgs.fetch_image("2", 45.0))))
    assert side[320, 630, 0] > 180 and side[320, 320, 0] < 160
