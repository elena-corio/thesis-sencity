"""The app's street photos, from one source (Elena, 2026-11-16): PHOTO_SOURCE (tool/config.py photo_source).

- streetview (the local prototype, default): the study's source, so the app's photos and ratings look like the study's.
  A street or place gets up to 3 photos by the step-1 rule (brief §4: official imagery on streets, a contributor
  photosphere allowed in parks and squares, retries, newest first, different spots). A street a route walks gets a photo
  every 10 to 20 m, turned to the way it is walked (the route's bearing walk_photos.ahead_m further on: at a turn, the
  street ahead). Where Street View has none (parks, paths), the Mapillary photo is used
  instead, with its own credit; with neither, the street has no photo. Only pano IDs, location, date and heading are
  kept (Google terms); images are fetched on demand, in memory only, and every fetch counts against a daily cap.
- mapillary (any public version): one Mapillary photo per street or place (tool/photos/mapillary.py).

A photo belongs to its street only if no other street of the area or route is nearer to it by more than
selection.own_street_tolerance_m (Elena, 2026-11-16): the pano at a junction is often on the crossing street, and a path
beside a road has the road's panos.

A photo, as the app gets it: Street View {id: "sv:<pano ID>", source, pano_id, lat, lon, heading, date, year,
contributor, copyright?}; Mapillary as tool/photos/mapillary.py makes it, with source "mapillary". The "sv:" prefix
keeps the two kinds of ID apart in the app and in the rating cache.
"""
import json
import logging
import re
import threading
from datetime import date, datetime, timezone
from pathlib import Path

from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

from tool.candidates import candidates_for, make_lookup, photos_for_segment
from tool.config import REPO_ROOT, photo_source
from tool.geo import bearing_ahead
from tool.photos import mapillary
from tool.selection import Candidate, select

log = logging.getLogger("sencity.api")

SV = "sv:"
PANO_ID = re.compile(r"^[A-Za-z0-9_.\-]{10,120}$")  # contributed photo spheres ("CAoS…") may contain "." (2026-11-22)
# The settings that change which photos a street gets (and so a cached area or route).
MAPILLARY_SETTINGS = ("radius_m", "max_turn_deg", "max_age_years", "search_limit")
STREETVIEW_SETTINGS = ("source", "metadata_radius_m", "official_copyright", "retry_radius_m", "retry_offsets_m",
                       "walk_min_spacing_m")


def settings(cfg: dict, source: str | None = None) -> dict:
    """What the cache keys of areas and routes hold about the photos: a new source or rule finds them again. With
    source="mapillary" it is exactly what the keys held before PHOTO_SOURCE, which the thermal caches still use."""
    source = source or photo_source(cfg)
    out = {"photos": source, "mapillary": {k: cfg["mapillary"][k] for k in MAPILLARY_SETTINGS}}
    if source == "streetview":
        out["streetview"] = {k: cfg["streetview"][k] for k in STREETVIEW_SETTINGS}
        out["selection"] = {k: v for k, v in cfg["selection"].items() if k != "heading_tolerance_deg"}
        out["candidates"] = cfg["candidates"]
    return out


def sv_photo(c: Candidate, copyright_: str = "", walked: bool = False) -> dict:
    out = {"id": SV + c.photo_id, "source": "streetview", "pano_id": c.photo_id, "lat": round(c.lat, 7),
           "lon": round(c.lon, 7), "heading": c.heading, "date": c.date, "year": int(c.date[:4]) if c.date else None,
           "contributor": not c.official}
    if walked:
        out["offset_deg"] = 0.0  # a panorama turned to the walking direction exactly
    if not c.official and copyright_:
        out["copyright"] = copyright_  # a contributor photosphere is credited to its author
    return out


def walked_line(seg, forward: bool, ahead: list | None = None) -> LineString:
    """The street in walking order (local metres), then the route's next points (`ahead`), for the bearing at a turn."""
    coords = list(seg.geom.coords)
    return LineString((coords if forward else coords[::-1]) + list(ahead or []))


def walk_candidates(seg, metas: list, proj, forward: bool, ahead: list | None, ahead_m: float) -> list[Candidate]:
    """One candidate per pano along a street a route walks, looking the way it is walked: the route's bearing ahead_m
    further on (at a turn, the street ahead). `dist_to_midpoint_m` holds the distance walked, for the order."""
    out, seen = [], set()
    line = seg.geom
    walked = walked_line(seg, forward, ahead)
    street = walked_line(seg, forward)
    for m in metas:
        if m.photo_id in seen:
            continue
        seen.add(m.photo_id)
        x, y = proj.to_xy(m.lon, m.lat)
        p = Point(x, y)
        along = street.project(p)
        heading = bearing_ahead(walked, along, ahead_m)
        out.append(Candidate(segment_id=seg.id, photo_id=m.photo_id, lat=m.lat, lon=m.lon, x=x, y=y, date=m.date,
                             official=m.official, heading=round(heading, 1), dist_to_segment_m=round(line.distance(p), 2),
                             dist_to_midpoint_m=round(along, 2), faces_midpoint=True))
    return out


