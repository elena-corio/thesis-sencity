"""Cost and abuse guard (Elena, 2026-11-22): per-user limits on the routes that call the model, and a global daily cap
on model calls as a second safety net. Counts live in the database (app/db.py `usage`), per UTC hour and day.

Every limit is an environment variable (defaults in brackets):
    LIMIT_CHAT_PER_HOUR (30), LIMIT_CHAT_PER_DAY (100)       chat messages per user
    LIMIT_RUNS_PER_HOUR (10), LIMIT_RUNS_PER_DAY (30)        rating runs with new photos per user (each <= cap_photos)
    LIMIT_MODEL_CALLS_PER_DAY (2000)                         model calls for everyone together
Logs say which limit was reached and the count; never who asked what.
"""
import logging
import os
from datetime import datetime, timezone

from fastapi import HTTPException

from . import db

log = logging.getLogger("sencity.limits")
DEFAULTS = {"LIMIT_CHAT_PER_HOUR": 30, "LIMIT_CHAT_PER_DAY": 100, "LIMIT_RUNS_PER_HOUR": 10, "LIMIT_RUNS_PER_DAY": 30,
            "LIMIT_MODEL_CALLS_PER_DAY": 2000}
GLOBAL = "*:model_calls"


def setting(name: str) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return int(raw) if raw else DEFAULTS[name]
    except ValueError:
        return DEFAULTS[name]


def _windows(at: datetime | None = None) -> tuple[str, str]:
    t = at or datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%dT%H"), t.strftime("%Y-%m-%d")


def _check(scope: str, per_hour: str, per_day: str, what: str) -> None:
    hour, day = _windows()
    if db.count(f"{scope}:hour", hour) >= setting(per_hour):
        log.info("limits: %s per hour reached (%d)", what, setting(per_hour))
        raise HTTPException(429, f"You have reached the limit of {setting(per_hour)} {what} an hour. Please try again later.")
    if db.count(f"{scope}:day", day) >= setting(per_day):
        log.info("limits: %s per day reached (%d)", what, setting(per_day))
        raise HTTPException(429, f"You have reached today's limit of {setting(per_day)} {what}. Please try again tomorrow.")


def _count(scope: str) -> None:
    hour, day = _windows()
    db.add(f"{scope}:hour", hour)
    db.add(f"{scope}:day", day)


def model_calls_left() -> int:
    return max(0, setting("LIMIT_MODEL_CALLS_PER_DAY") - db.count(GLOBAL, _windows()[1]))


def check_global() -> None:
    """The global daily cap: refuse when it is used up."""
    if model_calls_left() < 1:
        log.warning("limits: global daily cap of %d model calls reached", setting("LIMIT_MODEL_CALLS_PER_DAY"))
        raise HTTPException(429, "SenCity has reached its daily limit for predictions. Please try again tomorrow.")


def model_called(n: int = 1) -> None:
    """Count n model calls against the global daily cap."""
    if n:
        db.add(GLOBAL, _windows()[1], n)


def chat(account_id: str) -> None:
    """Before a chat message: per-user limits and the global cap; counts the message."""
    _check(f"{account_id}:chat", "LIMIT_CHAT_PER_HOUR", "LIMIT_CHAT_PER_DAY", "questions")
    check_global()
    _count(f"{account_id}:chat")


def rating_run(account_id: str) -> None:
    """Before a rating run with new photos: per-user limits and the global cap; counts the run."""
    _check(f"{account_id}:runs", "LIMIT_RUNS_PER_HOUR", "LIMIT_RUNS_PER_DAY", "rating runs")
    check_global()
    _count(f"{account_id}:runs")
