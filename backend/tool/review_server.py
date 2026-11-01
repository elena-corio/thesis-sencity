"""Local server for review.html: proxies Street View images on demand (the key stays here,
nothing is saved) and writes keep/reject notes to review_notes.csv.

    python -m tool.review_server                      # latest run
    python -m tool.review_server --run <run folder name>
"""
import argparse
import csv
import threading
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from .config import REPO_ROOT, load_config
from .photos.provider import get_provider

NOTE_FIELDS = ["segment_id", "pano_id", "heading", "pipeline_status", "pipeline_reason", "verdict", "note", "updated_at"]


class Note(BaseModel):
    segment_id: str
    pano_id: str
    heading: str | float
    pipeline_status: str = ""
    pipeline_reason: str = ""
    verdict: str = ""
    note: str = ""


def create_app(run_dir: Path, cfg: dict) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None)
    provider = get_provider(cfg)
    lock = threading.Lock()
    notes_path = run_dir / "review_notes.csv"
    log_path = run_dir / "run.log"
    with open(run_dir / "photos.csv", encoding="utf-8") as f:
        allowed = {(r["pano_id"], str(float(r["heading"]))) for r in csv.DictReader(f)}

    def read_notes() -> dict:
        if not notes_path.exists():
            return {}
        with open(notes_path, encoding="utf-8") as f:
            return {(r["segment_id"], r["pano_id"], str(float(r["heading"]))): r for r in csv.DictReader(f)}

    @app.get("/")
    def page():
        return FileResponse(run_dir / "review.html", headers={"Cache-Control": "no-store"})

    @app.get("/image")
    def image(pano: str, heading: float):
        # Only photos of this run can be fetched, so the endpoint cannot be used for anything else.
        if (pano, str(float(heading))) not in allowed:
            raise HTTPException(404, "not a photo of this run")
        try:
            content = provider.fetch_image(pano, heading)
        except Exception as e:  # noqa: BLE001 - shown in the page as a broken image
            raise HTTPException(502, f"Street View error: {type(e).__name__}") from None
        with lock, open(log_path, "a", encoding="utf-8") as f:
            n = provider.image_calls
            f.write(f"review_server image call {n} (session est. ${provider.estimated_cost_usd(n):.3f})\n")
        print(f"image calls this session: {provider.image_calls} (est. ${provider.estimated_cost_usd(provider.image_calls):.3f})")
        return Response(content, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.get("/notes")
    def get_notes():
        return list(read_notes().values())

    @app.post("/notes")
    def post_note(note: Note):
        row = note.model_dump()
        row["heading"] = str(float(row["heading"]))
        row["updated_at"] = datetime.now().isoformat(timespec="seconds")
        with lock:
            notes = read_notes()
            notes[(row["segment_id"], row["pano_id"], row["heading"])] = row
            with open(notes_path, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=NOTE_FIELDS)
                w.writeheader()
                w.writerows(sorted(notes.values(), key=lambda r: (r["segment_id"], r["pano_id"], r["heading"])))
        return {"ok": True}

    return app


def main():
    cfg = load_config()
    p = argparse.ArgumentParser(prog="python -m tool.review_server")
    p.add_argument("--run", help="run folder name in runs/photos (default: the latest)")
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    runs = REPO_ROOT / cfg["runs"]["dir"]
    if args.run:
        run_dir = runs / args.run
    else:
        done = sorted((d for d in runs.glob("*") if (d / "review.html").exists()), key=lambda d: d.stat().st_mtime)
        if not done:
            raise SystemExit(f"No run found in {runs}. Run python -m tool.fetch_photos first.")
        run_dir = done[-1]
    if not (run_dir / "review.html").exists():
        raise SystemExit(f"{run_dir} has no review.html.")
    print(f"Reviewing {run_dir.name}\nOpen http://127.0.0.1:{args.port}/  (Ctrl+C to stop)")
    uvicorn.run(create_app(run_dir, cfg), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
