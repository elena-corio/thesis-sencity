"""Mapillary photos (Elena, 2026-11-11): one per stretch of a walk (its photo window), or per street or place on the cards.

The access token stays here (MAPILLARY_ACCESS_TOKEN in .env); the browser gets only the public thumbnail URL. Per
stretch, of the images within mapillary.radius_m and no older than mapillary.max_age_years (Elena, 2026-11-11):
1. a panorama, if there is one (the nearest, then the newest): the app shows its view at exactly the walk's bearing;
2. otherwise the flat photo with the smallest angle between its camera (computed_compass_angle if present) and the walk,
   within mapillary.max_turn_deg; ties go to the nearest, then the newest.
A street on a card has no walking direction, so either way along it counts; a park or square has none at all (the nearest
flat photo, then the newest), and its distance is to its outline (0 inside).
Imagery is CC BY-SA 4.0, credited "{username} · {year} · CC BY-SA 4.0" with a link to the image page.

Nothing here is sent to the rating model: the walk's comfort still comes from the Street View photos' ratings.
"""
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests
from shapely.geometry import LineString, Point, Polygon

from tool.config import get_key
from tool.geo import LocalProjection

log = logging.getLogger("sencity.mapillary")

GRAPH = "https://graph.mapillary.com"
FIELDS = ("id,computed_compass_angle,compass_angle,computed_geometry,geometry,is_pano,captured_at,creator,"
          "thumb_1024_url,thumb_2048_url")


class MapillaryError(Exception):
    """Photos that cannot be looked up; the message is safe to show in the app."""


def bearing(a: list[float], b: list[float]) -> float:
    """Compass bearing (degrees) from lon/lat a to lon/lat b."""
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    y = math.sin(dl) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def turn(a: float, b: float) -> float:
    return abs(((a - b + 540) % 360) - 180)


def session() -> requests.Session:
    try:
        token = get_key("MAPILLARY_ACCESS_TOKEN")
    except SystemExit:
        raise MapillaryError("Mapillary photos are not set up on the server.") from None
    s = requests.Session()
    s.headers["Authorization"] = f"OAuth {token}"
    return s


def search(s: requests.Session, coordinates: list[list[float]], cfg: dict) -> list[dict]:
    """Every image the Graph API has in the box around the stretch, plus the radius."""
    m = cfg["mapillary"]
    lons = [c[0] for c in coordinates]
    lats = [c[1] for c in coordinates]
    pad_lat = m["radius_m"] / 111320
    pad_lon = pad_lat / max(math.cos(math.radians(sum(lats) / len(lats))), 1e-6)
    bbox = f"{min(lons) - pad_lon},{min(lats) - pad_lat},{max(lons) + pad_lon},{max(lats) + pad_lat}"
    r = s.get(f"{GRAPH}/images", params={"bbox": bbox, "fields": FIELDS, "limit": m["search_limit"]}, timeout=m["timeout_s"])
    r.raise_for_status()
    return r.json().get("data", [])


def angle_of(im: dict) -> float | None:
    a = im.get("computed_compass_angle")
    return a if a is not None else im.get("compass_angle")


def pick(images: list[dict], coordinates: list[list[float]], cfg: dict, now: datetime | None = None,
         kind: str = "walk") -> dict | None:
    """The image to show for a stretch, in the shape the app shows, or None. `heading` is the direction the view looks:
    the walk's bearing for a panorama (the app turns it there, from `pano_heading`), the camera's for a flat photo.
    kind: 'walk' (along its direction), 'street' (either way along it) or 'area' (a park or square: any direction)."""
    m = cfg["mapillary"]
    now = now or datetime.now(timezone.utc)
    oldest = now.timestamp() * 1000 - m["max_age_years"] * 365.25 * 86400 * 1000
    want = bearing(coordinates[0], coordinates[-1])
    lons = [c[0] for c in coordinates]
    lats = [c[1] for c in coordinates]
    proj = LocalProjection((min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2)
    xy = [proj.to_xy(*c) for c in coordinates]
    if kind == "area" and len(xy) >= 3:
        line = Polygon(xy)
    else:
        line = LineString(xy) if len(xy) > 1 else Point(xy[0])

    def off(angle):  # the angle between the camera and the way to look
        if kind == "area":
            return 0.0
        if kind == "street":
            return min(turn(angle, want), turn(angle, want + 180))
        return turn(angle, want)
    panos, flats = [], []
    for im in images:
        geom = im.get("computed_geometry") or im.get("geometry")
        angle = angle_of(im)
        if not geom or angle is None or (im.get("captured_at") or 0) < oldest:
            continue
        d = line.distance(Point(proj.to_xy(*geom["coordinates"])))
        if d > m["radius_m"]:
            continue
        if im.get("is_pano"):
            if im.get("thumb_2048_url") or im.get("thumb_1024_url"):
                panos.append((d, -im["captured_at"], im))
        elif im.get("thumb_1024_url") and off(angle) <= m["max_turn_deg"]:
            flats.append((round(off(angle), 1), d, -im["captured_at"], im))
    if panos:
        best = min(panos, key=lambda t: t[:2])[-1]
        view, pano = want, True
        if kind == "street" and turn(angle_of(best), want + 180) < turn(angle_of(best), want):
            view = (want + 180) % 360  # the way along the street the panorama faces more
    elif flats:
        best = min(flats, key=lambda t: t[:3])[-1]
        view, pano = angle_of(best), False
    else:
        return None
    lon, lat = (best.get("computed_geometry") or best["geometry"])["coordinates"]
    taken = datetime.fromtimestamp(best["captured_at"] / 1000, timezone.utc)
    return {
        "id": str(best["id"]),
        "lon": round(lon, 7), "lat": round(lat, 7),
        "heading": round(view, 1),
        "pano": pano,
        "pano_heading": round(angle_of(best), 1) if pano else None,
        "turn": round(0.0 if pano else off(view), 1),
        "year": taken.year, "date": taken.strftime("%Y-%m"),
        "creator": (best.get("creator") or {}).get("username") or "Mapillary contributor",
        "thumb_url": (best.get("thumb_2048_url") or best["thumb_1024_url"]) if pano else best["thumb_1024_url"],
        "link": f"https://www.mapillary.com/app/?pKey={best['id']}",
    }


def along(stretches: list[dict], cfg: dict) -> dict:
    """{key: photo or None} for [{key, coordinates, kind?}], one Graph search per stretch, a few at a time."""
    s = session()

    def one(st):
        kind = st.get("kind") or "walk"
        return st["key"], pick(search(s, st["coordinates"], cfg), st["coordinates"], cfg, kind=kind)

    try:
        with ThreadPoolExecutor(max_workers=cfg["mapillary"]["workers"]) as pool:
            out = dict(pool.map(one, stretches))
    except requests.RequestException as e:
        log.warning("mapillary search failed: %s", type(e).__name__)
        raise MapillaryError("Mapillary photos could not be loaded.") from None
    found = sum(1 for v in out.values() if v)
    log.info("mapillary: %d of %d stretches with a photo", found, len(out))
    return out