class Finder:
    """Finds the photos of one street or place; shared by the lookups of one area or route (several at a time)."""

    def __init__(self, cfg: dict, proj, indoor=None, streets: list | None = None):
        """streets: every street and place of the area or route (local metres), to tell which a photo belongs to."""
        self.cfg, self.proj, self.indoor = cfg, proj, indoor
        self.streets = [s.geom for s in (streets or [])]
        self.tree = STRtree(self.streets) if self.streets else None
        self.tolerance = cfg["selection"]["own_street_tolerance_m"]
        self.source = photo_source(cfg)
        self.today = date.today()
        self._mly, self._mly_tried, self._mly_ok = None, False, False
        self._mly_lock = threading.Lock()
        if self.source == "streetview":
            from tool.photos.streetview import StreetViewProvider
            try:
                self.sv = StreetViewProvider(cfg)
            except SystemExit:
                raise mapillary.MapillaryError("Street View photos are not set up on the server: add "
                                               "GOOGLE_MAPS_API_KEY to .env, or set PHOTO_SOURCE=mapillary.") from None
            self.lookup = make_lookup(self.sv, proj)
            self.copyrights: dict[str, str] = {}

    def belongs(self, seg, x: float, y: float) -> bool:
        """No other street is nearer to this point than seg, by more than the tolerance."""
        if self.tree is None:
            return True
        p = Point(x, y)
        own = seg.geom.distance(p)
        near = own - self.tolerance
        if near <= 0:
            return True
        return not any(self.streets[i] is not seg.geom and self.streets[i].distance(p) < near
                       for i in self.tree.query(p.buffer(near)))

    def keep_for(self, seg):
        """keep(lon, lat) for Mapillary: the image belongs to seg."""
        return lambda lon, lat: self.belongs(seg, *self.proj.to_xy(lon, lat))

    def mly(self) -> tuple[bool, object]:
        """(True, the Mapillary session), or (False, None) when it is not set up (with Street View it is only the
        fallback)."""
        with self._mly_lock:
            if not self._mly_tried:
                try:
                    self._mly, self._mly_ok = mapillary.session(), True
                except mapillary.MapillaryError:
                    if self.source == "mapillary":
                        raise
                    log.warning("photos: no Mapillary token, so no fallback where Street View has no photo")
                self._mly_tried = True
            return self._mly_ok, self._mly

    def mapillary_photos(self, seg, walk: tuple | None) -> list:
        ok, s = self.mly()
        if not ok:
            return []
        geom = self.proj.geom_to_lonlat(seg.geom)
        if seg.kind == "area":
            photo = mapillary.photo_for(s, [list(c) for c in geom.exterior.coords], "area", self.cfg, self.keep_for(seg))
        elif walk is not None:
            forward, ahead = walk
            coords = [list(c) for c in geom.coords]
            ahead_lonlat = [list(self.proj.to_lonlat(x, y)) for x, y in (ahead or [])]
            photo = mapillary.photo_walking(s, coords if forward else coords[::-1], self.cfg, ahead_lonlat, self.keep_for(seg))
        else:
            photo = mapillary.photo_for(s, [list(c) for c in geom.coords], "street", self.cfg, self.keep_for(seg))
        return [{**photo, "source": "mapillary"}] if photo else []

    def streetview_photos(self, seg, walk: tuple | None) -> list:
        lookup = self.lookup

        def remember(x, y, radius=None):  # the copyright of contributor photospheres, for their credit
            m = lookup(x, y, radius)
            if m is not None and not m.official:
                self.copyrights[m.photo_id] = m.copyright
            return m
        metas = [m for m in photos_for_segment(seg, remember, self.cfg, {})
                 if self.belongs(seg, *self.proj.to_xy(m.lon, m.lat))]
        if walk is None or seg.kind != "street":
            chosen = select(candidates_for(seg, metas, self.proj, self.indoor), self.cfg, self.today,
                            contributor_fallback=seg.kind == "area")
            kept = [c for c in chosen if c.status == "kept"]
        else:
            walk_cfg = {**self.cfg, "selection": {**self.cfg["selection"], "max_photos": 10**6,
                                                  "min_spacing_m": self.cfg["streetview"]["walk_min_spacing_m"]}}
            forward, ahead = walk
            candidates = walk_candidates(seg, metas, self.proj, forward, ahead, self.cfg["walk_photos"]["ahead_m"])
            chosen = select(candidates, walk_cfg, self.today)
            # In the order they are walked past (the rank was newest first).
            kept = sorted((c for c in chosen if c.status == "kept"), key=lambda c: c.dist_to_midpoint_m)
            return [sv_photo(c, self.copyrights.get(c.photo_id, ""), walked=True) for c in kept]
        return [sv_photo(c, self.copyrights.get(c.photo_id, "")) for c in kept]

    def photos(self, seg, walk: tuple | None = None) -> list:
        """The photos of a street or place. walk: for a street a route walks, (forward, ahead): True if walked along its
        drawing, False against it, and the route's next points after it (local metres); else None."""
        if self.source == "streetview":
            found = self.streetview_photos(seg, walk)
            if found:
                return found
        return self.mapillary_photos(seg, walk)


