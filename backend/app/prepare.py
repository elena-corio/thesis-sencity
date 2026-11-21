"""How you prepare for new places: the optional onboarding step after the profile (config/prepare.json).

The questions (Q1 = the thesis's tool-only A15, Q2-Q4 Elena's), English only, and the mapping of each Q2 option to
what the app or a chatbot can offer. The answers stay in the browser with the profile; they never reach this server
in a rating request (main.ProfileAnswers refuses them) and are never put in a prompt. A chatbot can read the same file
and call `offers_for` on answers the browser gives it for that one turn.
"""
import json
from pathlib import Path

from tool.config import REPO_ROOT

PATH = REPO_ROOT / "config" / "prepare.json"
TYPES = ("scale_1_5", "single", "multi")


class PrepareError(Exception):
    """config/prepare.json is not in the expected form."""


def load(path: Path = PATH) -> dict:
    """Read and check the file. Raises PrepareError on the first problem."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise PrepareError(f"{path.name} cannot be read ({type(e).__name__}).") from None
    offers = data.get("offers")
    questions = data.get("questions")
    if not isinstance(offers, dict) or not isinstance(questions, list) or not isinstance(data.get("other_max"), int):
        raise PrepareError("prepare.json needs questions, offers and other_max.")
    if [q.get("code") for q in questions] != ["Q1", "Q2", "Q3", "Q4"]:
        raise PrepareError("prepare.json must ask Q1, Q2, Q3 and Q4, in that order.")
    for q in questions:
        if q.get("type") not in TYPES or not (q.get("title") or {}).get("en"):
            raise PrepareError(f"{q['code']}: a type ({', '.join(TYPES)}) and an English title are needed.")
        if q["type"] == "scale_1_5" and not all(((q.get("labels") or {}).get(k) or {}).get("en") for k in ("1", "5")):
            raise PrepareError(f"{q['code']}: a 1-5 scale needs English words for 1 and 5.")
        options = q.get("options", [])
        codes = [o.get("code") for o in options]
        if q["type"] != "scale_1_5" and (not codes or len(set(codes)) != len(codes) or not all(o.get("en") for o in options)):
            raise PrepareError(f"{q['code']}: every option needs its own code and English words.")
        for o in options:
            unknown = [x for x in o.get("offers", []) if x not in offers]
            if unknown:
                raise PrepareError(f"{q['code']}.{o['code']}: unknown offer {', '.join(unknown)}.")
    q2 = questions[1]
    if not all("offers" in o for o in q2["options"]):
        raise PrepareError("Q2: every option needs its offers (an empty list for Other).")
    return data


def offers_for(data: dict, answers: dict | None) -> list:
    """What the app can offer first, from the Q2 answer: the offer codes of the ticked options, in the file's order,
    each once. Empty without an answer."""
    ticked = set(((answers or {}).get("Q2") or {}).get("ticked") or [])
    out = []
    for o in data["questions"][1]["options"]:
        if o["code"] in ticked:
            out += [x for x in o["offers"] if x not in out]
    return out
