"""Senses mode: the requests are built from model/app_v9/ as it is on disk (after its hash check), and replies are
validated. No API calls."""
import base64
import hashlib
import io
import json
import re
import shutil
import threading
import time
from dataclasses import replace

import pytest

from tool.config import load_config
import requests
from fastapi.testclient import TestClient
from PIL import Image

from app import main as main_mod
from app import senses as senses_mod
from app.senses import (EXPORT_DIR, SENSES, ExportError, PredictionError, answer_schemas, build_presence_request,
                        build_request, encode_image, load_export, parse_reply, task_text)

PANO = "1234567890"  # a Mapillary image ID
HEADING = 90.0
V9_CODES = ["greenery_trees", "nice_buildings", "signs_ads", "fountains_water", "traffic_trams", "plants_flowers",
            "trash_bins", "food_stalls_cafes", "grass_soil", "asphalt_stone_concrete", "shade", "direct_sun",
            "open_space", "heights_bridges", "car_free", "crowds", "narrow_shared", "seats",
            "drinking_fountains_toilets", "steps_slopes"]
OLD_CODES = ["traffic_trams_crowds", "bins_stalls_exhaust", "hard_surfaces", "sun_little_shade", "steps_slopes_potholes",
             "narrow_close", "no_seats", "greenery_water_buildings", "running_water_trees", "natural_materials",
             "open_sports", "wide_car_free", "seats_fountains_toilets", "nothing"]
SEEN = ["greenery_trees", "traffic_trams", "shade"]  # what the fake presence call finds, unless a test says otherwise


def presence_answer(seen=(), people=0):
    """A presence reply: true for `seen`, and the people count in Crowds' place (thesis D163)."""
    return {("people_count" if c == "crowds" else c): (people if c == "crowds" else c in seen) for c in V9_CODES}


PRESENT = presence_answer(SEEN)
GOOD = {"B1_comfort": 4,
        "B2_marked": [{"element": "traffic_trams", "answer": "unpleasant"}, {"element": "shade", "answer": "pleasant"},
                      {"element": "greenery_trees", "answer": "both"}],
        "B2_none": False, "reasoning": "Trees give shade, but the road is busy."}


def picture(fmt="JPEG", size=(64, 64)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (120, 150, 160)).save(buffer, format=fmt)
    return buffer.getvalue()


def reply(content, cost=0.0004) -> dict:
    if not isinstance(content, str):
        content = json.dumps(content)
    return {"choices": [{"message": {"content": content}}], "usage": {"cost": cost}}


def rehash(folder):
    """Write the sha256 of every listed file into MANIFEST.md again, after a test edited a file on purpose."""
    manifest = folder / "MANIFEST.md"
    text = manifest.read_text(encoding="utf-8")
    text = re.sub(r"^- `([^`]+)`: [0-9a-f]{64}$",
                  lambda m: f"- `{m.group(1)}`: {hashlib.sha256((folder / m.group(1)).read_bytes()).hexdigest()}",
                  text, flags=re.M)
    manifest.write_text(text, encoding="utf-8", newline="\n")


def copy_export(tmp_path):
    folder = tmp_path / "app_v9"
    shutil.copytree(EXPORT_DIR, folder)
    return folder


def edit_json(folder, name, change):
    data = json.loads((folder / name).read_text(encoding="utf-8"))
    change(data)
    (folder / name).write_text(json.dumps(data), encoding="utf-8")
    rehash(folder)


def edit_text(folder, name, old, new):
    path = folder / name
    path.write_text(path.read_text(encoding="utf-8").replace(old, new), encoding="utf-8", newline="\n")
    rehash(folder)


def is_presence(body) -> bool:
    return body["response_format"]["json_schema"]["name"] == load_export().presence["name"]


@pytest.fixture
def cfg(tmp_path):
    return {"url": "https://example.invalid", "timeout_s": 1, "cache_file": str(tmp_path / "senses" / "cache.json"),
            "presence_cache_file": str(tmp_path / "senses" / "presence.json"),
            "concurrency": 4, "cap_photos": 250, "estimate_call_usd": 0.001}


