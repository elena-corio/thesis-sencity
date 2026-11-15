"""SenCity API (FastAPI).

- POST /api/search   address and place search (Photon)
- POST /api/reverse  the name of a point clicked on the map (Photon)
- POST /api/area     street segments and their Mapillary photos for one circle (metadata only), then
                     thermal comfort per segment for one season and time (Infrared.city, billed, cached)
- POST /api/routes   two walking routes between two points: streets, photos, thermal comfort along a
                     corridor, then the shortest and the easiest way
- POST /api/buildings   footprints and heights along a walked route, for the walk view (public data, free, cached)
- POST /api/mapillary/along   one Mapillary photo per stretch of a walk (free; the token stays here)
- POST /api/senses/rate   the model's predictions for a list of Mapillary photos, streamed; cached ones cost nothing.
                          With "profile" (your answers, from the browser) they are personal (V2), else general (V0)
- GET  /api/profile/survey   the onboarding questions and the profile template, from model/app_v9/ (nothing personal)

No Street View call is left in the app (Elena, 2026-11-11): its photos are Mapillary's, and those are the ones rated.

Privacy (brief §10): request bodies are never logged. The profile has no endpoint of its own (phase 1): the browser
keeps it and sends it in the body of a rating request, where it is used for the model call only. Search text and area coordinates travel in
the body, not the URL, so they do not appear in access logs or the browser history either.
"""
import json
import logging
import threading
import time
from collections import defaultdict, deque

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from tool.config import load_config
from tool.buildings import BuildingsError
from tool.photos import mapillary as mapillary_mod
from tool.infrared import km_between

from . import area as area_mod
from . import profile as profile_mod
from . import buildings as buildings_mod
from . import routes as routes_mod
from . import search as search_mod
from . import senses as senses_mod
from . import steps

full_cfg = load_config()
cfg = full_cfg["api"]
log = logging.getLogger("sencity.api")

app = FastAPI(title="SenCity API", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=cfg["cors_origins"], allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"])


# Simple per-IP limits (in memory; enough for one Render instance).
_hits: dict[tuple, deque] = defaultdict(deque)


def _rate_limited(bucket: str, ip: str, limit: int, window_s: float) -> bool:
    now = time.monotonic()
    q = _hits[(bucket, ip)]
    while q and now - q[0] > window_s:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def _ip(request: Request) -> str:
    return request.client.host if request.client else "?"


# The Mapillary images for the model; created on first use, on the server only (the token stays here).
_images = None
_images_lock = threading.Lock()


def images():
    global _images
    with _images_lock:
        if _images is None:
            _images = mapillary_mod.Images(full_cfg)
        return _images


# Search

class SearchRequest(BaseModel):
    q: str = Field(..., max_length=cfg["search"]["max_chars"])
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)


@app.post("/api/search")
def search(body: SearchRequest, request: Request) -> dict:
    s = cfg["search"]
    query = body.q.strip()
    if len(query) < s["min_chars"]:
        return {"results": []}
    if _rate_limited("search", _ip(request), s["rate_per_minute"], 60):
        raise HTTPException(429, "Too many searches. Wait a moment and try again.")
    try:
        return {"results": search_mod.search(query, body.lat, body.lon, s)}
    except requests.RequestException as e:
        # Log the failure type only, never the query.
        log.warning("search provider failed: %s", type(e).__name__)
        raise HTTPException(502, "Search is not available right now.") from None


class ReverseRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


@app.post("/api/reverse")
def reverse(body: ReverseRequest, request: Request) -> dict:
    """The name of a point clicked on the map: {"name": "Mariahilfer Straße"}, or null when there is none."""
    s = cfg["search"]
    if _rate_limited("reverse", _ip(request), s["reverse_rate_per_minute"], 60):
        raise HTTPException(429, "Too many points in a short time. Wait a moment and try again.")
    try:
        return {"name": search_mod.reverse(body.lat, body.lon, s)}
    except requests.RequestException as e:
        # Log the failure type only, never the point.
        log.warning("reverse geocoding failed: %s", type(e).__name__)
        raise HTTPException(502, "Place names are not available right now.") from None


# Area: segments and photos

class AreaRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    radius: int = Field(..., ge=full_cfg["area"]["radius_min_m"], le=full_cfg["area"]["radius_max_m"])
    season: str = Field(full_cfg["thermal"]["default"]["season"], pattern="^(" + "|".join(full_cfg["thermal"]["seasons"]) + ")$")
    time: str = Field(full_cfg["thermal"]["default"]["time"], pattern="^([01][0-9]|2[0-3]):00$")
    # Photos always load. Senses skips the billed thermal run (Thermal skips ratings, once they exist).
    layer: str = Field("overall", pattern="^(senses|thermal|overall)$")


