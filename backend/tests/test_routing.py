"""The route finder on small made-up street grids (no API calls)."""
from shapely.geometry import LineString

from tool.routing import build_graph, find_b, parts, shares, shortest_path, snap
from tool.thermal import thermal_state

CFG = {"length_ratio": 1.25, "candidates": 8, "candidate_penalty": 1.4, "easiest_weights": [0.5, 1, 2, 4, 8],
       "mixed_weight": 0.25, "min_difference_share": 0.1}
LIMITS = {"heat": [26, 32, 38], "cold": [9, 0, -13, -27]}


def ladder():
    """Two parallel ways from (0, 0) to (300, 0): straight along y = 0 (300 m), or up and over y = 30 (360 m)."""
    return [
        ("low1", LineString([(0, 0), (150, 0)])), ("low2", LineString([(150, 0), (300, 0)])),
        ("up", LineString([(0, 0), (0, 30)])), ("high1", LineString([(0, 30), (150, 30)])),
        ("high2", LineString([(150, 30), (300, 30)])), ("down", LineString([(300, 30), (300, 0)])),
    ]


def test_shortest_is_the_straight_way():
    g = build_graph(ladder(), 0)
    path = shortest_path(g, (0.0, 0.0), (300.0, 0.0))
    assert path.length == 300
    assert [p["segment_id"] for p in parts(path)] == ["low1", "low2"]


def test_b_avoids_hard_within_a_quarter_more():
    g = build_graph(ladder(), 0)
    a = shortest_path(g, (0.0, 0.0), (300.0, 0.0))
    state = {"low1": "hard", "low2": "mixed"}.get
    b, kind = find_b(g, (0.0, 0.0), (300.0, 0.0), a, lambda s: state(s, "easy"), CFG)
    assert kind == "easiest"
    assert [p["segment_id"] for p in parts(b)] == ["up", "high1", "high2", "down"]
    assert shares(b, lambda s: state(s, "easy"))["hard"] == 0


def test_b_is_never_more_than_a_quarter_longer():
    # The way around is 460 m, 53% longer than A: B may not take it, however easy it is.
    lines = [("low", LineString([(0, 0), (300, 0)])), ("up", LineString([(0, 0), (0, 80)])),
             ("high", LineString([(0, 80), (300, 80)])), ("down", LineString([(300, 80), (300, 0)]))]
    g = build_graph(lines, 0)
    a = shortest_path(g, (0.0, 0.0), (300.0, 0.0))
    b, kind = find_b(g, (0.0, 0.0), (300.0, 0.0), a, lambda s: "hard" if s == "low" else "easy", CFG)
    assert b is None and kind == "none"


def test_b_is_the_second_shortest_when_a_is_already_easiest():
    g = build_graph(ladder(), 0)
    a = shortest_path(g, (0.0, 0.0), (300.0, 0.0))
    b, kind = find_b(g, (0.0, 0.0), (300.0, 0.0), a, lambda s: "easy", CFG)
    assert kind == "second"
    assert b.length == 360


def test_no_value_is_not_treated_as_easier_than_a_known_easy_street():
    g = build_graph(ladder(), 0)
    a = shortest_path(g, (0.0, 0.0), (300.0, 0.0))
    # A is known easy; the way around has no values: B must not be called easiest.
    b, kind = find_b(g, (0.0, 0.0), (300.0, 0.0), a, lambda s: "easy" if s.startswith("low") else None, CFG)
    assert kind == "second"


def test_snap_cuts_a_street_and_the_parts_join_again():
    g = build_graph([("long", LineString([(0, 0), (200, 0)])), ("side", LineString([(200, 0), (200, 100)]))], 0)
    a, b = snap(g, (60, 8), 100), snap(g, (200, 70), 100)
    assert a == (60.0, 0.0) and b == (200.0, 70.0)
    route = parts(shortest_path(g, a, b))
    assert [p["segment_id"] for p in route] == ["long", "side"]
    assert round(route[0]["length_m"]) == 140 and round(route[1]["length_m"]) == 70


def test_start_and_end_on_one_street():
    g = build_graph([("long", LineString([(0, 0), (200, 0)]))], 0)
    a, b = snap(g, (40, 0), 100), snap(g, (150, 0), 100)
    route = parts(shortest_path(g, a, b))
    assert [p["segment_id"] for p in route] == ["long"] and round(route[0]["length_m"]) == 110


def test_snap_refuses_a_point_far_from_any_street():
    g = build_graph([("long", LineString([(0, 0), (200, 0)]))], 0)
    assert snap(g, (100, 500), 100) is None


def test_a_small_gap_is_joined_by_a_connector_and_a_big_one_is_not():
    road = ("road", LineString([(0, 0), (200, 0)]))
    near = ("path", LineString([(100, 8), (100, 100)]))  # ends 8 m short of the road (a sidewalk between them)
    g = build_graph([road, near], 15)
    route = parts(shortest_path(g, snap(g, (0, 0), 10), snap(g, (100, 100), 10)))
    assert [p["segment_id"] for p in route] == ["road", None, "path"]
    assert round(route[1]["length_m"]) == 8

    far = ("path", LineString([(100, 40), (100, 100)]))
    g = build_graph([road, far], 15)
    # Not joined, so only one part stays (the first, when both are the same size).
    assert {e.segment_id for e in g.edges.values()} == {"road"}


def test_path_ends_on_the_same_street_cut_it_twice():
    road = ("road", LineString([(0, 0), (300, 0)]))
    g = build_graph([road, ("a", LineString([(100, 5), (100, 80)])), ("b", LineString([(200, 5), (200, 80)]))], 15)
    route = parts(shortest_path(g, snap(g, (100, 80), 10), snap(g, (200, 80), 10)))
    assert [p["segment_id"] for p in route] == ["a", None, "road", None, "b"]
    assert round(route[2]["length_m"]) == 100


def test_same_answer_every_time():
    def run():
        g = build_graph(ladder(), 0)
        a = shortest_path(g, (0.0, 0.0), (300.0, 0.0))
        b, _ = find_b(g, (0.0, 0.0), (300.0, 0.0), a, lambda s: "hard" if s == "low1" else "mixed", CFG)
        return [p["segment_id"] for p in parts(b)]
    assert run() == run()


def test_thermal_state_matches_the_app():
    # The same table as frontend/src/lib/thermal.test.js.
    for utci, state in [(39, "hard"), (33, "hard"), (32, "mixed"), (27, "mixed"), (26, "easy"), (5, "easy"),
                        (0, "easy"), (-1, "mixed"), (-13, "mixed"), (-14, "hard"), (-30, "hard")]:
        assert thermal_state(utci, LIMITS) == state, utci
