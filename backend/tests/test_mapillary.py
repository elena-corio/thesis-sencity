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