def _ndjson(event: dict) -> bytes:
    return (json.dumps(event, ensure_ascii=False) + "\n").encode()


@app.post("/api/area")
def area(body: AreaRequest, request: Request) -> StreamingResponse:
    """Streams newline-separated JSON events: "segments" (all segments, photos pending), "segment"
    (one segment with its photos, with done/total), "done" with the FeatureCollection, then the
    thermal stage: "thermal" (UTCI per segment) or "thermal_error". A cached area sends "done" at
    once; cached thermal comfort comes straight after it. If the app cancels, the lookups stop.
    The photos always load; the Senses layer skips the thermal stage."""
    needs_thermal = body.layer != "senses"
    key = area_mod.area_key(body.lat, body.lon, body.radius, full_cfg)
    ip = _ip(request)
    cached = area_mod.load_cached(key, full_cfg)
    # Going on from a failed try is not a new area (its finished steps are kept, app/steps.py).
    resuming = cached is None and steps.exists(area_mod.cache_dir(full_cfg), key)
    if cached is None and not resuming and _rate_limited("area", ip, cfg["area"]["rate_per_hour"], 3600):
        raise HTTPException(429, "Too many new areas in a short time. Wait a while and try again.")

    def thermal(fc):
        if not needs_thermal:
            return
        allowed = lambda: not _rate_limited("thermal", ip, full_cfg["thermal"]["rate_per_hour"], 3600)  # noqa: E731
        for event in area_mod.thermal_events(key, fc, body.lat, body.lon,
                                             area_mod.circle_polygon(body.lat, body.lon, body.radius, full_cfg),
                                             body.season, body.time, full_cfg, allowed):
            yield _ndjson(event)

    def events():
        if cached is not None:
            yield _ndjson({"type": "done", "area": cached, "cached": True})
            yield from thermal(cached)
            return
        fc = None
        try:
            for event in area_mod.run_area(body.lat, body.lon, body.radius, full_cfg, key):
                if event["type"] == "done":
                    fc = event["area"]
                    area_mod.save_cached(key, body.lat, body.lon, body.radius, fc, full_cfg)
                    steps.clear(area_mod.cache_dir(full_cfg), key)
                yield _ndjson(event)
        except (requests.RequestException, mapillary_mod.MapillaryError, SystemExit) as e:
            # Only the type: a network error's text can hold the request URL.
            log.warning("area failed: %s", type(e).__name__)
            yield _ndjson({"type": "error", "message": "Could not load street photos for this area. Try again."})
            return
        yield from thermal(fc)

    return StreamingResponse(events(), media_type="application/x-ndjson")


# Routes: two ways between two points

class RoutePoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class ThermalLimits(BaseModel):
    """°C, as in the app's config.js: heat [mixed above, hard above] and cold [easy from, hard below]."""
    heat: list[float] = Field(..., min_length=2, max_length=2)
    cold: list[float] = Field(..., min_length=2, max_length=2)


class RoutesRequest(BaseModel):
    start: RoutePoint
    end: RoutePoint
    limits: ThermalLimits
    season: str = Field(full_cfg["thermal"]["default"]["season"], pattern="^(" + "|".join(full_cfg["thermal"]["seasons"]) + ")$")
    time: str = Field(full_cfg["thermal"]["default"]["time"], pattern="^([01][0-9]|2[0-3]):00$")
    # Senses loads streets and photos only, with no billed thermal run: B is chosen from rated candidates.
    layer: str = Field("thermal", pattern="^(senses|thermal|overall)$")


