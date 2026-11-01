"""The photo selection rule (brief §4, steps 1-3 and 6) on a fixed sample (no API calls)."""
import random
from datetime import date

from tool.selection import Candidate, select

CFG = {"selection": {"max_photos": 3, "max_age_years": 5, "max_distance_to_segment_m": 15,
                     "min_spacing_m": 10, "heading_tolerance_deg": 45}}
TODAY = date(2026, 11, 1)


def cand(pid, x, d="2024-06", official=True, dist_seg=2.0, heading=90.0, faces=True):
    return Candidate(segment_id="s1", photo_id=pid, lat=0, lon=0, x=x, y=0, date=d, official=official,
                     heading=heading, dist_to_segment_m=dist_seg, dist_to_midpoint_m=abs(x - 25),
                     faces_midpoint=faces)


def by_id(rows):
    return {(r.photo_id, r.heading): r for r in rows}


def test_filters():
    rows = by_id(select([
        cand("user", 25, official=False),
        cand("nodate", 25, d=None),
        cand("far", 25, dist_seg=30),
        cand("ok", 25),
    ], CFG, TODAY))
    assert rows[("user", 90.0)].reason == "contributor photo"
    assert rows[("nodate", 90.0)].reason == "no date"
    assert rows[("far", 90.0)].reason == "too far from segment"
    assert rows[("ok", 90.0)].status == "kept"


def test_old_dropped_only_when_newer_exists():
    rows = by_id(select([cand("old", 25, d="2019-01"), cand("new", 0, d="2023-05")], CFG, TODAY))
    assert rows[("old", 90.0)].reason == "too old"
    assert rows[("new", 90.0)].status == "kept"
    # Only old photos: they are kept.
    rows = by_id(select([cand("old", 25, d="2019-01")], CFG, TODAY))
    assert rows[("old", 90.0)].status == "kept"


def test_rank_recent_first_then_closest_to_midpoint():
    rows = select([cand("near_older", 40, d="2022-01"), cand("far_newer", 0, d="2024-01"),
                   cand("mid_newer", 20, d="2024-01")], CFG, TODAY)
    kept = [r.photo_id for r in rows if r.status == "kept"]
    assert kept == ["mid_newer", "far_newer", "near_older"]


def test_keep_three_from_different_spots():
    rows = by_id(select([cand("a", 25), cand("b", 27), cand("c", 40), cand("d", 5), cand("e", 50)], CFG, TODAY))
    assert rows[("a", 90.0)].status == "kept"
    assert rows[("b", 90.0)].reason == "same spot"       # 2 m from a
    assert rows[("c", 90.0)].status == "kept"
    assert rows[("d", 90.0)].status == "kept"
    assert rows[("e", 90.0)].reason == "segment full"


def test_one_heading_per_spot_facing_midpoint():
    rows = by_id(select([cand("a", 5, heading=90.0, faces=True), cand("a", 5, heading=270.0, faces=False)], CFG, TODAY))
    assert rows[("a", 90.0)].status == "kept"
    assert rows[("a", 270.0)].reason == "same spot"


def test_image_check_rejects_and_moves_on():
    rows = by_id(select([cand("blurry", 25), cand("b", 0), cand("c", 50)], CFG, TODAY,
                        image_ok=lambda c: c.photo_id != "blurry"))
    assert rows[("blurry", 90.0)].reason == "70% rule"
    assert rows[("b", 90.0)].status == rows[("c", 90.0)].status == "kept"


def test_deterministic_whatever_the_input_order():
    sample = [cand(f"p{i}", x, d=d) for i, (x, d) in enumerate(
        [(0, "2024-01"), (12, "2024-01"), (25, "2023-07"), (26, "2024-01"), (49, "2020-02"), (37, "2024-01")])]
    expected = select(sample, CFG, TODAY)
    for seed in range(5):
        shuffled = sample[:]
        random.Random(seed).shuffle(shuffled)
        assert select(shuffled, CFG, TODAY) == expected


def test_streets_never_use_contributor_photos():
    rows = by_id(select([cand("user", 25, official=False)], CFG, TODAY))
    assert rows[("user", 90.0)].reason == "contributor photo"


def test_area_falls_back_to_contributor_only_without_official():
    rows = by_id(select([cand("user", 25, official=False)], CFG, TODAY, contributor_fallback=True))
    assert rows[("user", 90.0)].status == "kept" and rows[("user", 90.0)].official is False
    rows = by_id(select([cand("user", 25, official=False), cand("off", 0)], CFG, TODAY, contributor_fallback=True))
    assert rows[("user", 90.0)].reason == "contributor photo, official found"
    assert rows[("off", 90.0)].status == "kept"
    # An official photo that fails the filters (too far) does not block the fallback.
    rows = by_id(select([cand("user", 25, official=False), cand("far", 0, dist_seg=40)], CFG, TODAY,
                        contributor_fallback=True))
    assert rows[("user", 90.0)].status == "kept"


def test_indoor_photos_are_rejected_and_do_not_block_area_fallback():
    indoor = Candidate(**{**cand("in", 25).__dict__, "indoor": True})
    rows = by_id(select([indoor, cand("out", 0)], CFG, TODAY))
    assert rows[("in", 90.0)].reason == "indoor" and rows[("out", 90.0)].status == "kept"
    # In an area, an indoor official photo does not count as "official found".
    rows = by_id(select([indoor, cand("user", 25, official=False)], CFG, TODAY, contributor_fallback=True))
    assert rows[("user", 90.0)].status == "kept"
