"""The local OpenStreetMap copy: which tiles a request reads, and when it must leave the question to Overpass."""
import json

import pytest

from tool import osm_local


def way(id_, lon, lat, **tags):
    return {"type": "way", "id": id_, "bounds": {"minlon": lon, "minlat": lat, "maxlon": lon + 0.0002, "maxlat": lat + 0.0002},
            "nodes": [1, 2], "geometry": [{"lat": lat, "lon": lon}, {"lat": lat + 0.0002, "lon": lon + 0.0002}], "tags": tags}


@pytest.fixture(autouse=True)
def real_reader(monkeypatch):  # conftest turns the local copy off for the other tests
    monkeypatch.setattr(osm_local, "around", ORIGINAL["around"])
    monkeypatch.setattr(osm_local, "ways_in", ORIGINAL["ways_in"])
    monkeypatch.setattr(osm_local, "buildings_in", ORIGINAL["buildings_in"])


ORIGINAL = {k: getattr(osm_local, k) for k in ("around", "ways_in", "buildings_in")}


@pytest.fixture
def cfg(tmp_path):
    return {"osm": {"buildings_margin_m": 50, "overpass_url": "https://example.invalid", "walkable_highways": ["footway"],
                    "area_tags": {"leisure": ["park"]}},
            "osm_local": {"dir": str(tmp_path / "tiles"), "bbox": [16.0, 48.0, 16.06, 48.06], "tile_deg": 0.03, "pause_s": 0, "timeout_s": 10}}


def write(cfg, tile, elements):
    path = osm_local.tile_path(tile, cfg["osm_local"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"elements": elements}), encoding="utf-8")


def write_all(cfg, elements_by_tile=None):
    for c in range(2):
        for r in range(2):
            write(cfg, (c, r), (elements_by_tile or {}).get((c, r), []))


def test_a_request_reads_only_the_tiles_it_touches(cfg):
    local = cfg["osm_local"]
    assert osm_local.tiles_for((16.01, 48.01, 16.02, 48.02), local) == [(0, 0)]
    assert osm_local.tiles_for((16.02, 48.01, 16.04, 48.02), local) == [(0, 0), (1, 0)]


def test_outside_the_city_the_copy_does_not_answer(cfg):
    write_all(cfg)
    assert osm_local.around(47.0, 16.03, 100, cfg) is None


def test_a_missing_or_broken_tile_leaves_it_to_overpass(cfg):
    assert osm_local.around(48.015, 16.015, 100, cfg) is None
    write_all(cfg)
    osm_local.tile_path((0, 0), cfg["osm_local"]).write_text("{ not json", encoding="utf-8")
    assert osm_local.around(48.015, 16.015, 100, cfg) is None


def test_a_way_across_two_tiles_comes_once_and_far_ways_are_left_out(cfg):
    shared = way(1, 16.0299, 48.015, highway="footway")
    far = way(2, 16.001, 48.001, highway="footway")
    write_all(cfg, {(0, 0): [shared, far], (1, 0): [shared]})
    data = osm_local.around(48.015, 16.03, 100, cfg)
    assert [e["id"] for e in data["elements"]] == [1]


def test_routes_get_only_the_kind_they_asked_for(cfg):
    street, building = way(1, 16.01, 48.01, highway="footway"), way(2, 16.0101, 48.0101, building="yes")
    write_all(cfg, {(0, 0): [street, building]})
    ring = [(16.005, 48.005), (16.015, 48.005), (16.015, 48.015), (16.005, 48.015)]
    assert [e["id"] for e in osm_local.ways_in(ring, cfg)["elements"]] == [1]
    assert [e["id"] for e in osm_local.buildings_in(ring, cfg)["elements"]] == [2]


def test_the_tile_query_asks_for_streets_parks_and_buildings_in_its_own_box(cfg):
    q = osm_local.tile_query((1, 0), cfg)
    assert "48.00000,16.03000,48.03000,16.06000" in q
    assert 'way["highway"~"^(footway)$"]' in q and 'relation["leisure"="park"]' in q and 'way["building"]' in q


def test_download_fetches_only_what_is_missing_and_goes_on_after_a_failure(cfg, monkeypatch):
    write(cfg, (0, 0), [])
    calls = []

    def fake(query, server):
        calls.append(query)
        if len(calls) == 1:
            raise osm_local.requests.ConnectionError()
        return {"elements": []}

    monkeypatch.setattr(osm_local, "_post", fake)
    assert osm_local.download(cfg) == 1
    assert len(calls) == 3
    assert sum(osm_local.tile_path((c, r), cfg["osm_local"]).exists() for c in range(2) for r in range(2)) == 3