@app.post("/api/routes")
def routes(body: RoutesRequest, request: Request) -> StreamingResponse:
    """Streams newline-separated JSON events: "stage" (streets, thermal, routes), "segments" and "segment"
    (progress of the photo lookups, with counts only), then "routes", or "error" or "thermal_error" (the
    stream ends). Nothing is shown on the map before "routes" (brief §3, Routes 2)."""
    r = full_cfg["routes"]
    start, end = body.start.model_dump(), body.end.model_dump()
    straight = km_between(start["lat"], start["lon"], end["lat"], end["lon"]) * 1000
    if straight < r["min_walk_m"]:
        raise HTTPException(422, "Start and end are too close together. Choose points further apart.")
    if straight > r["max_walk_m"]:
        raise HTTPException(422, f"Start and end are too far apart. Routes go up to {r['max_walk_m'] / 1000:.1f} km for now.")
    key = routes_mod.route_key(start, end, full_cfg)  # thermal comfort: either way round
    corridor_key = routes_mod.corridor_key(start, end, full_cfg)  # streets and photos: the photos face the walk
    ip = _ip(request)
    cached = routes_mod.load_cached(corridor_key, full_cfg)
    resuming = cached is None and steps.exists(routes_mod.cache_dir(full_cfg), corridor_key)
    if cached is None and not resuming and _rate_limited("routes", ip, r["rate_per_hour"], 3600):
        raise HTTPException(429, "Too many new routes in a short time. Wait a while and try again.")
    limits = body.limits.model_dump()
    # A corridor may bill more tiles than one circle, up to its own limit.
    thermal_cfg = {**full_cfg, "thermal": {**full_cfg["thermal"], "max_jobs": r["max_jobs"]}}

    def events():
        corridor = cached
        if corridor is None:
            try:
                for event in routes_mod.build_corridor(start, end, full_cfg, corridor_key):
                    if event["type"] == "corridor":
                        corridor = event
                    else:
                        yield _ndjson(event)
            except routes_mod.RouteError as e:
                yield _ndjson({"type": "error", "message": str(e)})
                return
            except (requests.RequestException, mapillary_mod.MapillaryError, SystemExit) as e:
                log.warning("routes failed: %s", type(e).__name__)
                yield _ndjson({"type": "error", "message": "Could not load the streets between start and end. Try again."})
                return
            lat, lon = routes_mod.middle(start, end)
            routes_mod.save_cached(corridor_key, corridor["area"], corridor["zone"], lat, lon, full_cfg)
            steps.clear(routes_mod.cache_dir(full_cfg), corridor_key)
        fc, zone = corridor["area"], corridor["zone"]
        lat, lon = routes_mod.middle(start, end)
        allowed = lambda: not _rate_limited("thermal", ip, full_cfg["thermal"]["rate_per_hour"], 3600)  # noqa: E731
        thermal = None
        if body.layer != "senses":
            for event in area_mod.thermal_events(key, fc, lat, lon, zone, body.season, body.time, thermal_cfg, allowed):
                if event["type"] == "thermal":
                    thermal = event
                else:
                    yield _ndjson(event)
            if thermal is None:
                return
        yield _ndjson({"type": "stage", "stage": "routes"})
        try:
            found = (routes_mod.find_routes(fc, start, end, thermal["values"], limits, full_cfg) if thermal
                     else routes_mod.find_candidates(fc, start, end, cfg["senses"]["route_candidates"], full_cfg))
        except routes_mod.RouteError as e:
            yield _ndjson({"type": "error", "message": str(e)})
            return
        if thermal:
            yield _ndjson({"type": "routes", "season": thermal["season"], "time": thermal["time"],
                           "station": thermal["station"], **found})
        else:  # no window, and no routes yet: the browser rates the candidates and chooses B
            yield _ndjson({"type": "routes", "season": None, "time": None, "station": None, "routes": [], "verdict": "", **found})

    return StreamingResponse(events(), media_type="application/x-ndjson")


# Buildings along a walked route (board Routes 5)

class BuildingsRequest(BaseModel):
    line: list[tuple[float, float]] = Field(..., min_length=2, max_length=full_cfg["buildings"]["max_points"])


@app.post("/api/buildings")
def buildings(body: BuildingsRequest, request: Request) -> dict:
    """Footprints and heights of the buildings along the walked line (lon, lat pairs), and their source, as
    GeoJSON. The line is not logged or stored: the cache is keyed by a hash."""
    b = full_cfg["buildings"]
    line = [[lon, lat] for lon, lat in body.line]
    if any(not (-180 <= lon <= 180 and -90 <= lat <= 90) for lon, lat in line):
        raise HTTPException(422, "The route is not on the map.")
    length = sum(km_between(a[1], a[0], c[1], c[0]) for a, c in zip(line, line[1:])) * 1000
    if length > b["max_length_m"]:
        raise HTTPException(422, "This route is too long for the walk view.")
    key = buildings_mod.line_key(line, full_cfg)
    if buildings_mod.load_cached(key, full_cfg) is None and _rate_limited("buildings", _ip(request), b["rate_per_hour"], 3600):
        raise HTTPException(429, "Too many new walks in a short time. Wait a while and try again.")
    try:
        result, _ = buildings_mod.buildings_for(line, full_cfg)
    except BuildingsError as e:
        raise HTTPException(503, str(e)) from None
    return result


# Mapillary photos along a walk

class WalkStretch(BaseModel):
    key: str = Field(..., max_length=80)
    coordinates: list[tuple[float, float]] = Field(..., min_length=1, max_length=400)
    # 'walk': along its direction; 'street' (a card): either way; 'area' (a park or square): any direction.
    kind: str = Field("walk", pattern="^(walk|street|area)$")


