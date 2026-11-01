"""Address and place search through Photon (komoot, OpenStreetMap data).

The search text can be someone's own address, so it is never logged or stored:
it is forwarded to Photon and the answer is passed back to the browser.
"""
import requests

USER_AGENT = "SenCity thesis tool (search)"


def label(props: dict) -> tuple[str, str]:
    """Name and a secondary line ("street, district, city, country") from Photon properties."""
    street = " ".join(p for p in (props.get("street"), props.get("housenumber")) if p)
    name = props.get("name") or street or props.get("city") or props.get("country") or "Unnamed place"
    parts = []
    if street and street != name:
        parts.append(street)
    for key in ("district", "city", "country"):
        value = props.get(key)
        if value and value != name and value not in parts:
            parts.append(value)
    return name, ", ".join(parts)


def to_result(feature: dict) -> dict | None:
    geom = feature.get("geometry") or {}
    if geom.get("type") != "Point":
        return None
    lon, lat = geom["coordinates"][:2]
    props = feature.get("properties", {})
    name, detail = label(props)
    result = {"name": name, "detail": detail, "lat": lat, "lon": lon,
              "kind": props.get("osm_value") or props.get("type") or ""}
    # Photon extent: [min lon, max lat, max lon, min lat] → [[west, south], [east, north]]
    extent = props.get("extent")
    if extent and len(extent) == 4:
        result["bbox"] = [[extent[0], extent[3]], [extent[2], extent[1]]]
    return result


def search(query: str, lat: float | None, lon: float | None, cfg: dict) -> list[dict]:
    """Up to `limit` places for a query, ranked toward (lat, lon) when given (the map view)."""
    params = {"q": query, "limit": cfg["limit"]}
    if lat is not None and lon is not None:
        params.update(lat=f"{lat:.5f}", lon=f"{lon:.5f}")
    resp = requests.get(cfg["provider_url"], params=params, timeout=cfg["timeout_s"],
                        headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    results = [to_result(f) for f in resp.json().get("features", [])]
    return [r for r in results if r][: cfg["limit"]]
