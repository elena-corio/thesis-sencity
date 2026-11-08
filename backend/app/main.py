"""SenCity API (FastAPI).

- POST /api/search   address and place search (Photon)
- POST /api/reverse  the name of a point clicked on the map (Photon)
- POST /api/area     street segments and their chosen photos for one circle (metadata only), then
                     thermal comfort per segment for one season and time (Infrared.city, billed, cached)
- POST /api/routes   two walking routes between two points: streets, photos, thermal comfort along a
                     corridor, then the shortest and the easiest way
- GET  /api/photo/{pano_id}?heading=…   one Street View image, streamed through, never stored

Privacy (brief §10): request bodies are never logged. Search text and area coordinates travel in
the body, not the URL, so they do not appear in access logs or the browser history either.
"""
import json
import logging
import re
import threading
import time
from collections import defaultdict, deque

import requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from tool.config import load_config
from tool.infrared import km_between
from tool.photos.provider import get_provider

from . import area as area_mod
from . import routes as routes_mod
from . import search as search_mod
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


# The photo provider holds the Street View key; it is created on first use, on the server only.
_provider = None
_provider_lock = threading.Lock()


def provider():
    global _provider
    with _provider_lock:
        if _provider is None:
            try:
                _provider = get_provider(full_cfg)
            except SystemExit:
                raise HTTPException(503, "Street photos are not set up on the server.") from None
        return _provider


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


# (pano ID, heading) pairs of every cached area: /photo fetches nothing else.
_known_photos: set[tuple[str, float]] = area_mod.load_all_known(full_cfg)


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
    prov = provider() if cached is None else None

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
            for event in area_mod.run_area(body.lat, body.lon, body.radius, full_cfg, prov, key):
                if event["type"] == "done":
                    fc = event["area"]
                    area_mod.save_cached(key, body.lat, body.lon, body.radius, fc, full_cfg)
                    steps.clear(area_mod.cache_dir(full_cfg), key)
                    _known_photos.update(area_mod.known_photos(fc))
                yield _ndjson(event)
        except (requests.RequestException, SystemExit) as e:
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
    key = routes_mod.route_key(start, end, full_cfg)
    ip = _ip(request)
    cached = routes_mod.load_cached(key, full_cfg)
    resuming = cached is None and steps.exists(routes_mod.cache_dir(full_cfg), key)
    if cached is None and not resuming and _rate_limited("routes", ip, r["rate_per_hour"], 3600):
        raise HTTPException(429, "Too many new routes in a short time. Wait a while and try again.")
    prov = provider() if cached is None else None
    limits = body.limits.model_dump()
    # A corridor may bill more tiles than one circle, up to its own limit.
    thermal_cfg = {**full_cfg, "thermal": {**full_cfg["thermal"], "max_jobs": r["max_jobs"]}}

    def events():
        corridor = cached
        if corridor is None:
            try:
                for event in routes_mod.build_corridor(start, end, full_cfg, prov, key):
                    if event["type"] == "corridor":
                        corridor = event
                    else:
                        yield _ndjson(event)
            except routes_mod.RouteError as e:
                yield _ndjson({"type": "error", "message": str(e)})
                return
            except (requests.RequestException, SystemExit) as e:
                log.warning("routes failed: %s", type(e).__name__)
                yield _ndjson({"type": "error", "message": "Could not load the streets between start and end. Try again."})
                return
            lat, lon = routes_mod.middle(start, end)
            routes_mod.save_cached(key, corridor["area"], corridor["zone"], lat, lon, full_cfg)
            steps.clear(routes_mod.cache_dir(full_cfg), key)
        fc, zone = corridor["area"], corridor["zone"]
        _known_photos.update(area_mod.known_photos(fc))
        lat, lon = routes_mod.middle(start, end)
        allowed = lambda: not _rate_limited("thermal", ip, full_cfg["thermal"]["rate_per_hour"], 3600)  # noqa: E731
        thermal = None
        for event in area_mod.thermal_events(key, fc, lat, lon, zone, body.season, body.time, thermal_cfg, allowed):
            if event["type"] == "thermal":
                thermal = event
            else:
                yield _ndjson(event)
        if thermal is None:
            return
        yield _ndjson({"type": "stage", "stage": "routes"})
        try:
            found = routes_mod.find_routes(fc, start, end, thermal["values"], limits, full_cfg)
        except routes_mod.RouteError as e:
            yield _ndjson({"type": "error", "message": str(e)})
            return
        yield _ndjson({"type": "routes", "season": thermal["season"], "time": thermal["time"],
                       "station": thermal["station"], **found})

    return StreamingResponse(events(), media_type="application/x-ndjson")


# Photo: streamed through, never stored

PANO_ID = re.compile(r"^[A-Za-z0-9_.\-]{10,120}$")


@app.get("/api/photo/{pano_id}")
def photo(pano_id: str, request: Request, heading: float = Query(..., ge=0, lt=360)) -> Response:
    if not PANO_ID.match(pano_id) or (pano_id, round(heading, 1)) not in _known_photos:
        # Only photos chosen for an area can be fetched, so this is not an open Street View proxy.
        raise HTTPException(404, "Not a photo of a loaded area.")
    if _rate_limited("photo", _ip(request), cfg["photo"]["rate_per_minute"], 60):
        raise HTTPException(429, "Too many photos in a short time. Wait a moment.")
    try:
        content = provider().fetch_image(pano_id, heading)
    except requests.RequestException as e:
        log.warning("photo failed: %s", type(e).__name__)
        raise HTTPException(502, "The photo could not be loaded.") from None
    # In memory only: never written to disk (Google terms). Only the browser keeps it, briefly.
    return Response(content, media_type="image/jpeg",
                    headers={"Cache-Control": f"private, max-age={cfg['photo']['browser_cache_s']}"})
