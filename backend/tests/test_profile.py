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

from pathlib import Path

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


# Use in ratings: V0 without a profile, V2 with it. Personal results are relayed, never kept on the server
# (Elena, 2026-11-15): the browser keeps them and sends a stamp; the server answers "keep" while it still holds.

def run_with(photos, cfg, text=None, stamps=None):
    plan = senses_mod.plan_rating(photos, cfg, text, stamps)
    provider = FakeProvider()
    return list(senses_mod.rate_events(plan, cfg, provider if plan.to_rate else None)), plan


def server_files(cfg):
    """Everything the server keeps about ratings: the rating cache and the presence cache, as text."""
    return "".join(Path(f).read_text(encoding="utf-8") for f in (cfg["cache_file"], cfg["presence_cache_file"]) if Path(f).exists())


def test_with_a_profile_the_system_message_is_the_instruction_a_blank_line_and_the_profile(calls, cfg):
    calls.ratings.append(reply(GOOD))
    events, _ = run_with([(PANO, HEADING)], cfg, DEV["expected"])
    presence, rating = calls.made
    export = load_export()
    # The presence call never sees the profile; the rating call is the study's V2.
    assert all(m["role"] == "user" for m in presence["messages"])
    assert rating["messages"][0] == {"role": "system", "content": export.system.rstrip() + "\n\n" + DEV["expected"]}
    assert rating["provider"] == export.model["provider"]
    assert rating["provider"]["zdr"] is True and rating["provider"]["allow_fallbacks"] is False
    ok = photo_events(events, "ok")[0]
    assert events[0]["personal"] is True and ok["result"]["personal"] is True
    assert ok["stamp"] == {"listed": ok["result"]["listed"], "model": export.model["model"], "commit": export.commit,
                           "prompt": senses_mod.PROMPT_VERSION}


def test_without_a_profile_it_is_the_instruction_alone_and_marked_general(calls, cfg):
    calls.ratings.append(reply(GOOD))
    events, _ = run_with([(PANO, HEADING)], cfg)
    assert calls.made[1]["messages"][0] == {"role": "system", "content": load_export().system.strip()}
    ok = photo_events(events, "ok")[0]
    assert ok["result"]["personal"] is False and "stamp" not in ok


def test_after_a_personal_rating_the_server_holds_nothing_keyed_to_the_profile(calls, cfg, pe):
    calls.ratings += [reply(dict(GOOD, B1_comfort=2, reasoning="Too loud for me, the traffic wears me out."))]
    events, _ = run_with([(PANO, HEADING)], cfg, DEV["expected"])
    assert photo_events(events, "ok")[0]["result"]["comfort"] == 2
    kept = server_files(cfg)
    version = profile_mod.version(DEV["expected"])
    assert version not in kept and "profile" not in kept
    assert "Too loud for me" not in kept  # the personal result
    assert "Traffic noise" not in kept and "How you experience public spaces" not in kept  # the answers, the text
    rating_cache = json.loads(Path(cfg["cache_file"]).read_text(encoding="utf-8")) if Path(cfg["cache_file"]).exists() else {}
    assert rating_cache == {}  # only the presence list (not personal) was kept
    assert json.loads(Path(cfg["presence_cache_file"]).read_text(encoding="utf-8"))  # it was


def test_a_stamp_that_still_holds_is_kept_without_a_call_and_one_that_does_not_is_rated_again(calls, cfg, pe):
    calls.ratings += [reply(dict(GOOD, B1_comfort=2)), reply(dict(GOOD, B1_comfort=3))]
    events, _ = run_with([(PANO, HEADING)], cfg, DEV["expected"])
    stamp = photo_events(events, "ok")[0]["stamp"]
    made = len(calls.made)
    again, plan = run_with([(PANO, HEADING)], cfg, DEV["expected"], {(PANO, HEADING): stamp})
    assert photo_events(again) == [{"type": "photo", "id": PANO, "heading": HEADING, "status": "keep", "cached": True}]
    assert len(calls.made) == made and plan.to_rate == []
    # Another element list, model or export: rated again (the presence list stays cached).
    for wrong in ({**stamp, "listed": stamp["listed"][:-1]}, {**stamp, "model": "other/model"}, {**stamp, "commit": "abc1234"},
                  {**stamp, "prompt": "1"}):
        plan = senses_mod.plan_rating([(PANO, HEADING)], cfg, DEV["expected"], {(PANO, HEADING): wrong})
        assert plan.kept == () and plan.to_rate == [(PANO, HEADING)]
    # A stamp means nothing without a profile: general ratings come from the server cache.
    plan = senses_mod.plan_rating([(PANO, HEADING)], cfg, None, {(PANO, HEADING): stamp})
    assert plan.kept == () and plan.to_rate == [(PANO, HEADING)]


def test_personal_entries_from_before_are_removed_from_the_cache(tmp_path):
    path = tmp_path / "c.json"
    general = "mly:1|90.0|m|c|general"
    path.write_text(json.dumps({general: {"output": {}}, "mly:1|90.0|m|c|profile 386e888b8867": {"output": {}},
                                "mly:2|90.0|m|c|profile 021e74c47d3a": {"output": {}}}), encoding="utf-8")
    assert senses_mod.drop_personal(path) == 2
    assert list(json.loads(path.read_text(encoding="utf-8"))) == [general]
    assert senses_mod.drop_personal(path) == 0


