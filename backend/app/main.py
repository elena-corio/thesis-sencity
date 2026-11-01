"""SenCity API (FastAPI).

- POST /api/search   address and place search (Photon)
- POST /api/area     street segments and their chosen photos for one circle (metadata only)
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
from tool.photos.provider import get_provider

from . import area as area_mod
from . import search as search_mod

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


# Area: segments and photos

class AreaRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    radius: int = Field(..., ge=full_cfg["area"]["radius_min_m"], le=full_cfg["area"]["radius_max_m"])


# (pano ID, heading) pairs of every cached area: /photo fetches nothing else.
_known_photos: set[tuple[str, float]] = area_mod.load_all_known(full_cfg)


def _ndjson(event: dict) -> bytes:
    return (json.dumps(event, ensure_ascii=False) + "\n").encode()


@app.post("/api/area")
def area(body: AreaRequest, request: Request) -> StreamingResponse:
    """Streams newline-separated JSON events: "segments" (all segments, photos pending), "segment"
    (one segment with its photos, with done/total), then "done" with the FeatureCollection.
    A cached area answers with "done" at once. If the app cancels, the lookups stop."""
    key = area_mod.area_key(body.lat, body.lon, body.radius, full_cfg)
    cached = area_mod.load_cached(key, full_cfg)
    if cached is not None:
        return StreamingResponse(iter([_ndjson({"type": "done", "area": cached, "cached": True})]),
                                 media_type="application/x-ndjson")
    if _rate_limited("area", _ip(request), cfg["area"]["rate_per_hour"], 3600):
        raise HTTPException(429, "Too many new areas in a short time. Wait a while and try again.")
    prov = provider()

    def events():
        try:
            for event in area_mod.run_area(body.lat, body.lon, body.radius, full_cfg, prov):
                if event["type"] == "done":
                    area_mod.save_cached(key, body.lat, body.lon, body.radius, event["area"], full_cfg)
                    _known_photos.update(area_mod.known_photos(event["area"]))
                yield _ndjson(event)
        except (requests.RequestException, SystemExit) as e:
            log.warning("area failed: %s", type(e).__name__)
            yield _ndjson({"type": "error", "message": "Could not load street photos for this area. Try again."})

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