class Fake:
    """Fake OpenRouter: presence calls answer from `presence` (PRESENT once it is empty), rating calls from
    `ratings`. Every request is recorded, in order."""

    def __init__(self):
        self.made, self.presence, self.ratings = [], [], []
        self.lock = threading.Lock()

    def __call__(self, body, key, cfg):
        with self.lock:
            self.made.append(body)
            if is_presence(body):
                return self.presence.pop(0) if self.presence else reply(PRESENT, cost=0.0001)
            return self.ratings.pop(0)

    def kinds(self):
        return ["presence" if is_presence(b) else "rating" for b in self.made]


@pytest.fixture
def calls(monkeypatch):
    fake = Fake()
    monkeypatch.setattr(senses_mod, "post_openrouter", fake)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    return fake


# The export: hashes, contents, checks

def test_the_export_on_disk_matches_its_manifest_and_loads():
    export = load_export()
    assert list(export.elements) == V9_CODES
    assert export.commit and len(export.presence_version) == 12


def test_a_file_that_differs_from_its_hash_stops_and_says_which(tmp_path):
    folder = copy_export(tmp_path)
    with (folder / "elements.json").open("ab") as f:
        f.write(b" ")
    with pytest.raises(ExportError, match=r"elements\.json does not match its sha256"):
        load_export(folder)


def test_line_endings_changed_by_a_checkout_are_caught(tmp_path):
    folder = copy_export(tmp_path)
    path = folder / "task_template.txt"
    path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
    with pytest.raises(ExportError, match="task_template.txt"):
        load_export(folder)


@pytest.mark.parametrize("name", senses_mod.FILES)
def test_a_missing_file_stops_and_says_which(tmp_path, name):
    folder = copy_export(tmp_path)
    (folder / name).unlink()
    with pytest.raises(ExportError, match=re.escape(name)):
        load_export(folder)


def test_a_file_the_manifest_does_not_list_stops(tmp_path):
    folder = copy_export(tmp_path)
    edit_text(folder, "MANIFEST.md", "- `presence_prompt.txt`:", "- presence_prompt.txt:")
    with pytest.raises(ExportError, match="no sha256 for: presence_prompt.txt"):
        load_export(folder)


@pytest.mark.parametrize("name", ["schema_template.json", "elements.json", "model.json", "presence_schema.json"])
def test_a_broken_file_stops_and_says_which(tmp_path, name):
    folder = copy_export(tmp_path)
    (folder / name).write_text("{ not json", encoding="utf-8")
    rehash(folder)
    with pytest.raises(ExportError, match=re.escape(name)):
        load_export(folder)


def test_all_twenty_elements_have_an_english_and_italian_label_and_a_sense_icon():
    elements = load_export().elements
    assert len(elements) == 20
    for e in elements.values():
        assert e["en"].strip() and e["it"].strip()
        assert e["icon_key"] in SENSES
        assert set(e.get("also", [])) <= set(SENSES)
    assert not set(OLD_CODES) & set(elements)


@pytest.mark.parametrize("key,value", [("zdr", False), ("data_collection", "allow"), ("allow_fallbacks", True), ("only", []),
                                       ("only", ["google-vertex"]), ("only", ["google-vertex/eu", "google-vertex/us"])])
def test_an_export_that_breaks_a_privacy_rule_is_refused(tmp_path, key, value):
    folder = copy_export(tmp_path)
    edit_json(folder, "model.json", lambda m: m["provider"].__setitem__(key, value))
    with pytest.raises(ExportError, match="model.json"):
        load_export(folder)


def test_a_pinned_endpoint_other_than_the_one_sent_is_refused(tmp_path):
    folder = copy_export(tmp_path)
    edit_json(folder, "model.json", lambda m: m.__setitem__("pinned_endpoint", ["google-vertex/us"]))
    with pytest.raises(ExportError, match="pinned_endpoint"):
        load_export(folder)


def test_the_export_folder_is_one_setting(tmp_path):
    # api.senses.export in config/tool.yaml (2026-11-28): the folder in model/ every prediction uses.
    from app.senses import export_dir
    assert export_dir({"api": {"senses": {"export": "app_v9"}}}).name == "app_v9"
    assert export_dir().name == load_config()["api"]["senses"]["export"]
    for bad in ("../secrets", "app_v99_not_there"):
        with pytest.raises(SystemExit):
            export_dir({"api": {"senses": {"export": bad}}})


