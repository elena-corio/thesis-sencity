"""The in-app test (D197; app/app_test.py, app/main.py, app/db.py): nothing is saved without its own opt-in, the photos
and their order are fixed by config/app_test.json, a missing rating is stored as missing (never 0), the test stays shut
until the photo list is approved, and the rows go with the account. No test reaches Clerk, Google or the model."""
import csv
import json

import pytest
from fastapi.testclient import TestClient

from app import app_test as app_test_mod
from app import app_test_export
from app import auth, db
from app import main as main_mod

PROFILE = {"language": "en", "answers": {"A11": 3, "A12": {"traffic_trams": 1}, "A13": {"greenery_trees": 5}, "A16": ""},
           "text": "t", "version": "abc123", "saved": "2026-11-28T10:00:00Z", "weather": {"hot": 2}, "thermal": {"heat": 24.0},
           "prepare": None}
ESTIMATE = {"comfort": 2, "level": "hard", "bothers": ["traffic_trams"], "feels_good": ["greenery_trees"],
            "model": "google/gemini-3.1-flash-lite", "commit": "86491d3e19fc5dfcadea83a15069b59cb19e4b0f",
            "prompt": "p3", "profile_version": "abc123", "personal": True}
SHOWN = "2026-11-28T10:01:00Z"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("APP_TEST_ALLOW_UNAPPROVED", "1")  # the proposed list, as in local testing
    return TestClient(main_mod.app)


@pytest.fixture
def cfg():
    return app_test_mod.load()


@pytest.fixture
def with_profile(database_and_user):
    db.put_profile(database_and_user["id"], PROFILE)


def answer(cfg, i, **over):
    """The answer to the i-th photo (0-based), in the fixed order."""
    p = cfg["photos"][i]
    return {"photo_id": p["id"], "order": i + 1, "estimate": ESTIMATE, "rating": 4, "reasons_right": "partly",
            "free_text": "", "shown_at": SHOWN, "answered_at": "2026-11-28T10:02:00Z", **over}


def saved_rows():
    s = db.app_test_session("user_test")
    return db.app_test_answered(s["id"]) if s else []


def test_the_config_has_six_to_eight_fixed_photos_and_no_survey_photo(cfg):
    assert 6 <= len(cfg["photos"]) <= 8
    assert len({p["id"] for p in cfg["photos"]}) == len(cfg["photos"])
    assert cfg["info_sheet_url"].startswith("https://")
    # None of the 20 survey photos (their pano IDs are in the thesis repo, config/photos_meta.csv; checked when the list was made).
    assert all(p["source"] in ("streetview", "mapillary") for p in cfg["photos"])


def test_the_photos_come_in_the_same_fixed_order_for_everyone(client, cfg):
    first = client.get("/api/app-test").json()
    assert [p["id"] for p in first["photos"]] == [p["id"] for p in cfg["photos"]]
    assert [p["order"] for p in first["photos"]] == list(range(1, len(cfg["photos"]) + 1))
    assert all("kind" not in p for p in first["photos"])  # Elena's note is never sent
    other = db.ensure_account("user_other")
    main_mod.app.dependency_overrides[auth.signed_in] = lambda: auth.User("user_other", other["id"], True)
    assert client.get("/api/app-test").json()["photos"] == first["photos"]


def test_an_answer_out_of_the_fixed_order_or_for_another_photo_is_refused(client, cfg, with_profile):
    assert client.post("/api/app-test/start", json={"consent": True}).status_code == 200
    assert client.post("/api/app-test/answer", json=answer(cfg, 1, order=1)).status_code == 422
    assert client.post("/api/app-test/answer", json=answer(cfg, 0, photo_id="sv:NotInTheTest_123")).status_code == 422
    assert saved_rows() == []
    assert client.post("/api/app-test/answer", json=answer(cfg, 1)).status_code == 200
    assert [(r["photo_id"], r["order_shown"]) for r in saved_rows()] == [(cfg["photos"][1]["id"], 2)]


def test_nothing_is_saved_without_the_opt_in(client, cfg, with_profile):
    # No tick: no session, so neither an answer nor the end is saved.
    assert client.post("/api/app-test/start", json={"consent": False}).status_code == 422
    assert db.app_test_session("user_test") is None
    assert client.post("/api/app-test/answer", json=answer(cfg, 0)).status_code == 403
    assert client.post("/api/app-test/finish").status_code == 403
    assert db.app_test_session("user_test") is None and db.app_test_export() == []
    assert client.get("/api/app-test").json()["session"] is None


def test_the_privacy_notice_and_a_profile_come_first(client, cfg):
    account = db.ensure_account("user_new")
    main_mod.app.dependency_overrides[auth.signed_in] = lambda: auth.User("user_new", account["id"], False)
    assert client.post("/api/app-test/start", json={"consent": True}).status_code == 403
    main_mod.app.dependency_overrides[auth.signed_in] = lambda: auth.User("user_new", account["id"], True)
    assert client.post("/api/app-test/start", json={"consent": True}).status_code == 409  # no profile yet
    assert db.app_test_session("user_new") is None


