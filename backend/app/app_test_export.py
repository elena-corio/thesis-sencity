"""Export the in-app test (D197) to data/raw/app_test/ (gitignored): one row per person and photo.

    python -m app.app_test_export                  # the database in DATABASE_URL (or the local SQLite file)
    python -m app.app_test_export --out some/dir   # elsewhere

Only rows saved after the test's own opt-in exist. A missing rating or reasons answer is an empty cell, never 0.
The file holds the Clerk user id (a pseudonym) and free text: keep it out of the repo and off shared drives.
Exploratory data, never pooled with the survey study.
"""
import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from tool.config import REPO_ROOT

from . import app_test, db

COLUMNS = [
    "clerk_user_id", "session_id", "photo_set", "consented_at", "started_at", "finished_at",
    "order_shown", "photo_id", "photo_name", "shown_at", "answered_at",
    "estimate_comfort", "estimate_level", "estimate_bothers", "estimate_feels_good", "estimate_personal",
    "rating_b1", "reasons_right", "free_text",
    "app_version", "model", "export_commit", "prompt_version", "profile_version", "profile_answers",
]


def _iso(v) -> str:
    return v.isoformat() if isinstance(v, datetime) else ("" if v is None else str(v))


def _cell(v) -> str:
    return "" if v is None else str(v)


def rows(records: list[dict], names: dict[str, str]) -> list[dict]:
    """The export's rows from db.app_test_export(): one per saved answer, in session then fixed order."""
    out = []
    for r in records:
        est = r["estimate"] or {}
        out.append({
            "clerk_user_id": r["clerk_user_id"], "session_id": r["session_id"], "photo_set": r["photo_set"],
            "consented_at": _iso(r["consented_at"]), "started_at": _iso(r["started_at"]), "finished_at": _iso(r["finished_at"]),
            "order_shown": r["order_shown"], "photo_id": r["photo_id"], "photo_name": names.get(r["photo_id"], ""),
            "shown_at": _iso(r["shown_at"]), "answered_at": _iso(r["answered_at"]),
            "estimate_comfort": _cell(est.get("comfort")), "estimate_level": _cell(est.get("level")),
            "estimate_bothers": " ".join(est.get("bothers") or []), "estimate_feels_good": " ".join(est.get("feels_good") or []),
            "estimate_personal": _cell(est.get("personal")),
            "rating_b1": _cell(r["rating"]), "reasons_right": _cell(r["reasons_right"]), "free_text": _cell(r["free_text"]),
            "app_version": _cell(r["app_version"]), "model": _cell(r["model"]), "export_commit": _cell(r["export_commit"]),
            "prompt_version": _cell(r["prompt_version"]),
            "profile_version": _cell(r["profile_version"] or r["session_profile_version"]),
            "profile_answers": json.dumps(r["profile"], ensure_ascii=False, sort_keys=True),
        })
    return out


def export(out_dir: Path) -> Path:
    try:
        names = {p["id"]: p.get("name", "") for p in app_test.load()["photos"]}
    except app_test.AppTestError:
        names = {}
    data = rows(db.app_test_export(), names)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"app_test_{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.csv"
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(data)
    people = len({r["clerk_user_id"] for r in data})
    print(f"{len(data)} rows ({people} people) → {path}")
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "data" / "raw" / "app_test")
    export(ap.parse_args().out)
