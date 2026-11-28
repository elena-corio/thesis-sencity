"""SenCity API (FastAPI).

- POST /api/search   address and place search (Photon)
- POST /api/reverse  the name of a point clicked on the map (Photon)
- POST /api/area     street segments and their photos for one circle (metadata only), then
                     thermal comfort per segment for one season and time (Infrared.city, billed, cached)
- POST /api/routes   two walking routes between two points: streets, photos, thermal comfort along a
                     corridor, then the shortest and the easiest way
- GET  /api/photo/{pano_id}?heading=…   one Street View image of a loaded area or route, never stored (paid, daily cap)
- POST /api/senses/rate   the model's predictions for a list of photos, streamed; cached ones cost nothing.
                          With "profile" (your answers, from the browser) they are personal (V2), else general (V0);
                          personal ones are relayed, never kept here: the browser keeps them
- GET  /api/profile/survey   the onboarding questions and the profile template, from model/app_v9/ (nothing personal)
- POST /api/chat     one chat message → one intent (app/chat.py): the message text only, one model call at temperature 0;
                     the browser carries the intent out and writes the reply. Never stored or logged
- GET/PUT/DELETE /api/profile, GET/PUT /api/ratings/own   your profile and your own photo ratings, in our database
- POST /api/account/consent, DELETE /api/account          the privacy notice agreed; delete your account and data
- GET /api/app-test, POST /api/app-test/start|answer|finish   the in-app test (D197): fixed photos, its own opt-in,
                     answers saved only after it (config/app_test.json, app/app_test.py)
- GET  /api/health   public: the API is up and the database answers

Sign-in (Elena, 2026-11-22): every /api route but /api/health needs a Clerk session, checked on the server
(app/auth.py). Per-user limits and a global daily cap on model calls: app/limits.py. Built, the frontend is served
from here too (frontend/dist), so the app is one web service.

The photos come from one source, PHOTO_SOURCE (app/photos.py, Elena 2026-11-16): Street View in the local prototype
(Mapillary where it has none), Mapillary in any public version. The photo shown is the photo rated.

Privacy (brief §10): request bodies are never logged. The profile has no endpoint of its own (phase 1): the browser
keeps it and sends it in the body of a rating request, where it is used for the model call only. Search text and area coordinates travel in
the body, not the URL, so they do not appear in access logs or the browser history either.
"""
import json
import mimetypes
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal
import logging
import threading
import time
from collections import defaultdict, deque

import requests
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from tool.config import load_config, photo_source
from tool.photos import mapillary as mapillary_mod
from tool.infrared import km_between

from . import app_test as app_test_mod
from . import area as area_mod
from . import auth
from . import db
from . import limits
from . import chat as chat_mod
from . import formula as formula_mod
from . import photos as photos_mod
from . import prepare as prepare_mod
from . import profile as profile_mod
from . import profile_questions as layout_mod
from . import routes as routes_mod
from . import search as search_mod
from . import senses as senses_mod
from . import steps

full_cfg = load_config()
cfg = full_cfg["api"]
PHOTO_SOURCE = photo_source(full_cfg)  # refuses an unknown source, and Street View on Render, before the API starts
log = logging.getLogger("sencity.api")

@asynccontextmanager
async def _lifespan(_app):
    db.migrate()  # safe to run again: creates only what is missing
    yield


app = FastAPI(title="SenCity API", docs_url=None, redoc_url=None, openapi_url=None, lifespan=_lifespan)
app.add_middleware(CORSMiddleware, allow_origins=cfg["cors_origins"], allow_methods=["GET", "POST", "PUT", "DELETE"],
                   allow_headers=["Content-Type", "Authorization"])
SignedIn = Depends(auth.signed_in)


class _ModelGuard:
    """The global daily cap on model calls, for every rating call (app/senses.py)."""
    allow = staticmethod(lambda: limits.model_calls_left() > 0)
    called = staticmethod(lambda: limits.model_called(1))


senses_mod.model_guard = _ModelGuard()


@app.get("/api/health")
def health() -> dict:
    """Public: for Render's health check. Says nothing about anyone."""
    try:
        db.count("*:health", "0")
    except Exception as e:  # noqa: BLE001
        log.warning("health: database not reachable: %s", type(e).__name__)
        raise HTTPException(503, "Database not reachable.") from None
    return {"ok": True}


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


