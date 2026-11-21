"""How you prepare for new places (config/prepare.json, app/prepare.py): the file, its offers for a chatbot, and the
survey that serves it. The answers never reach the server in a rating request (test_profile.py)."""
import json

import pytest
from fastapi.testclient import TestClient

from app import main as main_mod
from app import prepare as prepare_mod


def test_the_file_has_the_four_questions_and_every_q2_option_its_offers():
    data = prepare_mod.load()
    assert [q["code"] for q in data["questions"]] == ["Q1", "Q2", "Q3", "Q4"]
    q1, q2, q3, q4 = data["questions"]
    assert q1["source"] == "A15" and q1["title"]["en"] == "How comfortable do you feel going to a place you don't know?"
    assert q1["labels"] == {"1": {"en": "Not at all"}, "5": {"en": "Very much"}}  # A15's, word for word
    assert q2["title"]["en"] == "How do you usually prepare before going somewhere new?"
    assert q3["type"] == "scale_1_5" and q3["title"]["en"] == "How often does a place feel like too much for your senses?"
    assert q3["labels"] == {"1": {"en": "Never"}, "5": {"en": "Very often"}} and "options" not in q3
    assert q4["title"]["en"] == "When a place feels too much, what helps you?"
    assert [o["code"] for o in q2["options"] if o.get("exclusive")] == ["dont_prepare"]
    assert [o["code"] for o in q4["options"] if o.get("exclusive")] == ["nothing_helps"]
    assert {o["code"]: o["offers"] for o in q2["options"]}["other"] == []
    assert all(o["offers"] for o in q2["options"] if not o.get("other"))


def test_offers_for_a_chatbot():
    data = prepare_mod.load()
    answers = {"Q2": {"ticked": ["bring_something", "look_at_photos", "other"], "other": "x"}}
    assert prepare_mod.offers_for(data, answers) == ["place_photo", "take_with_you"]
    assert prepare_mod.offers_for(data, None) == [] and prepare_mod.offers_for(data, {"Q2": {"ticked": []}}) == []
    assert [data["offers"][x]["en"] for x in prepare_mod.offers_for(data, {"Q2": {"ticked": ["dont_prepare"]}})] == ["A short summary only"]


@pytest.mark.parametrize("change, match", [
    (lambda d: d["questions"].pop(), "Q1, Q2, Q3 and Q4"),
    (lambda d: d["questions"][1]["options"][0].update(offers=["teleport"]), "unknown offer"),
    (lambda d: d["questions"][1]["options"][0].pop("offers"), "offers"),
    (lambda d: d["questions"][2].update(type="dropdown"), "a type"),
    (lambda d: d["questions"][2]["labels"].pop("5"), "words for 1 and 5"),
    (lambda d: d["questions"][3]["options"].append({"code": "sit_rest", "en": "again"}), "its own code"),
])
def test_a_broken_file_is_refused(tmp_path, change, match):
    data = json.loads(prepare_mod.PATH.read_text(encoding="utf-8"))
    change(data)
    path = tmp_path / "prepare.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(prepare_mod.PrepareError, match=match):
        prepare_mod.load(path)


def test_the_survey_serves_it_with_part_a():
    res = TestClient(main_mod.app).get("/api/profile/survey")
    assert res.status_code == 200
    body = res.json()
    assert body["prepare"] == prepare_mod.load()
    assert [q["code"] for q in body["questions"]] == ["A11", "A12", "A13", "A16"]  # A15 is not a profile question
