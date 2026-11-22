"""Accounts (app/auth.py, app/db.py, app/limits.py, Elena 2026-11-22): every /api route but /api/health needs a
session checked on the server; the profile and own ratings are kept under our own account id; deleting the account
removes our rows, then the Clerk user; per-user limits and the global daily cap. No test reaches Clerk or the model."""
import pytest
from fastapi.testclient import TestClient

from app import auth, db, limits
from app import main as main_mod
from app import senses as senses_mod

PROFILE = {"language": "en", "answers": {"A11": 2, "A12": {"traffic_trams": 1}, "A13": {}, "A16": ""}, "text": "t",
           "version": "abc123", "saved": "2026-11-22T10:00:00Z", "weather": {"hot": 2}, "thermal": None,
           "prepare": {"Q4": {"ticked": ["sit_rest"], "other": ""}}}


@pytest.fixture
def client():
    main_mod._hits.clear()
    return TestClient(main_mod.app)


@pytest.fixture
def signed_out():
    """The real session check: no Clerk session in a test, so every protected route must refuse."""
    main_mod.app.dependency_overrides.clear()


def _calls():
    """Every /api route with a method and a path a request can use (path parameters filled in)."""
    out = []
    for r in main_mod.app.routes:
        path = getattr(r, "path", "")
        if not path.startswith("/api/"):
            continue
        for m in getattr(r, "methods", set()) - {"HEAD", "OPTIONS"}:
            out.append((m, path.replace("{pano_id}", "x") + ("?heading=1" if "{pano_id}" in path else "")))
    return out


def test_every_api_route_but_health_needs_a_session(client, signed_out, monkeypatch):
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_not_real")  # set up, but no token is sent
    calls = _calls()
    assert len(calls) >= 15
    for method, path in calls:
        res = client.request(method, path, json={})
        if path == "/api/health":
            assert res.status_code == 200, path
        else:
            assert res.status_code == 401, (method, path, res.status_code)
    assert client.get("/api/health").json() == {"ok": True}


def test_a_bad_token_is_refused_and_never_logged(client, signed_out, monkeypatch, caplog):
    monkeypatch.setenv("CLERK_SECRET_KEY", "sk_test_not_real")
    monkeypatch.setattr(auth, "_parties", lambda: None)
    res = client.get("/api/profile", headers={"Authorization": "Bearer not.a.token"})
    assert res.status_code == 401
    assert "not.a.token" not in caplog.text


def test_without_the_clerk_secret_sign_in_is_not_set_up(client, signed_out):
    assert client.get("/api/profile").status_code == 503


def test_the_profile_is_saved_under_our_account_and_read_back(client, database_and_user):
    assert client.get("/api/profile").json() == {"profile": None, "consented": True}
    assert client.put("/api/profile", json={**PROFILE, "extra": "dropped"}).status_code == 200
    got = client.get("/api/profile").json()["profile"]
    assert got == PROFILE  # only the known fields are kept
    assert db.get_profile(database_and_user["id"]) == PROFILE
    assert database_and_user["clerk_user_id"] == "user_test" and len(database_and_user["id"]) == 36  # our own random id


def test_nothing_is_saved_before_the_privacy_notice_is_agreed(client):
    account = db.ensure_account("user_new")
    main_mod.app.dependency_overrides[auth.signed_in] = lambda: auth.User("user_new", account["id"], False)
    assert client.put("/api/profile", json=PROFILE).status_code == 403
    assert client.put("/api/ratings/own", json=[]).status_code == 403
    assert client.post("/api/account/consent", json={"agreed": False}).status_code == 422
    assert client.post("/api/account/consent", json={"agreed": True}).status_code == 200
    assert db.account_for("user_new")["consented_at"] is not None


def test_a_profile_that_is_not_one_is_refused(client):
    for body in ([], {"answers": {}}, {"language": "fr", "answers": {}}):
        assert client.put("/api/profile", json=body).status_code == 422
    assert client.put("/api/profile", content=b"{" + b"x" * 300_000).status_code == 413


def test_own_ratings_are_kept_as_a_list(client):
    ratings = [{"id": "r1", "photo": {"id": "p1"}, "rating": {"B1": 3}}]
    assert client.put("/api/ratings/own", json=ratings).json() == {"saved": 1}
    assert client.get("/api/ratings/own").json() == {"ratings": ratings}
    assert client.put("/api/ratings/own", json={"not": "a list"}).status_code == 422


def test_delete_my_account_removes_our_rows_then_the_clerk_user(client, database_and_user, monkeypatch):
    order = []
    monkeypatch.setattr(db, "delete_account", lambda account_id, real=db.delete_account: (order.append("rows"), real(account_id)))
    monkeypatch.setattr(auth, "delete_clerk_user", lambda clerk_id: order.append(f"clerk:{clerk_id}"))
    client.put("/api/profile", json=PROFILE)
    client.put("/api/ratings/own", json=[{"id": "r1"}])
    limits.chat(database_and_user["id"])
    assert client.delete("/api/account").json() == {"deleted": True}
    assert order == ["rows", "clerk:user_test"]
    assert db.get_profile(database_and_user["id"]) is None and db.get_ratings(database_and_user["id"]) == []
    assert db.account_for("user_test") is None
    with db.engine().begin() as c:
        assert c.execute(db.usage.select().where(db.usage.c.scope.like(f"{database_and_user['id']}:%"))).first() is None