def test_a_free_endpoint_is_refused(tmp_path):
    folder = copy_export(tmp_path)
    edit_json(folder, "model.json", lambda m: m.__setitem__("model", "google/gemini-3.1-flash-lite:free"))
    with pytest.raises(ExportError, match="model"):
        load_export(folder)


def test_a_new_reasoning_order_is_picked_up_from_the_folder(tmp_path):
    folder = copy_export(tmp_path)

    def reasoning_first(template):
        props = template["schema"]["properties"]
        template["schema"]["properties"] = {"reasoning": props["reasoning"], **{k: v for k, v in props.items() if k != "reasoning"}}

    edit_json(folder, "model.json", lambda m: m.__setitem__("reasoning_position", "before"))
    with pytest.raises(ExportError, match="reasoning_position"):
        load_export(folder)  # the schema still says "after"
    edit_json(folder, "schema_template.json", reasoning_first)
    body = build_request(load_export(folder), "data:image/jpeg;base64,AA==", SEEN)
    assert list(body["response_format"]["json_schema"]["schema"]["properties"])[0] == "reasoning"


def test_an_input_the_export_cannot_serve_is_refused(tmp_path):
    folder = copy_export(tmp_path)
    edit_json(folder, "model.json", lambda m: m.__setitem__("input", "photo_description"))
    with pytest.raises(ExportError, match="photo_description"):
        load_export(folder)


def test_a_task_without_its_element_slot_or_scale_is_refused(tmp_path):
    folder = copy_export(tmp_path)
    edit_text(folder, "task_template.txt", "{ELEMENTS}", "")
    with pytest.raises(ExportError, match="ELEMENTS"):
        load_export(folder)
    folder = copy_export(tmp_path / "again")
    edit_text(folder, "task_template.txt", "(1 = Not at all", "(Not at all")
    with pytest.raises(ExportError, match="scale"):
        load_export(folder)


def test_presence_files_that_do_not_cover_every_element_are_refused(tmp_path):
    folder = copy_export(tmp_path)
    edit_json(folder, "presence_schema.json", lambda p: p["schema"]["properties"].pop("people_count"))
    with pytest.raises(ExportError, match="presence_schema.json"):
        load_export(folder)
    folder = copy_export(tmp_path / "again")
    edit_text(folder, "presence_prompt.txt", "- seats (Seats)", "- Seats")
    with pytest.raises(ExportError, match="presence_prompt.txt does not list: seats"):
        load_export(folder)


def test_presence_files_must_count_crowds(tmp_path):
    """Thesis D163: the people count in Crowds' place, an integer, with its threshold; no defaults."""
    export = load_export()
    assert export.presence["crowds"] == {"from": "people_count", "at_least": 8}
    props = list(export.presence["schema"]["properties"])
    assert "crowds" not in props and props[V9_CODES.index("crowds")] == "people_count"
    for i, change in enumerate([lambda p: p.pop("crowds"),
                                lambda p: p["crowds"].update(at_least=0),
                                lambda p: p["crowds"].update(from_="x"),
                                lambda p: p["schema"]["properties"].update(people_count={"type": "boolean"}),
                                lambda p: p["crowds"].update({"from": "crowd_size"})]):
        folder = copy_export(tmp_path / str(i))
        edit_json(folder, "presence_schema.json", change)
        with pytest.raises(ExportError, match="presence_schema.json"):
            load_export(folder)
    folder = copy_export(tmp_path / "prompt")
    edit_text(folder, "presence_prompt.txt", "- people_count:", "- count:")
    edit_text(folder, "presence_prompt.txt", "then people_count.", "then the count.")
    with pytest.raises(ExportError, match="presence_prompt.txt does not list: people_count"):
        load_export(folder)


@pytest.mark.parametrize("people, crowds", [(0, False), (7, False), (8, True), (25, True)])
def test_crowds_is_listed_from_the_people_count(people, crowds):
    listed = senses_mod.listed_from(load_export(), presence_answer(SEEN, people))
    assert ("crowds" in listed) is crowds
    assert [c for c in listed if c != "crowds"] == SEEN and listed == [c for c in V9_CODES if c in listed]


