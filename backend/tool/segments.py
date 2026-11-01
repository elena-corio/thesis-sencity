"""Street segments: join OSM ways into chains between intersections, clip to the circle,
cut into ~50 m pieces. Pure functions on local metric coordinates (no API calls)."""
from dataclasses import dataclass, field

from shapely.geometry import LineString, MultiLineString, Polygon
from shapely.ops import linemerge, substring


@dataclass
class Way:
    id: int
    nodes: list[int]
    tags: dict = field(default_factory=dict)


@dataclass
class Chain:
    nodes: list[int]
    way_ids: list[int]


def build_chains(ways: list[Way]) -> list[Chain]:
    """Join ways into chains that run from one intersection (or dead end) to the next.

    A node splits the network when its degree is not 2: three or more streets meet,
    or a street ends. Nodes of degree 2 are joined through, even across OSM way ends,
    so a street split by a tag change stays one piece. Closed loops with no
    intersection become one chain starting at their smallest node id.
    """
    adj: dict[int, set[int]] = {}
    edge_way: dict[frozenset, int] = {}
    for way in sorted(ways, key=lambda w: w.id):
        for a, b in zip(way.nodes, way.nodes[1:]):
            if a == b:
                continue
            adj.setdefault(a, set()).add(b)
            adj.setdefault(b, set()).add(a)
            edge_way.setdefault(frozenset((a, b)), way.id)

    visited: set[frozenset] = set()
    chains: list[Chain] = []

    def walk(start: int, nxt: int) -> Chain:
        path = [start, nxt]
        visited.add(frozenset((start, nxt)))
        prev, cur = start, nxt
        while len(adj[cur]) == 2 and cur != start:
            (step,) = [n for n in adj[cur] if n != prev] or [prev]
            edge = frozenset((cur, step))
            if edge in visited:
                break
            visited.add(edge)
            path.append(step)
            prev, cur = cur, step
        way_ids: list[int] = []
        for a, b in zip(path, path[1:]):
            wid = edge_way[frozenset((a, b))]
            if not way_ids or way_ids[-1] != wid:
                way_ids.append(wid)
        return Chain(path, way_ids)

    for node in sorted(n for n in adj if len(adj[n]) != 2):
        for nb in sorted(adj[node]):
            if frozenset((node, nb)) not in visited:
                chains.append(walk(node, nb))

    # Loops made only of degree-2 nodes.
    for node in sorted(adj):
        for nb in sorted(adj[node]):
            if frozenset((node, nb)) not in visited:
                chains.append(walk(node, nb))
    return chains


def split_line(line: LineString, target_m: float) -> list[LineString]:
    """Cut a line into round(L / target) equal pieces (at least one)."""
    n = max(1, round(line.length / target_m))
    step = line.length / n
    return [substring(line, i * step, (i + 1) * step) for i in range(n)]


@dataclass
class Piece:
    id: str
    line: LineString
    name: str = ""
    osm_ids: list[str] = field(default_factory=list)


def _ends(line: LineString):
    return line.coords[0], line.coords[-1]


def _touch(a: LineString, b: LineString, tol: float) -> bool:
    return any(abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol for p in _ends(a) for q in _ends(b))


def merge_short(pieces: list[Piece], below_m: float, tol: float = 0.01) -> list[Piece]:
    """Merge every piece shorter than below_m into a neighbour that shares an end with it,
    so no gaps appear at junctions. The shortest piece goes first; it joins the neighbour
    with the same street name if there is one, otherwise the longest, then the smallest id.
    A short piece with no neighbour stays as it is."""
    pieces = list(pieces)
    while True:
        short = sorted((p for p in pieces if p.line.length < below_m), key=lambda p: (p.line.length, p.id))
        for s in short:
            nbs = [p for p in pieces if p is not s and _touch(s.line, p.line, tol)]
            if not nbs:
                continue
            nb = min(nbs, key=lambda p: (p.name != s.name or not s.name, -p.line.length, p.id))
            merged = linemerge([_snap(nb.line, s.line, tol), s.line])
            if not isinstance(merged, LineString):
                continue
            nb_index = pieces.index(nb)
            pieces[nb_index] = Piece(nb.id, merged, nb.name or s.name,
                                     nb.osm_ids + [o for o in s.osm_ids if o not in nb.osm_ids])
            pieces.remove(s)
            break
        else:
            return pieces


def _snap(line: LineString, other: LineString, tol: float) -> LineString:
    """Move the end of line that touches other exactly onto it, so linemerge joins them."""
    coords = list(line.coords)
    for i in (0, -1):
        for q in _ends(other):
            if abs(coords[i][0] - q[0]) <= tol and abs(coords[i][1] - q[1]) <= tol:
                coords[i] = q
    return LineString(coords)


def clip_and_split(line: LineString, area: Polygon, target_m: float, min_m: float) -> list[LineString]:
    """Clip a chain to the circle, then cut each inside part into ~target_m pieces.
    Parts shorter than min_m (a line that only grazes the circle edge) are dropped."""
    clipped = line.intersection(area)
    if clipped.is_empty:
        return []
    if isinstance(clipped, LineString):
        parts = [clipped]
    elif isinstance(clipped, MultiLineString):
        parts = list(clipped.geoms)
    else:  # GeometryCollection with points where the line only touches the edge
        parts = [g for g in getattr(clipped, "geoms", []) if isinstance(g, LineString)]
    # Order parts along the original line, so ids are stable.
    parts.sort(key=lambda p: line.project(p.interpolate(0)))
    pieces: list[LineString] = []
    for part in parts:
        if part.length < min_m:
            continue
        pieces.extend(p for p in split_line(part, target_m) if p.length >= min_m)
    return pieces
