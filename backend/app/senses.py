"""Senses mode: a general prediction for one street photo (no profile).

model/app_v0/ (exported from the thesis repo) is the only source of the instructions, schemas, labels and model
settings. It is read again on every request, so replacing the folder changes the setting without a code change or
a restart. If a file is missing, broken or unsafe the request stops with ExportError: there are no defaults.

Images stay in memory: they are never written to disk, cached or logged. Only the model's JSON output, the model ID,
latency and cost are kept, in a git-ignored file, per pano ID + heading + the export's commit.
"""
import base64
import io
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import requests
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError
from PIL import Image, UnidentifiedImageError

from tool.config import REPO_ROOT, get_key

EXPORT_DIR = REPO_ROOT / "model" / "app_v0"
log = logging.getLogger("sencity.api")

# What this app needs from model.json. A file that breaks a privacy rule is refused, whatever else it says.
MODEL_RULES = {
    "type": "object",
    "required": ["model", "provider", "temperature", "max_tokens", "reasoning", "input", "reasoning_position",
                 "response_format", "image"],
    "properties": {
        "model": {"type": "string", "minLength": 1, "not": {"pattern": ":free$"}},
        "provider": {
            "type": "object",
            "required": ["zdr", "data_collection", "allow_fallbacks", "only"],
            "properties": {"zdr": {"const": True}, "data_collection": {"const": "deny"}, "allow_fallbacks": {"const": False},
                           "only": {"type": "array", "minItems": 1, "items": {"type": "string"}}},
        },
        "temperature": {"type": "number"},
        "max_tokens": {"type": "integer", "minimum": 1},
        "reasoning": {"type": ["object", "null"]},
        "input": {"type": "string"},
        "reasoning_position": {"enum": ["before", "after"]},
        "response_format": {
            "type": "object",
            "required": ["type", "name", "strict"],
            "properties": {"type": {"const": "json_schema"}, "name": {"type": "string"}, "strict": {"const": True}},
        },
        "image": {
            "type": "object",
            "required": ["format", "mime_type", "encoding", "quality", "max_px"],
            "properties": {"format": {"type": "string"}, "mime_type": {"type": "string"},
                           "encoding": {"const": "base64 data URL"}, "quality": {"type": "integer"},
                           "max_px": {"type": "integer", "minimum": 1}},
        },
    },
}
ELEMENT_RULES = {
    "type": "array",
    "minItems": 1,
    "items": {"type": "object", "required": ["code", "en", "it", "sense", "kind"]},
}
OUTPUT_FIELDS = ("B1_comfort", "B2_bothers", "B3_feels_good", "reasoning")


class ExportError(Exception):
    """model/app_v0/ cannot be used. The message says which file and why."""