def test_the_scale_words_come_from_the_task_text_in_the_apps_style():
    assert load_export().anchors == ("not at all, too much for my senses", "very much")


# The two requests

def check_provider(body, model):
    assert body["model"] == model["model"] and not body["model"].endswith(":free")
    assert body["provider"] == model["provider"]
    assert body["provider"]["only"] == ["google-vertex/eu"]
    assert body["provider"]["zdr"] is True
    assert body["provider"]["data_collection"] == "deny"
    assert body["provider"]["allow_fallbacks"] is False
    assert body["max_tokens"] == model["max_tokens"]
    assert body["reasoning"] == model["reasoning"]
    assert body["usage"] == {"include": True}


def test_the_presence_request_is_the_exported_prompt_alone_then_the_photo():
    model = json.loads((EXPORT_DIR / "model.json").read_text(encoding="utf-8"))
    presence = json.loads((EXPORT_DIR / "presence_schema.json").read_text(encoding="utf-8"))
    prompt = (EXPORT_DIR / "presence_prompt.txt").read_text(encoding="utf-8")
    export = load_export()
    data = picture()

    body = build_presence_request(export, encode_image(data, export.model["image"]))

    check_provider(body, model)
    assert body["temperature"] == presence["temperature"] == 0
    [user] = body["messages"]  # the user message only: no system message
    assert user["role"] == "user"
    assert [p["type"] for p in user["content"]] == ["text", "image_url"]
    assert user["content"][0]["text"] == prompt
    assert user["content"][1]["image_url"]["url"] == f"data:{model['image']['mime_type']};base64," + base64.b64encode(data).decode()
    fmt = body["response_format"]
    assert fmt == {"type": "json_schema", "json_schema": {"name": presence["name"], "strict": True, "schema": presence["schema"]}}


def test_the_rating_request_without_a_profile_is_the_study_v0_with_this_photos_list():
    model = json.loads((EXPORT_DIR / "model.json").read_text(encoding="utf-8"))
    template = json.loads((EXPORT_DIR / "schema_template.json").read_text(encoding="utf-8"))
    system = (EXPORT_DIR / "system_instruction.txt").read_text(encoding="utf-8").strip()  # as the study sends it
    export = load_export()

    body = build_request(export, encode_image(picture(), export.model["image"]), SEEN)

    check_provider(body, model)
    assert body["temperature"] == model["temperature"]
    system_message, user = body["messages"]
    assert system_message == {"role": "system", "content": system}  # the system instruction alone
    assert [p["type"] for p in user["content"]] == ["text", "image_url"]  # the task, then the image, as in the study
    assert user["content"][0]["text"] == task_text(export, SEEN)
    schema = body["response_format"]["json_schema"]
    assert schema["name"] == template["name"] and schema["strict"] is True
    assert list(schema["schema"]["properties"]) == list(template["schema"]["properties"])
    assert schema["schema"]["properties"]["B2_marked"]["items"]["properties"]["element"]["enum"] == SEEN


def test_a_profile_goes_after_the_system_instruction_and_a_blank_line():
    export = load_export()
    body = build_request(export, "data:image/jpeg;base64,AA==", SEEN, profile="How you experience public spaces: …")
    assert body["messages"][0]["content"] == export.system.rstrip() + "\n\nHow you experience public spaces: …"


def test_the_task_lists_each_listed_element_as_task_rules_says():
    export = load_export()
    text = task_text(export, SEEN)
    assert "{" not in text
    lines = [line for line in text.split("\n") if line.startswith("- ")]
    assert lines == [f"- {c} ({export.elements[c]['en']}): {export.elements[c]['definition']}" for c in SEEN]
    assert text.startswith(export.task.split("{ELEMENTS}")[0])
    assert text.endswith(export.task.split("{ELEMENTS}")[1].rstrip("\n"))  # no trailing newline, as the study