def test_a_missing_rating_is_stored_as_missing_never_as_zero(client, cfg, with_profile):
    client.post("/api/app-test/start", json={"consent": True})
    assert client.post("/api/app-test/answer", json=answer(cfg, 0, rating=0)).status_code == 422
    assert client.post("/api/app-test/answer", json=answer(cfg, 0, rating=6)).status_code == 422
    body = answer(cfg, 0, reasons_right=None, answered_at=None)
    del body["rating"]
    assert client.post("/api/app-test/answer", json=body).status_code == 200
    assert client.post("/api/app-test/answer", json=answer(cfg, 1, rating=None)).status_code == 200
    rows = saved_rows()
    assert [r["rating"] for r in rows] == [None, None]
    assert rows[0]["reasons_right"] is None
    # …and in the export it is an empty cell, never 0.
    out = app_test_export.rows(db.app_test_export(), {})
    assert [r["rating_b1"] for r in out] == ["", ""]
    assert client.post("/api/app-test/finish").json()["session"]["rated"] == 0


def test_what_is_saved_with_the_opt_in(client, cfg, with_profile):
    started = client.post("/api/app-test/start", json={"consent": True}).json()["session"]
    assert started == {"finished": False, "answered": [], "rated": 0}
    s = db.app_test_session("user_test")
    assert s["clerk_user_id"] == "user_test" and s["consented_at"] is not None
    assert s["photo_set"] == app_test_mod.photo_set(cfg) and s["app_version"]
    # The profile answers as they were at that moment (not the thermal handles or the text).
    assert s["profile"] == {"language": "en", "answers": PROFILE["answers"], "version": "abc123", "weather": {"hot": 2},
                            "prepare": None}
    db.put_profile(db.account_for("user_test")["id"], {**PROFILE, "answers": {**PROFILE["answers"], "A11": 1}})
    assert db.app_test_session("user_test")["profile"]["answers"]["A11"] == 3  # a later edit does not change it
    assert client.post("/api/app-test/answer", json=answer(cfg, 0, free_text="  too loud  ")).status_code == 200
    row = saved_rows()[0]
    assert row["estimate"] == ESTIMATE and row["rating"] == 4 and row["reasons_right"] == "partly"
    assert row["free_text"] == "too loud" and row["model"] == ESTIMATE["model"] and row["export_commit"] == ESTIMATE["commit"]
    assert row["profile_version"] == "abc123" and row["shown_at"] is not None and row["answered_at"] is not None
    # Sent again after a network error: replaced, not doubled.
    assert client.post("/api/app-test/answer", json=answer(cfg, 0, rating=5)).status_code == 200
    assert [r["rating"] for r in saved_rows()] == [5]
    done = client.post("/api/app-test/finish").json()["session"]
    assert done == {"finished": True, "answered": [cfg["photos"][0]["id"]], "rated": 1}


def test_no_estimate_means_no_reasons_answer(client, cfg, with_profile):
    client.post("/api/app-test/start", json={"consent": True})
    assert client.post("/api/app-test/answer", json=answer(cfg, 0, estimate=None, reasons_right="yes")).status_code == 200
    row = saved_rows()[0]
    assert row["estimate"] is None and row["reasons_right"] is None and row["model"] is None


def test_free_text_is_capped(client, cfg, with_profile):
    client.post("/api/app-test/start", json={"consent": True})
    long = "x" * (cfg["free_text_max"] + 1)
    assert client.post("/api/app-test/answer", json=answer(cfg, 0, free_text=long)).status_code == 422
    assert saved_rows() == []


def test_the_test_is_shut_until_the_list_is_approved(monkeypatch, cfg):
    monkeypatch.delenv("APP_TEST_ALLOW_UNAPPROVED", raising=False)
    c = TestClient(main_mod.app)
    monkeypatch.setattr(app_test_mod, "load", lambda path=None: {**cfg, "approved": False})
    assert c.get("/api/app-test").status_code == 503
    assert c.post("/api/app-test/start", json={"consent": True}).status_code == 503
    monkeypatch.setattr(app_test_mod, "load", lambda path=None: {**cfg, "approved": True})
    assert c.get("/api/app-test").status_code == 200


def test_deleting_the_account_deletes_the_app_test_rows(client, cfg, with_profile, monkeypatch):
    client.post("/api/app-test/start", json={"consent": True})
    client.post("/api/app-test/answer", json=answer(cfg, 0))
    monkeypatch.setattr(auth, "delete_clerk_user", lambda clerk_id: None)
    assert client.delete("/api/account").status_code == 200
    assert db.app_test_session("user_test") is None and db.app_test_export() == []


def test_the_test_photos_may_be_fetched_like_an_area_s_at_their_own_pitch(cfg):
    for p in cfg["photos"]:
        if p["source"] == "streetview":
            key = (p["pano_id"], round(p["heading"], 1))
            assert key in main_mod._known_photos
            if "pitch" in p:
                assert main_mod._photo_pitches[key] == p["pitch"]


