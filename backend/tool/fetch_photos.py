"""Fetch street photo candidates for one circle and choose up to 3 photos per segment.

    python -m tool.fetch_photos --lat 48.2085 --lon 16.3721 --radius 100

Uses only free metadata calls unless --check-images is given (paid image calls,
asks for --yes after showing the expected number and cost). See README.md.
"""
import argparse
import csv
import json
import sys
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path

from shapely.geometry import Point, mapping, shape
from shapely.prepared import prep

from . import image_check
from .candidates import candidates_for, query_photos
from .config import REPO_ROOT, load_config
from .geo import LocalProjection, circle
from .osm import build_segments, fetch_buildings, fetch_overpass, parse, parse_buildings
from .photos.provider import PhotoMeta, get_provider
from .review import write_review_html
from .selection import select

CSV_FIELDS = ["segment_id", "pano_id", "lat", "lon", "date", "heading", "status", "reason", "rank",
              "dist_to_segment_m", "dist_to_midpoint_m", "photo_type", "sharp_share"]


class RunLog:
    def __init__(self, path: Path):
        self.path = path
        path.write_text("", encoding="utf-8")

    def __call__(self, msg: str = ""):
        print(msg)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(msg + "\n")


def parse_args(cfg: dict):
    p = argparse.ArgumentParser(prog="python -m tool.fetch_photos", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--lon", type=float, required=True)
    p.add_argument("--radius", type=int, default=cfg["area"]["radius_default_m"], help="circle radius in metres")
    p.add_argument("--check-images", action="store_true",
                   help="also run the 70%% sharp/unblocked check (paid image calls)")
    p.add_argument("--yes", action="store_true",
                   help="confirm a radius above the test limit, or the image calls of --check-images")
    p.add_argument("--refresh", action="store_true", help="ignore cached OSM data and metadata of this run")
    return p.parse_args()


def main():
    cfg = load_config()
    args = parse_args(cfg)
    area = cfg["area"]
    if not area["radius_min_m"] <= args.radius <= area["radius_max_m"]:
        sys.exit(f"--radius must be between {area['radius_min_m']} and {area['radius_max_m']} m.")
    if args.radius > area["radius_confirm_above_m"] and not args.yes:
        sys.exit(f"Radius {args.radius} m is above the test limit ({area['radius_confirm_above_m']} m). "
                 f"Add --yes to confirm (about {(args.radius / 100) ** 2:.0f}x the metadata calls of 100 m).")
    if area.get("allowed_polygon") and not shape(area["allowed_polygon"]).contains(Point(args.lon, args.lat)):
        sys.exit("This point is outside the allowed area set in config/tool.yaml (area.allowed_polygon).")

    today = date.today()
    run_dir = REPO_ROOT / cfg["runs"]["dir"] / f"{today.isoformat()}_{args.lat:.4f}_{args.lon:.4f}_r{args.radius}"
    run_dir.mkdir(parents=True, exist_ok=True)
    log = RunLog(run_dir / "run.log")
    log(f"SenCity fetch_photos  {datetime.now().isoformat(timespec='seconds')}")
    log(f"centre {args.lat}, {args.lon}  radius {args.radius} m  source {cfg['photo_source']}")
    log(f"output {run_dir.relative_to(REPO_ROOT)}")

    proj = LocalProjection(args.lat, args.lon)
    area_poly = circle(args.radius, area["circle_points"])

    # OpenStreetMap (cached per run folder, so re-runs give the same segments).
    osm_path = run_dir / "osm.json"
    if osm_path.exists() and not args.refresh:
        data = json.loads(osm_path.read_text(encoding="utf-8"))
        log("OSM: cached osm.json")
    else:
        log("OSM: querying Overpass…")
        data = fetch_overpass(args.lat, args.lon, args.radius, cfg)
        osm_path.write_text(json.dumps(data), encoding="utf-8")
    # Building footprints, for the courtyard rule and the indoor test (cached separately).
    bld_path = run_dir / "buildings.json"
    if bld_path.exists() and not args.refresh:
        bld_data = json.loads(bld_path.read_text(encoding="utf-8"))
    else:
        log("OSM: querying building footprints…")
        bld_data = fetch_buildings(args.lat, args.lon, args.radius, cfg)
        bld_path.write_text(json.dumps(bld_data), encoding="utf-8")
    footprints = parse_buildings(bld_data, proj, 0)
    log(f"OSM: {len(bld_data.get('elements', []))} building footprints")

    ways, node_xy, areas, dropped = parse(data, proj, cfg)
    segments = build_segments(ways, node_xy, areas, area_poly, cfg, footprints, dropped)
    n_street = sum(s.kind == "street" for s in segments)
    log(f"OSM: {len(ways)} walkable ways, {len(areas)} parks/squares; dropped {dict(sorted(dropped.items()))}")
    log(f"segments: {len(segments)} ({n_street} street, {len(segments) - n_street} park/square)")

    # Photo metadata (free; cached per run folder: pano IDs, location, date only).
    provider = get_provider(cfg)
    meta_path = run_dir / "metadata.json"
    if meta_path.exists() and not args.refresh:
        cached = json.loads(meta_path.read_text(encoding="utf-8"))
        found = {k: [PhotoMeta(**{**m, "official": provider.is_official(m["copyright"])}) for m in v]
                 for k, v in cached["found"].items()}
        stats = cached.get("stats", {"empty_points": cached.get("empty_points", 0)})
        earlier_calls = cached.get("metadata_calls_total", 0)
        log("metadata: cached metadata.json (use --refresh after changing sampling or retry settings)")
        missing = [s for s in segments if s.id not in found]
        if missing:
            more, more_stats = query_photos(missing, provider, proj, cfg, log)
            found.update(more)
            stats = {k: stats.get(k, 0) + v for k, v in more_stats.items()}
    else:
        earlier_calls = 0
        log("metadata: querying Street View metadata (free)…")
        found, stats = query_photos(segments, provider, proj, cfg, log)
    new_calls = provider.metadata_calls
    meta_path.write_text(json.dumps({"found": {k: [asdict(m) for m in v] for k, v in found.items()},
                                     "stats": stats, "metadata_calls_total": earlier_calls + new_calls}),
                         encoding="utf-8")
    log(f"metadata calls: {new_calls} new, {earlier_calls + new_calls} in total for this run folder")
    log(f"  sample points with no photo {stats.get('empty_points', 0)}; contributor photo nearest on a street "
        f"{stats.get('retry_points', 0)}, of which the retry found an official pano {stats.get('retry_found_official', 0)}")
    metadata_calls = (new_calls, earlier_calls + new_calls)

    # Indoor test: footprints shrunk a little, so photos right against a facade still count as outdoor.
    buildings = None
    if footprints is not None:
        buildings = prep(footprints.buffer(-cfg["selection"]["indoor_building_inset_m"]))

    kinds = {s.id: s.kind for s in segments}
    cands = {s.id: candidates_for(s, found.get(s.id, []), proj, buildings) for s in segments}
    results = {sid: select(c, cfg, today, contributor_fallback=kinds[sid] == "area") for sid, c in cands.items()}

    shares: dict[tuple, float] = {}
    if args.check_images:
        kept_n = sum(c.status == "kept" for r in results.values() for c in r)
        upper = sum(c.rank is not None and c.reason != "same spot" for r in results.values() for c in r)
        cost_lo, cost_hi = provider.estimated_cost_usd(kept_n), provider.estimated_cost_usd(upper)
        msg = (f"--check-images needs between {kept_n} and {upper} image calls "
               f"(about ${cost_lo:.2f}–${cost_hi:.2f}; {cfg['streetview']['free_images_per_month']} "
               f"free per month may cover it).")
        if not args.yes:
            log(msg)
            log("Not fetching images. Re-run with --check-images --yes to go ahead.")
        else:
            log(msg + " Confirmed with --yes.")

            def image_ok(c):
                key = (c.photo_id, c.heading)
                if key not in shares:
                    img = provider.fetch_image(c.photo_id, c.heading)
                    shares[key] = image_check.sharp_share(img, cfg)
                    del img  # in memory only, never saved
                return shares[key] >= cfg["image_check"]["min_sharp_share"]

            results = {sid: select(c, cfg, today, image_ok, contributor_fallback=kinds[sid] == "area")
                       for sid, c in cands.items()}

    write_outputs(run_dir, segments, results, shares, proj, args, provider, metadata_calls, stats, log)


def photo_type(c) -> str:
    return "official" if c.official else "contributor"


def write_outputs(run_dir, segments, results, shares, proj, args, provider, metadata_calls, stats, log):
    rows = [c for sid in sorted(results) for c in results[sid]]
    with open(run_dir / "photos.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for c in rows:
            w.writerow({"segment_id": c.segment_id, "pano_id": c.photo_id, "lat": f"{c.lat:.7f}",
                        "lon": f"{c.lon:.7f}", "date": c.date or "", "heading": c.heading,
                        "status": c.status, "reason": c.reason, "rank": c.rank or "",
                        "dist_to_segment_m": c.dist_to_segment_m, "dist_to_midpoint_m": c.dist_to_midpoint_m,
                        "photo_type": photo_type(c), "sharp_share": shares.get((c.photo_id, c.heading), "")})

    features = []
    for s in segments:
        kept = [c for c in results[s.id] if c.status == "kept"]
        size = {"length_m": round(s.geom.length, 1)} if s.kind == "street" else {"area_m2": round(s.geom.area, 1)}
        features.append({"type": "Feature", "geometry": mapping(proj.geom_to_lonlat(s.geom)), "properties": {
            "segment_id": s.id, "kind": s.kind, "name": s.name, "highway": s.highway, "osm_ids": s.osm_ids,
            **size, "n_candidates": len(results[s.id]),
            "pano_ids": [c.photo_id for c in kept],
            "contributor_photos": sum(not c.official for c in kept),
            "photos": [{"pano_id": c.photo_id, "heading": c.heading, "date": c.date,
                        "lat": c.lat, "lon": c.lon, "photo_type": photo_type(c)} for c in kept]}})
    with open(run_dir / "segments.geojson", "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False, indent=1)

    kept_n = sum(c.status == "kept" for c in rows)
    reasons: dict[str, int] = {}
    for c in rows:
        if c.status == "rejected":
            reasons[c.reason] = reasons.get(c.reason, 0) + 1
    with_photo = sum(1 for s in segments if any(c.status == "kept" for c in results[s.id]))
    street_ids = {s.id for s in segments if s.kind == "street"}
    streets_with_photo = sum(1 for sid in street_ids if any(c.status == "kept" for c in results[sid]))
    panos = {c.photo_id: c.official for c in rows}
    kept_rows = [c for c in rows if c.status == "kept"]
    counts = {
        "panos_official": sum(panos.values()), "panos_contributor": len(panos) - sum(panos.values()),
        "kept_official": sum(c.official for c in kept_rows),
        "kept_contributor": sum(not c.official for c in kept_rows),
        "kept_contributor_on_streets": sum(not c.official and c.segment_id in street_ids for c in kept_rows),
    }
    summary = {
        "date": date.today().isoformat(), "lat": args.lat, "lon": args.lon, "radius_m": args.radius,
        "segments": len(segments), "segments_with_photo": with_photo,
        "street_segments": len(street_ids), "street_segments_with_photo": streets_with_photo,
        "candidates": len(rows), "unique_panos": len({c.photo_id for c in rows}),
        "kept": kept_n, **counts, "rejected": dict(sorted(reasons.items(), key=lambda kv: -kv[1])),
        "metadata_calls_new": metadata_calls[0], "metadata_calls_total": metadata_calls[1],
        "metadata_stats": stats,
        "image_calls": provider.image_calls,
        "estimated_cost_usd": round(provider.estimated_cost_usd(provider.image_calls), 4),
        "images_to_review_kept": kept_n,
        "review_cost_kept_usd": round(provider.estimated_cost_usd(kept_n), 4),
    }
    (run_dir / "run.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    write_review_html(run_dir, summary)

    log("")
    log(f"segments {summary['segments']} (with a kept photo: {with_photo}); "
        f"street segments {len(street_ids)} (with a kept photo: {streets_with_photo})")
    log(f"candidates {summary['candidates']} (photo x heading; {summary['unique_panos']} unique panos: "
        f"{counts['panos_official']} official, {counts['panos_contributor']} contributor)")
    log(f"kept {kept_n} ({counts['kept_official']} official, {counts['kept_contributor']} contributor, "
        f"all contributor ones in parks/squares/pedestrian areas: {counts['kept_contributor_on_streets'] == 0})")
    for reason, n in summary["rejected"].items():
        log(f"rejected {n:5d}  {reason}")
    log(f"metadata calls {metadata_calls[0]} new, {metadata_calls[1]} in total (free)")
    log(f"image calls {provider.image_calls} (est. ${summary['estimated_cost_usd']:.2f})")
    log(f"opening every kept photo in review.html = {kept_n} image calls "
        f"(est. ${summary['review_cost_kept_usd']:.2f}); rejected photos load only when opened")
    log(f"review: python -m tool.review_server --run {run_dir.name}")


if __name__ == "__main__":
    main()
