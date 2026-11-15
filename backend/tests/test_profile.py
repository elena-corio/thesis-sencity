"""Your sensory profile: built from model/app_v9/ exactly as the study builds it, checked, and used in the rating call
(V2) or left out (V0). The expected texts were made by the study's own code (thesis-personas, personas.persona_texts_v9)
for made-up people: frontend/src/dev/test-profiles.json. No API calls."""
import json
import logging

import pytest
from fastapi.testclient import TestClient

from app import main as main_mod
from app import profile as profile_mod
from app import senses as senses_mod
from app.senses import load_export
from tool.config import REPO_ROOT

from tests.test_senses import GOOD, HEADING, PANO, FakeProvider, calls, cfg, copy_export, edit_text, photo_events, reply  # noqa: F401

CASES = json.loads((REPO_ROOT / "frontend" / "src" / "dev" / "test-profiles.json").read_text(encoding="utf-8"))
DEV = CASES[0]  # the made-up profile the app can load in dev mode


@pytest.fixture(scope="module")
def pe():
    return profile_mod.load()


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_profile_text_is_the_studys_word_for_word(pe, case):
    assert profile_mod.build(case["answers"], case["language"], pe) == case["expected"]


def test_the_dev_profile_is_complete_and_passes_the_checks(pe):
    answers = profile_mod.check(DEV["answers"], DEV["language"], pe)
    assert profile_mod.build(answers, DEV["language"], pe) == DEV["expected"]
    assert len(answers["A12"]) == 10 and len(answers["A13"]) == 10


def test_the_version_is_the_hash_of_the_text(pe):
    v = profile_mod.version(DEV["expected"])
    assert len(v) == 12 and v == profile_mod.version(profile_mod.build(DEV["answers"], "en", pe))
    other = dict(DEV["answers"], A11=3)
    assert profile_mod.version(profile_mod.build(other, "en", pe)) != v
    # The language is named in the A16 line, so answering in Italian is another profile.
    assert profile_mod.version(profile_mod.build(DEV["answers"], "it", pe)) != v


def test_the_open_answer_is_trimmed_and_an_empty_one_leaves_its_line_out(pe):
    answers = profile_mod.check(dict(DEV["answers"], A16="  hello  \n"), "en", pe)
    assert answers["A16"] == "hello"
    blank = profile_mod.check(dict(DEV["answers"], A16="   "), "en", pe)
    assert "Anything else" not in profile_mod.build(blank, "en", pe)


@pytest.mark.parametrize("change,word", [
    ({"A11": 0}, "A11"), ({"A11": None}, "A11"), ({"A11": True}, "A11"),
    ({"A12": {}}, "A12"), ({"A13": {"crowds": 3}}, "A13"),
    ({"A12": {**DEV["answers"]["A12"], "greenery_trees": 6}}, "A12"),
    ({"A16": "x" * (profile_mod.A16_MAX + 1)}, "A16"),
])
def test_answers_that_do_not_fit_part_a_are_refused_and_the_message_names_only_the_question(pe, change, word):
    with pytest.raises(profile_mod.ProfileError) as e:
        profile_mod.check({**DEV["answers"], **change}, "en", pe)
    assert word in str(e.value) and "Traffic noise" not in str(e.value)


def test_an_unknown_language_is_refused(pe):
    with pytest.raises(profile_mod.ProfileError):
        profile_mod.check(DEV["answers"], "de", pe)


def test_the_survey_is_part_a_as_exported_with_icons_and_no_attention_checks(pe):
    s = profile_mod.survey(pe)
    assert [q["code"] for q in s["questions"]] == ["A11", "A12", "A13", "A16"]
    assert s["intro"]["en"].startswith("Think of all eight senses")
    rows = [r for q in s["questions"] for r in q.get("rows", [])]
    assert len(rows) == 20 and all(r["en"] and r["it"] and r["icon_key"] in senses_mod.SENSES for r in rows)
    assert "Check:" not in json.dumps(s) and "persona" not in json.dumps(s).lower()
    assert s["profile"]["template"] == (senses_mod.EXPORT_DIR / "profile_template.txt").read_text(encoding="utf-8")
    assert s["profile"]["constants"]["{A11_LOW}"] == "not at all"


def test_a_profile_file_that_differs_from_its_hash_stops(tmp_path):
    folder = copy_export(tmp_path)
    (folder / "profile_template.txt").write_text("changed {A11}", encoding="utf-8")
    with pytest.raises(senses_mod.ExportError, match="profile_template.txt does not match"):
        profile_mod.load(folder)


def test_a_template_without_one_of_its_slots_is_refused(tmp_path):
    folder = copy_export(tmp_path)
    edit_text(folder, "profile_template.txt", "{A16}", "")
    with pytest.raises(senses_mod.ExportError, match=r"\{A16\}"):
        profile_mod.load(folder)


# Use in ratings: V0 without a profile, V2 with it, cached per profile version