def test_with_nothing_listed_b2_takes_no_items_and_b2_none_must_be_true():
    export = load_export()
    text = task_text(export, [])
    assert "{ELEMENTS}" not in text and not any(line.startswith("- ") for line in text.split("\n"))
    assert "\n\n" not in text  # the slot's line is left out, not left empty
    sent, check = answer_schemas(export, [])
    assert sent["properties"]["B2_marked"]["maxItems"] == 0
    none = {"B1_comfort": 3, "B2_marked": [], "B2_none": True, "reasoning": "A plain street."}
    assert parse_reply(export, [], json.dumps(none)) == (none, None)
    assert parse_reply(export, [], json.dumps({**none, "B2_none": False}))[0] is None
    assert parse_reply(export, [], json.dumps({**none, "B2_marked": [{"element": "shade", "answer": "pleasant"}]}))[0] is None


def test_a_valid_reply_passes_and_invalid_ones_do_not():
    export = load_export()
    assert parse_reply(export, SEEN, json.dumps(GOOD)) == (GOOD, None)
    for bad in ("not json", {**GOOD, "B1_comfort": 6}, {**GOOD, "extra": 1}, {**GOOD, "B2_none": "no"},
                {**GOOD, "B2_marked": [{"element": "crowds", "answer": "unpleasant"}]},       # not listed for this photo
                {**GOOD, "B2_marked": [{"element": "traffic_trams_crowds", "answer": "unpleasant"}]},  # an old code
                {**GOOD, "B2_marked": [{"element": "shade", "answer": "maybe"}]}):
        output, problem = parse_reply(export, SEEN, bad if isinstance(bad, str) else json.dumps(bad))
        assert output is None and problem


def test_other_images_are_converted_in_memory():
    image = load_export().model["image"]
    for data in (picture("PNG"), picture("JPEG", (2000, 1000))):
        out = base64.b64decode(encode_image(data, image).split(",", 1)[1])
        with Image.open(io.BytesIO(out)) as pic:
            assert pic.format == image["format"] and max(pic.size) <= image["max_px"]
    with pytest.raises(PredictionError):
        encode_image(b"not a picture", image)


# A run

class FakeProvider:
    def __init__(self):
        self.fetched = []

    def fetch_image(self, photo_id, heading):
        self.fetched.append(photo_id)
        return picture()

    def estimated_cost_usd(self, calls):
        return 0.0


def run(photos, cfg, provider=None):
    provider = provider or FakeProvider()
    plan = senses_mod.plan_rating(photos, cfg)
    return list(senses_mod.rate_events(plan, cfg, provider if plan.to_rate else None)), provider


def photo_events(events, status=None):
    return [e for e in events if e["type"] == "photo" and (status is None or e["status"] == status)]


def test_a_new_photo_takes_the_presence_call_then_the_rating_call_on_its_list(calls, cfg):
    calls.ratings.append(reply(GOOD, cost=0.0004))
    events, _ = run([(PANO, HEADING)], cfg)
    assert calls.kinds() == ["presence", "rating"]
    rating = calls.made[1]
    assert rating["response_format"]["json_schema"]["schema"]["properties"]["B2_marked"]["items"]["properties"]["element"]["enum"] == SEEN
    ok = photo_events(events, "ok")[0]["result"]
    assert ok["comfort"] == 4
    assert ok["listed"] == SEEN
    assert [e["code"] for e in ok["bothers"]] == ["greenery_trees", "traffic_trams"]  # "both" is in both lists
    assert [e["code"] for e in ok["feels_good"]] == ["greenery_trees", "shade"]
    assert ok["bothers"][1] == {"code": "traffic_trams", "n": 5, "en": "Traffic, trams", "it": "Traffico, tram",
                                "icon_key": "hearing", "also": []}
    assert ok["cost_usd"] == pytest.approx(0.0005)  # both calls
    assert ok["commit"] == load_export().commit and ok["prompt"] == senses_mod.PROMPT_VERSION  # what it was made from


def test_nothing_detected_sends_an_empty_list_and_needs_b2_none(calls, cfg):
    calls.presence.append(reply(presence_answer()))
    calls.ratings.append(reply({"B1_comfort": 3, "B2_marked": [], "B2_none": True, "reasoning": "Plain."}))
    events, _ = run([(PANO, HEADING)], cfg)
    schema = calls.made[1]["response_format"]["json_schema"]["schema"]
    assert schema["properties"]["B2_marked"]["maxItems"] == 0
    ok = photo_events(events, "ok")[0]["result"]
    assert ok["listed"] == [] and ok["bothers"] == [] and ok["feels_good"] == []


