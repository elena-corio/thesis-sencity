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