def test_on_render_only_the_test_photos_are_street_view(cfg, monkeypatch):
    # PHOTO_SOURCE=mapillary: the map's cached Street View photos are never fetched, the app test's are.
    monkeypatch.setattr(main_mod.photos_mod, "load_all_known", lambda c: {("panoOfAMapStreet", 90.0)})
    known, pitches = main_mod.street_view_at_start("mapillary")
    assert known == app_test_mod.known_photos(cfg)
    assert ("panoOfAMapStreet", 90.0) not in known
    assert set(pitches) <= known
    known, _ = main_mod.street_view_at_start("streetview")
    assert ("panoOfAMapStreet", 90.0) in known and app_test_mod.known_photos(cfg) <= known


def test_a_contributor_photo_carries_its_author_s_credit(client, cfg):
    sent = {p["id"]: p for p in client.get("/api/app-test").json()["photos"]}
    for p in cfg["photos"]:
        if p.get("contributor"):
            assert sent[p["id"]]["copyright"] == p["copyright"] and "Google" not in p["copyright"]


def test_a_pitch_out_of_range_is_refused(tmp_path, cfg):
    bad = {**cfg, "photos": [{**cfg["photos"][0], "pitch": 120}] + cfg["photos"][1:]}
    path = tmp_path / "app_test.json"
    path.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(app_test_mod.AppTestError):
        app_test_mod.load(path)


def test_the_export_writes_one_row_per_person_and_photo(client, cfg, with_profile, tmp_path):
    client.post("/api/app-test/start", json={"consent": True})
    for i in range(3):
        client.post("/api/app-test/answer", json=answer(cfg, i, rating=None if i == 2 else i + 2))
    other = db.ensure_account("user_other")
    db.set_consent(other["id"], db.now())
    db.put_profile(other["id"], PROFILE)
    main_mod.app.dependency_overrides[auth.signed_in] = lambda: auth.User("user_other", other["id"], True)
    client.post("/api/app-test/start", json={"consent": True})
    client.post("/api/app-test/answer", json=answer(cfg, 0))
    path = app_test_export.export(tmp_path / "app_test")
    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert list(rows[0]) == app_test_export.COLUMNS
    assert [(r["clerk_user_id"], r["order_shown"]) for r in rows] == [("user_test", "1"), ("user_test", "2"),
                                                                       ("user_test", "3"), ("user_other", "1")]
    assert [r["rating_b1"] for r in rows] == ["2", "3", "", "4"]
    assert rows[0]["photo_name"] == cfg["photos"][0]["name"] and rows[0]["estimate_bothers"] == "traffic_trams"
    assert json.loads(rows[0]["profile_answers"])["answers"] == PROFILE["answers"]


def test_the_session_says_where_it_started_and_whether_it_was_skipped_first(client, cfg, with_profile):
    assert client.post("/api/app-test/start", json={"consent": True, "entry": "somewhere"}).status_code == 422
    assert db.app_test_session("user_test") is None
    assert client.post("/api/app-test/start", json={"consent": True, "entry": "later", "skipped_first": True}).status_code == 200
    s = db.app_test_session("user_test")
    assert (s["entry"], s["skipped_first"]) == ("later", True)
    client.post("/api/app-test/answer", json=answer(cfg, 0))
    row = app_test_export.rows(db.app_test_export(), {})[0]
    assert (row["entry"], row["skipped_first"]) == ("later", "True")


def test_started_right_after_the_profile(client, cfg, with_profile):
    client.post("/api/app-test/start", json={"consent": True, "entry": "profile"})
    s = db.app_test_session("user_test")
    assert (s["entry"], s["skipped_first"]) == ("profile", False)


def test_migrate_adds_the_new_columns_to_a_table_that_already_exists(tmp_path):
    from sqlalchemy import create_engine, inspect, text
    e = create_engine(f"sqlite:///{(tmp_path / 'old.db').as_posix()}")
    with e.begin() as c:  # the table as schema version 2 made it, with a row in it
        c.execute(text("CREATE TABLE app_test_sessions (id VARCHAR(36) PRIMARY KEY, clerk_user_id VARCHAR(64) NOT NULL UNIQUE, "
                       "consented_at DATETIME NOT NULL, started_at DATETIME NOT NULL, finished_at DATETIME, "
                       "photo_set VARCHAR(16) NOT NULL, app_version VARCHAR(40) NOT NULL, profile JSON NOT NULL, profile_version VARCHAR(32))"))
        c.execute(text("INSERT INTO app_test_sessions VALUES ('s1', 'user_old', '2026-11-28', '2026-11-28', NULL, 'abc', 'v', '{}', NULL)"))
    assert db.migrate(e) == db.SCHEMA_VERSION
    assert {"entry", "skipped_first"} <= {c["name"] for c in inspect(e).get_columns("app_test_sessions")}
    with e.begin() as c:
        assert c.execute(text("SELECT clerk_user_id, entry, skipped_first FROM app_test_sessions")).one() == ("user_old", None, None)
    db.migrate(e)  # safe to run again
    e.dispose()