def test_the_presence_result_is_cached_per_photo_even_when_the_rating_changes(calls, cfg, monkeypatch, tmp_path):
    calls.ratings.append(reply(GOOD))
    run([(PANO, HEADING)], cfg)
    stored = json.loads((tmp_path / "senses" / "presence.json").read_text(encoding="utf-8"))
    [entry] = stored.values()
    assert set(entry) == {"present", "model", "latency_ms", "cost_usd"} and entry["present"] == SEEN

    # Another export commit: the rating is asked again, the presence is not.
    other = replace(load_export(), commit="abc1234")
    monkeypatch.setattr(senses_mod, "load_export", lambda: other)
    calls.ratings.append(reply(GOOD))
    events, _ = run([(PANO, HEADING)], cfg)
    assert calls.kinds() == ["presence", "rating", "rating"]
    assert photo_events(events, "ok")[0]["result"]["listed"] == SEEN

    # A new presence rule: asked again.
    monkeypatch.setattr(senses_mod, "load_export", lambda: replace(other, commit="def5678", presence_version="0" * 12))
    calls.ratings.append(reply(GOOD))
    run([(PANO, HEADING)], cfg)
    assert calls.kinds()[-2:] == ["presence", "rating"]


def test_a_failed_rating_keeps_the_presence_result(calls, cfg):
    calls.ratings += [reply("not json"), reply("not json")]
    events, _ = run([(PANO, HEADING)], cfg)
    assert photo_events(events, "failed")
    calls.ratings.append(reply(GOOD))
    run([(PANO, HEADING)], cfg)
    assert calls.kinds() == ["presence", "rating", "rating", "rating"]


def test_an_invalid_presence_reply_is_retried_once(calls, cfg):
    calls.presence += [reply({"greenery_trees": True}, cost=0.0001), reply(PRESENT, cost=0.0001)]
    calls.ratings.append(reply(GOOD, cost=0.0004))
    events, _ = run([(PANO, HEADING)], cfg)
    assert calls.kinds() == ["presence", "presence", "rating"]
    assert photo_events(events, "ok")[0]["cost_usd"] == pytest.approx(0.0006)


def test_an_invalid_rating_reply_is_retried_once_then_used(calls, cfg):
    calls.ratings += [reply("not json", cost=0.0001), reply(GOOD, cost=0.0004)]
    events, _ = run([(PANO, HEADING)], cfg)
    assert calls.kinds() == ["presence", "rating", "rating"]
    ok = photo_events(events, "ok")[0]
    assert ok["cost_usd"] == pytest.approx(0.0006)  # what was paid, all three calls
    assert ok["cached"] is False


def test_still_invalid_is_marked_failed_with_the_text_shortened_and_not_cached(calls, cfg, tmp_path):
    calls.ratings += [reply("x" * 500), reply("x" * 500)]
    events, _ = run([(PANO, HEADING)], cfg)
    failed = photo_events(events, "failed")[0]
    assert "x" * 100 in failed["error"] and "x" * 300 not in failed["error"]
    assert failed["cost_usd"] == pytest.approx(0.0009)
    assert events[-1]["failed"] == 1
    assert not (tmp_path / "senses" / "cache.json").exists()


def test_the_cache_keeps_only_the_output_costs_nothing_and_ignores_another_commit(calls, cfg, tmp_path, monkeypatch):
    calls.ratings.append(reply(GOOD))
    run([(PANO, HEADING)], cfg)

    events, provider = run([(PANO, HEADING)], cfg)  # reopening: no model call and no image
    assert photo_events(events, "ok")[0]["cached"] is True
    assert len(calls.made) == 2 and provider.fetched == []

    stored = json.loads((tmp_path / "senses" / "cache.json").read_text(encoding="utf-8"))
    [(key, entry)] = stored.items()
    assert key.endswith("|general")
    assert set(entry) == {"output", "listed", "model", "prompt", "latency_ms", "cost_usd"}
    assert entry["prompt"] == senses_mod.PROMPT_VERSION
    assert "base64" not in json.dumps(stored) + (tmp_path / "senses" / "presence.json").read_text(encoding="utf-8")

    monkeypatch.setattr(senses_mod, "load_export", lambda: replace(load_export(), commit="abc1234"))
    calls.ratings.append(reply(GOOD))
    assert photo_events(run([(PANO, HEADING)], cfg)[0], "ok")[0]["cached"] is False