def test_chat_limits_per_user_with_a_friendly_message(client, monkeypatch):
    monkeypatch.setenv("LIMIT_CHAT_PER_HOUR", "2")
    monkeypatch.setattr(senses_mod, "post_openrouter", lambda *a: {"choices": [{"message": {"content": "{\"action\": \"out_of_scope\"}"}}]})
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    codes = [client.post("/api/chat", json={"message": "hi"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert "limit of 2 questions an hour" in client.post("/api/chat", json={"message": "hi"}).json()["detail"]


def test_the_limits_are_env_vars_with_defaults(monkeypatch):
    assert limits.setting("LIMIT_MODEL_CALLS_PER_DAY") == 2000
    assert (limits.setting("LIMIT_CHAT_PER_HOUR"), limits.setting("LIMIT_CHAT_PER_DAY")) == (30, 100)
    assert (limits.setting("LIMIT_RUNS_PER_HOUR"), limits.setting("LIMIT_RUNS_PER_DAY")) == (10, 30)
    monkeypatch.setenv("LIMIT_RUNS_PER_DAY", "5")
    assert limits.setting("LIMIT_RUNS_PER_DAY") == 5
    monkeypatch.setenv("LIMIT_RUNS_PER_DAY", "lots")
    assert limits.setting("LIMIT_RUNS_PER_DAY") == 30


def test_the_global_daily_cap_stops_chat_and_rating_calls(client, monkeypatch, database_and_user):
    monkeypatch.setenv("LIMIT_MODEL_CALLS_PER_DAY", "3")
    limits.model_called(3)
    res = client.post("/api/chat", json={"message": "hi"})
    assert res.status_code == 429 and "daily limit" in res.json()["detail"]
    # A rating call checks the cap before it is made: a fatal error, so the run stops.
    assert main_mod._ModelGuard.allow() is False
    with pytest.raises(senses_mod.PredictionError) as e:
        senses_mod._ask({}, "k", {}, lambda t: (None, None), [], "rating")
    assert e.value.fatal and e.value.status == 429
    with pytest.raises(Exception):
        limits.rating_run(database_and_user["id"])


def test_rating_runs_are_counted_per_user(database_and_user, monkeypatch):
    monkeypatch.setenv("LIMIT_RUNS_PER_HOUR", "1")
    limits.rating_run(database_and_user["id"])
    with pytest.raises(Exception) as e:
        limits.rating_run(database_and_user["id"])
    assert "rating runs an hour" in str(e.value.detail)


def test_the_built_frontend_is_served_with_the_app_routes(client, tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>SenCity</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    monkeypatch.setattr(main_mod, "DIST", dist)
    assert "SenCity" in client.get("/").text
    assert "SenCity" in client.get("/profile").text  # the app's own route: index.html
    assert client.get("/assets/app.js").text == "console.log(1)"
    assert client.get("/api/nothing-here").status_code == 404
    assert "SenCity" in client.get("/../../.env").text  # never a file outside dist


def test_requests_arriving_together_after_sign_in_share_one_account():
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(8) as pool:
        ids = set(pool.map(lambda _: db.ensure_account("user_together")["id"], range(16)))
    assert len(ids) == 1


def test_database_errors_never_carry_row_values():
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy import insert
    e = db.create_engine("sqlite://", hide_parameters=True)
    db.migrate(e)
    with e.begin() as c:
        c.execute(insert(db.accounts).values(id="a", clerk_user_id="secret_user", created_at=db.now()))
    with pytest.raises(IntegrityError) as err:
        with e.begin() as c:
            c.execute(insert(db.accounts).values(id="b", clerk_user_id="secret_user", created_at=db.now()))
    assert "secret_user" not in str(err.value)
    import inspect
    assert "hide_parameters=True" in inspect.getsource(db.engine)


def test_database_url_from_render_is_read_as_postgres(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@host:5432/sencity")
    assert db.url() == "postgresql+psycopg://u:p@host:5432/sencity"
    monkeypatch.delenv("DATABASE_URL")
    assert db.url().startswith("sqlite:///")


def test_a_photo_sphere_id_with_a_dot_is_a_photo_id():
    """Contributed Street View photo spheres ("CAoS…") can end in "."; refusing it refused a whole rating run."""
    from app import photos as photos_mod
    from app.main import SensesPhoto
    assert photos_mod.PANO_ID.match("CAoSFkNJSE0wb2dLRUlDQWdJQ1ZuNUx0SlE.")
    assert SensesPhoto(id="sv:CAoSFkNJSE0wb2dLRUlDQWdJQ1ZuNUx0SlE.", heading=10).id.endswith(".")
    assert not photos_mod.PANO_ID.match("../../etc/passwd")
