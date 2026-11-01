"""Candidates: sample points along each segment (or a grid inside parks and squares),
ask the photo provider for the nearest photo, and give each photo its view headings."""
import math

from shapely.geometry import Point

from .geo import LocalProjection, bearing_xy, line_bearing_at
from .osm import Segment
from .photos.provider import PhotoMeta, PhotoProvider
from .selection import Candidate


def sample_points(seg: Segment, cfg: dict) -> list[Point]:
    c = cfg["candidates"]
    if seg.kind == "street":
        line = seg.geom
        n = max(1, math.ceil(line.length / c["street_sample_spacing_m"]))
        return [line.interpolate((i + 0.5) * line.length / n) for i in range(n)]
    poly = seg.geom
    step = c["area_grid_spacing_m"]
    minx, miny, maxx, maxy = poly.bounds
    pts = [Point(minx + (i + 0.5) * step, miny + (j + 0.5) * step)
           for i in range(max(1, math.ceil((maxx - minx) / step)))
           for j in range(max(1, math.ceil((maxy - miny) / step)))]
    pts = [p for p in pts if poly.contains(p)]
    return pts or [poly.representative_point()]


def area_middle(poly) -> Point:
    c = poly.centroid
    return c if poly.contains(c) else poly.representative_point()


def candidates_for(seg: Segment, metas: list[PhotoMeta], proj: LocalProjection, buildings=None) -> list[Candidate]:
    """One candidate per (photo, heading). Streets: along the street, both ways.
    Areas: one heading, from the photo toward the middle of the park or square.
    A photo located inside a building footprint (buildings, local metres) is marked indoor."""
    out: list[Candidate] = []
    seen: set[str] = set()
    for m in metas:
        if m.photo_id in seen:
            continue
        seen.add(m.photo_id)
        x, y = proj.to_xy(m.lon, m.lat)
        p = Point(x, y)
        common = dict(segment_id=seg.id, photo_id=m.photo_id, lat=m.lat, lon=m.lon, x=x, y=y,
                      date=m.date, official=m.official,
                      indoor=buildings is not None and buildings.contains(p))
        if seg.kind == "street":
            line = seg.geom
            s = line.project(p)
            mid = line.interpolate(line.length / 2)
            fwd = line_bearing_at(line, s)
            for heading, faces in ((fwd, s <= line.length / 2), ((fwd + 180) % 360, s > line.length / 2)):
                out.append(Candidate(**common, heading=round(heading, 1),
                                     dist_to_segment_m=round(line.distance(p), 2),
                                     dist_to_midpoint_m=round(p.distance(mid), 2),
                                     faces_midpoint=faces))
        else:
            mid = area_middle(seg.geom)
            heading = bearing_xy(x, y, mid.x, mid.y) if p.distance(mid) > 1 else 0.0
            out.append(Candidate(**common, heading=round(heading, 1),
                                 dist_to_segment_m=round(seg.geom.distance(p), 2),
                                 dist_to_midpoint_m=round(p.distance(mid), 2),
                                 faces_midpoint=True))
    return out


def query_photos(segments: list[Segment], provider: PhotoProvider, proj: LocalProjection, cfg: dict,
                 log=print) -> tuple[dict[str, list[PhotoMeta]], dict]:
    """Metadata lookup for every sample point. Identical (point, radius) lookups are asked once per run.

    On streets, when the nearest pano is a contributor photo, it may hide an official one:
    retry from nearby points along the street with a smaller radius (brief §4, step 1).
    Returns photos found per segment and counts (points with no photo, retries, retries that found
    an official pano)."""
    sv = cfg["streetview"]
    cache: dict[tuple, PhotoMeta | None] = {}

    def lookup(x: float, y: float, radius: float | None = None) -> PhotoMeta | None:
        lon, lat = proj.to_lonlat(x, y)
        key = (round(lat, 6), round(lon, 6), radius)
        if key not in cache:
            cache[key] = provider.search(lat, lon, radius)
        return cache[key]

    found: dict[str, list[PhotoMeta]] = {}
    stats = {"empty_points": 0, "retry_points": 0, "retry_found_official": 0}
    total = sum(len(sample_points(s, cfg)) for s in segments)
    done = 0
    for seg in segments:
        metas = []
        for pt in sample_points(seg, cfg):
            m = lookup(pt.x, pt.y)
            done += 1
            if m is None:
                stats["empty_points"] += 1
            else:
                metas.append(m)
            if m is not None and not m.official and seg.kind == "street":
                stats["retry_points"] += 1
                line, s = seg.geom, seg.geom.project(pt)
                hits = [lookup(q.x, q.y, sv["retry_radius_m"])
                        for q in (line.interpolate(min(max(s + off, 0), line.length)) for off in sv["retry_offsets_m"])]
                hits = [h for h in hits if h is not None]
                metas.extend(hits)
                if any(h.official for h in hits):
                    stats["retry_found_official"] += 1
            if done % 50 == 0:
                log(f"  metadata {done}/{total} sample points ({provider.metadata_calls} calls)")
        found[seg.id] = metas
    return found, stats