def endpoint(monkeypatch, tmp_path):
    monkeypatch.setitem(main_mod.cfg["senses"], "cache_file", str(tmp_path / "c.json"))
    monkeypatch.setitem(main_mod.cfg["senses"], "presence_cache_file", str(tmp_path / "p.json"))
    seen = {}

    def plan(photos, cfg, text=None, stamps=None):
        seen.update(text=text, stamps=stamps)
        raise senses_mod.PredictionError(418, "stop here")
    monkeypatch.setattr(senses_mod, "plan_rating", plan)
    return TestClient(main_mod.app), seen


def test_the_endpoint_builds_the_profile_from_the_answers_and_never_logs_it(monkeypatch, tmp_path, caplog):
    client, seen = endpoint(monkeypatch, tmp_path)
    body = {"photos": [{"id": PANO, "heading": HEADING}], "profile": {**DEV["answers"], "language": "en"}}
    with caplog.at_level(logging.DEBUG):
        assert client.post("/api/senses/rate", json=body).status_code == 418
    assert seen["text"] == DEV["expected"] and seen["stamps"] == {}
    assert "Traffic noise" not in caplog.text and "greenery" not in caplog.text
    client.post("/api/senses/rate", json={"photos": body["photos"]})
    assert seen == {"text": None, "stamps": {}}
    stamp = {"listed": ["shade"], "model": "google/m", "commit": "ed963d2", "prompt": "2"}
    client.post("/api/senses/rate", json={**body, "photos": [{"id": PANO, "heading": HEADING, "cached": stamp}]})
    assert seen["stamps"] == {(PANO, HEADING): stamp}


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


# Parity with the study: the whole V2 request, against what the study pipeline sends (tests/fixtures/v2_parity.json,
# made by thesis-personas src/task_v9.build_call for study photo 1 and the made-up test profile, without the image).

PARITY = json.loads((Path(__file__).parent / "fixtures" / "v2_parity.json").read_text(encoding="utf-8"))


def test_the_v2_request_is_the_studys_word_for_word(pe):
    export = load_export()
    text = profile_mod.build(profile_mod.check(DEV["answers"], DEV["language"], pe), DEV["language"], pe)
    body = senses_mod.build_request(export, "data:image/jpeg;base64,AAAA", PARITY["listed"], text)
    system, user = body["messages"]
    # System: the instruction, a blank line, the profile, which ends with the study's closing line.
    assert system == {"role": "system", "content": PARITY["system"]}
    assert system["content"].endswith("Now rate this specific place: it may be easier or harder for you than public spaces in general.")
    # User: the task text with this photo's elements, then the photo, nothing else.
    assert [p["type"] for p in user["content"]] == ["text", "image_url"]
    assert user["content"][0]["text"] == PARITY["user_text"]
    # Schema: the study's, with this photo's codes, reasoning after the rating.
    assert body["response_format"] == PARITY["response_format"]
    assert list(body["response_format"]["json_schema"]["schema"]["properties"])[-1] == "reasoning"
    # Settings (model.json).
    assert body["model"] == "google/gemini-3.1-flash-lite"
    assert body["provider"]["only"] == ["google-vertex/eu"]
    assert body["provider"]["zdr"] is True and body["provider"]["data_collection"] == "deny"
    assert body["provider"]["allow_fallbacks"] is False
    assert body["temperature"] == 0.7


def test_the_v0_request_differs_from_v2_by_the_profile_only():
    export = load_export()
    v0 = senses_mod.build_request(export, "data:image/jpeg;base64,AAAA", PARITY["listed"])
    assert v0["messages"][0]["content"] == PARITY["system"].split("\n\n")[0]
    assert v0["messages"][1]["content"][0]["text"] == PARITY["user_text"]
    assert v0["response_format"] == PARITY["response_format"]


# The study's confirmed element lists (model/app_v9/study_lists.json, hash-checked with the export) as the parity fixture.

STUDY_LISTS = json.loads((senses_mod.EXPORT_DIR / "study_lists.json").read_text(encoding="utf-8"))


def test_the_study_lists_are_checked_with_the_export_and_cover_the_20_photos():
    files, _commit, _presence = senses_mod.verified_files()
    assert "study_lists.json" in files  # listed in MANIFEST.md, so its sha256 is checked
    places = STUDY_LISTS["places"]
    assert [p["place"] for p in places] == list(range(1, 21))
    codes = set(load_export().elements)
    assert all(set(p["elements"]) <= codes and set(p["visible_not_listed"]) <= codes for p in places)
    assert not any(set(p["elements"]) & set(p["visible_not_listed"]) for p in places)


def test_the_v2_parity_fixture_uses_the_study_list_of_its_photo():
    place = next(p for p in STUDY_LISTS["places"] if p["place"] == PARITY["photo"])
    order = list(load_export().elements)
    assert PARITY["listed"] == [c for c in order if c in place["elements"]]
