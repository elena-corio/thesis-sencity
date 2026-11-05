"""Infrared.city thermal comfort (UTCI) for one circle and one window (brief §5).

Billed: one job per 512 m tile, so preview_area counts the jobs first and a run over
thermal.max_jobs is refused before anything is sent. The key is read from INFRARED_API_KEY on
the server only. Buildings, trees and ground materials come from the SDK's public data for the
polygon; weather from the nearest public station, filtered to one hour of one typical day.
"""
import logging
import math
import time as clock
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

import numpy as np

from tool.config import get_key

log = logging.getLogger("sencity.thermal")


class ThermalError(Exception):
    """A thermal run that cannot be done; the message is safe to show in the app."""


def window(season: str, time: str, cfg: dict) -> tuple[int, int, int]:
    """(month, day, hour) of a season and "HH:00" time."""
    day = cfg["thermal"]["seasons"][season]
    return day["month"], day["day"], int(time.split(":")[0])


def km_between(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def optional(future, label: str, limit_s: float, started: float):
    """The result of an optional input, or None if it failed or is not ready by the time limit."""
    try:
        return future.result(timeout=max(0.0, limit_s - (clock.monotonic() - started)))
    except FutureTimeout:
        log.warning("%s skipped: not ready after %.0f s", label, limit_s)
    except Exception as e:  # noqa: BLE001 (any failure of an optional input)
        log.warning("%s unavailable: %s", label, type(e).__name__)
    return None


def count_jobs(polygon: dict, cfg: dict) -> int:
    """How many tiles a run on this polygon would bill. Free: preview_area runs no analysis."""
    from infrared_sdk import InfraredClient

    try:
        client = InfraredClient(api_key=get_key("INFRARED_API_KEY"), base_url="https://api.infrared.city/v2")
    except SystemExit:
        raise ThermalError("Thermal comfort is not set up on the server.") from None
    return client.preview_area(polygon, analysis_type=cfg["thermal"]["analysis"]).would_bill_jobs


def count_jobs(polygon: dict, cfg: dict) -> int:
    """How many tiles a run on this polygon would bill. Free: preview_area runs no analysis."""
    from infrared_sdk import InfraredClient

    try:
        client = InfraredClient(api_key=get_key("INFRARED_API_KEY"), base_url="https://api.infrared.city/v2")
    except SystemExit:
        raise ThermalError("Thermal comfort is not set up on the server.") from None
    return client.preview_area(polygon, analysis_type=cfg["thermal"]["analysis"]).would_bill_jobs


def run_utci(polygon: dict, lat: float, lon: float, season: str, time: str, cfg: dict) -> dict:
    """UTCI grid for the polygon (lon/lat GeoJSON). Returns {"grid": float32 array (row 0 south,
    NaN = no value), "bounds": (min_lon, min_lat, max_lon, max_lat), "station": {...}, "jobs": n}."""
    from infrared_sdk import InfraredClient
    from infrared_sdk.analyses.types import AnalysesName, UtciModelBaseRequest, UtciModelRequest
    from infrared_sdk.models import Location, TimePeriod

    t = cfg["thermal"]
    try:
        client = InfraredClient(api_key=get_key("INFRARED_API_KEY"), base_url="https://api.infrared.city/v2")
    except SystemExit:
        raise ThermalError("Thermal comfort is not set up on the server.") from None

    jobs = client.preview_area(polygon, analysis_type=t["analysis"]).would_bill_jobs
    if jobs > t["max_jobs"]:
        raise ThermalError(f"This area needs {jobs} thermal runs; the limit is {t['max_jobs']}.")

    stations = client.weather.get_weather_file_from_location(lat=lat, lon=lon, radius=t["station_radius_km"])
    if not stations:
        raise ThermalError("No weather station near this area, so thermal comfort is not available here.")
    st = stations[0]
    loc = st.get("location_data", {})
    # Catalog names use dots for spaces ("Wien-Innere.Stadt").
    station = {"name": (loc.get("city") or st.get("fileName", "")).replace(".", " "),
               "distance_km": round(km_between(lat, lon, loc["latitude"], loc["longitude"]), 1)
               if "latitude" in loc else None}

    month, day, hour = window(season, time, cfg)
    period = TimePeriod(start_month=month, start_day=day, start_hour=hour,
                        end_month=month, end_day=day, end_hour=hour)
    weather = client.weather.filter_weather_data(identifier=st["uuid"], time_period=period)

    # Buildings, trees and ground materials are read at the same time. Trees and ground improve the
    # result but are optional: the ground read can hang for minutes, so each gets a short time limit
    # and the run goes ahead without it.
    started = clock.monotonic()
    limit = t["optional_input_timeout_s"]
    pool = ThreadPoolExecutor(max_workers=3)
    try:
        f_buildings = pool.submit(client.buildings.get_area, polygon, analysis_type=t["analysis"])
        f_vegetation = pool.submit(client.vegetation.get_area, polygon, analysis_type=t["analysis"],
                                   timeout=limit, total_timeout=limit)
        f_ground = pool.submit(client.ground_materials.get_area, polygon, analysis_type=t["analysis"],
                               timeout=limit, total_timeout=limit)
        buildings = f_buildings.result()
        vegetation = optional(f_vegetation, "vegetation", limit, started)
        ground = optional(f_ground, "ground materials", limit, started)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    log.info("thermal inputs read in %.0f s", clock.monotonic() - started)

    payload = UtciModelRequest.from_weatherfile_payload(
        payload=UtciModelBaseRequest(analysis_type=AnalysesName.thermal_comfort_index),
        location=Location(latitude=lat, longitude=lon),
        time_period=period,
        weather_data=weather,
    )
    started = clock.monotonic()
    result = client.run_area_and_wait(payload, polygon, buildings=buildings, vegetation=vegetation,
                                      ground_materials=ground)
    log.info("thermal run: %d of %d jobs succeeded in %.0f s", result.succeeded_jobs, result.total_jobs,
             clock.monotonic() - started)
    if result.bounds is None or not result.succeeded_jobs:
        raise ThermalError("Thermal comfort could not be computed for this area.")
    return {"grid": result.physical_grid(dtype=np.float32), "bounds": tuple(result.bounds),
            "station": station, "jobs": result.total_jobs}
