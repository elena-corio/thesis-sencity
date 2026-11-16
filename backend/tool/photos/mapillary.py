"""Mapillary photos (Elena, 2026-11-11): all the app's photos with PHOTO_SOURCE=mapillary, else where Street View has
none (app/photos.py, 2026-11-16). One per street or place of an area or a route, chosen while it loads, kept with its
metadata.

The access token stays here (MAPILLARY_ACCESS_TOKEN in .env); the browser gets only the public thumbnail URL. Per
stretch, of the images within mapillary.radius_m and no older than mapillary.max_age_years (Elena, 2026-11-11):
1. a panorama, if there is one (the nearest, then the newest): the app shows its view at exactly the walk's bearing;
2. otherwise the flat photo with the smallest angle between its camera (computed_compass_angle if present) and the walk,
   within mapillary.max_turn_deg; ties go to the nearest, then the newest.
A street of an area has no walking direction, so either way along it counts; a park or square has none at all (the
nearest flat photo, then the newest), and its distance is to its outline (0 inside). A street a route walks (Elena,
2026-11-16): the walking direction at each image is the route's bearing walk_photos.ahead_m further on (the street ahead
at a turn); a panorama is turned to it, a flat photo is kept only within walk_photos.max_turn_deg of it, never facing the
other way, and `offset_deg` says how far it looks from it.
Imagery is CC BY-SA 4.0, credited "{username} · {year} · CC BY-SA 4.0" with a link to the image page.

The photo shown is the photo rated (Elena, 2026-11-11): Images fetches it for the model, in memory only, never stored. A
flat photo goes as Mapillary serves it; a panorama is first rendered as the 90 degree view the app shows, at its bearing.
"""
import io
import math
from datetime import datetime, timezone

import numpy as np
import requests
from PIL import Image
from shapely.geometry import LineString, Point, Polygon

from tool.config import get_key
from tool.geo import LocalProjection, bearing_ahead, signed_turn

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
         kind: str = "walk", ahead: list[list[float]] | None = None) -> dict | None:
    """The image to show for a stretch, in the shape the app shows, or None. `heading` is the direction the view looks:
    the walk's bearing for a panorama (the app turns it there, from `pano_heading`), the camera's for a flat photo.
    kind: 'walk' (the way it is walked, from coordinates[0]; `ahead`: the route's next points, for the bearing near the
    end), 'street' (either way along it) or 'area' (a park or square: any direction)."""
    m = cfg["mapillary"]
    wp = cfg["walk_photos"]
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
    walked = None
    if kind == "walk":
        path = xy + [proj.to_xy(*c) for c in (ahead or [])]
        walked = LineString(path) if len(path) > 1 else None
    limit = wp["max_turn_deg"] if kind == "walk" else m["max_turn_deg"]

    def way_at(pt):  # the way to look from this point
        if walked is None:
            return want
        return bearing_ahead(walked, walked.project(pt), wp["ahead_m"])

    def off(angle, way):  # the angle between the camera and the way to look
        if kind == "area":
            return 0.0
        if kind == "street":
            return min(turn(angle, way), turn(angle, way + 180))
        return turn(angle, way)
    panos, flats = [], []
    for im in images:
        geom = im.get("computed_geometry") or im.get("geometry")
        angle = angle_of(im)
        if not geom or angle is None or (im.get("captured_at") or 0) < oldest:
            continue
        pt = Point(proj.to_xy(*geom["coordinates"]))
        d = line.distance(pt)
        if d > m["radius_m"]:
            continue
        way = way_at(pt)
        if im.get("is_pano"):
            if im.get("thumb_2048_url") or im.get("thumb_1024_url"):
                panos.append((d, -im["captured_at"], way, im))
        elif im.get("thumb_1024_url") and off(angle, way) <= limit:
            flats.append((round(off(angle, way), 1), d, -im["captured_at"], way, im))
    if panos:
        *_, way, best = min(panos, key=lambda t: t[:2])
        view, pano = way, True
        if kind == "street" and turn(angle_of(best), want + 180) < turn(angle_of(best), want):
            view = (want + 180) % 360  # the way along the street the panorama faces more
        offset = 0.0
    elif flats:
        *_, way, best = min(flats, key=lambda t: t[:3])
        view, pano = angle_of(best), False
        offset = signed_turn(view, way)
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
        "turn": round(0.0 if pano else abs(offset) if kind == "walk" else off(view, want), 1),
        "year": taken.year, "date": taken.strftime("%Y-%m"),
        "creator": (best.get("creator") or {}).get("username") or "Mapillary contributor",
        "thumb_url": (best.get("thumb_2048_url") or best["thumb_1024_url"]) if pano else best["thumb_1024_url"],
        "link": f"https://www.mapillary.com/app/?pKey={best['id']}",
        **({"offset_deg": round(offset, 1)} if kind == "walk" else {}),
    }


