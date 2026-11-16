"""Senses mode: a prediction for one street photo, from the survey v9 export.

model/app_v9/ (exported from the thesis repo) is the only source of the instructions, task text, schemas, labels and
model settings. It is read again on every request, so replacing the folder changes the setting without a code change or
a restart. Every file is first checked against its sha256 in MANIFEST.md; if one differs, is missing, broken or unsafe,
the request stops with ExportError: there are no defaults.

Each new photo takes two calls (Elena, 2026-11-14). The presence call (presence_prompt.txt, presence_schema.json) says
which of the 20 elements are clearly visible; it is cached per photo. The rating call then sends the study's task and
schema with that list. If nothing is listed, B2 takes no items and B2_none must be true. Without a profile the system
message is system_instruction.txt alone: the study's V0. With your sensory profile (app/profile.py) it is the system
instruction, a blank line and the profile: the study's V2. Unlike the study, no person confirms the lists.

Personal ratings are never kept here (Elena, 2026-11-15): the server only relays them. It builds the profile text for
the one call and stores or logs neither the answers, the text nor the result; the browser keeps its own ratings, keyed
by photo, profile version, element list, model and export. For a photo it already has, the browser sends only that
stamp (element list, model, export: nothing personal), and the server answers "keep" when the photo's presence list,
model and export are still the same. This server cache holds only what is not personal: general (V0) ratings and the
presence lists.

The model rates the photo the person sees (Elena, 2026-11-11), from the source in use (app/photos.py, 2026-11-16):
a Street View photo ("sv:<pano ID>", the 640 x 640, 90 degree crop the app shows, a paid image under the daily cap) or a
Mapillary photo (a panorama rendered as the 90 degree view the app shows). The backend fetches each picture itself,
only for photos not in the cache. Images stay in memory: they are never written to disk, cached or logged. Only the
model's JSON output, the listed elements, the model ID, latency and cost are kept, in git-ignored files. Ratings made
before 2026-11-11 from Street View photos (keys with no source) or from the V0 export are marked stale and never used.
"""
import base64
import copy
import hashlib
import io
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import requests
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError
from PIL import Image, UnidentifiedImageError

from tool.config import REPO_ROOT, get_key
from tool.photos.mapillary import NotThisPhoto

from .photos import SV, CapReached

EXPORT_DIR = REPO_ROOT / "model" / "app_v9"
log = logging.getLogger("sencity.api")

# The files the rating reads. Each must be listed in MANIFEST.md with its sha256. Every listed file is checked; the
# profile files are read by app/profile.py.
FILES = ("system_instruction.txt", "task_template.txt", "schema_template.json", "elements.json", "model.json",
         "presence_prompt.txt", "presence_schema.json")
SENSES = ("sight", "hearing", "smell", "touch", "thermal", "balance_movement", "body_awareness", "inner_sensations")

