"""Load config/tool.yaml and the keys from .env (repo root)."""
import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPO_ROOT / "config" / "tool.yaml"


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def get_key(name: str) -> str:
    """Read a secret from the environment or .env. Never print or log the value."""
    load_dotenv(REPO_ROOT / ".env")
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing {name}. Add it to .env at the repo root (see .env.example).")
    return value


PHOTO_SOURCES = ("streetview", "mapillary")


def photo_source(cfg: dict) -> str:
    """Where the app's street photos come from (Elena, 2026-11-16): PHOTO_SOURCE in the environment or .env, else
    photo_source in config/tool.yaml. 'streetview' (the local prototype, the study's source) or 'mapillary' (any public
    version). On Render (it sets RENDER) Street View is refused until Google's terms are checked."""
    load_dotenv(REPO_ROOT / ".env")
    source = (os.environ.get("PHOTO_SOURCE") or cfg.get("photo_source") or "streetview").strip().lower()
    if source not in PHOTO_SOURCES:
        raise SystemExit(f"PHOTO_SOURCE must be one of {', '.join(PHOTO_SOURCES)}, not '{source}'.")
    if source == "streetview" and os.environ.get("RENDER"):
        raise SystemExit("PHOTO_SOURCE=streetview is for the local prototype only: set PHOTO_SOURCE=mapillary on Render.")
    return source