class PredictionError(Exception):
    """The prediction failed. The message is shown to the person as it is."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class Export:
    system: str
    schema: dict
    validator: Draft202012Validator
    elements: dict  # code → the element as in elements.json
    model: dict
    commit: str


def _text(folder: Path, name: str) -> str:
    try:
        text = (folder / name).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        raise ExportError(f"model/{folder.name}/{name} is missing or cannot be read.") from None
    if not text.strip():
        raise ExportError(f"model/{folder.name}/{name} is empty.")
    return text


def _json(folder: Path, name: str):
    try:
        return json.loads(_text(folder, name))
    except json.JSONDecodeError as e:
        raise ExportError(f"model/{folder.name}/{name} does not parse: {e.msg} (line {e.lineno}).") from None


def _check(data, rules: dict, label: str) -> None:
    error = next(Draft202012Validator(rules).iter_errors(data), None)
    if error is not None:
        where = "/".join(str(p) for p in error.absolute_path) or "top level"
        raise ExportError(f"{label}: {where}: {error.message}")


def load_export(folder: Path = EXPORT_DIR) -> Export:
    """Read and check the whole folder. Raises ExportError on the first problem."""
    system = _text(folder, "system_instructions.txt")
    schema = _json(folder, "schema.json")
    validate = _json(folder, "schema_validate.json")
    elements = _json(folder, "elements.json")
    model = _json(folder, "model.json")
    manifest = _text(folder, "MANIFEST.md")

    _check(model, MODEL_RULES, "model.json")
    _check(elements, ELEMENT_RULES, "elements.json")
    # The only input the folder can serve: the descriptions and their prompt are not part of the export.
    if model["input"] != "photo":
        raise ExportError(f"model.json asks for input \"{model['input']}\", but the export only has what is needed for "
                          "\"photo\": there is no describer model or prompt in it, so the app cannot build this request.")
    commit = re.search(r"^- Source commit:\s*([0-9a-f]{7,40})\s*$", manifest, re.M)
    if commit is None:
        raise ExportError("MANIFEST.md has no \"- Source commit: <hash>\" line.")

    by_code = {e["code"]: e for e in elements}
    position = 0 if model["reasoning_position"] == "before" else -1
    for name, s in (("schema.json", schema), ("schema_validate.json", validate)):
        try:
            Draft202012Validator.check_schema(s)
            props = list(s["properties"])
            codes = [*s["properties"]["B2_bothers"]["items"]["enum"], *s["properties"]["B3_feels_good"]["items"]["enum"]]
        except (SchemaError, KeyError, TypeError) as e:
            raise ExportError(f"{name} is not the expected answer schema ({type(e).__name__}).") from None
        if sorted(props) != sorted(OUTPUT_FIELDS):
            raise ExportError(f"{name} must have exactly these fields: {', '.join(OUTPUT_FIELDS)}.")
        # The reasoning order is the order of the properties in the schema: it is sent as it is in the file.
        if props[position] != "reasoning":
            raise ExportError(f"{name} does not match reasoning_position \"{model['reasoning_position']}\" in model.json.")
        missing = sorted(set(codes) - set(by_code))
        if missing:
            raise ExportError(f"elements.json has no label for: {', '.join(missing)}.")
    return Export(system, schema, Draft202012Validator(validate), by_code, model, commit.group(1))


def encode_image(data: bytes, image: dict) -> str:
    """The rule in model.json, in memory: an existing JPEG that already fits is sent unchanged; anything else is
    converted to RGB, scaled to fit and saved in the format and quality given."""
    try:
        with Image.open(io.BytesIO(data)) as pic:
            pic.load()
            if pic.format == image["format"] and max(pic.size) <= image["max_px"]:
                out = data
            else:
                rgb = pic.convert("RGB")
                rgb.thumbnail((image["max_px"], image["max_px"]))
                buffer = io.BytesIO()
                rgb.save(buffer, format=image["format"], quality=image["quality"])
                out = buffer.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise PredictionError(400, "What was sent is not a picture the model can read.") from None
    return f"data:{image['mime_type']};base64," + base64.b64encode(out).decode("ascii")


def build_request(export: Export, data_url: str) -> dict:
    """The OpenRouter request, exactly as model.json says. The image is the only user content."""
    m = export.model
    fmt = m["response_format"]
    body = {
        "model": m["model"],
        "provider": m["provider"],
        "temperature": m["temperature"],
        "max_tokens": m["max_tokens"],
        "messages": [
            {"role": "system", "content": export.system},
            {"role": "user", "content": [{"type": "image_url", "image_url": {"url": data_url}}]},
        ],
        "response_format": {"type": fmt["type"], "json_schema": {"name": fmt["name"], "strict": fmt["strict"],
                                                                 "schema": export.schema}},
        "usage": {"include": True},
    }
    if m["reasoning"] is not None:
        body["reasoning"] = m["reasoning"]
    return body


def _short(text, limit: int = 200) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def problem_with(export: Export, output) -> str | None:
    """Why an answer breaks schema_validate.json, or None when it is valid."""
    error = next(export.validator.iter_errors(output), None)
    return None if error is None else error.message


def parse_reply(export: Export, text) -> tuple[dict | None, str | None]:
    """(the answer, None), or (None, what is wrong with it)."""
    try:
        output = json.loads(text)
    except (TypeError, ValueError):
        return None, "not JSON"
    problem = problem_with(export, output)
    return (None, problem) if problem else (output, None)


def post_openrouter(body: dict, key: str, cfg: dict) -> dict:
    """One call. The answer as a dict, or PredictionError. The key and the body are never logged."""
    try:
        resp = requests.post(cfg["url"], json=body, headers={"Authorization": f"Bearer {key}"}, timeout=cfg["timeout_s"])
    except requests.Timeout:
        raise PredictionError(504, "The model took too long to answer.") from None
    except requests.RequestException as e:
        log.warning("senses: model call failed: %s", type(e).__name__)
        raise PredictionError(502, "Could not reach OpenRouter.") from None
    try:
        data = resp.json()
    except ValueError:
        data = None
    error = data.get("error") if isinstance(data, dict) else None
    if resp.status_code != 200 or error or not isinstance(data, dict):
        log.warning("senses: OpenRouter answered %s", resp.status_code)
        detail = error.get("message") if isinstance(error, dict) else error
        raise PredictionError(502, f"OpenRouter refused the request ({resp.status_code}). {_short(detail)}".strip())
    return data


def _reply_text(data: dict):
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None


# Cache: one JSON file, {key: {output, model, latency_ms, cost_usd}}. The key holds the commit, so results
# of another export are never found.
_cache_lock = threading.Lock()


def cache_key(pano_id: str, heading: float, commit: str) -> str:
    return f"{pano_id}|{round(heading, 1)}|{commit}"


def _read_cache(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_cache(path: Path, key: str, entry: dict) -> None:
    with _cache_lock:
        data = _read_cache(path)
        data[key] = entry
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, path)
        except OSError as e:  # the prediction is still good: it is only not kept
            log.warning("senses: cache not written: %s", type(e).__name__)


def _view(export: Export, entry: dict, cached: bool) -> dict:
    output = entry["output"]
    return {
        "comfort": output["B1_comfort"],
        "bothers": [export.elements[c] for c in output["B2_bothers"]],
        "feels_good": [export.elements[c] for c in output["B3_feels_good"]],
        "reason": output["reasoning"],
        "model": entry["model"],
        "latency_ms": entry["latency_ms"],
        "cost_usd": entry["cost_usd"],
        "cached": cached,
    }


def _api_key() -> str:
    try:
        return get_key("OPENROUTER_API_KEY")
    except SystemExit:
        raise PredictionError(503, "The model is not set up on the server: add OPENROUTER_API_KEY to .env.") from None


def predict(image: bytes, pano_id: str, heading: float, cfg: dict, allowed) -> dict:
    """The prediction for one picture, from the cache or the model. allowed() is asked only before a paid call."""
    export = load_export()
    path = REPO_ROOT / cfg["cache_file"]
    key = cache_key(pano_id, heading, export.commit)
    with _cache_lock:
        hit = _read_cache(path).get(key)
    if isinstance(hit, dict) and problem_with(export, hit.get("output")) is None:
        return _view(export, hit, cached=True)
    if not allowed():
        raise PredictionError(429, "Too many new predictions in a short time. Wait a moment, then retry.")

    api_key = _api_key()
    body = build_request(export, encode_image(image, export.model["image"]))
    started = time.perf_counter()
    costs, text = [], None
    for _ in range(2):  # one retry, only for an invalid reply; an API error stops at once
        data = post_openrouter(body, api_key, cfg)
        costs += [c for c in [(data.get("usage") or {}).get("cost")] if c is not None]
        text = _reply_text(data)
        output, _problem = parse_reply(export, text)
        if output is not None:
            entry = {"output": output, "model": export.model["model"],
                     "latency_ms": round((time.perf_counter() - started) * 1000),
                     "cost_usd": sum(costs) if costs else None}
            _save_cache(path, key, entry)
            return _view(export, entry, cached=False)
    log.warning("senses: invalid reply after the retry")
    raise PredictionError(502, f"The model's answer was not valid, twice, so nothing is shown. It said: \"{_short(text)}\"")
