"""The in-app test (D197 in the thesis log; docs/decisions.md 2026-11-28): an optional extra after sign-in and the
profile, exploratory and separate from the survey study (it decides nothing about H1/H2).

`config/app_test.json` holds the fixed photos (the same for everyone, in that order), the information sheet link and
whether Elena has approved the list. Until she has, the API refuses the test unless APP_TEST_ALLOW_UNAPPROVED=1 is set
(local testing only; never on Render).

Nothing here is logged. Answers are saved only after the test's own opt-in (app/main.py, app/db.py).
"""
import hashlib
import json
import os
import re
import subprocess
from functools import lru_cache

from tool.config import REPO_ROOT

CONFIG = REPO_ROOT / "config" / "app_test.json"
REASONS = ("yes", "partly", "no")
_SV = re.compile(r"^sv:[A-Za-z0-9_.\-]{10,120}$")
_MLY = re.compile(r"^[0-9]{1,20}$")


class AppTestError(Exception):
    """config/app_test.json cannot be used, or the test is not open."""


def load(path=CONFIG) -> dict:
    """The checked config: approved (bool), info_sheet_url, free_text_max, photos (6–8, each with a unique id)."""
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise AppTestError(f"{path.name} cannot be read.") from e
    photos = cfg.get("photos")
    if not isinstance(photos, list) or not 6 <= len(photos) <= 8:
        raise AppTestError("The app test needs 6 to 8 photos.")
    seen = set()
    for p in photos:
        ok = isinstance(p, dict) and p.get("source") in ("streetview", "mapillary") and isinstance(p.get("heading"), (int, float))
        if ok and p["source"] == "streetview":
            ok = bool(_SV.match(str(p.get("id")))) and p["id"] == f"sv:{p.get('pano_id')}"
        elif ok:
            ok = bool(_MLY.match(str(p.get("id"))))
        if ok and "pitch" in p:
            ok = isinstance(p["pitch"], (int, float)) and -90 <= p["pitch"] <= 90
        if not ok or not 0 <= p["heading"] < 360 or p["id"] in seen:
            raise AppTestError(f"A photo in {path.name} is not usable: {p.get('id') if isinstance(p, dict) else p}")
        seen.add(p["id"])
    if not isinstance(cfg.get("approved"), bool) or not str(cfg.get("info_sheet_url", "")).startswith("https://"):
        raise AppTestError(f"{path.name} needs approved (true/false) and an https info_sheet_url.")
    return {**cfg, "free_text_max": int(cfg.get("free_text_max", 500))}


def photo_set(cfg: dict) -> str:
    """A short hash of the photo list (ids and headings, in order): saved with every session."""
    key = "|".join(f"{p['id']}@{round(float(p['heading']), 1)}" for p in cfg["photos"])
    return hashlib.sha256(key.encode()).hexdigest()[:12]


def is_open(cfg: dict) -> bool:
    """The list is approved, or this is a local test run that allows the proposal (APP_TEST_ALLOW_UNAPPROVED=1)."""
    return cfg["approved"] or os.environ.get("APP_TEST_ALLOW_UNAPPROVED", "").strip() == "1"


def order_of(cfg: dict, photo_id: str) -> int | None:
    """The 1-based place of a photo in the fixed order, or None if it is not one of the test's photos."""
    for i, p in enumerate(cfg["photos"], start=1):
        if p["id"] == photo_id:
            return i
    return None


def public(cfg: dict) -> list[dict]:
    """The photos as the browser gets them, in the fixed order (kind, Elena's note, is left out)."""
    keep = ("id", "source", "pano_id", "heading", "pitch", "lat", "lon", "date", "name", "copyright", "contributor",
            "thumb_url", "creator", "link", "pano", "pano_heading")
    return [{"order": i, **{k: p[k] for k in keep if k in p}} for i, p in enumerate(cfg["photos"], start=1)]


def known_photos(cfg: dict) -> set[tuple[str, float]]:
    """The test's Street View photos, so /api/photo and the model may fetch them (as for a loaded area)."""
    return {(p["pano_id"], round(float(p["heading"]), 1)) for p in cfg["photos"] if p["source"] == "streetview"}


def pitches(cfg: dict) -> dict[tuple[str, float], float]:
    """The pitch of each Street View photo that has its own (the specs' 7.5°), so the app shows and rates that crop."""
    return {(p["pano_id"], round(float(p["heading"]), 1)): float(p["pitch"])
            for p in cfg["photos"] if p["source"] == "streetview" and isinstance(p.get("pitch"), (int, float))}


@lru_cache(maxsize=1)
def app_version() -> str:
    """APP_VERSION, else Render's commit, else this checkout's commit, else "dev"."""
    for name in ("APP_VERSION", "RENDER_GIT_COMMIT"):
        v = os.environ.get(name, "").strip()
        if v:
            return v[:40]
    try:
        out = subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True, timeout=5)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return "dev"


def profile_snapshot(profile: dict | None) -> dict | None:
    """The profile answers as they are now (no thermal handles, no text: the answers it is built from, and its version)."""
    if not isinstance(profile, dict) or not isinstance(profile.get("answers"), dict):
        return None
    return {k: profile.get(k) for k in ("language", "answers", "version", "weather", "prepare")}
