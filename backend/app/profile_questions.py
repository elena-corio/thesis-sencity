"""The profile questions' layout (Elena, 2026-11-28): config/profile_questions.json says which onboarding questions are
shown, in what order, and their labels on screen. Served with the survey; the browser applies it (lib/questions.js).

Only the screen changes. The stored keys and answers stay the same, and the profile text the model reads is built
from model/app_v9/ as before, never from these labels. A11, A12 and A13 cannot be hidden: the profile text needs them.
"""
import json

from tool.config import REPO_ROOT

CONFIG = REPO_ROOT / "config" / "profile_questions.json"
PROFILE_KEYS = ("intro", "A11", "A12", "A13", "A16", "weather")
PREPARE_KEYS = ("Q1", "Q2", "Q3", "Q4")
REQUIRED = ("A11", "A12", "A13")
WEATHER_ROWS = ("hot", "cold", "wind")  # frontend/src/lib/weather.js
LANGS = ("en", "it")


class LayoutError(Exception):
    """config/profile_questions.json cannot be used."""


def _texts(value, where: str) -> dict:
    if not isinstance(value, dict) or not value or any(k not in LANGS or not isinstance(v, str) or not v.strip()
                                                       for k, v in value.items()):
        raise LayoutError(f"{where}: give the words as {{\"en\": \"…\"}} (and \"it\" if needed).")
    return {k: v.strip() for k, v in value.items()}


def rows_of(part_a: dict, prepare: dict) -> dict[str, set]:
    """The row or option codes each question has: grid rows, weather rows, ticked options."""
    out = {q["code"]: {r["code"] for r in q.get("rows", [])} for q in part_a["questions"]}
    out["weather"] = set(WEATHER_ROWS)
    for q in prepare.get("questions", []):
        out[q["code"]] = {o["code"] for o in q.get("options", [])}
    return out


def check(layout: dict, part_a: dict, prepare: dict) -> dict:
    """The layout as served: {profile: [entry], prepare: [entry]}, each entry {key, shown, title?, help?, rows?}."""
    if not isinstance(layout, dict):
        raise LayoutError("profile_questions.json must be an object.")
    codes = rows_of(part_a, prepare)
    out = {}
    for part, keys in (("profile", PROFILE_KEYS), ("prepare", PREPARE_KEYS)):
        entries = layout.get(part)
        if not isinstance(entries, list):
            raise LayoutError(f"\"{part}\" must be a list.")
        got = [e.get("key") if isinstance(e, dict) else None for e in entries]
        if sorted(map(str, got)) != sorted(keys):
            raise LayoutError(f"\"{part}\" must list each of {', '.join(keys)} exactly once (stored keys never change).")
        clean = []
        for e in entries:
            unknown = set(e) - {"key", "shown", "title", "help", "rows"}
            if unknown:
                raise LayoutError(f"{e['key']}: unknown field {sorted(unknown)[0]}.")
            shown = e.get("shown", True)
            if not isinstance(shown, bool):
                raise LayoutError(f"{e['key']}: shown must be true or false.")
            if not shown and e["key"] in REQUIRED:
                raise LayoutError(f"{e['key']} must stay shown: the profile text needs it.")
            item = {"key": e["key"], "shown": shown}
            for field in ("title", "help"):
                if field in e:
                    item[field] = _texts(e[field], f"{e['key']}.{field}")
            if "rows" in e:
                if not isinstance(e["rows"], dict):
                    raise LayoutError(f"{e['key']}.rows must be an object.")
                bad = set(e["rows"]) - codes.get(e["key"], set())
                if bad:
                    raise LayoutError(f"{e['key']}.rows: {sorted(bad)[0]} is not a row or option of {e['key']}.")
                item["rows"] = {c: _texts(t, f"{e['key']}.rows.{c}") for c, t in e["rows"].items()}
            clean.append(item)
        out[part] = clean
    return out


def load(part_a: dict, prepare: dict, path=CONFIG) -> dict:
    try:
        layout = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise LayoutError(f"{path.name} cannot be read.") from e
    return check(layout, part_a, prepare)
