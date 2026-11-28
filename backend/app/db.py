"""Our database (Elena, 2026-11-22): accounts, profiles and own photo ratings, keyed by our own random account id.

Postgres on Render (Frankfurt), SQLite locally and in tests (DATABASE_URL; default: .local/sencity.db, not committed).
Clerk holds the email and login; here the Clerk user id only links a sign-in to our account. Nothing from the survey
or the study is stored here; chats are never stored. The app test (D197, 2026-11-28) keeps its answers here only after
its own opt-in, under the Clerk user id.

    python -m app.db migrate     # create or update the tables (safe to run again; Render runs it before each start)
"""
import os
import sys
import uuid
from datetime import datetime, timezone

from sqlalchemy import (JSON, Column, DateTime, ForeignKey, Integer, MetaData, String, Table, create_engine, delete,
                        insert, select, update)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tool.config import REPO_ROOT

SCHEMA_VERSION = 2  # 2: the app test's two tables (2026-11-28)
metadata = MetaData()

accounts = Table(
    "accounts", metadata,
    Column("id", String(36), primary_key=True),                      # our random id, never the email
    Column("clerk_user_id", String(64), unique=True, nullable=False),
    Column("consented_at", DateTime(timezone=True)),                 # the privacy notice agreed ("Agree and continue")
    Column("created_at", DateTime(timezone=True), nullable=False),
)
profiles = Table(
    "profiles", metadata,
    Column("account_id", String(36), ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
    Column("data", JSON, nullable=False),      # { language, answers, text, version, saved, weather, thermal, prepare }
    Column("version", String(32)),
    Column("saved_at", DateTime(timezone=True), nullable=False),
)
own_ratings = Table(
    "own_ratings", metadata,
    Column("account_id", String(36), ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
    Column("data", JSON, nullable=False),      # the list as lib/myRatings.js keeps it (photo IDs, never images)
    Column("saved_at", DateTime(timezone=True), nullable=False),
)
usage = Table(
    "usage", metadata,                         # counts only: "<account id>:chat:hour", "*:model_calls:day"…
    Column("scope", String(96), primary_key=True),
    Column("window", String(16), primary_key=True),                  # "2026-11-22T14" or "2026-11-22" (UTC)
    Column("count", Integer, nullable=False),
)
# The in-app test (D197, Elena 2026-11-28): only with its own opt-in. Exploratory, kept apart from the survey study.
# The Clerk user id is the person's pseudonym here (no name or email in these tables); the rows go with the account.
app_test_sessions = Table(
    "app_test_sessions", metadata,
    Column("id", String(36), primary_key=True),
    Column("clerk_user_id", String(64), unique=True, nullable=False),  # one test per person
    Column("consented_at", DateTime(timezone=True), nullable=False),   # the app test's own tick, not the privacy notice
    Column("started_at", DateTime(timezone=True), nullable=False),
    Column("finished_at", DateTime(timezone=True)),
    Column("photo_set", String(16), nullable=False),                   # hash of config/app_test.json's photo list
    Column("app_version", String(40), nullable=False),
    Column("profile", JSON, nullable=False),                           # the profile answers as they were at the start
    Column("profile_version", String(32)),
)
app_test_answers = Table(
    "app_test_answers", metadata,
    Column("session_id", String(36), ForeignKey("app_test_sessions.id", ondelete="CASCADE"), primary_key=True),
    Column("photo_id", String(140), primary_key=True),
    Column("order_shown", Integer, nullable=False),                    # 1-based, fixed by the config
    Column("estimate", JSON),                                          # the app's estimate as shown; null: none could be made
    Column("rating", Integer),                                         # B1 1–5; NULL when not given, never 0
    Column("reasons_right", String(8)),                                # "yes" | "partly" | "no" | NULL
    Column("free_text", String(2000)),
    Column("shown_at", DateTime(timezone=True), nullable=False),
    Column("answered_at", DateTime(timezone=True)),
    Column("saved_at", DateTime(timezone=True), nullable=False),
    Column("app_version", String(40), nullable=False),
    Column("model", String(200)),
    Column("export_commit", String(40)),
    Column("prompt_version", String(20)),
    Column("profile_version", String(32)),
)
schema_version = Table("schema_version", metadata, Column("version", Integer, primary_key=True))

_engine: Engine | None = None


def url() -> str:
    """DATABASE_URL (Render gives postgres://…; SQLAlchemy wants postgresql+psycopg://…), else a local SQLite file."""
    raw = os.environ.get("DATABASE_URL", "").strip()
    if not raw:
        path = REPO_ROOT / ".local" / "sencity.db"
        path.parent.mkdir(exist_ok=True)
        return f"sqlite:///{path.as_posix()}"
    for prefix in ("postgres://", "postgresql://"):
        if raw.startswith(prefix):
            return "postgresql+psycopg://" + raw[len(prefix):]
    return raw


def engine() -> Engine:
    global _engine
    if _engine is None:
        # hide_parameters: an error never carries row values (a profile, an id) into the logs.
        _engine = create_engine(url(), pool_pre_ping=True, future=True, hide_parameters=True)
    return _engine


def use(e: Engine) -> None:
    """Tests: use this engine (an in-memory or temporary SQLite)."""
    global _engine
    _engine = e


def migrate(e: Engine | None = None) -> int:
    """Create the tables that are missing and record the schema version. Returns the version."""
    e = e or engine()
    metadata.create_all(e)
    with e.begin() as c:
        found = c.execute(select(schema_version.c.version)).first()
        if found is None:
            c.execute(insert(schema_version).values(version=SCHEMA_VERSION))
        elif found[0] < SCHEMA_VERSION:  # only new tables so far: create_all has added them
            c.execute(update(schema_version).values(version=SCHEMA_VERSION))
    return SCHEMA_VERSION


now = lambda: datetime.now(timezone.utc)  # noqa: E731


# Accounts
def account_for(clerk_user_id: str) -> dict | None:
    with engine().begin() as c:
        row = c.execute(select(accounts).where(accounts.c.clerk_user_id == clerk_user_id)).mappings().first()
    return dict(row) if row else None


def ensure_account(clerk_user_id: str) -> dict:
    """The account of a signed-in Clerk user, created on first sign-in (no consent yet)."""
    found = account_for(clerk_user_id)
    if found:
        return found
    row = {"id": str(uuid.uuid4()), "clerk_user_id": clerk_user_id, "consented_at": None, "created_at": now()}
    try:
        with engine().begin() as c:
            c.execute(insert(accounts).values(**row))
    except IntegrityError:
        # The first requests after sign-in arrive together: another one created it a moment ago.
        found = account_for(clerk_user_id)
        if found:
            return found
        raise
    return row


def set_consent(account_id: str, at: datetime) -> None:
    with engine().begin() as c:
        c.execute(update(accounts).where(accounts.c.id == account_id).values(consented_at=at))


def delete_account(account_id: str) -> None:
    """Every row of the account: ratings, profile, usage counts, then the account."""
    with engine().begin() as c:
        c.execute(delete(own_ratings).where(own_ratings.c.account_id == account_id))
        c.execute(delete(profiles).where(profiles.c.account_id == account_id))
        c.execute(delete(usage).where(usage.c.scope.like(f"{account_id}:%")))
        c.execute(delete(accounts).where(accounts.c.id == account_id))


# Profile and own ratings: one JSON document each per account.
def _get(table: Table, account_id: str):
    with engine().begin() as c:
        row = c.execute(select(table.c.data).where(table.c.account_id == account_id)).first()
    return row[0] if row else None


def _put(table: Table, account_id: str, data, **extra) -> None:
    values = {"data": data, "saved_at": now(), **extra}
    with engine().begin() as c:
        done = c.execute(update(table).where(table.c.account_id == account_id).values(**values)).rowcount
        if not done:
            c.execute(insert(table).values(account_id=account_id, **values))


def get_profile(account_id: str):
    return _get(profiles, account_id)


def put_profile(account_id: str, data: dict) -> None:
    _put(profiles, account_id, data, version=data.get("version"))


def delete_profile(account_id: str) -> None:
    with engine().begin() as c:
        c.execute(delete(profiles).where(profiles.c.account_id == account_id))
        c.execute(delete(own_ratings).where(own_ratings.c.account_id == account_id))


def get_ratings(account_id: str) -> list:
    return _get(own_ratings, account_id) or []


def put_ratings(account_id: str, data: list) -> None:
    _put(own_ratings, account_id, data)


# The app test (app/app_test.py)
def app_test_session(clerk_user_id: str) -> dict | None:
    with engine().begin() as c:
        row = c.execute(select(app_test_sessions).where(app_test_sessions.c.clerk_user_id == clerk_user_id)).mappings().first()
    return dict(row) if row else None


def start_app_test(clerk_user_id: str, **values) -> dict:
    """The person's session, created at the opt-in (one per person); an existing one is returned as it is."""
    found = app_test_session(clerk_user_id)
    if found:
        return found
    row = {"id": str(uuid.uuid4()), "clerk_user_id": clerk_user_id, "started_at": now(), "finished_at": None, **values}
    try:
        with engine().begin() as c:
            c.execute(insert(app_test_sessions).values(**row))
    except IntegrityError:
        found = app_test_session(clerk_user_id)
        if found:
            return found
        raise
    return row


def app_test_answered(session_id: str) -> list[dict]:
    with engine().begin() as c:
        rows = c.execute(select(app_test_answers).where(app_test_answers.c.session_id == session_id)
                         .order_by(app_test_answers.c.order_shown)).mappings().all()
    return [dict(r) for r in rows]


def save_app_test_answer(row: dict) -> None:
    """One photo's answer; sent again (a retry after a network error) it replaces the first."""
    values = {**row, "saved_at": now()}
    key = (app_test_answers.c.session_id == row["session_id"]) & (app_test_answers.c.photo_id == row["photo_id"])
    with engine().begin() as c:
        if not c.execute(update(app_test_answers).where(key).values(**values)).rowcount:
            c.execute(insert(app_test_answers).values(**values))


def finish_app_test(session_id: str) -> None:
    with engine().begin() as c:
        c.execute(update(app_test_sessions).where(app_test_sessions.c.id == session_id, app_test_sessions.c.finished_at.is_(None))
                  .values(finished_at=now()))


def delete_app_test(clerk_user_id: str) -> None:
    """The person's app-test rows (with "Delete my account and data")."""
    found = app_test_session(clerk_user_id)
    if not found:
        return
    with engine().begin() as c:
        c.execute(delete(app_test_answers).where(app_test_answers.c.session_id == found["id"]))
        c.execute(delete(app_test_sessions).where(app_test_sessions.c.id == found["id"]))


def app_test_export() -> list[dict]:
    """Every saved answer with its session, one row per person and photo (for app/app_test_export.py)."""
    s, a = app_test_sessions, app_test_answers
    with engine().begin() as c:
        rows = c.execute(select(s.c.clerk_user_id, s.c.id.label("session_id"), s.c.consented_at, s.c.started_at,
                                s.c.finished_at, s.c.photo_set, s.c.profile, s.c.profile_version.label("session_profile_version"),
                                a.c.photo_id, a.c.order_shown, a.c.estimate, a.c.rating, a.c.reasons_right, a.c.free_text,
                                a.c.shown_at, a.c.answered_at, a.c.app_version, a.c.model, a.c.export_commit,
                                a.c.prompt_version, a.c.profile_version)
                         .select_from(a.join(s, a.c.session_id == s.c.id))
                         .order_by(s.c.started_at, a.c.order_shown)).mappings().all()
    return [dict(r) for r in rows]


# Usage counters (app/limits.py)
def count(scope: str, window: str) -> int:
    with engine().begin() as c:
        row = c.execute(select(usage.c.count).where(usage.c.scope == scope, usage.c.window == window)).first()
    return row[0] if row else 0


def add(scope: str, window: str, n: int = 1) -> int:
    """Add n to a counter and return the new count."""
    with engine().begin() as c:
        done = c.execute(update(usage).where(usage.c.scope == scope, usage.c.window == window)
                         .values(count=usage.c.count + n)).rowcount
        if not done:
            c.execute(insert(usage).values(scope=scope, window=window, count=n))
        return c.execute(select(usage.c.count).where(usage.c.scope == scope, usage.c.window == window)).scalar_one()


if __name__ == "__main__":
    if sys.argv[1:] != ["migrate"]:
        print(__doc__)
        raise SystemExit(2)
    print(f"schema version {migrate()}")
