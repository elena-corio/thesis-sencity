"""PhotoProvider: one interface for every street photo source (brief §6).
Switching photo_source in config/tool.yaml needs no other code change."""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class PhotoMeta:
    photo_id: str        # Street View: pano ID
    lat: float
    lon: float
    date: str | None     # "YYYY-MM" (Street View gives month precision), None if missing
    official: bool       # False for contributor photospheres
    copyright: str = ""


class PhotoProvider(ABC):
    metadata_calls: int = 0
    image_calls: int = 0

    @abstractmethod
    def search(self, lat: float, lon: float, radius_m: float | None = None) -> PhotoMeta | None:
        """Nearest photo to a point (within radius_m, default from config), or None.
        Counts as one metadata call."""

    @abstractmethod
    def is_official(self, copyright_: str) -> bool:
        """True for the provider's own imagery, False for user uploads."""

    @abstractmethod
    def fetch_image(self, photo_id: str, heading: float) -> bytes:
        """Image bytes for a photo and view heading. Callers must keep them in memory only."""

    @abstractmethod
    def estimated_cost_usd(self, image_calls: int) -> float:
        """Cost of a number of image calls (metadata is free for Street View)."""


def get_provider(cfg: dict) -> PhotoProvider:
    source = cfg["photo_source"]
    if source == "streetview":
        from .streetview import StreetViewProvider
        return StreetViewProvider(cfg)
    raise SystemExit(f"photo_source '{source}' is not implemented yet (only 'streetview').")
