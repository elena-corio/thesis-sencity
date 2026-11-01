"""SenCity API (FastAPI). For now: POST /api/search.

Privacy (brief §10): request bodies are never logged. The search text travels in the body,
not the URL, so it does not appear in access logs or the browser history either.
"""
import logging
import time
from collections import defaultdict, deque

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from tool.config import load_config

from . import search as search_mod

cfg = load_config()["api"]
log = logging.getLogger("sencity.api")

app = FastAPI(title="SenCity API", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=cfg["cors_origins"], allow_methods=["POST"],
                   allow_headers=["Content-Type"])


class SearchRequest(BaseModel):
    q: str = Field(..., max_length=cfg["search"]["max_chars"])
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)


# Simple per-IP limit (in memory; enough for one Render instance).
_hits: dict[str, deque] = defaultdict(deque)


def _rate_limited(ip: str, per_minute: int) -> bool:
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= per_minute:
        return True
    q.append(now)
    return False


@app.post("/api/search")
def search(body: SearchRequest, request: Request) -> dict:
    s = cfg["search"]
    query = body.q.strip()
    if len(query) < s["min_chars"]:
        return {"results": []}
    if _rate_limited(request.client.host if request.client else "?", s["rate_per_minute"]):
        raise HTTPException(429, "Too many searches. Wait a moment and try again.")
    try:
        return {"results": search_mod.search(query, body.lat, body.lon, s)}
    except requests.RequestException as e:
        # Log the failure type only, never the query.
        log.warning("search provider failed: %s", type(e).__name__)
        raise HTTPException(502, "Search is not available right now.") from None
