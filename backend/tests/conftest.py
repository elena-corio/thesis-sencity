"""Every test runs without the Infrared.city key and without its API: a thermal run is billed,
so a test that forgets to fake it fails instead of calling the real service."""
import pytest

from app import area as area_mod


@pytest.fixture(autouse=True)
def no_infrared(tmp_path, monkeypatch):
    monkeypatch.setenv("INFRARED_API_KEY", "")  # load_dotenv does not override a set variable

    def refuse(*a, **k):
        raise AssertionError("Infrared.city must not be called in tests")

    monkeypatch.setattr(area_mod, "run_utci", refuse)
    monkeypatch.setattr(area_mod, "thermal_dir", lambda cfg: tmp_path / "thermal")