def ip_limit(env: str, default: int) -> int:
    """A per-address limit: the environment variable `env` if it is a whole number, else the config's default
    (Elena, 2026-11-22: env vars, defaults raised so a class on one network is not blocked; per-user limits:
    app/limits.py)."""
    raw = os.environ.get(env, "").strip()
    return int(raw) if raw.isdigit() else default


def _ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def street_view_at_start(source: str) -> tuple[set[tuple[str, float]], dict[tuple[str, float], float]]:
    """The only Street View photos the API fetches (not an open proxy), as (pano ID, heading), and the pitch of those
    with their own. With Street View as the source: every photo of a cached area or route. With Mapillary (Render): none
    of the map's, so only the app test's (exception of 2026-11-28: invited testers, on demand, never stored). The app
    test's photos (D197) are added either way, each at its own pitch."""
    known = photos_mod.load_all_known(full_cfg) if source == "streetview" else set()
    pitches: dict = {}
    try:
        cfg = app_test_mod.load()
        known |= app_test_mod.known_photos(cfg)
        pitches = app_test_mod.pitches(cfg)
    except app_test_mod.AppTestError:
        log.warning("app test: config/app_test.json cannot be used")
    return known, pitches


_known_photos, _photo_pitches = street_view_at_start(PHOTO_SOURCE)
# The Street View images (the key stays here) and the pictures for the model; created on first use, on the server only.
_streetview = None
_images = None
_images_lock = threading.Lock()


def _make_streetview():
    """The Street View images; SystemExit when GOOGLE_MAPS_API_KEY is missing."""
    global _streetview
    with _images_lock:
        if _streetview is None:
            _streetview = photos_mod.StreetViewImages(full_cfg, _known_photos, _photo_pitches)
        return _streetview


def streetview():
    try:
        return _make_streetview()
    except SystemExit:
        raise HTTPException(503, "Street View photos are not set up on the server.") from None


def images():
    global _images
    with _images_lock:
        if _images is None:
            _images = photos_mod.Images(full_cfg, _make_streetview)
        return _images


# Search

class SearchRequest(BaseModel):
    q: str = Field(..., max_length=cfg["search"]["max_chars"])
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)


@app.post("/api/search")
def search(body: SearchRequest, request: Request, user: auth.User = SignedIn) -> dict:
    s = cfg["search"]
    query = body.q.strip()
    if len(query) < s["min_chars"]:
        return {"results": []}
    if _rate_limited("search", _ip(request), ip_limit("IP_LIMIT_SEARCH_PER_MINUTE", s["rate_per_minute"]), 60):
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
def reverse(body: ReverseRequest, request: Request, user: auth.User = SignedIn) -> dict:
    """The name of a point clicked on the map: {"name": "Mariahilfer Straße"}, or null when there is none."""
    s = cfg["search"]
    if _rate_limited("reverse", _ip(request), ip_limit("IP_LIMIT_REVERSE_PER_MINUTE", s["reverse_rate_per_minute"]), 60):
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


def _failed_host(e: Exception) -> str:
    """The host a failed request went to (no path, no query), or "?"."""
    from urllib.parse import urlparse
    url = getattr(getattr(e, "request", None), "url", "") or ""
    return urlparse(url).hostname or "?"


def _area_failure(e: Exception) -> str:
    """What the app says when an area cannot load: which service failed, and what to do."""
    if isinstance(e, mapillary_mod.MapillaryError):
        return str(e)
    host = _failed_host(e)
    if "mapillary" in host:
        return "The street photos (Mapillary) could not be reached. Try again in a minute."
    if host != "?":
        return "The street map (OpenStreetMap) could not be reached: its public servers are busy. Try again in a minute."
    return "Could not load street photos for this area. Try again."


