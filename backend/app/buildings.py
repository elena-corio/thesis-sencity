"""Buildings along a walked route (board Routes 5), cached per route like the route corridors.

Privacy: the line can start at someone's home. It travels in the POST body, is never logged, and is not
written to the cache: the key is a hash, and the file holds only the buildings (public data) and their source.
"""
import hashlib
import json
from datetime import date
from pathlib import Path as FilePath

from tool.buildings import along
from tool.config import REPO_ROOT


def cache_dir(cfg: dict) -> FilePath:
    return REPO_ROOT / cfg["buildings"]["cache_dir"]


def line_key(line: list[list[float]], cfg: dict) -> str:
    """The same line (to about a metre, either way round) and the same settings give the same key."""
    pts = [[round(lon, 5), round(lat, 5)] for lon, lat in line]
    pts = min(pts, pts[::-1])
    raw = json.dumps({"line": pts, "settings": cfg["buildings"], "analysis": cfg["thermal"]["analysis"]},
                     sort_keys=True, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def load_cached(key: str, cfg: dict) -> dict | None:
    path = cache_dir(cfg) / f"{key}.json"
    return json.loads(path.read_text(encoding="utf-8"))["buildings"] if path.exists() else None


def save_cached(key: str, result: dict, cfg: dict) -> None:
    d = cache_dir(cfg)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{key}.json.tmp"
    tmp.write_text(json.dumps({"created": date.today().isoformat(), "buildings": result}, ensure_ascii=False),
                   encoding="utf-8")
    tmp.replace(d / f"{key}.json")


def buildings_for(line: list[list[float]], cfg: dict) -> tuple[dict, bool]:
    """(buildings, from_cache). Raises tool.buildings.BuildingsError when they cannot be read."""
    key = line_key(line, cfg)
    cached = load_cached(key, cfg)
    if cached is not None:
        return cached, True
    result = along(line, cfg)
    save_cached(key, result, cfg)
    return result, False
