"""Every test runs without the Infrared.city key and without its API: a thermal run is billed,
so a test that forgets to fake it fails instead of calling the real service."""
import pytest

from app import area as area_mod
from app import buildings as buildings_app
from app import routes as routes_mod
from app import senses as senses_mod
from tool import buildings as buildings_tool
from tool.photos import mapillary as mapillary_tool
from tool.photos import streetview as streetview_tool
from tool import osm_local


@pytest.fixture(autouse=True)
def no_infrared(tmp_path, monkeypatch):
    monkeypatch.setenv("INFRARED_API_KEY", "")  # load_dotenv does not override a set variable

    def refuse(*a, **k):
        raise AssertionError("Infrared.city must not be called in tests")

    monkeypatch.setattr(area_mod, "run_utci", refuse)
    monkeypatch.setattr(routes_mod, "count_jobs", refuse)
    monkeypatch.setattr(area_mod, "thermal_dir", lambda cfg: tmp_path / "thermal")
    # Buildings are free, but a test never reads public data: it fakes read_area.
    monkeypatch.setattr(buildings_tool, "read_area", refuse)
    monkeypatch.setattr(buildings_app, "cache_dir", lambda cfg: tmp_path / "buildings")
    # Mapillary is free, but a test never calls it: it fakes search.
    monkeypatch.setattr(mapillary_tool, "search", refuse)


@pytest.fixture(autouse=True)
def no_local_osm(monkeypatch):
    """The tests decide what Overpass answers, whatever has been downloaded on this machine."""
    for name in ("around", "ways_in", "buildings_in"):
        monkeypatch.setattr(osm_local, name, lambda *a, **k: None)


@pytest.fixture(autouse=True)
def no_model_calls(monkeypatch):
    """A model call is paid too: a test that forgets to fake it fails instead of calling OpenRouter."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "")

    def refuse(*a, **k):
        raise AssertionError("OpenRouter must not be called in tests")

    monkeypatch.setattr(senses_mod, "post_openrouter", refuse)


@pytest.fixture(autouse=True)
def no_street_view(tmp_path, monkeypatch):
    """Street View images are paid (and its metadata is not ours to spend): the tests run on Mapillary unless one sets
    PHOTO_SOURCE=streetview itself, and then fakes the provider; one that forgets fails instead of calling Google."""
    monkeypatch.setenv("PHOTO_SOURCE", "mapillary")
    monkeypatch.delenv("RENDER", raising=False)

    def refuse(*a, **k):
        raise AssertionError("Street View must not be called in tests")

    monkeypatch.setattr(streetview_tool.StreetViewProvider, "_get", refuse)  # every call to Google goes through it
