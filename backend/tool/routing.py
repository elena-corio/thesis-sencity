"""Walking routes on the rated street lines. Pure: local metres, no API calls.

The graph's edges are the street segments, so every metre of a route has a segment and its rating.
Separately mapped sidewalks and crossings are not in the data, which can leave a path's end a few
metres short of the street it joins: such a gap is closed with a short connector, which belongs to no
segment. The clicked start and end are snapped onto the nearest street.

A = the shortest way. B = the way with the least "hard" at most length_ratio longer, or, when that is A
itself, the next shortest. Finding the true minimum under a length limit is a hard problem, so B is the
best of a fixed set: Dijkstra with hard streets weighted more and more, plus the candidates found by
penalising the streets already used. The result is deterministic.
"""
import heapq
from dataclasses import dataclass, field

from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.ops import substring

NODE_ROUNDING = 1  # decimals of a metre: ends closer than this are the same junction
MIN_PIECE_M = 0.1


def node_of(xy) -> tuple[float, float]:
    return round(xy[0], NODE_ROUNDING), round(xy[1], NODE_ROUNDING)


@dataclass
class Edge:
    id: int
    u: tuple
    v: tuple
    segment_id: str | None  # None: a connector across a small gap
    line: LineString        # runs from u to v

    @property
    def length(self) -> float:
        return self.line.length


@dataclass
class Path:
    steps: list[tuple[Edge, bool]]  # (edge, walked from u to v)
    length: float

    @property
    def edge_ids(self) -> frozenset:
        return frozenset(e.id for e, _ in self.steps)


@dataclass
class Graph:
    edges: dict[int, Edge] = field(default_factory=dict)
    adj: dict[tuple, list[int]] = field(default_factory=dict)
    _next: int = 0

    def add(self, u, v, segment_id, line) -> Edge:
        edge = Edge(self._next, u, v, segment_id, line)
        self._next += 1
        self.edges[edge.id] = edge
        self.adj.setdefault(u, []).append(edge.id)
        self.adj.setdefault(v, []).append(edge.id)
        return edge

    def remove(self, edge: Edge) -> None:
        del self.edges[edge.id]
        self.adj[edge.u].remove(edge.id)
        self.adj[edge.v].remove(edge.id)

    def cut(self, edge: Edge, distances: list[float]) -> list[tuple]:
        """Cut an edge at these distances along it. Returns the node at each distance, in the order
        given. A distance at an end of the edge gives that end, with no cut."""
        nodes: dict[float, tuple] = {}
        inner = []
        for d in distances:
            if d < MIN_PIECE_M:
                nodes[d] = edge.u
            elif edge.length - d < MIN_PIECE_M:
                nodes[d] = edge.v
            else:
                inner.append(d)
        if inner:
            self.remove(edge)
            start, start_node = 0.0, edge.u
            for d in sorted(set(inner)):
                piece = substring(edge.line, start, d)
                node = node_of(piece.coords[-1])
                self.add(start_node, node, edge.segment_id, piece)
                nodes[d] = node
                start, start_node = d, node
            self.add(start_node, edge.v, edge.segment_id, substring(edge.line, start, edge.length))
        return [nodes[d] for d in distances]


def build_graph(lines: list[tuple[str, LineString]], connect_gap_m: float) -> Graph:
    """Graph from (segment id, line) pairs. A dead end within connect_gap_m of another street is joined
    to it, and only the largest connected part is kept, so every snapped point can reach every other."""
    g = Graph()
    for seg_id, line in lines:
        u, v = node_of(line.coords[0]), node_of(line.coords[-1])
        if u != v:
            g.add(u, v, seg_id, line)
    if connect_gap_m > 0:
        _close_gaps(g, connect_gap_m)
    return _largest_part(g)


def _close_gaps(g: Graph, gap_m: float) -> None:
    originals = list(g.edges.values())
    if not originals:
        return
    tree = STRtree([e.line for e in originals])
    joints: dict[int, list[tuple[float, tuple]]] = {}
    for node in sorted(n for n, ids in g.adj.items() if len(ids) == 1):
        p = Point(node)
        best = None
        for i in tree.query(p.buffer(gap_m)):
            e = originals[int(i)]
            if node in (e.u, e.v):
                continue
            d = e.line.distance(p)
            if d <= gap_m and (best is None or (d, e.id) < (best[0], best[1].id)):
                best = (d, e)
        if best is not None:
            joints.setdefault(best[1].id, []).append((best[1].line.project(p), node))
    for edge_id in sorted(joints):
        pairs = joints[edge_id]
        cut_nodes = g.cut(g.edges[edge_id], [d for d, _ in pairs])
        for (_, dead_end), joint in zip(pairs, cut_nodes):
            if joint != dead_end:
                g.add(dead_end, joint, None, LineString([dead_end, joint]))


def _largest_part(g: Graph) -> Graph:
    seen: set = set()
    best: set = set()
    for start in sorted(g.adj):
        if start in seen:
            continue
        part, stack = {start}, [start]
        while stack:
            n = stack.pop()
            for i in g.adj[n]:
                e = g.edges[i]
                o = e.v if e.u == n else e.u
                if o not in part:
                    part.add(o)
                    stack.append(o)
        seen |= part
        if len(part) > len(best):
            best = part
    for e in list(g.edges.values()):
        if e.u not in best:
            g.remove(e)
    for n in [n for n, ids in g.adj.items() if not ids]:
        del g.adj[n]
    return g