# Street View images: on demand, in memory only, under a daily cap

class CapReached(Exception):
    """Today's Street View images are used up."""


_usage_lock = threading.Lock()


def _usage_path(cfg: dict) -> Path:
    return REPO_ROOT / cfg["streetview"]["usage_file"]


def images_today(cfg: dict) -> int:
    try:
        data = json.loads(_usage_path(cfg).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    today = datetime.now(timezone.utc).date().isoformat()
    return int(data.get("images", 0)) if isinstance(data, dict) and data.get("date") == today else 0


def take_image(cfg: dict) -> None:
    """Count one Street View image against today's cap (UTC), across all users; raise CapReached when it is used up.
    The file holds the date and the count only."""
    cap = cfg["streetview"]["daily_image_cap"]
    with _usage_lock:
        n = images_today(cfg)
        if n >= cap:
            raise CapReached(f"Street View's daily limit of {cap} images is reached. Photos come back tomorrow.")
        path = _usage_path(cfg)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"date": datetime.now(timezone.utc).date().isoformat(), "images": n + 1}),
                       encoding="utf-8")
        tmp.replace(path)


def image_usd(cfg: dict) -> float:
    """One Street View image at list price (the free 10,000 a month are not taken off)."""
    return cfg["streetview"]["price_per_1000_images_usd"] / 1000


def known_photos(fc: dict) -> set[tuple[str, float]]:
    """(pano ID, heading) pairs an area or route uses: the only Street View images the API fetches."""
    return {(p["pano_id"], round(float(p["heading"]), 1))
            for f in fc["features"] for p in (f["properties"].get("photos") or []) if p.get("source") == "streetview"}


def load_all_known(cfg: dict) -> set[tuple[str, float]]:
    """The Street View photos of every cached area and route corridor."""
    known: set = set()
    for d in (REPO_ROOT / cfg["api"]["area"]["cache_dir"], REPO_ROOT / cfg["routes"]["cache_dir"]):
        if not d.exists():
            continue
        for path in d.glob("*.json"):
            if path.name.count(".") > 1:  # the steps of an unfinished load (<key>.osm.json, ...)
                continue
            try:
                known |= known_photos(json.loads(path.read_text(encoding="utf-8"))["area"])
            except (ValueError, KeyError, TypeError, OSError):
                continue
    return known


class StreetViewImages:
    """The Street View image a card or the walk shows, for /api/photo and for the model. Only photos chosen for a loaded
    area or route (`known`), so this is not an open Street View proxy. In memory only."""

    def __init__(self, cfg: dict, known: set):
        from tool.photos.streetview import StreetViewProvider
        self.cfg, self.known = cfg, known
        self.provider = StreetViewProvider(cfg)

    def fetch(self, pano_id: str, heading: float) -> bytes:
        if not PANO_ID.match(pano_id) or (pano_id, round(heading, 1)) not in self.known:
            raise mapillary.NotThisPhoto("Not a photo of a loaded area or route.")
        take_image(self.cfg)
        return self.provider.fetch_image(pano_id, heading)


class Images:
    """The picture of a photo for the model, from its source: "sv:<pano ID>" from Street View, else Mapillary."""

    def __init__(self, cfg: dict, streetview):
        self.cfg, self.streetview = cfg, streetview
        self._mly = None

    def fetch_image(self, photo_id: str, heading: float) -> bytes:
        if photo_id.startswith(SV):
            return self.streetview().fetch(photo_id[len(SV):], heading)
        if self._mly is None:
            self._mly = mapillary.Images(self.cfg)
        return self._mly.fetch_image(photo_id, heading)

    def image_usd(self, photo_id: str) -> float:
        return image_usd(self.cfg) if photo_id.startswith(SV) else 0.0