def test_a_cached_rating_with_old_codes_is_rated_again(calls, cfg, tmp_path):
    export = load_export()
    path = tmp_path / "senses" / "cache.json"
    path.parent.mkdir(parents=True)
    old = {"output": {**GOOD, "B2_marked": [{"element": "traffic_trams_crowds", "answer": "unpleasant"}]},
           "listed": ["traffic_trams_crowds"], "model": "m", "latency_ms": 1, "cost_usd": 0.001}
    path.write_text(json.dumps({senses_mod.cache_key(PANO, HEADING, export.model["model"], export.commit): old}), encoding="utf-8")
    calls.ratings.append(reply(GOOD))
    events, _ = run([(PANO, HEADING)], cfg)
    assert photo_events(events, "ok")[0]["cached"] is False


def test_at_most_the_cap_is_rated_in_order_and_the_rest_is_estimated(calls, cfg):
    cfg.update(cap_photos=2, estimate_call_usd=0.001)
    calls.ratings += [reply(GOOD) for _ in range(2)]
    photos = [(f"{i}000", HEADING) for i in range(1, 6)]
    events, provider = run(photos, cfg)
    assert sorted(provider.fetched) == ["1000", "2000"]
    assert events[0]["remaining"] == 3
    assert events[-1]["remaining"] == 3
    assert events[-1]["estimate_usd"] == pytest.approx(0.006)  # 3 photos, two calls each

    # Asking again goes on: those rated are now cached and do not count against the cap.
    calls.ratings += [reply(GOOD) for _ in range(2)]
    events, provider = run(photos, cfg)
    assert sorted(provider.fetched) == ["3000", "4000"]
    assert len(photo_events(events, "ok")) == 4 and events[-1]["remaining"] == 1


