"""Intent accuracy of the chat parser on a fixed set of requests (paid: one model call per request).

    python -m app.chat_eval dev     # the development set: the only one used to tune config/chat_prompt.txt
    python -m app.chat_eval test    # the frozen test set (30 requests): the accuracy reported

Prints each case that is wrong (its id, the fields that differ, what was expected and what came back), the accuracy and
what the calls cost. Writes nothing. The messages are the fixtures' own, never anyone's chat.
"""
import json
import sys
import time

from tool.config import REPO_ROOT, load_config

from . import chat

SETS = {"dev": "chat_intents_dev.json", "test": "chat_intents_test.json"}
FIXTURES = REPO_ROOT / "backend" / "tests" / "fixtures"


def cases(name: str) -> list[dict]:
    return json.loads((FIXTURES / SETS[name]).read_text(encoding="utf-8"))["cases"]


def evaluate(name: str, parse=chat.parse, cfg=None) -> dict:
    """{n, correct, accuracy, cost_usd, wrong: [{id, fields, expected, got}]}."""
    cfg = cfg or load_config()["api"]["senses"]
    wrong, cost, items = [], 0.0, cases(name)
    for c in items:
        try:
            intent, spent = parse(c["message"], cfg)
            cost += spent or 0.0
            bad = chat.matches(c["expected"], intent)
        except chat.ChatError as e:
            intent, bad = {"error": e.message}, ["action"]
        if bad:
            wrong.append({"id": c["id"], "fields": bad, "expected": {k: c["expected"][k] for k in bad},
                          "got": {k: intent.get(k) for k in bad} if "error" not in intent else intent})
        time.sleep(0.2)
    n = len(items)
    return {"n": n, "correct": n - len(wrong), "accuracy": (n - len(wrong)) / n, "cost_usd": round(cost, 5), "wrong": wrong}


def main(argv=None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if len(argv) != 1 or argv[0] not in SETS:
        print(__doc__)
        return 2
    r = evaluate(argv[0])
    for w in r["wrong"]:
        print(f"{w['id']}: wrong {', '.join(w['fields'])}: expected {w['expected']}, got {w['got']}")
    print(f"{argv[0]}: {r['correct']}/{r['n']} correct = {r['accuracy']:.1%}; cost ${r['cost_usd']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