class MapillaryRequest(BaseModel):
    stretches: list[WalkStretch] = Field(..., min_length=1, max_length=full_cfg["mapillary"]["max_stretches"])


@app.post("/api/mapillary/along")
def mapillary_along(body: MapillaryRequest, request: Request) -> dict:
    """{photos: {key: photo or null}}: for each stretch the newest flat Mapillary photo within 30 m facing along it, with
    its public thumbnail URL and credit. The stretches travel in the body and are not logged or stored."""
    if _rate_limited("mapillary", _ip(request), full_cfg["mapillary"]["rate_per_hour"], 3600):
        raise HTTPException(429, "Too many walks in a short time. Wait a while and try again.")
    stretches = [{"key": s.key, "kind": s.kind, "coordinates": [[lon, lat] for lon, lat in s.coordinates]} for s in body.stretches]
    try:
        return {"photos": mapillary_mod.along(stretches, full_cfg)}
    except mapillary_mod.MapillaryError as e:
        raise HTTPException(503, str(e)) from None


# Senses mode: general predictions for the photos of an area or route (no profile), from model/app_v9/

# Ratings made from Street View photos are stale from now on (Elena, 2026-11-11): marked on the first rating request
# (their keys never match a Mapillary photo anyway; the mark is for the record).
_stale_marked = False

class SensesPhoto(BaseModel):
    id: str = Field(..., pattern=r"^[0-9]{1,20}$")  # a Mapillary image ID
    heading: float = Field(..., ge=0, lt=360)


class ProfileAnswers(BaseModel):
    """Your answers to Part A (part_a.json), checked against it in app/profile.py. Never logged or stored."""
    language: str = Field(..., pattern="^(en|it)$")
    A11: int = Field(..., ge=1, le=5)
    A12: dict[str, int] = Field(..., max_length=20)
    A13: dict[str, int] = Field(..., max_length=20)
    A16: str = Field("", max_length=profile_mod.A16_MAX)


class SensesRateRequest(BaseModel):
    photos: list[SensesPhoto] = Field(..., max_length=cfg["senses"]["max_photos_per_request"])
    profile: ProfileAnswers | None = None


@app.get("/api/profile/survey")
def profile_survey() -> dict:
    """The onboarding (part_a.json, each element with its sense icon) and the profile template with its fixed words,
    so the browser builds and shows the same text as the server."""
    try:
        return profile_mod.survey(profile_mod.load())
    except senses_mod.ExportError as e:
        log.warning("profile: the export cannot be used")
        raise HTTPException(503, f"The survey cannot be loaded. {e}") from None


@app.post("/api/senses/rate")
def senses_rate(body: SensesRateRequest, request: Request) -> StreamingResponse:
    """Rates the photos in the order given (nearest first). Cached ones answer at once and cost nothing; of the rest,
    at most cfg["senses"]["cap_photos"] are rated and "done" says how many are left. Streams newline-separated JSON
    (app/senses.py). Images are fetched here from Mapillary, kept in memory only, and never logged. A flat photo is
    rated only at its own heading; a panorama at the heading the app shows it."""
    global _stale_marked
    if not _stale_marked:
        senses_mod.mark_stale(senses_mod.REPO_ROOT / cfg["senses"]["cache_file"])
        _stale_marked = True
    photos = [(p.id, round(p.heading, 1)) for p in body.photos]
    try:
        text = version = None
        if body.profile is not None:
            pe = profile_mod.load()
            answers = profile_mod.check(body.profile.model_dump(exclude={"language"}), body.profile.language, pe)
            text = profile_mod.build(answers, body.profile.language, pe)
            version = profile_mod.version(text)
        plan = senses_mod.plan_rating(photos, cfg["senses"], text, version)
    except profile_mod.ProfileError as e:
        raise HTTPException(422, f"Your sensory profile could not be used: {e}") from None
    except senses_mod.ExportError as e:
        log.warning("senses: the export cannot be used")
        raise HTTPException(503, f"The model settings cannot be used. {e}") from None
    except senses_mod.PredictionError as e:
        raise HTTPException(e.status, e.message) from None
    if plan.to_rate and _rate_limited("senses", _ip(request), cfg["senses"]["runs_per_hour"], 3600):
        raise HTTPException(429, "Too many rating runs in a short time. Wait a while, then retry.")
    try:
        prov = images() if plan.to_rate else None
    except mapillary_mod.MapillaryError as e:
        raise HTTPException(503, str(e)) from None
    return StreamingResponse((_ndjson(e) for e in senses_mod.rate_events(plan, cfg["senses"], prov)),
                             media_type="application/x-ndjson")