def test_no_more_than_four_run_at_a_time(cfg, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    lock, now, most = threading.Lock(), [0], [0]

    def slow(body, key, cfg):
        with lock:
            now[0] += 1
            most[0] = max(most[0], now[0])
        time.sleep(0.02)
        with lock:
            now[0] -= 1
        return reply(PRESENT if is_presence(body) else GOOD)

    monkeypatch.setattr(senses_mod, "post_openrouter", slow)
    events, _ = run([(f"{i}00", HEADING) for i in range(1, 13)], cfg)
    assert len(photo_events(events, "ok")) == 12
    assert 1 < most[0] <= 4


def test_a_refused_key_stops_the_run_instead_of_paying_for_every_image(cfg, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    cfg["concurrency"] = 1

    def refuse(body, key, cfg):
        raise PredictionError(502, "OpenRouter refused the request (401).", fatal=True)

    monkeypatch.setattr(senses_mod, "post_openrouter", refuse)
    events, provider = run([(f"{i}00", HEADING) for i in range(1, 21)], cfg)
    assert events[-1] == {"type": "error", "message": "OpenRouter refused the request (401)."}
    assert len(provider.fetched) < 20


def test_a_photo_that_cannot_be_loaded_is_marked_failed_and_the_run_goes_on(calls, cfg):
    calls.ratings.append(reply(GOOD))

    class Flaky(FakeProvider):
        def fetch_image(self, photo_id, heading):
            if photo_id == "100":
                raise requests.ConnectionError()
            return super().fetch_image(photo_id, heading)

    cfg["concurrency"] = 1
    events, _ = run([("100", HEADING), ("200", HEADING)], cfg, Flaky())
    assert len(photo_events(events, "failed")) == 1 and len(photo_events(events, "ok")) == 1


def test_a_photo_the_app_does_not_show_is_marked_failed(calls, cfg):
    class Refuses(FakeProvider):
        def fetch_image(self, photo_id, heading):
            raise senses_mod.NotThisPhoto("not its heading")

    events, _ = run([(PANO, HEADING)], cfg, Refuses())
    assert photo_events(events, "failed")[0]["error"] == "This is not a photo the app shows."
    assert calls.made == []


def test_the_endpoint_takes_mapillary_ids_only_and_reports_a_missing_key(monkeypatch, tmp_path):
    client = TestClient(main_mod.app)
    monkeypatch.setitem(main_mod.cfg["senses"], "cache_file", str(tmp_path / "c.json"))
    monkeypatch.setitem(main_mod.cfg["senses"], "presence_cache_file", str(tmp_path / "p.json"))
    # A Street View pano ID (or anything else) is not a photo the app shows: refused before any call.
    assert client.post("/api/senses/rate", json={"photos": [{"id": "CAoSLEFGMVFpcE1", "heading": HEADING}]}).status_code == 422
    assert client.post("/api/senses/rate", json={"photos": [{"pano_id": PANO, "heading": HEADING}]}).status_code == 422
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setattr(senses_mod, "get_key", lambda name: (_ for _ in ()).throw(SystemExit(name)))
    res = client.post("/api/senses/rate", json={"photos": [{"id": PANO, "heading": HEADING}]})
    assert res.status_code == 503
    assert "OPENROUTER_API_KEY" in res.json()["detail"]


def test_the_cache_keys_hold_the_photo_model_and_export():
    assert senses_mod.cache_key("123", 90.04, "google/m", "abc1234") == "mly:123|90.0|google/m|abc1234|general"
    assert senses_mod.presence_key("123", 90.04, "google/m", "0123456789ab") == "mly:123|90.0|google/m|presence 0123456789ab"


def test_street_view_and_v0_ratings_are_marked_stale_and_never_used(calls, cfg, tmp_path):
    export = load_export()
    path = tmp_path / "senses" / "cache.json"
    path.parent.mkdir(parents=True)
    old = {"output": {"B1_comfort": 4}, "model": "m", "latency_ms": 1, "cost_usd": 0.001}
    v9_key = senses_mod.cache_key("999", HEADING, export.model["model"], export.commit)
    v9 = {"output": GOOD, "listed": SEEN, "model": "m", "prompt": senses_mod.PROMPT_VERSION, "latency_ms": 1, "cost_usd": 0.001}
    path.write_text(json.dumps({"CAoSLEFGMVFpcE1|90.0|3cbbc25": old,                     # Street View
                                f"mly:{PANO}|90.0|{export.model['model']}|3cbbc25": old,  # V0 export
                                v9_key: v9}), encoding="utf-8")
    assert senses_mod.mark_stale(path) == 2
    assert senses_mod.mark_stale(path) == 0  # once
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert "Mapillary" in stored["CAoSLEFGMVFpcE1|90.0|3cbbc25"]["stale"]
    assert "V0" in stored[f"mly:{PANO}|90.0|{export.model['model']}|3cbbc25"]["stale"]
    assert "stale" not in stored[v9_key]
    assert stored[f"mly:{PANO}|90.0|{export.model['model']}|3cbbc25"]["output"] == old["output"]  # kept for the record


def test_general_ratings_from_before_the_prompt_fix_are_stale_and_rated_again_when_asked(calls, cfg, tmp_path):
    """Elena, 2026-11-15: made with the trailing newlines; marked stale, kept for the record, rated again only when
    their photo is asked for (never all at once)."""
    export = load_export()
    path = tmp_path / "senses" / "cache.json"
    path.parent.mkdir(parents=True)
    old = {"output": GOOD, "listed": SEEN, "model": "m", "latency_ms": 1, "cost_usd": 0.001}  # no "prompt"
    asked = senses_mod.cache_key(PANO, HEADING, export.model["model"], export.commit)
    other = senses_mod.cache_key("999", HEADING, export.model["model"], export.commit)
    path.write_text(json.dumps({asked: old, other: old}), encoding="utf-8")
    assert senses_mod.mark_stale(path) == 2
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert "prompt 2" in stored[asked]["stale"] and stored[asked]["output"] == GOOD
    calls.ratings.append(reply(dict(GOOD, B1_comfort=3)))
    events, _ = run([(PANO, HEADING)], cfg)  # only the photo asked for is rated again
    assert photo_events(events, "ok")[0]["cached"] is False and photo_events(events, "ok")[0]["result"]["comfort"] == 3
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored[asked]["prompt"] == senses_mod.PROMPT_VERSION and "stale" not in stored[asked]
    assert "stale" in stored[other]  # not rated: nobody asked for it
