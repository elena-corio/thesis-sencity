"""The chat assistant's parser (Elena, 2026-11-21): one message → one intent, one model call, nothing else.

The browser sends the message text only (never the profile or ratings). The server sends it to the model of the export
(model/app_v9/model.json: the same pinned EU endpoint with zero data retention as the ratings, no fallbacks) at
temperature 0, with the fixed parser prompt (config/chat_prompt.txt) and the fixed list of element codes, and a strict
JSON schema. The intent is checked here and returned; the browser carries it out on its own data and writes the reply
from templates, so the model never writes facts. The message is never stored or logged. No agent, no retry, no tools.
"""
import json
from pathlib import Path

from tool.config import REPO_ROOT

from . import senses as senses_mod

PROMPT_PATH = REPO_ROOT / "config" / "chat_prompt.txt"
PART_A = senses_mod.EXPORT_DIR / "part_a.json"

ACTIONS = ("filter_places", "explain_place", "plan_route", "set_view", "summarise_profile", "prepare_cope", "compare_seasons",
           "out_of_scope")
# Added after the first test set was frozen; each has its own frozen set (chat_eval SETS).
LATER_ACTIONS = ("compare_seasons",)
LEVELS = ("easy", "mixed", "hard")
LAYERS = ("senses", "thermal", "overall")
SEASONS = ("spring", "summer", "autumn", "winter")
TOPICS = ("bothers", "feels_good", "overall")
LANGUAGES = ("en", "it")
HOURS = (9, 21)          # the time slider's whole hours (frontend config thermalHours)
RADIUS = (50, 500)       # the area's radius limits (m)
MAX_TOKENS = 300


class ChatError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def elements(path: Path = PART_A) -> list[dict]:
    """The 20 elements of Part A (A12 and A13 rows): [{code, en}], in the survey's order. Nothing personal."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return [{"code": r["code"], "en": r["en"]} for q in data["questions"] if q["code"] in ("A12", "A13") for r in q["rows"]]


def _enum(values, nullable=True) -> dict:
    return {"type": ["string", "null"], "enum": [*values, None]} if nullable else {"type": "string", "enum": list(values)}


def schema(codes: list[str]) -> dict:
    """The intent: one action and every parameter, all required (strict mode), null or [] when not said."""
    props = {
        "action": _enum(ACTIONS, nullable=False),
        "language": _enum(LANGUAGES, nullable=False),
        "level": _enum(LEVELS),
        "with": {"type": "array", "items": {"type": "string", "enum": codes}},
        "without": {"type": "array", "items": {"type": "string", "enum": codes}},
        "near": {"type": ["string", "null"]},
        "radius_m": {"type": ["integer", "null"]},
        "start": {"type": ["string", "null"]},
        "end": {"type": ["string", "null"]},
        "calmer": {"type": "boolean"},
        "layer": _enum(LAYERS),
        "season": _enum(SEASONS),
        "time": {"type": ["string", "null"]},
        "topic": _enum(TOPICS),
    }
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


FIELDS = tuple(schema([])["properties"])


def prompt(elems: list[dict], path: Path = PROMPT_PATH) -> str:
    listing = "\n".join(f"  {e['code']}: {e['en']}" for e in elems)
    return path.read_text(encoding="utf-8").replace("{ELEMENTS}", listing)


def build_request(export, message: str, elems: list[dict]) -> dict:
    """The model call: the export's model and provider (pinned endpoint, zero retention, no fallbacks), temperature 0,
    the fixed prompt as the system message, the message alone as the user's, a strict schema. Text only."""
    m = export.model
    body = {
        "model": m["model"],
        "provider": m["provider"],
        "temperature": 0,
        "max_tokens": MAX_TOKENS,
        "messages": [{"role": "system", "content": prompt(elems)}, {"role": "user", "content": message}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "sencity_intent", "strict": True,
                                                                   "schema": schema([e["code"] for e in elems])}},
        "usage": {"include": True},
    }
    if m.get("reasoning") is not None:
        body["reasoning"] = m["reasoning"]
    return body


def _str(v, limit=80):
    return v.strip()[:limit] or None if isinstance(v, str) else None


def _time(v):
    """"HH:00" within the slider's hours, else None ("9:00" and "09" are read too)."""
    if not isinstance(v, str):
        return None
    head = v.strip().split(":")[0]
    if not head.isdigit():
        return None
    h = int(head)
    return f"{h:02d}:00" if HOURS[0] <= h <= HOURS[1] else None


def check(raw, codes: list[str]) -> dict:
    """The intent as the browser gets it: every field, known values only, unknown or out-of-range ones as null or [].
    An element asked both with and without is dropped from both. Raises ChatError without a known action."""
    if not isinstance(raw, dict) or raw.get("action") not in ACTIONS:
        raise ChatError(502, "The request could not be read. Try other words.")
    known = set(codes)
    pick = lambda v, allowed: v if v in allowed else None  # noqa: E731
    with_ = [c for c in dict.fromkeys(raw.get("with") or []) if c in known]
    without = [c for c in dict.fromkeys(raw.get("without") or []) if c in known]
    both = set(with_) & set(without)
    radius = raw.get("radius_m")
    return {
        "action": raw["action"],
        "language": pick(raw.get("language"), LANGUAGES) or "en",
        "level": pick(raw.get("level"), LEVELS),
        "with": [c for c in with_ if c not in both],
        "without": [c for c in without if c not in both],
        "near": _str(raw.get("near")),
        "radius_m": radius if isinstance(radius, int) and not isinstance(radius, bool) and RADIUS[0] <= radius <= RADIUS[1] else None,
        "start": _str(raw.get("start")),
        "end": _str(raw.get("end")),
        "calmer": raw.get("calmer") is True,
        "layer": pick(raw.get("layer"), LAYERS),
        "season": pick(raw.get("season"), SEASONS),
        "time": _time(raw.get("time")),
        "topic": pick(raw.get("topic"), TOPICS),
    }


def parse(message: str, cfg: dict, export=None, post=None) -> tuple[dict, float | None]:
    """One message → (intent, cost in USD or None). One call; an unreadable answer is an error, not a retry."""
    export = export or senses_mod.load_export()
    elems = elements()
    body = build_request(export, message, elems)
    data = (post or senses_mod.post_openrouter)(body, senses_mod._api_key(), cfg)
    text = senses_mod._reply_text(data)
    try:
        raw = json.loads(text) if isinstance(text, str) else None
    except ValueError:
        raw = None
    cost = (data.get("usage") or {}).get("cost") if isinstance(data, dict) else None
    return check(raw, [e["code"] for e in elems]), cost


# Comparison with an expected intent (the frozen test set and the dev set): only the fields listed in `expected`.
_ARTICLES = ("the ", "il ", "la ", "lo ", "l'")


def _norm(v):
    if isinstance(v, str):
        s = v.strip().lower()
        for a in _ARTICLES:
            if s.startswith(a):
                s = s[len(a):]
        return s
    if isinstance(v, list):
        return sorted(_norm(x) for x in v)
    return v


def matches(expected: dict, intent: dict) -> list[str]:
    """The fields of `expected` that `intent` gets wrong (empty: correct)."""
    return [k for k, v in expected.items() if _norm(v) != _norm(intent.get(k))]
