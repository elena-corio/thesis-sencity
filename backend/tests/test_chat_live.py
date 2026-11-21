"""Intent accuracy on the frozen test set (30 requests): PAID, one model call each (about $0.02 in all), so it runs only
when asked:  CHAT_LIVE=1 python -m pytest tests/test_chat_live.py -s
It passes at 90% (27 of 30) or more and prints the exact accuracy and every wrong case."""
import os

import pytest
from dotenv import dotenv_values

from app import chat_eval
from app import senses as senses_mod
from tool.config import REPO_ROOT

REAL_POST = senses_mod.post_openrouter  # taken before the conftest fixture replaces it with one that refuses
THRESHOLD = 0.9

pytestmark = pytest.mark.skipif(os.environ.get("CHAT_LIVE") != "1", reason="paid: set CHAT_LIVE=1 to run")


def test_intent_accuracy_on_the_frozen_test_set(monkeypatch):
    key = dotenv_values(REPO_ROOT / ".env").get("OPENROUTER_API_KEY") or ""
    if not key.strip():
        pytest.skip("OPENROUTER_API_KEY is not in .env")
    monkeypatch.setenv("OPENROUTER_API_KEY", key.strip())
    monkeypatch.setattr(senses_mod, "post_openrouter", REAL_POST)
    r = chat_eval.evaluate("test")
    for w in r["wrong"]:
        print(f"{w['id']}: wrong {', '.join(w['fields'])}: expected {w['expected']}, got {w['got']}")
    print(f"intent accuracy: {r['correct']}/{r['n']} = {r['accuracy']:.1%} (cost ${r['cost_usd']})")
    assert r["accuracy"] >= THRESHOLD
