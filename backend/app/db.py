"""Our database (Elena, 2026-11-22): accounts, profiles and own photo ratings, keyed by our own random account id.

Postgres on Render (Frankfurt), SQLite locally and in tests (DATABASE_URL; default: .local/sencity.db, not committed).
Clerk holds the email and login; here the Clerk user id only links a sign-in to our account. Nothing from the survey
or the study is stored here; chats are never stored.

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

SCHEMA_VERSION = 1
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
        if c.execute(select(schema_version.c.version)).first() is None:
            c.execute(insert(schema_version).values(version=SCHEMA_VERSION))
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
