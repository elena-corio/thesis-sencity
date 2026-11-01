"""Choosing photos for one segment (brief §4, "Choosing photos…", steps 1-3 and 6).

A pure function of the segment's candidates and the config: same input, same output,
whatever the input order. The optional image check (70% rule) is passed in as a callable
and is only called for candidates that would otherwise be kept, to save image calls.
"""
import math
from dataclasses import dataclass, replace
from datetime import date
from typing import Callable

# Reasons written to photos.csv
CONTRIBUTOR = "contributor photo"
CONTRIBUTOR_OFFICIAL_FOUND = "contributor photo, official found"
INDOOR = "indoor"
NO_DATE = "no date"
TOO_FAR = "too far from segment"
TOO_OLD = "too old"
SAME_SPOT = "same spot"
SEGMENT_FULL = "segment full"
RULE_70 = "70% rule"


@dataclass(frozen=True)
class Candidate:
    segment_id: str
    photo_id: str
    lat: float
    lon: float
    x: float                     # local metres
    y: float
    date: str | None             # "YYYY-MM"
    official: bool
    heading: float
    dist_to_segment_m: float
    dist_to_midpoint_m: float
    faces_midpoint: bool         # this heading looks toward the segment's middle
    indoor: bool = False         # taken inside a building footprint (OSM)
    status: str = ""             # "kept" | "rejected"
    reason: str = ""
    rank: int | None = None


def age_years(ym: str, today: date) -> float:
    y, m = (int(p) for p in ym.split("-")[:2])
    return ((today.year - y) * 12 + (today.month - m)) / 12


def _rank_key(c: Candidate):
    # Most recent first, then closest to the midpoint, then the heading toward the midpoint;
    # photo ID and heading only break exact ties, so the order never depends on input order.
    y, m = (int(p) for p in c.date.split("-")[:2])
    return (-(y * 12 + m), round(c.dist_to_midpoint_m, 3), not c.faces_midpoint, c.photo_id, c.heading)


def select(candidates: list[Candidate], cfg: dict, today: date,
           image_ok: Callable[[Candidate], bool] | None = None,
           contributor_fallback: bool = False) -> list[Candidate]:
    """Return every candidate with status, reason and rank set.

    Streets use official imagery only. With contributor_fallback (parks, squares and
    pedestrian areas), contributor photos are allowed when no official photo passes the
    metadata filters; they keep official=False, so they can be flagged as contributor photos.
    """
    sel = cfg["selection"]
    out: list[Candidate] = []
    eligible: list[Candidate] = []

    def usable(c: Candidate) -> bool:
        return not c.indoor and bool(c.date) and c.dist_to_segment_m <= sel["max_distance_to_segment_m"]

    allow_contributor = contributor_fallback and not any(c.official and usable(c) for c in candidates)

    # Step 1, filter (metadata only).
    for c in candidates:
        if not c.official and not allow_contributor:
            out.append(replace(c, status="rejected",
                               reason=CONTRIBUTOR_OFFICIAL_FOUND if contributor_fallback else CONTRIBUTOR))
        elif c.indoor:
            out.append(replace(c, status="rejected", reason=INDOOR))
        elif not c.date:
            out.append(replace(c, status="rejected", reason=NO_DATE))
        elif c.dist_to_segment_m > sel["max_distance_to_segment_m"]:
            out.append(replace(c, status="rejected", reason=TOO_FAR))
        else:
            eligible.append(c)

    # Step 2, drop photos older than max_age_years if a newer one exists.
    if any(age_years(c.date, today) <= sel["max_age_years"] for c in eligible):
        recent = []
        for c in eligible:
            if age_years(c.date, today) > sel["max_age_years"]:
                out.append(replace(c, status="rejected", reason=TOO_OLD))
            else:
                recent.append(c)
        eligible = recent

    # Step 2, rank; step 3, keep up to max_photos from different spots.
    kept: list[Candidate] = []
    for rank, c in enumerate(sorted(eligible, key=_rank_key), start=1):
        if len(kept) >= sel["max_photos"]:
            out.append(replace(c, status="rejected", reason=SEGMENT_FULL, rank=rank))
        elif any(k.photo_id == c.photo_id or math.dist((k.x, k.y), (c.x, c.y)) < sel["min_spacing_m"]
                 for k in kept):
            out.append(replace(c, status="rejected", reason=SAME_SPOT, rank=rank))
        elif image_ok is not None and not image_ok(c):
            out.append(replace(c, status="rejected", reason=RULE_70, rank=rank))
        else:
            k = replace(c, status="kept", rank=rank)
            kept.append(k)
            out.append(k)

    out.sort(key=lambda c: (c.status != "kept", c.rank or 10**6, c.photo_id, c.heading))
    return out
