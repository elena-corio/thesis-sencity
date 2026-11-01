"""Write review.html for a run. The page holds no API key and no images: photos load
through tool.review_server (/image), and keep/reject toggles post to /notes."""
import csv
import json
from pathlib import Path

TEMPLATE = Path(__file__).with_name("review_template.html")


def write_review_html(run_dir: Path, summary: dict) -> None:
    with open(run_dir / "photos.csv", encoding="utf-8") as f:
        photos = list(csv.DictReader(f))
    segments = json.loads((run_dir / "segments.geojson").read_text(encoding="utf-8"))
    data = {"summary": summary, "segments": segments, "photos": photos}
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = TEMPLATE.read_text(encoding="utf-8").replace("/*__DATA__*/null", payload)
    (run_dir / "review.html").write_text(html, encoding="utf-8")
