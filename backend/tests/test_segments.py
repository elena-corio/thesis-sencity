"""Segment splitting on a small fixed network (no API calls)."""
from shapely.geometry import LineString

from tool.geo import circle
from tool.segments import Piece, Way, build_chains, clip_and_split, merge_short, split_line


def chain_nodes(chains):
    # Direction does not matter: compare each chain from its smaller end.
    return sorted(min(tuple(c.nodes), tuple(reversed(c.nodes))) for c in chains)


def test_t_junction_splits_into_three_chains():
    # 1-2-3 is one way, 2-4 meets it at node 2.
    chains = build_chains([Way(10, [1, 2, 3]), Way(11, [2, 4])])
    assert chain_nodes(chains) == [(1, 2), (2, 3), (2, 4)]


def test_way_split_by_tag_change_is_joined():
    # Two OSM ways meet end to end with no third street: one chain.
    chains = build_chains([Way(10, [1, 2, 3]), Way(11, [3, 4, 5])])
    assert chain_nodes(chains) == [(1, 2, 3, 4, 5)]
    assert chains[0].way_ids == [10, 11]


def test_crossing_splits_both_streets():
    chains = build_chains([Way(10, [1, 5, 2]), Way(11, [3, 5, 4])])
    assert chain_nodes(chains) == [(1, 5), (2, 5), (3, 5), (4, 5)]


def test_loop_without_intersection_is_one_chain():
    chains = build_chains([Way(10, [1, 2, 3, 4, 1])])
    assert len(chains) == 1 and chains[0].nodes[0] == chains[0].nodes[-1] == 1


def test_order_of_ways_does_not_change_result():
    ways = [Way(10, [1, 2, 3]), Way(11, [2, 4]), Way(12, [3, 6, 7])]
    assert chain_nodes(build_chains(ways)) == chain_nodes(build_chains(list(reversed(ways))))


def test_split_line_rounds_to_nearest_count():
    assert [round(p.length, 1) for p in split_line(LineString([(0, 0), (120, 0)]), 50)] == [60.0, 60.0]
    assert [round(p.length, 1) for p in split_line(LineString([(0, 0), (130, 0)]), 50)] == [43.3, 43.3, 43.3]
    assert [round(p.length, 1) for p in split_line(LineString([(0, 0), (40, 0)]), 50)] == [40.0]


def test_clip_at_circle_edge_and_drop_slivers():
    area = circle(100, 64)
    pieces = clip_and_split(LineString([(-300, 0), (300, 0)]), area, 50, 5)
    total = sum(p.length for p in pieces)
    assert 199 < total <= 200            # the diameter, inside the 64-gon
    assert len(pieces) == 4               # ~200 m / 50 m
    # A line that only grazes the edge leaves a tiny piece, which is dropped.
    assert clip_and_split(LineString([(-10, 99.9), (10, 99.9)]), area, 50, 5) == []


def test_clip_line_leaving_and_reentering():
    area = circle(100, 64)
    # A U shape: goes out of the circle and comes back. Two inside parts of ~86 m,
    # each cut in two, in order along the line.
    line = LineString([(-50, 0), (-50, 200), (50, 200), (50, 0)])
    pieces = clip_and_split(line, area, 50, 5)
    assert [round(p.coords[0][0]) for p in pieces] == [-50, -50, 50, 50]


def test_short_piece_between_junctions_merges_into_same_named_neighbour():
    pieces = [Piece("a", LineString([(0, 0), (40, 0)]), "Graben"),
              Piece("b", LineString([(40, 0), (46, 0)]), "Graben"),        # 6 m leftover
              Piece("c", LineString([(40, 0), (40, 60)]), "Kohlmarkt")]
    out = {p.id: p for p in merge_short(pieces, 10)}
    assert set(out) == {"a", "c"}
    assert round(out["a"].line.length, 1) == 46.0
    assert out["a"].line.coords[0] == (0, 0) and out["a"].line.coords[-1] == (46, 0)


def test_short_piece_without_same_name_joins_longest_neighbour():
    pieces = [Piece("a", LineString([(0, 0), (20, 0)]), "X"),
              Piece("b", LineString([(20, 0), (25, 0)]), ""),
              Piece("c", LineString([(25, 0), (25, 50)]), "Y")]
    out = {p.id: p for p in merge_short(pieces, 10)}
    assert set(out) == {"a", "c"} and round(out["c"].line.length, 1) == 55.0


def test_isolated_short_piece_is_kept_and_no_length_is_lost():
    pieces = [Piece("a", LineString([(0, 0), (50, 0)])), Piece("b", LineString([(50, 0), (53, 0)])),
              Piece("c", LineString([(53, 0), (56, 0)])), Piece("lonely", LineString([(100, 100), (104, 100)]))]
    out = merge_short(pieces, 10)
    assert {p.id for p in out} == {"a", "lonely"}
    assert round(sum(p.line.length for p in out), 6) == round(sum(p.line.length for p in pieces), 6)
