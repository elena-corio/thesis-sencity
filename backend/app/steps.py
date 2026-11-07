"""Finished steps of a load that did not complete, so "Try again" goes on from the failed step.

An area or a route corridor is loaded in steps: the streets (one Overpass answer), then a photo lookup
per street. When a later step fails or the app cancels, the finished ones are kept here, next to the
area or route cache, under the same key: the Overpass answer (OpenStreetMap data) and the photos
chosen so far per segment (pano IDs, location, date and heading only, never images). The next request
for the same key reads them back and makes only the calls that are still missing. Once the load
completes, the full result is cached as before and these files are removed.
"""
import json
from pathlib import Path


def _path(directory: Path, key: str, step: str) -> Path:
    return directory / f"{key}.{step}.json"


def load(directory: Path, key: str, step: str):
    path = _path(directory, key, step)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:  # a half-written file: do that step again
        return None


def save(directory: Path, key: str, step: str, data) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    path = _path(directory, key, step)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def exists(directory: Path, key: str) -> bool:
    return any(directory.glob(f"{key}.*.json")) if directory.exists() else False


def clear(directory: Path, key: str) -> None:
    if not directory.exists():
        return
    for path in directory.glob(f"{key}.*.json"):
        path.unlink(missing_ok=True)
