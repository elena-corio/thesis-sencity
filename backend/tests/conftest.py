"""Every test runs without the Infrared.city key and without its API: a thermal run is billed,
so a test that forgets to fake it fails instead of calling the real service."""
import pytest

from app import area as area_mod
from app import routes as routes_mod
from app import senses as senses_mod
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


@pytest.fixture(autouse=True)
def database_and_user(tmp_path, monkeypatch):
    """Each test: its own SQLite database, and a signed-in test user unless a test signs out (tests/test_auth.py).
    No test reaches Clerk: CLERK_SECRET_KEY is empty, so a real session check would refuse."""
    from sqlalchemy import create_engine
    from app import auth, db
    monkeypatch.setenv("CLERK_SECRET_KEY", "")
    for name in ("LIMIT_CHAT_PER_HOUR", "LIMIT_CHAT_PER_DAY", "LIMIT_RUNS_PER_HOUR", "LIMIT_RUNS_PER_DAY", "LIMIT_MODEL_CALLS_PER_DAY"):
        monkeypatch.delenv(name, raising=False)
    engine = create_engine(f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    db.use(engine)
    db.migrate(engine)
    account = db.ensure_account("user_test")
    db.set_consent(account["id"], db.now())
    try:
        from app import main as main_mod
        main_mod.app.dependency_overrides[auth.signed_in] = lambda: auth.User("user_test", account["id"], True)
        yield account
    finally:
        try:
            main_mod.app.dependency_overrides.clear()
        except NameError:
            pass
        engine.dispose()