def photo_for(s: requests.Session, coordinates: list[list[float]], kind: str, cfg: dict) -> dict | None:
    """The photo of one street ('street') or place ('area'), or None."""
    return pick(search(s, coordinates, cfg), coordinates, cfg, kind=kind)


def photo_walking(s: requests.Session, coordinates: list[list[float]], cfg: dict,
                  ahead: list[list[float]] | None = None) -> dict | None:
    """The photo of a street a route walks from coordinates[0] to coordinates[-1], facing the way it is walked (Elena,
    2026-11-16), or None: never one facing another way."""
    return pick(search(s, coordinates, cfg), coordinates, cfg, kind="walk", ahead=ahead)


# The image for the model

def render_pano(data: bytes, pano_heading: float, heading: float, fov_deg: float, pitch_deg: float, size_px: int) -> bytes:
    """A square perspective view of an equirectangular panorama (its middle column looks `pano_heading`), looking
    `heading`, `pitch_deg` up from the horizon, `fov_deg` across: the view the app's walk shows, as a camera would take
    it. In memory only; returns JPEG bytes (quality 95: the export's own rule then encodes it once more)."""
    with Image.open(io.BytesIO(data)) as pic:
        pano = np.asarray(pic.convert("RGB"), dtype=np.float32)
    h, w = pano.shape[:2]
    f = (size_px / 2) / math.tan(math.radians(fov_deg) / 2)
    c = (size_px - 1) / 2
    x, y = np.meshgrid(np.arange(size_px) - c, c - np.arange(size_px))  # right, up
    z = np.full_like(x, f, dtype=np.float64)
    p = math.radians(pitch_deg)
    y2, z2 = y * math.cos(p) + z * math.sin(p), -y * math.sin(p) + z * math.cos(p)
    yaw = math.radians(((heading - pano_heading + 540) % 360) - 180) + np.arctan2(x, z2)
    lat = np.arctan2(y2, np.hypot(x, z2))
    u = ((0.5 + yaw / (2 * math.pi)) % 1.0) * w - 0.5
    v = np.clip((0.5 - lat / math.pi) * h - 0.5, 0, h - 1)
    u0, v0 = np.floor(u).astype(int), np.floor(v).astype(int)
    du, dv = (u - u0)[..., None], (v - v0)[..., None]
    u0, u1 = u0 % w, (u0 + 1) % w
    v1 = np.minimum(v0 + 1, h - 1)
    out = (pano[v0, u0] * (1 - du) * (1 - dv) + pano[v0, u1] * du * (1 - dv)
           + pano[v1, u0] * (1 - du) * dv + pano[v1, u1] * du * dv)
    buffer = io.BytesIO()
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(buffer, format="JPEG", quality=95)
    return buffer.getvalue()


class NotThisPhoto(Exception):
    """The image and heading asked for are not a photo the app shows."""


class Images:
    """The photo a card or the walk shows, fetched for the model, in memory only. Mapillary is free."""

    def __init__(self, cfg: dict):
        self.cfg = cfg["mapillary"]
        self.session = session()

    def fetch_image(self, photo_id: str, heading: float) -> bytes:
        m = self.cfg
        r = self.session.get(f"{GRAPH}/{photo_id}", params={"fields": "id,is_pano,computed_compass_angle,compass_angle,"
                                                                          "thumb_1024_url,thumb_2048_url"},
                             timeout=m["timeout_s"])
        if r.status_code in (400, 404):
            raise NotThisPhoto("There is no such Mapillary image.")
        r.raise_for_status()
        meta = r.json()
        angle = angle_of(meta)
        if angle is None:
            raise NotThisPhoto("The image has no direction.")
        pano = bool(meta.get("is_pano"))
        # A flat photo is shown looking its own way: another heading is not the photo the app shows (2 degrees of slack,
        # in case Mapillary recomputes the angle after the photo was chosen).
        if not pano and turn(angle, heading) > 2.0:
            raise NotThisPhoto("This heading is not the photo's own.")
        url = (meta.get("thumb_2048_url") or meta.get("thumb_1024_url")) if pano else meta.get("thumb_1024_url")
        if not url:
            raise NotThisPhoto("The image has no thumbnail.")
        # The thumbnail is a public, signed URL: no token is sent with it.
        img = requests.get(url, timeout=m["timeout_s"])
        img.raise_for_status()
        if not pano:
            return img.content
        rd = m["render"]
        return render_pano(img.content, angle, heading, rd["fov_deg"], rd["pitch_deg"], rd["size_px"])

    def estimated_cost_usd(self, image_calls: int) -> float:
        return 0.0
