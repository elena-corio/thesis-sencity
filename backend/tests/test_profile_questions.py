"""The profile questions' layout (config/profile_questions.json, app/profile_questions.py): the file as it is, what it
may change (order inside a part, shown, labels on screen) and what it may not (stored keys, the questions the profile
text needs). The labels never reach the profile text (frontend lib/profile.js builds it from the export)."""
import copy
import json

import pytest

from app import prepare as prepare_mod
from app import profile as profile_mod
from app import profile_questions as layout_mod


@pytest.fixture
def parts():
    return profile_mod.survey(profile_mod.load()), prepare_mod.load()


@pytest.fixture
def default():
    return json.loads(layout_mod.CONFIG.read_text(encoding="utf-8"))


def test_the_file_shows_every_question_in_the_usual_order(parts):
    layout = layout_mod.load(*parts)
    assert [e["key"] for e in layout["profile"]] == list(layout_mod.PROFILE_KEYS)
    assert [e["key"] for e in layout["prepare"]] == list(layout_mod.PREPARE_KEYS)
    assert all(e["shown"] for e in layout["profile"] + layout["prepare"])


def test_order_shown_and_labels_can_change(parts, default):
    lay = copy.deepcopy(default)
    lay["profile"] = [{"key": "intro", "shown": False}, {"key": "A11", "title": {"en": "Overall, how are public spaces for you?"}},
                      {"key": "A13"}, {"key": "A12", "rows": {"traffic_trams": {"en": "Cars and trams"}}},
                      {"key": "weather", "rows": {"wind": {"en": "Wind"}}}, {"key": "A16", "shown": False}]
    lay["prepare"] = [{"key": "Q2", "rows": {"dont_prepare": {"en": "I don't"}}}, {"key": "Q1"}, {"key": "Q3", "shown": False}, {"key": "Q4"}]
    out = layout_mod.check(lay, *parts)
    assert [e["key"] for e in out["profile"]] == ["intro", "A11", "A13", "A12", "weather", "A16"]
    assert out["profile"][0]["shown"] is False and out["profile"][1]["title"] == {"en": "Overall, how are public spaces for you?"}
    assert out["profile"][3]["rows"] == {"traffic_trams": {"en": "Cars and trams"}}


@pytest.mark.parametrize("change, message", [
    (lambda l: l["profile"][2].update(shown=False), "A12 must stay shown"),
    (lambda l: l["profile"].pop(), "exactly once"),
    (lambda l: l["profile"].append({"key": "A11"}), "exactly once"),
    (lambda l: l["profile"].append(l["prepare"].pop()), "exactly once"),  # a question moved to the other part
    (lambda l: l["profile"][0].update(key="A15"), "exactly once"),       # a new stored key
    (lambda l: l["profile"][1].update(title="Just text"), "give the words"),
    (lambda l: l["profile"][1].update(title={"fr": "Bonjour"}), "give the words"),
    (lambda l: l["profile"][2].update(rows={"not_an_element": {"en": "x"}}), "not a row or option"),
    (lambda l: l["profile"][1].update(code="B1"), "unknown field"),
])
def test_what_the_layout_may_not_change(parts, default, change, message):
    lay = copy.deepcopy(default)
    change(lay)
    with pytest.raises(layout_mod.LayoutError, match=message):
        layout_mod.check(lay, *parts)


def test_the_survey_serves_the_layout(database_and_user):
    from fastapi.testclient import TestClient
    from app import main as main_mod
    got = TestClient(main_mod.app).get("/api/profile/survey").json()
    assert [e["key"] for e in got["layout"]["profile"]] == list(layout_mod.PROFILE_KEYS)