# What this app needs from model.json. A file that breaks a privacy rule is refused, whatever else it says.
MODEL_RULES = {
    "type": "object",
    "required": ["model", "provider", "temperature", "max_tokens", "reasoning", "input", "reasoning_position", "image"],
    "properties": {
        "model": {"type": "string", "minLength": 1, "not": {"pattern": ":free$"}},
        "provider": {
            "type": "object",
            "required": ["zdr", "data_collection", "allow_fallbacks", "only"],
            "properties": {"zdr": {"const": True}, "data_collection": {"const": "deny"}, "allow_fallbacks": {"const": False},
                           "only": {"type": "array", "minItems": 1, "items": {"type": "string"}}},
        },
        "zero_data_retention": {"const": True},
        "allow_fallbacks": {"const": False},
        "temperature": {"type": "number"},
        "max_tokens": {"type": "integer", "minimum": 1},
        "reasoning": {"type": ["object", "null"]},
        "input": {"type": "string"},
        "reasoning_position": {"enum": ["before", "after"]},
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
    "items": {"type": "object", "required": ["code", "n", "en", "it", "icon_key", "definition"],
              "properties": {"code": {"type": "string", "pattern": "^[a-z_]+$"}, "n": {"type": "integer"},
                             "en": {"type": "string", "minLength": 1}, "it": {"type": "string", "minLength": 1},
                             "icon_key": {"enum": list(SENSES)}, "definition": {"type": "string", "minLength": 1},
                             "also": {"type": "array", "items": {"enum": list(SENSES)}}}},
}
TEMPLATE_RULES = {
    "type": "object",
    "required": ["name", "strict", "schema"],
    "properties": {"name": {"type": "string", "minLength": 1}, "strict": {"const": True}, "schema": {"type": "object"}},
}
PRESENCE_RULES = {**TEMPLATE_RULES, "required": [*TEMPLATE_RULES["required"], "temperature"],
                  "properties": {**TEMPLATE_RULES["properties"], "temperature": {"type": "number"}}}
OUTPUT_FIELDS = ("B1_comfort", "B2_marked", "B2_none", "reasoning")
SLOT = "{ELEMENTS}"
BOTHERS = ("unpleasant", "both")
FEELS_GOOD = ("pleasant", "both")
GENERAL = "general"  # the end of every rating key: only general (V0) ratings are cached here
PROFILE_PART = "|profile "  # personal ratings were once cached under this; they are removed (drop_personal)
# How this app puts the request together from the export. A change here makes earlier personal ratings stale (their
# stamp carries it). 2: no trailing newline after the instruction and the task text, as the study (2026-11-15).
PROMPT_VERSION = "2"
CALLS_PER_PHOTO = 2  # presence + rating, for the cost estimate of photos left out by the cap
FATAL_STATUSES = (401, 402, 403, 404)  # key, credit or endpoint: no use trying the next photo


class ExportError(Exception):
    """model/app_v9/ cannot be used. The message says which file and why."""


class PredictionError(Exception):
    """The prediction failed. The message is shown to the person as it is."""

    def __init__(self, status: int, message: str, fatal: bool = False, cost: float = 0.0):
        super().__init__(message)
        self.status = status
        self.message = message
        self.fatal = fatal  # every other photo would fail the same way: stop the run
        self.cost = cost    # what the failed attempts cost


@dataclass(frozen=True)
class Export:
    system: str
    task: str
    anchors: tuple[str, str]  # the words of 1 and of 5, from the B1 line of the task
    template: dict            # schema_template.json: name, strict, schema
    presence_prompt: str
    presence: dict            # presence_schema.json: name, strict, schema, temperature
    elements: dict            # code → the element as in elements.json, in its order (n)
    model: dict
    commit: str
    presence_version: str     # from the hashes of the presence files: a new presence rule is never answered from the cache


def _read(folder: Path, name: str) -> bytes:
    try:
        return (folder / name).read_bytes()
    except OSError:
        raise ExportError(f"model/{folder.name}/{name} is missing or cannot be read.") from None


def _text(folder: Path, name: str, data: bytes | None = None) -> str:
    try:
        text = (_read(folder, name) if data is None else data).decode("utf-8")
    except UnicodeDecodeError:
        raise ExportError(f"model/{folder.name}/{name} is not UTF-8 text.") from None
    if not text.strip():
        raise ExportError(f"model/{folder.name}/{name} is empty.")
    return text


def _json(folder: Path, name: str, data: bytes):
    try:
        return json.loads(_text(folder, name, data))
    except json.JSONDecodeError as e:
        raise ExportError(f"model/{folder.name}/{name} does not parse: {e.msg} (line {e.lineno}).") from None


def _check(data, rules: dict, label: str) -> None:
    error = next(Draft202012Validator(rules).iter_errors(data), None)
    if error is not None:
        where = "/".join(str(p) for p in error.absolute_path) or "top level"
        raise ExportError(f"{label}: {where}: {error.message}")


def verified_files(folder: Path = EXPORT_DIR) -> tuple[dict, str, str]:
    """({name: bytes} for FILES, the source commit, the presence version), after checking every file listed in
    MANIFEST.md against its sha256. Raises ExportError on the first file that differs."""
    manifest = _text(folder, "MANIFEST.md")
    hashes = dict(re.findall(r"^- `([^`]+)`: ([0-9a-f]{64})\s*$", manifest, re.M))
    unlisted = [n for n in FILES if n not in hashes]
    if unlisted:
        raise ExportError(f"MANIFEST.md has no sha256 for: {', '.join(unlisted)}.")
    files = {}
    for name, expected in hashes.items():
        data = _read(folder, name)
        if hashlib.sha256(data).hexdigest() != expected:
            raise ExportError(f"model/{folder.name}/{name} does not match its sha256 in MANIFEST.md. Export the folder "
                              "again from the thesis repo.")
        files[name] = data
    commit = re.search(r"^- Source commit:\s*([0-9a-f]{7,40})\s*$", manifest, re.M)
    if commit is None:
        raise ExportError("MANIFEST.md has no \"- Source commit: <hash>\" line.")
    presence = hashlib.sha256((hashes["presence_prompt.txt"] + hashes["presence_schema.json"]).encode()).hexdigest()
    return files, commit.group(1), presence[:12]


def _codes(schema: dict) -> list:
    return schema["properties"]["B2_marked"]["items"]["properties"]["element"]["enum"]


def load_export(folder: Path = EXPORT_DIR) -> Export:
    """Read and check the whole folder. Raises ExportError on the first problem."""
    files, commit, presence_version = verified_files(folder)
    system = _text(folder, "system_instruction.txt", files["system_instruction.txt"])
    task = _text(folder, "task_template.txt", files["task_template.txt"])
    template = _json(folder, "schema_template.json", files["schema_template.json"])
    elements = _json(folder, "elements.json", files["elements.json"])
    model = _json(folder, "model.json", files["model.json"])
    presence_prompt = _text(folder, "presence_prompt.txt", files["presence_prompt.txt"])
    presence = _json(folder, "presence_schema.json", files["presence_schema.json"])

    _check(model, MODEL_RULES, "model.json")
    _check(elements, ELEMENT_RULES, "elements.json")
    _check(template, TEMPLATE_RULES, "schema_template.json")
    _check(presence, PRESENCE_RULES, "presence_schema.json")
    if model.get("pinned_endpoint", model["provider"]["only"]) != model["provider"]["only"]:
        raise ExportError("model.json: pinned_endpoint and provider.only name different endpoints.")
    # The only input the folder can serve: the descriptions and their prompt are not part of the export.
    if model["input"] != "photo":
        raise ExportError(f"model.json asks for input \"{model['input']}\", but the export only has what is needed for "
                          "\"photo\": there is no describer model or prompt in it, so the app cannot build this request.")
    if task.count(SLOT) != 1:
        raise ExportError(f"task_template.txt must contain \"{SLOT}\" exactly once.")
    anchors = re.search(r"^B1\..*\(1 = (.+?) … 5 = (.+?)\)\s*$", task, re.M)
    if anchors is None:
        raise ExportError("task_template.txt has no B1 line with the scale, \"(1 = … … 5 = …)\".")

    by_code = {e["code"]: e for e in sorted(elements, key=lambda e: e["n"])}
    codes = list(by_code)
    if len(codes) != len(elements):
        raise ExportError("elements.json lists a code twice.")
    schema = template["schema"]
    try:
        Draft202012Validator.check_schema(schema)
        props = list(schema["properties"])
        template_codes = _codes(schema)
    except (SchemaError, KeyError, TypeError) as e:
        raise ExportError(f"schema_template.json is not the expected answer schema ({type(e).__name__}).") from None
    if sorted(props) != sorted(OUTPUT_FIELDS):
        raise ExportError(f"schema_template.json must have exactly these fields: {', '.join(OUTPUT_FIELDS)}.")
    # The reasoning order is the order of the properties in the schema: it is sent as it is in the file.
    if props[0 if model["reasoning_position"] == "before" else -1] != "reasoning":
        raise ExportError(f"schema_template.json does not match reasoning_position \"{model['reasoning_position']}\" "
                          "in model.json.")
    if template_codes != codes:
        raise ExportError("schema_template.json does not list the codes of elements.json, in its order.")
    try:
        Draft202012Validator.check_schema(presence["schema"])
        presence_props = list(presence["schema"]["properties"])
    except (SchemaError, KeyError, TypeError) as e:
        raise ExportError(f"presence_schema.json is not the expected presence schema ({type(e).__name__}).") from None
    if presence_props != codes or presence["schema"].get("required") != codes:
        raise ExportError("presence_schema.json does not ask for every code of elements.json, in its order.")
    missing = [c for c in codes if f"- {c} (" not in presence_prompt]
    if missing:
        raise ExportError(f"presence_prompt.txt does not list: {', '.join(missing)}.")
    # The words of 1 and 5 in the app's style, "1 · not at all, …", as for 2 to 4.
    low, high = (w[:1].lower() + w[1:] for w in anchors.groups())
    return Export(system, task, (low, high), template, presence_prompt, presence, by_code, model, commit,
                  presence_version)


def encode_image(data: bytes, image: dict) -> str:
    """The image rule in model.json, in memory: an existing JPEG that already fits is sent unchanged; anything else is
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


def _base(export: Export, temperature: float, data_url: str, text: str, fmt: dict, schema: dict, system=None) -> dict:
    """What both calls share: the model and provider settings of model.json (pinned endpoint, zero retention, no
    fallbacks), a strict JSON schema, and the user content as text then image."""
    m = export.model
    messages = [{"role": "system", "content": system}] if system is not None else []
    messages.append({"role": "user", "content": [{"type": "text", "text": text},
                                                 {"type": "image_url", "image_url": {"url": data_url}}]})
    body = {
        "model": m["model"],
        "provider": m["provider"],
        "temperature": temperature,
        "max_tokens": m["max_tokens"],
        "messages": messages,
        "response_format": {"type": "json_schema", "json_schema": {"name": fmt["name"], "strict": fmt["strict"],
                                                                   "schema": schema}},
        "usage": {"include": True},
    }
    if m["reasoning"] is not None:
        body["reasoning"] = m["reasoning"]
    return body


def build_presence_request(export: Export, data_url: str) -> dict:
    """The presence call, as presence_schema.json says: the user message only (the prompt, then the photo), at its
    own temperature, with the other settings of model.json."""
    p = export.presence
    return _base(export, p["temperature"], data_url, export.presence_prompt, p, p["schema"])


def listed_from(export: Export, output: dict) -> list:
    """The elements the presence call answered true, in elements.json order."""
    return [c for c in export.elements if output.get(c) is True]


def answer_schemas(export: Export, listed: list) -> tuple[dict, dict]:
    """(the schema sent, the schema a reply must pass) for one photo. The element enum holds the listed codes
    (schema_template.json, per_photo). With none listed, B2 takes no items and B2_none must be true (Elena)."""
    sent = copy.deepcopy(export.template["schema"])
    if listed:
        sent["properties"]["B2_marked"]["items"]["properties"]["element"]["enum"] = list(listed)
        return sent, sent
    sent["properties"]["B2_marked"] = {"type": "array", "items": {"type": "string"}, "maxItems": 0}
    check = copy.deepcopy(sent)
    check["properties"]["B2_none"] = {"const": True}
    return sent, check


def task_text(export: Export, listed: list) -> str:
    """task_template.txt with one line per listed element, as task_rules.json says: '- <code> (<en name>):
    <definition>', in elements.json order. With none listed, the slot's line is left out. No trailing newline, as the
    study sends it (task_v9.task_text; the parity test checks it)."""
    task = export.task.rstrip("\n")
    lines = "\n".join(f"- {c} ({export.elements[c]['en']}): {export.elements[c]['definition']}" for c in listed)
    if lines:
        return task.replace(SLOT, lines)
    return task.replace(f"{SLOT}\n", "").replace(SLOT, "")


def system_text(export: Export, profile: str | None = None) -> str:
    """The system message: system_instruction.txt alone without a profile (the study's V0); with one, a blank line
    and the filled profile after it (profile_rules.json, placement)."""
    instruction = export.system.strip()  # as the study sends it (task_v9.system_instruction)
    return instruction if not profile else f"{instruction}\n\n{profile}"


def build_request(export: Export, data_url: str, listed: list, profile: str | None = None) -> dict:
    """The rating call, as the study builds it: the system message, then the task text followed by the image, with
    the answer schema for this photo's listed elements."""
    sent, _check_schema = answer_schemas(export, listed)
    return _base(export, export.model["temperature"], data_url, task_text(export, listed), export.template, sent,
                 system=system_text(export, profile))


def _short(text, limit: int = 200) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def problem_with(export: Export, listed: list, output) -> str | None:
    """Why a rating breaks the answer schema for this photo, or None when it is valid."""
    error = next(Draft202012Validator(answer_schemas(export, listed)[1]).iter_errors(output), None)
    return None if error is None else error.message


def presence_problem(export: Export, output) -> str | None:
    error = next(Draft202012Validator(export.presence["schema"]).iter_errors(output), None)
    return None if error is None else error.message


def parse_reply(export: Export, listed: list, text) -> tuple[dict | None, str | None]:
    """(the rating, None), or (None, what is wrong with it)."""
    return _parse(text, lambda o: problem_with(export, listed, o))


def _parse(text, problem) -> tuple[dict | None, str | None]:
    try:
        output = json.loads(text)
    except (TypeError, ValueError):
        return None, "not JSON"
    found = problem(output)
    return (None, found) if found else (output, None)


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
        raise PredictionError(502, f"OpenRouter refused the request ({resp.status_code}). {_short(detail)}".strip(),
                              fatal=resp.status_code in FATAL_STATUSES)
    return data


def _reply_text(data: dict):
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None


# Two caches, each one JSON file. Ratings: {key: {output, listed, model, latency_ms, cost_usd}}; the key holds the
# model, the export's commit and the profile, so results of another model, export or profile are never found.
# Presence: {key: {present, model, latency_ms, cost_usd}}, per photo; the key holds the presence version.
_cache_lock = threading.Lock()
SOURCE = "mly"  # the photo source in every key: "mly:" (Mapillary) or "sv:" (Street View, since 2026-11-16, its ID
# already has it). A key with neither is a Street View rating from before 2026-11-11 (another selection and crop), stale.


def _photo_part(photo_id: str) -> str:
    return photo_id if photo_id.startswith(SV) else f"{SOURCE}:{photo_id}"


def cache_key(photo_id: str, heading: float, model: str, commit: str, profile: str = GENERAL) -> str:
    return f"{_photo_part(photo_id)}|{round(heading, 1)}|{model}|{commit}|{profile}"


def presence_key(photo_id: str, heading: float, model: str, version: str) -> str:
    return f"{_photo_part(photo_id)}|{round(heading, 1)}|{model}|presence {version}"


def _stale_reason(key: str, entry=None) -> str | None:
    if not key.startswith((f"{SOURCE}:", SV)):
        return "streetview photo: the app now rates the Mapillary photo it shows"
    if key.count("|") == 3:  # photo|heading|model|commit: no profile part, so made from the V0 export
        return "V0 export: the app now rates with the v9 export"
    if isinstance(entry, dict) and entry.get("prompt") != PROMPT_VERSION:
        # Elena, 2026-11-15: made before the request matched the study word for word; rated again when its area is
        # asked for, never all at once.
        return f"request assembly before prompt {PROMPT_VERSION} (trailing newlines): rated again when its area is opened"
    return None


def mark_stale(path: Path) -> int:
    """Mark every rating made from a Street View photo (Elena, 2026-11-11) or from the V0 export (2026-11-14) as
    stale: kept for the record, never used again. Returns how many were newly marked."""
    with _cache_lock:
        data = _read_cache(path)
        n = 0
        for key, entry in data.items():
            reason = _stale_reason(key, entry)
            if reason and isinstance(entry, dict) and not entry.get("stale"):
                entry["stale"] = reason
                n += 1
        if n:
            try:
                tmp = path.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                os.replace(tmp, path)
            except OSError as e:
                log.warning("senses: stale marks not written: %s", type(e).__name__)
                return 0
    return n


def drop_personal(path: Path) -> int:
    """Remove every personal rating the cache held from before (Elena, 2026-11-15: personal results live in the browser
    only). Returns how many were removed."""
    with _cache_lock:
        data = _read_cache(path)
        keys = [k for k in data if PROFILE_PART in k]
        if not keys:
            return 0
        for k in keys:
            del data[k]
        try:
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, path)
        except OSError as e:
            log.warning("senses: cache not written: %s", type(e).__name__)
            return 0
    return len(keys)


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


def element_view(export: Export, code: str) -> dict:
    """An element as the app shows it: its labels, and the icon of its main sense. The other senses are kept as data."""
    e = export.elements[code]
    return {"code": code, "n": e["n"], "en": e["en"], "it": e["it"], "icon_key": e["icon_key"], "also": e.get("also", [])}


def _view(export: Export, entry: dict, cached: bool, personal: bool = False) -> dict:
    output = entry["output"]
    answers = {}
    for mark in output["B2_marked"]:
        answers.setdefault(mark["element"], set()).add(mark["answer"])

    def having(kinds):
        return [element_view(export, c) for c in export.elements if answers.get(c, set()) & set(kinds)]

    return {
        "comfort": output["B1_comfort"],
        "anchors": list(export.anchors),
        "bothers": having(BOTHERS),
        "feels_good": having(FEELS_GOOD),
        "listed": list(entry["listed"]),
        "reason": output["reasoning"],
        "model": entry["model"],
        "latency_ms": entry["latency_ms"],
        "cost_usd": entry["cost_usd"],
        "cached": cached,
        "personal": personal,  # rated with your sensory profile (V2), not the general prediction (V0)
    }


def _api_key() -> str:
    try:
        return get_key("OPENROUTER_API_KEY")
    except SystemExit:
        raise PredictionError(503, "The model is not set up on the server: add OPENROUTER_API_KEY to .env.") from None


@dataclass(frozen=True)
class Plan:
    """What one rating request will do: the cached photos answer at once, the first `cap` new ones are rated."""
    export: Export
    cached: list    # [(photo_id, heading, cache entry)]
    to_rate: list   # [(photo_id, heading)], in the order asked (nearest first)
    remaining: int  # new photos left out by the cap
    presence: dict  # (photo_id, heading) → the cached listed elements, for photos to rate whose presence is known
    api_key: str | None
    profile: str | None = None  # the filled profile text (V2), or None (V0); never logged or stored
    kept: tuple = ()  # personal: [(photo_id, heading, listed)] the browser already has, still valid ("keep")


def plan_rating(photos: list, cfg: dict, profile: str | None = None, stamps: dict | None = None) -> Plan:
    """Split the photos into cached and new. Nothing is paid for here. Raises ExportError or PredictionError.
    General (profile None): the server cache answers what it has. Personal: nothing is looked up in it; a photo whose
    browser stamp ({listed, model, commit}, in `stamps` by (photo_id, heading)) still matches its presence list, the
    model and the export is kept by the browser, every other one is new."""
    export = load_export()
    model = export.model["model"]
    with _cache_lock:
        cache = _read_cache(REPO_ROOT / cfg["cache_file"])
        presence_cache = _read_cache(REPO_ROOT / cfg["presence_cache_file"])
    cached, new, kept, seen = [], [], [], set()

    def present(photo_id, heading):
        hit = presence_cache.get(presence_key(photo_id, heading, model, export.presence_version))
        if isinstance(hit, dict) and isinstance(hit.get("present"), list) and set(hit["present"]) <= set(export.elements):
            return [c for c in export.elements if c in hit["present"]]
        return None

    for photo_id, heading in photos:
        key = cache_key(photo_id, heading, model, export.commit)
        if key in seen:
            continue
        seen.add(key)
        if profile:
            stamp = (stamps or {}).get((photo_id, heading))
            listed = present(photo_id, heading)
            if (stamp and listed is not None and stamp.get("model") == model and stamp.get("commit") == export.commit
                    and stamp.get("prompt") == PROMPT_VERSION and list(stamp.get("listed") or []) == listed):
                kept.append((photo_id, heading, listed))
            else:
                new.append((photo_id, heading))
            continue
        hit = cache.get(key)
        if (isinstance(hit, dict) and not hit.get("stale") and hit.get("prompt") == PROMPT_VERSION and isinstance(hit.get("listed"), list)
                and set(hit["listed"]) <= set(export.elements) and problem_with(export, hit["listed"], hit.get("output")) is None):
            cached.append((photo_id, heading, hit))
        else:
            new.append((photo_id, heading))
    cap = cfg["cap_photos"]
    to_rate = new[:cap]
    known = {}
    for photo in to_rate:
        listed = present(*photo)
        if listed is not None:
            known[photo] = listed
    return Plan(export, cached, to_rate, max(0, len(new) - cap), known, _api_key() if new else None, profile or None,
                tuple(kept))


def _ask(body: dict, key: str, cfg: dict, parse, costs: list, what: str):
    """One call, retried once if the reply is not valid. Every cost goes in `costs`. The reply is shortened in the
    error, never logged."""
    text = None
    for _ in range(2):
        data = post_openrouter(body, key, cfg)
        costs += [c for c in [(data.get("usage") or {}).get("cost")] if c is not None]
        text = _reply_text(data)
        output, _problem = parse(text)
        if output is not None:
            return output
    log.warning("senses: invalid %s reply after the retry", what)
    raise PredictionError(502, f"The model's {what} answer was not valid, twice, so nothing is shown. "
                               f"It said: \"{_short(text)}\"", cost=sum(costs))


def rate_one(plan: Plan, photo_id: str, heading: float, cfg: dict, provider) -> dict:
    """One photo: the picture from its source (in memory only), the presence call unless its result is cached, then
    the rating call. An invalid reply is retried once, for each call. Street View's daily cap stops the run."""
    export = plan.export
    model = export.model["model"]
    started = time.perf_counter()
    try:
        image = provider.fetch_image(photo_id, heading)
    except NotThisPhoto:
        raise PredictionError(400, "This is not a photo the app shows.") from None
    except CapReached as e:
        raise PredictionError(429, str(e), fatal=True) from None
    except SystemExit:  # no GOOGLE_MAPS_API_KEY: every Street View photo would fail
        raise PredictionError(503, "Street View photos are not set up on the server.", fatal=True) from None
    except (requests.RequestException, UnidentifiedImageError, OSError, ValueError) as e:
        log.warning("senses: photo failed: %s", type(e).__name__)
        raise PredictionError(502, "The street photo could not be loaded.") from None
    data_url = encode_image(image, export.model["image"])
    costs = []

    listed = plan.presence.get((photo_id, heading))
    if listed is None:
        presence_started = time.perf_counter()
        output = _ask(build_presence_request(export, data_url), plan.api_key, cfg,
                      lambda t: _parse(t, lambda o: presence_problem(export, o)), costs, "presence")
        listed = listed_from(export, output)
        _save_cache(REPO_ROOT / cfg["presence_cache_file"],
                    presence_key(photo_id, heading, model, export.presence_version),
                    {"present": listed, "model": model,
                     "latency_ms": round((time.perf_counter() - presence_started) * 1000),
                     "cost_usd": sum(costs) if costs else None})

    try:
        output = _ask(build_request(export, data_url, listed, plan.profile), plan.api_key, cfg,
                      lambda t: parse_reply(export, listed, t), costs, "rating")
    except PredictionError as e:
        e.cost = sum(costs)
        raise
    return {"output": output, "listed": listed, "model": model, "prompt": PROMPT_VERSION,
            "latency_ms": round((time.perf_counter() - started) * 1000), "cost_usd": sum(costs) if costs else None}


def rate_events(plan: Plan, cfg: dict, provider):
    """The run as events: "start", one "photo" per photo (cached ones first, then as each new one finishes, at most
    cfg["concurrency"] at a time), and "done", or "error" when going on is pointless. Every rating goes in the cache."""
    export = plan.export
    path = REPO_ROOT / cfg["cache_file"]
    personal = plan.profile is not None
    model = export.model["model"]
    yield {"type": "start", "model": model, "cached": len(plan.cached) + len(plan.kept), "to_rate": len(plan.to_rate),
           "remaining": plan.remaining, "personal": personal}
    for photo_id, heading, _listed in plan.kept:  # the browser has these: nothing to send but "keep"
        yield {"type": "photo", "id": photo_id, "heading": heading, "status": "keep", "cached": True}
    for photo_id, heading, entry in plan.cached:
        yield {"type": "photo", "id": photo_id, "heading": heading, "status": "ok", "cached": True,
               "result": _view(export, entry, cached=True)}

    started = time.perf_counter()
    stop = threading.Event()

    def work(photo):
        if stop.is_set():
            return None
        return rate_one(plan, photo[0], photo[1], cfg, provider)

    pool = ThreadPoolExecutor(max_workers=cfg["concurrency"])
    failed = 0
    try:
        futures = {pool.submit(work, photo): photo for photo in plan.to_rate}
        for future in as_completed(futures):
            photo_id, heading = futures[future]
            base = {"type": "photo", "id": photo_id, "heading": heading, "cached": False}
            # A Street View picture is paid too: its list price, for the cost counter in development.
            image = {"image_usd": provider.image_usd(photo_id)} if photo_id.startswith(SV) else {}
            try:
                entry = future.result()
            except PredictionError as e:
                if e.fatal:
                    stop.set()
                    yield {"type": "error", "message": e.message}
                    return
                failed += 1
                yield {**base, "status": "failed", "error": e.message, "cost_usd": e.cost, **(image if e.cost else {})}
                continue
            if entry is None:
                continue
            result = _view(export, entry, cached=False, personal=personal)
            if personal:  # relayed, never kept: the stamp lets the browser keep it and ask for "keep" next time
                yield {**base, **image, "status": "ok", "result": result, "cost_usd": entry["cost_usd"],
                       "stamp": {"listed": list(entry["listed"]), "model": model, "commit": export.commit,
                                 "prompt": PROMPT_VERSION}}
                continue
            _save_cache(path, cache_key(photo_id, heading, model, export.commit), entry)
            yield {**base, **image, "status": "ok", "result": result, "cost_usd": entry["cost_usd"]}
    finally:
        stop.set()
        pool.shutdown(wait=False, cancel_futures=True)
    yield {"type": "done", "seconds": round(time.perf_counter() - started, 1), "failed": failed, "remaining": plan.remaining,
           "estimate_usd": round(plan.remaining * CALLS_PER_PHOTO * cfg["estimate_call_usd"], 4)}
