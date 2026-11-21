"""The chat parser (app/chat.py) and POST /api/chat, without the model: what is sent, what comes back, what is refused.
The intent accuracy on the frozen test set is test_chat_live.py (paid, run on request)."""
import hashlib
import json
import logging

import pytest
from fastapi.testclient import TestClient

from app import chat as chat_mod
from app import main as main_mod
from app import senses as senses_mod
from app.chat_eval import FIXTURES, cases

CODES = [e["code"] for e in chat_mod.elements()]
# The frozen test set: written before the prompt, never edited (line endings aside).
TEST_SET_SHA256 = "46bd33e12fdaacdbccd7e579809951503d24f6f55faecd64e56dc87560cad8a8"


def reply(intent: dict) -> dict:
    """An OpenRouter answer carrying `intent` as its JSON content."""
    return {"choices": [{"message": {"content": json.dumps(intent)}}], "usage": {"cost": 0.0001}}


def full(**over) -> dict:
    base = {"action": "filter_places", "language": "en", "level": None, "with": [], "without": [], "near": None,
            "radius_m": None, "start": None, "end": None, "calmer": False, "layer": None, "season": None, "time": None,
            "topic": None}
    return {**base, **over}


def test_the_test_set_is_frozen_and_covers_every_action():
    raw = (FIXTURES / "chat_intents_test.json").read_bytes().replace(b"\r\n", b"\n")
    assert hashlib.sha256(raw).hexdigest() == TEST_SET_SHA256
    test = cases("test")
    assert len(test) == 30
    assert {c["expected"]["action"] for c in test} == set(chat_mod.ACTIONS)
    assert sum(c["expected"]["language"] == "it" for c in test) >= 3
    for c in test:
        assert set(c["expected"]) <= set(chat_mod.FIELDS), c["id"]
        for k in ("with", "without"):
            assert set(c["expected"].get(k, [])) <= set(CODES), c["id"]


def test_the_dev_set_never_repeats_a_test_message_and_the_prompt_quotes_none():
    test = {c["message"].lower() for c in cases("test")}
    assert not test & {c["message"].lower() for c in cases("dev")}
    prompt = chat_mod.PROMPT_PATH.read_text(encoding="utf-8").lower()
    assert not [m for m in test if m.rstrip("?") in prompt]


def test_the_request_is_the_ratings_endpoint_at_temperature_0_with_the_message_only():
    export = senses_mod.load_export()
    body = chat_mod.build_request(export, "easy streets near X", chat_mod.elements())
    assert body["model"] == export.model["model"]
    assert body["provider"] == export.model["provider"]
    assert body["provider"]["zdr"] is True and body["provider"]["allow_fallbacks"] is False
    assert body["provider"]["data_collection"] == "deny" and body["provider"]["only"] == export.model["pinned_endpoint"]
    assert body["temperature"] == 0
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    assert body["messages"][1]["content"] == "easy streets near X"
    system = body["messages"][0]["content"]
    assert "{ELEMENTS}" not in system and all(c in system for c in CODES)
    s = body["response_format"]["json_schema"]
    assert s["strict"] is True and set(s["schema"]["required"]) == set(chat_mod.FIELDS)
    assert s["schema"]["properties"]["with"]["items"]["enum"] == CODES


def test_check_keeps_known_values_and_drops_the_rest():
    got = chat_mod.check(full(level="very", radius_m=900, time="7:00", layer="heat", season="summer",
                              near="  Karlsplatz ", **{"with": ["shade", "nope", "shade"], "without": ["crowds"]}), CODES)
    assert got["level"] is None and got["layer"] is None and got["radius_m"] is None and got["time"] is None
    assert got["with"] == ["shade"] and got["without"] == ["crowds"] and got["near"] == "Karlsplatz"
    assert got["season"] == "summer"
    assert chat_mod.check(full(time="9:00"), CODES)["time"] == "09:00"
    assert chat_mod.check(full(time="21:00"), CODES)["time"] == "21:00"
    assert chat_mod.check(full(radius_m=True), CODES)["radius_m"] is None
    both = chat_mod.check(full(**{"with": ["shade", "seats"], "without": ["shade"]}), CODES)
    assert both["with"] == ["seats"] and both["without"] == []  # asked both ways: neither


def test_check_refuses_an_unknown_action():
    for raw in (None, [], {"action": "chat"}, {}):
        with pytest.raises(chat_mod.ChatError):
            chat_mod.check(raw, CODES)


def test_matches_compares_only_the_listed_fields_lowercased_without_articles_and_lists_as_sets():
    intent = chat_mod.check(full(near="the Naschmarkt", **{"with": ["seats", "shade"]}), CODES)
    assert chat_mod.matches({"action": "filter_places", "near": "Naschmarkt", "with": ["shade", "seats"]}, intent) == []
    assert chat_mod.matches({"level": "easy", "near": "naschmarkt"}, intent) == ["level"]


@pytest.fixture
def client(monkeypatch):
    main_mod._hits.clear()
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    return TestClient(main_mod.app)


def test_the_api_returns_the_checked_intent(client, monkeypatch):
    sent = []
    monkeypatch.setattr(senses_mod, "post_openrouter", lambda body, key, cfg: sent.append(body) or reply(
        full(action="set_view", layer="thermal", season="summer", time="15:00")))
    res = client.post("/api/chat", json={"message": "show thermal in summer at 15:00"})
    assert res.status_code == 200
    assert res.json()["intent"] == chat_mod.check(full(action="set_view", layer="thermal", season="summer", time="15:00"), CODES)
    assert len(sent) == 1 and sent[0]["messages"][1]["content"] == "show thermal in summer at 15:00"


def test_the_api_refuses_a_profile_ratings_or_a_long_message(client, monkeypatch):
    monkeypatch.setattr(senses_mod, "post_openrouter", lambda *a: pytest.fail("no call for a refused request"))
    for body in ({"message": "x", "profile": {"A11": 2}}, {"message": "x", "ratings": []},
                 {"message": "x" * 301}, {"message": ""}, {}):
        assert client.post("/api/chat", json=body).status_code == 422, body
    assert client.post("/api/chat", json={"message": "   "}).status_code == 422


def test_an_unreadable_answer_is_an_error_not_a_retry(client, monkeypatch):
    calls = []
    monkeypatch.setattr(senses_mod, "post_openrouter", lambda *a: calls.append(1) or {"choices": [{"message": {"content": "hello"}}]})
    res = client.post("/api/chat", json={"message": "hi"})
    assert res.status_code == 502 and len(calls) == 1


def test_the_message_is_never_logged(client, monkeypatch, caplog):
    secret = "my secret question about Karlsplatz"
    monkeypatch.setattr(senses_mod, "post_openrouter", lambda *a: reply(full(action="out_of_scope")))
    with caplog.at_level(logging.DEBUG):
        client.post("/api/chat", json={"message": secret})
        monkeypatch.setattr(senses_mod, "post_openrouter", lambda *a: {"choices": [{"message": {"content": "x"}}]})
        client.post("/api/chat", json={"message": secret})
    assert secret not in caplog.text


def test_the_rate_limit(client, monkeypatch):
    monkeypatch.setattr(senses_mod, "post_openrouter", lambda *a: reply(full(action="out_of_scope")))
    limit = main_mod.cfg["chat"]["per_hour"]
    codes = [client.post("/api/chat", json={"message": "hi"}).status_code for _ in range(limit + 1)]
    assert codes[:limit] == [200] * limit and codes[-1] == 429