def snap(g: Graph, xy: tuple[float, float], max_m: float) -> tuple | None:
    """Node on the nearest street (cutting it there), or None if no street is within max_m."""
    p = Point(xy)
    best = None
    for e in g.edges.values():
        if e.segment_id is None:
            continue
        d = e.line.distance(p)
        if d <= max_m and (best is None or (d, e.id) < (best[0], best[1].id)):
            best = (d, e)
    if best is None:
        return None
    return g.cut(best[1], [best[1].line.project(p)])[0]


def shortest_path(g: Graph, a: tuple, b: tuple, weight=None) -> Path | None:
    """Dijkstra. weight(edge) defaults to its length. Ties go to the smaller node, so it is deterministic."""
    weight = weight or (lambda e: e.length)
    dist = {a: 0.0}
    back: dict[tuple, tuple[Edge, bool, tuple]] = {}
    heap = [(0.0, a)]
    done: set = set()
    while heap:
        d, n = heapq.heappop(heap)
        if n in done:
            continue
        done.add(n)
        if n == b:
            break
        for i in g.adj.get(n, []):
            e = g.edges[i]
            forward = e.u == n
            o = e.v if forward else e.u
            nd = d + weight(e)
            if nd < dist.get(o, float("inf")) - 1e-9:
                dist[o] = nd
                back[o] = (e, forward, n)
                heapq.heappush(heap, (nd, o))
    if b not in done:
        return None
    steps = []
    n = b
    while n != a:
        e, forward, prev = back[n]
        steps.append((e, forward))
        n = prev
    steps.reverse()
    return Path(steps, sum(e.length for e, _ in steps))


def alternatives(g: Graph, a: tuple, b: tuple, shortest: Path, max_ratio: float, tries: int, penalty: float) -> list[Path]:
    """Different ways at most max_ratio x the shortest, shortest first (always starting with it): each
    try makes the streets already used longer by a factor, so the next way avoids them if it can."""
    found = [shortest]
    factor: dict[int, float] = {}
    for i in shortest.edge_ids:
        factor[i] = penalty
    limit = shortest.length * max_ratio
    for _ in range(tries):
        path = shortest_path(g, a, b, lambda e: e.length * factor.get(e.id, 1.0))
        if path is None:
            break
        if path.length <= limit and all(path.edge_ids != p.edge_ids for p in found):
            found.append(path)
        for i in path.edge_ids:
            factor[i] = factor.get(i, 1.0) * penalty
    return sorted(found, key=lambda p: (p.length, sorted(p.edge_ids)))


def shares(path: Path, state_of) -> dict[str, float]:
    """Share of the path's length in each state: easy, mixed, hard and none (no value, or a connector)."""
    metres = {"easy": 0.0, "mixed": 0.0, "hard": 0.0, "none": 0.0}
    for e, _ in path.steps:
        metres[(state_of(e.segment_id) if e.segment_id else None) or "none"] += e.length
    total = path.length or 1.0
    return {k: v / total for k, v in metres.items()}


def different_share(path: Path, other: Path) -> float:
    """Share of path's length that is not on the other path."""
    theirs = other.edge_ids
    return sum(e.length for e, _ in path.steps if e.id not in theirs) / (path.length or 1.0)


def find_b(g: Graph, a: tuple, b: tuple, route_a: Path, state_of, cfg: dict) -> tuple[Path | None, str]:
    """B and its kind: "easiest" if a way at most length_ratio longer is easier than A, else "second"
    (the next shortest that really differs from A), else (None, "none"): there is only one way."""
    limit = route_a.length * cfg["length_ratio"]
    others = alternatives(g, a, b, route_a, cfg["length_ratio"], cfg["candidates"], cfg["candidate_penalty"])
    pool = list(others)
    mixed_weight = cfg["mixed_weight"]

    def weighted(lam):
        def w(e):
            state = state_of(e.segment_id) if e.segment_id else None
            if state == "hard":
                return e.length * (1 + lam)
            return e.length * (1 + lam * mixed_weight) if state != "easy" else e.length
        return w

    for lam in cfg["easiest_weights"]:
        path = shortest_path(g, a, b, weighted(lam))
        if path is not None and path.length <= limit:
            pool.append(path)

    def rank(p):
        s = shares(p, state_of)
        # Rounded, so a tiny difference does not outweigh walking further.
        return round(s["hard"], 3), round(s["mixed"] + s["none"], 3), round(p.length, 1), sorted(p.edge_ids)

    best = min(pool, key=rank)
    if best.edge_ids != route_a.edge_ids and rank(best)[:2] < rank(route_a)[:2]:
        return best, "easiest"
    for p in others:
        if p.edge_ids != route_a.edge_ids and different_share(p, route_a) >= cfg["min_difference_share"]:
            return p, "second"
    return None, "none"


def parts(path: Path) -> list[dict]:
    """The path in walking order, one part per segment: {"segment_id", "xy" [(x, y)], "length_m"}.
    A segment cut by a snapped point or a joint is joined again; a connector is a part with no segment."""
    out: list[dict] = []
    for e, forward in path.steps:
        coords = list(e.line.coords) if forward else list(e.line.coords)[::-1]
        if out and out[-1]["segment_id"] == e.segment_id:
            out[-1]["xy"].extend(coords[1:])
            out[-1]["length_m"] += e.length
        else:
            out.append({"segment_id": e.segment_id, "xy": coords, "length_m": e.length})
    return out