@app.post("/api/area")
def area(body: AreaRequest, request: Request, user: auth.User = SignedIn) -> StreamingResponse:
    """Streams newline-separated JSON events: "segments" (all segments, photos pending), "segment"
    (one segment with its photos, with done/total), "done" with the FeatureCollection, then the
    thermal stage: "thermal" (UTCI per segment) or "thermal_error". A cached area sends "done" at
    once; cached thermal comfort comes straight after it. If the app cancels, the lookups stop.
    The photos always load; the Senses layer skips the thermal stage."""
    needs_thermal = body.layer != "senses"
    key = area_mod.area_key(body.lat, body.lon, body.radius, full_cfg)
    # Thermal comfort does not depend on the photos: its key stays the same whatever PHOTO_SOURCE is (no new billed run).
    thermal_key = area_mod.area_key(body.lat, body.lon, body.radius, full_cfg, source="mapillary")
    ip = _ip(request)
    cached = area_mod.load_cached(key, full_cfg)
    # Going on from a failed try is not a new area (its finished steps are kept, app/steps.py).
    resuming = cached is None and steps.exists(area_mod.cache_dir(full_cfg), key)
    if cached is None and not resuming and _rate_limited("area", ip, ip_limit("IP_LIMIT_AREA_PER_HOUR", cfg["area"]["rate_per_hour"]), 3600):
        raise HTTPException(429, "Too many new areas in a short time. Wait a while and try again.")

    def thermal(fc):
        if not needs_thermal:
            return
        allowed = lambda: not _rate_limited("thermal", ip, ip_limit("IP_LIMIT_THERMAL_PER_HOUR", full_cfg["thermal"]["rate_per_hour"]), 3600)  # noqa: E731
        for event in area_mod.thermal_events(thermal_key, fc, body.lat, body.lon,
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
                    _known_photos.update(photos_mod.known_photos(fc))
                    steps.clear(area_mod.cache_dir(full_cfg), key)
                yield _ndjson(event)
        except (requests.RequestException, mapillary_mod.MapillaryError, SystemExit) as e:
            # The type and the host only: a network error's text can hold the request URL with its query.
            log.warning("area failed: %s (%s)", type(e).__name__, _failed_host(e))
            yield _ndjson({"type": "error", "message": _area_failure(e)})
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
def routes(body: RoutesRequest, request: Request, user: auth.User = SignedIn) -> StreamingResponse:
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
    # Thermal comfort: either way round, and whatever PHOTO_SOURCE is (it does not depend on the photos).
    key = routes_mod.route_key(start, end, full_cfg, source="mapillary")
    corridor_key = routes_mod.corridor_key(start, end, full_cfg)  # streets and photos: the photos face the walk
    ip = _ip(request)
    cached = routes_mod.load_cached(corridor_key, full_cfg)
    resuming = cached is None and steps.exists(routes_mod.cache_dir(full_cfg), corridor_key)
    if cached is None and not resuming and _rate_limited("routes", ip, ip_limit("IP_LIMIT_ROUTES_PER_HOUR", r["rate_per_hour"]), 3600):
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
        _known_photos.update(photos_mod.known_photos(fc))
        lat, lon = routes_mod.middle(start, end)
        allowed = lambda: not _rate_limited("thermal", ip, ip_limit("IP_LIMIT_THERMAL_PER_HOUR", full_cfg["thermal"]["rate_per_hour"]), 3600)  # noqa: E731
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
        # The photos the routes show face the way they are walked (some turned): those images may be fetched.
        _known_photos.update(photos_mod.known_photos(found["segments"]))
        if thermal:
            yield _ndjson({"type": "routes", "season": thermal["season"], "time": thermal["time"],
                           "station": thermal["station"], **found})
        else:  # no window, and no routes yet: the browser rates the candidates and chooses B
            yield _ndjson({"type": "routes", "season": None, "time": None, "station": None, "routes": [], "verdict": "", **found})

    return StreamingResponse(events(), media_type="application/x-ndjson")


# Street View images: fetched on demand, in memory only, never stored (Google terms)

@app.get("/api/photo/{pano_id}")
def photo(pano_id: str, request: Request, heading: float = Query(..., ge=0, lt=360), user: auth.User = SignedIn) -> Response:
    """The Street View image of a photo of a loaded area or route, as the cards and the walk show it. Each one is a paid
    call, counted against the daily cap; the browser is told not to keep it."""
    if not photos_mod.PANO_ID.match(pano_id) or (pano_id, round(heading, 1)) not in _known_photos:
        raise HTTPException(404, "Not a photo of a loaded area or route.")
    if _rate_limited("photo", _ip(request), ip_limit("IP_LIMIT_PHOTO_PER_MINUTE", cfg["photo"]["rate_per_minute"]), 60):
        raise HTTPException(429, "Too many photos in a short time. Wait a moment.")
    try:
        content = streetview().fetch(pano_id, heading)
    except photos_mod.CapReached as e:
        raise HTTPException(429, str(e)) from None
    except requests.RequestException as e:
        log.warning("photo failed: %s", type(e).__name__)
        raise HTTPException(502, "The photo could not be loaded.") from None
    return Response(content, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


# Senses mode: general predictions for the photos of an area or route (no profile), from model/app_v9/

# Ratings made from Street View photos are stale from now on (Elena, 2026-11-11): marked on the first rating request
# (their keys never match a Mapillary photo anyway; the mark is for the record).
_stale_marked = False

class RatingStamp(BaseModel):
    """What the browser's own personal rating of a photo was made from: nothing personal."""
    listed: list[str] = Field(..., max_length=20)
    model: str = Field(..., max_length=200)
    commit: str = Field(..., pattern=r"^[0-9a-f]{7,40}$")
    prompt: str = Field("", max_length=20)  # how the app put the request together (senses.PROMPT_VERSION)
    formula: str = Field("none", pattern="^(none|(xhat|f):[0-9a-f]{12})$")  # the formula it had: mode and numbers' hash


class SensesPhoto(BaseModel):
    id: str = Field(..., pattern=r"^([0-9]{1,20}|sv:[A-Za-z0-9_.\-]{10,120})$")  # a Mapillary image ID, or "sv:<pano ID>" (a photo sphere\'s may end in ".")
    heading: float = Field(..., ge=0, lt=360)
    cached: RatingStamp | None = None  # with a profile: the browser has a rating of this photo; "keep" if still valid


class ProfileAnswers(BaseModel):
    """Your answers to Part A (part_a.json), checked against it in app/profile.py. Never logged or stored. Only the
    questions the profile text uses: anything else (A15, how you prepare for new places) is refused, never prompted."""
    model_config = ConfigDict(extra="forbid")
    language: str = Field(..., pattern="^(en|it)$")
    A11: int = Field(..., ge=1, le=5)
    A12: dict[str, int] = Field(..., max_length=20)
    A13: dict[str, int] = Field(..., max_length=20)
    A16: str = Field("", max_length=profile_mod.A16_MAX)


class SensesRateRequest(BaseModel):
    photos: list[SensesPhoto] = Field(..., max_length=cfg["senses"]["max_photos_per_request"])
    profile: ProfileAnswers | None = None


@app.get("/api/profile/survey")
def profile_survey(user: auth.User = SignedIn) -> dict:
    """The onboarding (part_a.json, each element with its sense icon) and the profile template with its fixed words,
    so the browser builds and shows the same text as the server; and the optional step about new places
    (config/prepare.json). Nothing personal."""
    try:
        survey, prepare = profile_mod.survey(profile_mod.load()), prepare_mod.load()
        return {**survey, "prepare": prepare, "layout": layout_mod.load(survey, prepare)}
    except layout_mod.LayoutError as e:
        log.warning("profile: config/profile_questions.json cannot be used")
        raise HTTPException(503, f"The profile questions cannot be loaded. {e}") from None
    except senses_mod.ExportError as e:
        log.warning("profile: the export cannot be used")
        raise HTTPException(503, f"The survey cannot be loaded. {e}") from None
    except prepare_mod.PrepareError as e:
        log.warning("profile: config/prepare.json cannot be used")
        raise HTTPException(503, f"The questions about new places cannot be loaded. {e}") from None


# Chat (Elena, 2026-11-21): the message only. extra="forbid": a profile, ratings or anything else is refused, so they
# can never reach the model by mistake.
class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(..., min_length=1, max_length=cfg["chat"]["max_chars"])


@app.post("/api/chat")
def chat(body: ChatRequest, request: Request, user: auth.User = SignedIn) -> dict:
    """One message → one intent. The message is sent to the model and never stored or logged."""
    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Write a question first.")
    if _rate_limited("chat", _ip(request), ip_limit("IP_LIMIT_CHAT_PER_HOUR", cfg["chat"]["per_hour"]), 3600):
        raise HTTPException(429, "Too many questions in a short time. Wait a while, then ask again.")
    limits.chat(user.account_id)  # per user, and the global daily cap
    try:
        limits.model_called(1)
        intent, _cost = chat_mod.parse(message, cfg["senses"])
    except chat_mod.ChatError as e:
        raise HTTPException(e.status, e.message) from None
    except senses_mod.ExportError:
        log.warning("chat: the export cannot be used")
        raise HTTPException(503, "The model settings cannot be used.") from None
    except senses_mod.PredictionError as e:
        raise HTTPException(e.status, e.message) from None
    return {"intent": intent}


@app.post("/api/senses/rate")
def senses_rate(body: SensesRateRequest, request: Request, user: auth.User = SignedIn) -> StreamingResponse:
    """Rates the photos in the order given (nearest first). Cached ones answer at once and cost nothing; of the rest,
    at most cfg["senses"]["cap_photos"] are rated and "done" says how many are left. Streams newline-separated JSON
    (app/senses.py). Images are fetched here from Mapillary, kept in memory only, and never logged. A flat photo is
    rated only at its own heading; a panorama at the heading the app shows it."""
    global _stale_marked
    if not _stale_marked:
        senses_mod.mark_stale(senses_mod.REPO_ROOT / cfg["senses"]["cache_file"])
        senses_mod.drop_personal(senses_mod.REPO_ROOT / cfg["senses"]["cache_file"])  # personal results: browser only
        _stale_marked = True
    photos = [(p.id, round(p.heading, 1)) for p in body.photos]
    try:
        text, stamps = None, {}
        if body.profile is not None:
            pe = profile_mod.load()
            answers = profile_mod.check(body.profile.model_dump(exclude={"language"}), body.profile.language, pe)
            text = profile_mod.build(answers, body.profile.language, pe)
            stamps = {(p.id, round(p.heading, 1)): p.cached.model_dump() for p in body.photos if p.cached}
        plan = senses_mod.plan_rating(photos, cfg["senses"], text, stamps,
                                      formula_mod.plan(cfg["senses"]["formula_mode"], answers) if text else None)
    except profile_mod.ProfileError as e:
        raise HTTPException(422, f"Your sensory profile could not be used: {e}") from None
    except senses_mod.ExportError as e:
        log.warning("senses: the export cannot be used")
        raise HTTPException(503, f"The model settings cannot be used. {e}") from None
    except senses_mod.PredictionError as e:
        raise HTTPException(e.status, e.message) from None
    if plan.to_rate and _rate_limited("senses", _ip(request), ip_limit("IP_LIMIT_SENSES_PER_HOUR", cfg["senses"]["runs_per_hour"]), 3600):
        raise HTTPException(429, "Too many rating runs in a short time. Wait a while, then retry.")
    if plan.to_rate:
        limits.rating_run(user.account_id)  # per user, and the global daily cap (each call is counted in app/senses.py)
    try:
        prov = images() if plan.to_rate else None
    except mapillary_mod.MapillaryError as e:
        raise HTTPException(503, str(e)) from None
    return StreamingResponse((_ndjson(e) for e in senses_mod.rate_events(plan, cfg["senses"], prov)),
                             media_type="application/x-ndjson")


# Your profile and your own ratings (Elena, 2026-11-22): in our database, under your account; never in Clerk.
MAX_PROFILE_BYTES = 200_000
MAX_RATINGS = 3000


def _consented(user: auth.User) -> None:
    if not user.consented:
        raise HTTPException(403, "Please read and agree to the privacy notice first.")


class ConsentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agreed: bool


@app.post("/api/account/consent")
def account_consent(body: ConsentRequest, user: auth.User = SignedIn) -> dict:
    """The privacy notice agreed ("Agree and continue"): recorded with the date. Nothing is saved before it."""
    if not body.agreed:
        raise HTTPException(422, "The privacy notice was not agreed.")
    db.set_consent(user.account_id, db.now())
    return {"consented": True}


@app.get("/api/account")
def account(user: auth.User = SignedIn) -> dict:
    """Whether the privacy notice is agreed (the email is Clerk's, not here)."""
    return {"consented": user.consented}


@app.delete("/api/account")
def account_delete(user: auth.User = SignedIn) -> dict:
    """"Delete my account and data": our rows first (the app test's too), then the Clerk user. The browser then signs out."""
    db.delete_app_test(user.clerk_user_id)
    db.delete_account(user.account_id)
    auth.delete_clerk_user(user.clerk_user_id)
    log.info("account: deleted")
    return {"deleted": True}


@app.get("/api/profile")
def profile_get(user: auth.User = SignedIn) -> dict:
    return {"profile": db.get_profile(user.account_id), "consented": user.consented}


@app.put("/api/profile")
async def profile_put(request: Request, user: auth.User = SignedIn) -> dict:
    """Save the profile as the browser built it (answers, text, version, weather, thermal, prepare). Never logged."""
    _consented(user)
    raw = await request.body()
    if len(raw) > MAX_PROFILE_BYTES:
        raise HTTPException(413, "The profile is too large.")
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(422, "The profile could not be read.") from None
    if not isinstance(data, dict) or not isinstance(data.get("answers"), dict) or data.get("language") not in ("en", "it"):
        raise HTTPException(422, "The profile could not be read.")
    keep = {k: data.get(k) for k in ("language", "answers", "text", "version", "saved", "weather", "thermal", "prepare")}
    db.put_profile(user.account_id, keep)
    return {"saved": True}


@app.delete("/api/profile")
def profile_delete(user: auth.User = SignedIn) -> dict:
    """Your profile and your ratings; the account stays (sign-in, consent)."""
    db.delete_profile(user.account_id)
    return {"deleted": True}


@app.get("/api/ratings/own")
def ratings_get(user: auth.User = SignedIn) -> dict:
    return {"ratings": db.get_ratings(user.account_id)}


@app.put("/api/ratings/own")
async def ratings_put(request: Request, user: auth.User = SignedIn) -> dict:
    """Your own photo ratings, the whole list (photo IDs and your answers; never images)."""
    _consented(user)
    raw = await request.body()
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(422, "The ratings could not be read.") from None
    if not isinstance(data, list) or len(data) > MAX_RATINGS or not all(isinstance(e, dict) for e in data):
        raise HTTPException(422, "The ratings could not be read.")
    db.put_ratings(user.account_id, data)
    return {"saved": len(data)}


# The app test (D197, Elena 2026-11-28): optional, exploratory, separate from the survey study. The fixed photos come
# from config/app_test.json; nothing is saved before the test's own opt-in, and then only under the Clerk user id.
# Request bodies (ratings, free text) are never logged.
def _app_test_cfg() -> dict:
    try:
        cfg = app_test_mod.load()
    except app_test_mod.AppTestError as e:
        log.warning("app test: config/app_test.json cannot be used")
        raise HTTPException(503, f"The app test cannot be loaded. {e}") from None
    if not app_test_mod.is_open(cfg):
        raise HTTPException(503, "The app test is not open yet.")
    return cfg


def _app_test_state(session: dict | None) -> dict | None:
    if not session:
        return None
    answered = db.app_test_answered(session["id"])
    return {"finished": session["finished_at"] is not None, "answered": [a["photo_id"] for a in answered],
            "rated": sum(1 for a in answered if a["rating"] is not None)}


@app.get("/api/app-test")
def app_test_get(user: auth.User = SignedIn) -> dict:
    """The fixed photos in their order, the information sheet, and the person's saved progress (only after opt-in)."""
    cfg = _app_test_cfg()
    return {"photos": app_test_mod.public(cfg), "info_sheet_url": cfg["info_sheet_url"], "approved": cfg["approved"],
            "photo_set": app_test_mod.photo_set(cfg), "free_text_max": cfg["free_text_max"],
            "session": _app_test_state(db.app_test_session(user.clerk_user_id))}


class AppTestStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    consent: bool
    entry: Literal["profile", "later"] = "later"  # right after the profile questions, or from the "Rate 8 places" entry
    skipped_first: bool = False                     # "Skip for now" was pressed before (known only in the browser until now)


@app.post("/api/app-test/start")
def app_test_start(body: AppTestStart, user: auth.User = SignedIn) -> dict:
    """The opt-in ticked: one session per person, with the profile answers as they are now."""
    cfg = _app_test_cfg()
    if not body.consent:
        raise HTTPException(422, "Nothing is saved without your consent.")
    _consented(user)
    snapshot = app_test_mod.profile_snapshot(db.get_profile(user.account_id))
    if snapshot is None:
        raise HTTPException(409, "Make your profile first.")
    session = db.start_app_test(user.clerk_user_id, consented_at=db.now(), photo_set=app_test_mod.photo_set(cfg),
                                app_version=app_test_mod.app_version(), profile=snapshot, profile_version=snapshot.get("version"),
                                entry=body.entry, skipped_first=body.skipped_first)
    return {"session": _app_test_state(session)}


class AppTestEstimate(BaseModel):
    """The app's estimate as it was on screen: the 1–5 rating, its level and the reasons, with what made it."""
    model_config = ConfigDict(extra="forbid")
    comfort: int = Field(..., ge=1, le=5)
    level: Literal["easy", "mixed", "hard"]
    bothers: list[str] = Field(default_factory=list, max_length=20)
    feels_good: list[str] = Field(default_factory=list, max_length=20)
    model: str = Field(..., max_length=200)
    commit: str = Field(..., pattern=r"^[0-9a-f]{7,40}$")
    prompt: str = Field("", max_length=20)
    profile_version: str | None = Field(None, max_length=32)
    personal: bool


class AppTestAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    photo_id: str = Field(..., max_length=140)
    order: int = Field(..., ge=1, le=8)
    estimate: AppTestEstimate | None = None   # null: the app could not make one
    rating: int | None = Field(None, ge=1, le=5)  # B1; missing or null is stored as missing (0 is refused)
    reasons_right: Literal["yes", "partly", "no"] | None = None
    free_text: str = Field("", max_length=2000)
    shown_at: datetime
    answered_at: datetime | None = None


@app.post("/api/app-test/answer")
def app_test_answer(body: AppTestAnswer, user: auth.User = SignedIn) -> dict:
    """One photo's answer. Refused without the opt-in, for a photo not in the test, or out of the fixed order."""
    cfg = _app_test_cfg()
    session = db.app_test_session(user.clerk_user_id)
    if not session:
        raise HTTPException(403, "Nothing is saved without your consent.")
    if session["photo_set"] != app_test_mod.photo_set(cfg):
        raise HTTPException(409, "The places of the test have changed. Reload the page.")
    if app_test_mod.order_of(cfg, body.photo_id) != body.order:
        raise HTTPException(422, "This place is not in the test's fixed order.")
    free = body.free_text.strip()
    if len(free) > cfg["free_text_max"]:
        raise HTTPException(422, f"Please keep the text under {cfg['free_text_max']} characters.")
    est = body.estimate
    db.save_app_test_answer({
        "session_id": session["id"], "photo_id": body.photo_id, "order_shown": body.order,
        "estimate": est.model_dump() if est else None, "rating": body.rating,
        "reasons_right": body.reasons_right if est else None, "free_text": free or None,
        "shown_at": body.shown_at, "answered_at": body.answered_at, "app_version": app_test_mod.app_version(),
        "model": est.model if est else None, "export_commit": est.commit if est else None,
        "prompt_version": est.prompt if est else None, "profile_version": est.profile_version if est else None,
    })
    return {"saved": True}


@app.post("/api/app-test/finish")
def app_test_finish(user: auth.User = SignedIn) -> dict:
    """The end screen: how many places were rated (nothing to finish without the opt-in)."""
    _app_test_cfg()
    session = db.app_test_session(user.clerk_user_id)
    if not session:
        raise HTTPException(403, "Nothing is saved without your consent.")
    db.finish_app_test(session["id"])
    return {"session": _app_test_state(db.app_test_session(user.clerk_user_id))}


# The built frontend (npm run build → frontend/dist), served from here in the one web service. Any path that is not
# a file and not /api gets index.html, so the app's own routes (/area, /profile…) load on refresh.
# .mjs (MapLibre's worker) and .js as JavaScript, whatever the system says (Python 3.11 on Linux may not know .mjs;
# Windows can map .js to another type): a module sent as anything else is refused by the browser (2026-11-28: the
# deployed map was blank).
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
DIST = senses_mod.REPO_ROOT / "frontend" / "dist"


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    if path.startswith("api/") or path == "api":
        raise HTTPException(404, "Not found.")
    if not (DIST / "index.html").is_file():
        raise HTTPException(404, "The app is not built: run npm run build in frontend/.")
    target = (DIST / path).resolve()
    if path and target.is_file() and DIST.resolve() in target.parents:
        return FileResponse(target)
    return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
