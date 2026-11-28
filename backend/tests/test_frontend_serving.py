"""The built frontend served by the API (app/main.py, `frontend`): files as themselves with their type, any other path
the app's page. MapLibre's worker is an .mjs file: sent as anything but JavaScript, the browser refuses it and the map
stays blank (the first Render deploy, 2026-11-28)."""
from fastapi.testclient import TestClient

from app import main as main_mod


def test_files_keep_their_type_and_other_paths_get_the_app(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>SenCity</title>", encoding="utf-8")
    (tmp_path / "assets" / "maplibre-gl-worker-abc.mjs").write_text("self.onmessage=()=>{}", encoding="utf-8")
    (tmp_path / "assets" / "index-abc.js").write_text("console.log(1)", encoding="utf-8")
    monkeypatch.setattr(main_mod, "DIST", tmp_path)
    c = TestClient(main_mod.app)
    worker = c.get("/assets/maplibre-gl-worker-abc.mjs")
    assert worker.status_code == 200 and worker.headers["content-type"].startswith("text/javascript")
    assert c.get("/assets/index-abc.js").headers["content-type"].startswith("text/javascript")
    page = c.get("/area")
    assert page.headers["content-type"].startswith("text/html") and "SenCity" in page.text
    assert c.get("/api/nothing-here").status_code == 404  # never the app's page for an API path
