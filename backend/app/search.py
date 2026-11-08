"""Address and place search through Photon (komoot, OpenStreetMap data).

The search text can be someone's own address, so it is never logged or stored:
it is forwarded to Photon and the answer is passed back to the browser.

Reverse geocoding names a point clicked on the map. Only the rounded point goes to Photon, from this
server, so nothing about the person is sent. Answers are kept in memory only, never on disk or in a log.
"""
import threading
import time
from collections import OrderedDict

import requests

USER_AGENT = "SenCity thesis tool (search)"

_cache: OrderedDict = OrderedDict()
_turn = threading.Lock()
_last_call = 0.0


def label(props: dict) -> tuple[str, str]:
    """Name and a secondary line ("street, district, city, country") from Photon properties."""
    street = " ".join(p for p in (props.get("street"), props.get("housenumber")) if p)
    name = props.get("name") or street or props.get("city") or props.get("country") or "Unnamed place"
    parts = []
    if street and street != name:
        parts.append(street)
    for key in ("district", "city", "country"):
        value = props.get(key)
        if value and value != name and value not in parts:
            parts.append(value)
    return name, ", ".join(parts)


def to_result(feature: dict) -> dict | None:
    geom = feature.get("geometry") or {}
    if geom.get("type") != "Point":
        return None
    lon, lat = geom["coordinates"][:2]
    props = feature.get("properties", {})
    name, detail = label(props)
    result = {"name": name, "detail": detail, "lat": lat, "lon": lon,
              "kind": props.get("osm_value") or props.get("type") or ""}
    # Photon extent: [min lon, max lat, max lon, min lat] → [[west, south], [east, north]]
    extent = props.get("extent")
    if extent and len(extent) == 4:
        result["bbox"] = [[extent[0], extent[3]], [extent[2], extent[1]]]
    return result


def search(query: str, lat: float | None, lon: float | None, cfg: dict) -> list[dict]:
    """Up to `limit` places for a query, ranked toward (lat, lon) when given (the map view)."""
    params = {"q": query, "limit": cfg["limit"]}
    if lat is not None and lon is not None:
        params.update(lat=f"{lat:.5f}", lon=f"{lon:.5f}")
    resp = requests.get(cfg["provider_url"], params=params, timeout=cfg["timeout_s"],
                        headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    results = [to_result(f) for f in resp.json().get("features", [])]
    return [r for r in results if r][: cfg["limit"]]


def _inside(props: dict, lat: float, lon: float) -> bool:
    """Inside a park or square. Photon extent: [min lon, max lat, max lon, min lat]; a square may have none."""
    extent = props.get("extent")
    if extent and len(extent) == 4:
        return extent[0] <= lon <= extent[2] and extent[3] <= lat <= extent[1]
    return props.get("osm_value") == "square"


def point_name(features: list[dict], lat: float, lon: float) -> str | None:
    """The nearest street (from a street or a real house address; Photon gives things in a park the name
    of a nearby street too, so those do not count), else the park or square the point is in, else None."""
    props = [f.get("properties", {}) for f in features]
    for p in props:
        if p.get("type") == "street" and p.get("name"):
            return p["name"]
        if p.get("street") and p.get("housenumber"):
            return p["street"]
    for p in props:
        place = (p.get("osm_key"), p.get("osm_value")) in {("leisure", "park"), ("leisure", "garden"), ("place", "square")}
        if place and p.get("name") and _inside(p, lat, lon):
            return p["name"]
    return None


def _wait_turn(min_interval_s: float) -> None:
    """At most one call per interval from this server, whoever asks."""
    global _last_call
    with _turn:
        wait = _last_call + min_interval_s - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()


def reverse(lat: float, lon: float, cfg: dict) -> str | None:
    """The name of a point, or None. Rounded to about 10 m, which is also what is cached."""
    key = (round(lat, 4), round(lon, 4))
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    _wait_turn(cfg["reverse_min_interval_s"])
    resp = requests.get(cfg["reverse_url"], params={"lat": f"{key[0]:.4f}", "lon": f"{key[1]:.4f}", "limit": cfg["reverse_limit"],
                                                    "radius": cfg["reverse_radius_km"]},
                        timeout=cfg["timeout_s"], headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    name = point_name(resp.json().get("features", []), key[0], key[1])
    _cache[key] = name
    while len(_cache) > cfg["reverse_cache_size"]:
        _cache.popitem(last=False)
    return name
