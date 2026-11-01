"""Google Street View: free metadata endpoint + Street View Static API (paid, per image).
Only pano IDs, location, date and heading are stored, never image files (Google terms)."""
import re
import threading
import time

import requests

from ..config import get_key
from .provider import PhotoMeta, PhotoProvider


class StreetViewProvider(PhotoProvider):
    def __init__(self, cfg: dict):
        self.cfg = cfg["streetview"]
        self.key = get_key("GOOGLE_MAPS_API_KEY")
        self.session = requests.Session()
        self.metadata_calls = 0
        self.image_calls = 0
        self._count_lock = threading.Lock()  # the API looks up segments in parallel
        self._official = re.compile(self.cfg["official_copyright"])

    def is_official(self, copyright_: str) -> bool:
        return bool(self._official.match(copyright_.strip()))

    def _get(self, url: str, params: dict) -> requests.Response:
        for attempt in range(3):
            try:
                resp = self.session.get(url, params={**params, "key": self.key},
                                        timeout=self.cfg["request_timeout_s"])
                if resp.status_code < 500:
                    return resp
            except requests.RequestException:
                if attempt == 2:
                    raise
            time.sleep(1 + attempt)
        return resp

    def search(self, lat: float, lon: float, radius_m: float | None = None) -> PhotoMeta | None:
        with self._count_lock:
            self.metadata_calls += 1
        resp = self._get(self.cfg["metadata_url"], {
            "location": f"{lat:.7f},{lon:.7f}",
            "radius": radius_m or self.cfg["metadata_radius_m"],
            "source": self.cfg["source"],
        })
        data = resp.json()
        status = data.get("status")
        if status == "ZERO_RESULTS" or status == "NOT_FOUND":
            return None
        if status != "OK":
            # REQUEST_DENIED, OVER_QUERY_LIMIT, ...: stop, the run would be wrong.
            raise SystemExit(f"Street View metadata error: {status} {data.get('error_message', '')}")
        copyright_ = data.get("copyright", "")
        return PhotoMeta(
            photo_id=data["pano_id"],
            lat=data["location"]["lat"],
            lon=data["location"]["lng"],
            date=data.get("date") or None,
            official=self.is_official(copyright_),
            copyright=copyright_,
        )

    def fetch_image(self, photo_id: str, heading: float) -> bytes:
        with self._count_lock:
            self.image_calls += 1
        resp = self._get(self.cfg["image_url"], {
            "pano": photo_id,
            "heading": f"{heading:.1f}",
            "size": self.cfg["size"],
            "fov": self.cfg["fov"],
            "pitch": self.cfg["pitch"],
            "return_error_code": "true",
        })
        resp.raise_for_status()
        return resp.content

    def estimated_cost_usd(self, image_calls: int) -> float:
        return image_calls * self.cfg["price_per_1000_images_usd"] / 1000