def run_with(photos, cfg, text=None):
    plan = senses_mod.plan_rating(photos, cfg, text, profile_mod.version(text) if text else None)
    provider = FakeProvider()
    return list(senses_mod.rate_events(plan, cfg, provider if plan.to_rate else None)), plan


def test_with_a_profile_the_system_message_is_the_instruction_a_blank_line_and_the_profile(calls, cfg):
    calls.ratings.append(reply(GOOD))
    events, plan = run_with([(PANO, HEADING)], cfg, DEV["expected"])
    presence, rating = calls.made
    export = load_export()
    # The presence call never sees the profile; the rating call is the study's V2.
    assert all(m["role"] == "user" for m in presence["messages"])
    assert rating["messages"][0] == {"role": "system", "content": export.system.rstrip() + "\n\n" + DEV["expected"]}
    assert rating["provider"] == export.model["provider"]
    assert rating["provider"]["zdr"] is True and rating["provider"]["allow_fallbacks"] is False
    assert events[0]["personal"] is True and photo_events(events, "ok")[0]["result"]["personal"] is True
    assert plan.profile_part == f"profile {profile_mod.version(DEV['expected'])}"


def test_without_a_profile_it_is_the_instruction_alone_and_marked_general(calls, cfg):
    calls.ratings.append(reply(GOOD))
    events, plan = run_with([(PANO, HEADING)], cfg)
    assert calls.made[1]["messages"][0] == {"role": "system", "content": load_export().system}
    assert photo_events(events, "ok")[0]["result"]["personal"] is False
    assert plan.profile_part == senses_mod.GENERAL


def test_ratings_are_cached_per_profile_version_and_a_new_profile_is_rated_again(calls, cfg, pe):
    calls.ratings += [reply(GOOD), reply(dict(GOOD, B1_comfort=2)), reply(dict(GOOD, B1_comfort=5))]
    run_with([(PANO, HEADING)], cfg)                       # general
    run_with([(PANO, HEADING)], cfg, DEV["expected"])      # personal: a new rating, the presence list from the cache
    assert calls.kinds() == ["presence", "rating", "rating"]
    again, _ = run_with([(PANO, HEADING)], cfg, DEV["expected"])
    assert photo_events(again)[0]["cached"] is True and photo_events(again)[0]["result"]["comfort"] == 2
    general, _ = run_with([(PANO, HEADING)], cfg)
    assert photo_events(general)[0]["result"]["comfort"] == 4 and photo_events(general)[0]["result"]["personal"] is False
    edited = profile_mod.build(dict(DEV["answers"], A11=4), "en", pe)
    changed, _ = run_with([(PANO, HEADING)], cfg, edited)  # the old personal rating is not used
    assert photo_events(changed)[0]["cached"] is False and photo_events(changed)[0]["result"]["comfort"] == 5
    stored = json.loads(open(cfg["cache_file"], encoding="utf-8").read())
    assert DEV["answers"]["A16"] not in json.dumps(stored)  # the cache holds the hash, never the profile


def endpoint(monkeypatch, tmp_path):
    monkeypatch.setitem(main_mod.cfg["senses"], "cache_file", str(tmp_path / "c.json"))
    monkeypatch.setitem(main_mod.cfg["senses"], "presence_cache_file", str(tmp_path / "p.json"))
    seen = {}

    def plan(photos, cfg, text=None, version=None):
        seen.update(text=text, version=version)
        raise senses_mod.PredictionError(418, "stop here")
    monkeypatch.setattr(senses_mod, "plan_rating", plan)
    return TestClient(main_mod.app), seen


def test_the_endpoint_builds_the_profile_from_the_answers_and_never_logs_it(monkeypatch, tmp_path, caplog):
    client, seen = endpoint(monkeypatch, tmp_path)
    body = {"photos": [{"id": PANO, "heading": HEADING}], "profile": {**DEV["answers"], "language": "en"}}
    with caplog.at_level(logging.DEBUG):
        assert client.post("/api/senses/rate", json=body).status_code == 418
    assert seen["text"] == DEV["expected"] and seen["version"] == profile_mod.version(DEV["expected"])
    assert "Traffic noise" not in caplog.text and "greenery" not in caplog.text
    client.post("/api/senses/rate", json={"photos": body["photos"]})
    assert seen == {"text": None, "version": None}


def test_the_endpoint_refuses_answers_that_do_not_fit(monkeypatch, tmp_path):
    client, seen = endpoint(monkeypatch, tmp_path)
    photos = [{"id": PANO, "heading": HEADING}]
    bad_grid = {**DEV["answers"], "A12": {"greenery_trees": 3}, "language": "en"}
    res = client.post("/api/senses/rate", json={"photos": photos, "profile": bad_grid})
    assert res.status_code == 422 and "A12" in res.json()["detail"]
    assert client.post("/api/senses/rate", json={"photos": photos, "profile": {**DEV["answers"], "language": "de"}}).status_code == 422
    assert seen == {}


def test_the_survey_endpoint(monkeypatch):
    res = TestClient(main_mod.app).get("/api/profile/survey")
    assert res.status_code == 200 and len(res.json()["questions"]) == 4
