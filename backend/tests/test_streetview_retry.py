"""Street View metadata: a temporary error (UNKNOWN_ERROR, OVER_QUERY_LIMIT) is asked again. A point that keeps answering
UNKNOWN_ERROR has no photo; a lasting OVER_QUERY_LIMIT, or a refused key, stops the run."""
import pytest

from tool.photos import streetview


class FakeResponse:
    def __init__(self, data):
        self.data = data
        self.status_code = 200

    def json(self):
        return self.data


OK = {"status": "OK", "pano_id": "abc", "location": {"lat": 48.2, "lng": 16.37}, "date": "2024-06", "copyright": "© Google"}


def provider(monkeypatch, answers):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")
    monkeypatch.setattr(streetview, "RETRY_WAITS_S", (0, 0, 0))
    p = streetview.StreetViewProvider({"streetview": {
        "metadata_url": "https://example/metadata", "image_url": "https://example/image", "metadata_radius_m": 15,
        "source": "outdoor", "official_copyright": "^© (\d{4} )?Google$", "request_timeout_s": 5}})
    seq = iter(answers)
    monkeypatch.setattr(p, "_get", lambda url, params: FakeResponse(next(seq)))
    return p


def test_a_temporary_error_is_asked_again(monkeypatch):
    p = provider(monkeypatch, [{"status": "UNKNOWN_ERROR"}, {"status": "OVER_QUERY_LIMIT"}, OK])
    assert p.search(48.2, 16.37).photo_id == "abc"
    assert p.metadata_calls == 3


def test_a_point_that_keeps_failing_has_no_photo(monkeypatch):
    p = provider(monkeypatch, [{"status": "UNKNOWN_ERROR"}] * 4)
    assert p.search(48.2, 16.37) is None
    assert p.metadata_calls == 4


def test_a_lasting_quota_error_stops(monkeypatch):
    p = provider(monkeypatch, [{"status": "OVER_QUERY_LIMIT"}] * 4)
    with pytest.raises(SystemExit, match="OVER_QUERY_LIMIT"):
        p.search(48.2, 16.37)


def test_a_refused_key_stops_at_once(monkeypatch):
    p = provider(monkeypatch, [{"status": "REQUEST_DENIED", "error_message": "The provided API key is invalid."}])
    with pytest.raises(SystemExit, match="REQUEST_DENIED"):
        p.search(48.2, 16.37)
    assert p.metadata_calls == 1
