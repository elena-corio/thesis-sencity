"""Senses mode: the request is built from model/app_v0/ as it is on disk, and replies are validated. No API calls."""
import base64
import io
import json
import shutil
import threading
import time
from dataclasses import replace

import pytest
import requests
from fastapi.testclient import TestClient
from PIL import Image

from app import main as main_mod
from app import senses as senses_mod
from app.senses import (EXPORT_DIR, ExportError, PredictionError, build_request, encode_image, load_export, parse_reply,
                        task_text)

PANO = "pano_id_for_tests"
HEADING = 90.0
GOOD = {"B1_comfort": 4, "B2_bothers": ["traffic_trams_crowds"], "B3_feels_good": ["shade", "plants_flowers"],
        "reasoning": "Trees give shade, but the road is busy."}


def picture(fmt="JPEG", size=(64, 64)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (120, 150, 160)).save(buffer, format=fmt)
    return buffer.getvalue()


def reply(content, cost=0.0004) -> dict:
    return {"choices": [{"message": {"content": content}}], "usage": {"cost": cost}}


def copy_export(tmp_path):
    folder = tmp_path / "app_v0"
    shutil.copytree(EXPORT_DIR, folder)
    return folder


def edit_json(folder, name, change):
    data = json.loads((folder / name).read_text(encoding="utf-8"))
    change(data)
    (folder / name).write_text(json.dumps(data), encoding="utf-8")


@pytest.fixture
def cfg(tmp_path):
    return {"url": "https://example.invalid", "timeout_s": 1, "cache_file": str(tmp_path / "senses" / "cache.json"),
            "concurrency": 4, "cap_photos": 250, "estimate_call_usd": 0.001}


@pytest.fixture
def calls(monkeypatch):
    """Fake OpenRouter: answers from the list, and records each request."""
    made = []
    answers = []

    def fake(body, key, cfg):
        made.append(body)
        return answers.pop(0)

    monkeypatch.setattr(senses_mod, "post_openrouter", fake)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    return made, answers


def test_request_is_built_from_the_export_as_model_json_says():
    """Loads model/app_v0/, builds a request without sending it, and checks it against model.json."""
    model = json.loads((EXPORT_DIR / "model.json").read_text(encoding="utf-8"))
    schema_text = (EXPORT_DIR / "schema.json").read_text(encoding="utf-8")
    system = (EXPORT_DIR / "system_instructions.txt").read_text(encoding="utf-8")
    export = load_export()
    data = picture()

    body = build_request(export, encode_image(data, export.model["image"]), "pano|90.0|commit")

    assert body["model"] == model["model"]
    assert body["provider"] == model["provider"]
    assert body["provider"]["zdr"] is True
    assert body["provider"]["data_collection"] == "deny"
    assert body["provider"]["allow_fallbacks"] is False
    assert not body["model"].endswith(":free")
    assert body["temperature"] == model["temperature"]
    assert body["max_tokens"] == model["max_tokens"]
    assert body["reasoning"] == model["reasoning"]
    assert body["usage"] == {"include": True}

    fmt = body["response_format"]
    assert fmt["type"] == model["response_format"]["type"]
    assert fmt["json_schema"]["name"] == model["response_format"]["name"]
    assert fmt["json_schema"]["strict"] is model["response_format"]["strict"]
    assert list(fmt["json_schema"]["schema"]["properties"]) == list(json.loads(schema_text)["properties"])
    assert fmt["json_schema"]["schema"] == json.loads(schema_text)

    system_message, user_message = body["messages"]
    assert system_message == {"role": "system", "content": system}
    assert user_message["role"] == "user"
    assert [p["type"] for p in user_message["content"]] == ["text", "image_url"]  # the task, then the image, as in the study
    assert user_message["content"][0]["text"] == task_text(export, "pano|90.0|commit")
    prefix = f"data:{model['image']['mime_type']};base64,"
    url = user_message["content"][1]["image_url"]["url"]
    assert url == prefix + base64.b64encode(data).decode("ascii")  # a small JPEG goes unchanged


def test_the_task_text_lists_every_option_as_the_study_does():
    export = load_export()
    text = task_text(export, "one photo")
    assert "{" not in text
    assert text.startswith(export.task.split("{")[0].rstrip())
    lines = [line[2:] for line in text.split("\n") if line.startswith("- ")]
    shown = [line.split(":")[0] for line in lines]
    bothers = export.schema["properties"]["B2_bothers"]["items"]["enum"]
    goods = export.schema["properties"]["B3_feels_good"]["items"]["enum"]
    assert len(shown) == len(bothers) + len(goods)
    assert sorted(shown[:len(bothers)]) == sorted(bothers) and shown[len(bothers) - 1] == "nothing"
    assert sorted(shown[len(bothers):]) == sorted(goods) and shown[-1] == "nothing"
    assert f"signs_ads: {export.elements['signs_ads']['en']}" in lines
    assert task_text(export, "one photo") == text  # the same photo always gets the same text
    assert any(task_text(export, f"photo {i}") != text for i in range(5))  # and the order varies between photos


def test_the_scale_words_come_from_the_task_text():
    assert load_export().anchors == ("not at all, too much for my senses", "very much")


def test_nothing_with_other_elements_is_invalid_once_the_export_says_so(tmp_path, calls, cfg, monkeypatch):
    """The rule lives in schema_validate.json, not in the code: this is the rule to add to the export."""
    folder = copy_export(tmp_path)

    def add_rule(schema):
        for field in ("B2_bothers", "B3_feels_good"):
            schema["properties"][field].update({"if": {"contains": {"const": "nothing"}}, "then": {"maxItems": 1}})

    edit_json(folder, "schema_validate.json", add_rule)
    export = load_export(folder)
    mixed = {**GOOD, "B2_bothers": ["nothing", "signs_ads"]}
    assert parse_reply(export, json.dumps(mixed))[0] is None
    assert parse_reply(export, json.dumps({**GOOD, "B2_bothers": ["nothing"]}))[0] is not None

    made, answers = calls
    monkeypatch.setattr(senses_mod, "load_export", lambda: export)
    answers += [reply(json.dumps(mixed)), reply(json.dumps(mixed))]
    events, _ = run([(PANO, HEADING)], cfg)
    assert len(photo_events(events, "failed")) == 1
    assert len(made) == 2


def test_a_valid_sample_reply_passes_and_invalid_ones_do_not():
    """Validates sample replies against schema_validate.json."""
    export = load_export()
    assert parse_reply(export, json.dumps(GOOD)) == (GOOD, None)
    for bad in ("not json", json.dumps({**GOOD, "B1_comfort": 6}), json.dumps({**GOOD, "B2_bothers": []}),
                json.dumps({**GOOD, "B3_feels_good": ["shade", "shade"]}), json.dumps({**GOOD, "extra": 1}),
                json.dumps({**GOOD, "B2_bothers": ["signs_ads", "hard_surfaces", "narrow_close", "no_seats"]})):
        output, problem = parse_reply(export, bad)
        assert output is None and problem


def test_other_images_are_converted_in_memory():
    image = load_export().model["image"]
    for data in (picture("PNG"), picture("JPEG", (2000, 1000))):
        out = base64.b64decode(encode_image(data, image).split(",", 1)[1])
        with Image.open(io.BytesIO(out)) as pic:
            assert pic.format == image["format"] and max(pic.size) <= image["max_px"]
    with pytest.raises(PredictionError):
        encode_image(b"not a picture", image)


@pytest.mark.parametrize("old,name", [(" {bother options}", "bother options"), ("(1 = not at all", "scale")])
def test_a_task_text_without_its_slots_or_scale_is_refused(tmp_path, old, name):
    folder = copy_export(tmp_path)
    task = folder / "task_part_b.txt"
    task.write_text(task.read_text(encoding="utf-8").replace(old, ""), encoding="utf-8")
    with pytest.raises(ExportError, match=name):
        load_export(folder)


@pytest.mark.parametrize("name", ["system_instructions.txt", "task_part_b.txt", "schema.json", "schema_validate.json", "elements.json",
                                  "model.json", "MANIFEST.md"])
def test_a_missing_file_stops_and_says_which(tmp_path, name):
    folder = copy_export(tmp_path)
    (folder / name).unlink()
    with pytest.raises(ExportError, match=name):
        load_export(folder)


@pytest.mark.parametrize("name", ["schema.json", "schema_validate.json", "elements.json", "model.json"])
def test_a_broken_file_stops_and_says_which(tmp_path, name):
    folder = copy_export(tmp_path)
    (folder / name).write_text("{ not json", encoding="utf-8")
    with pytest.raises(ExportError, match=name):
        load_export(folder)


@pytest.mark.parametrize("key,value", [("zdr", False), ("data_collection", "allow"), ("allow_fallbacks", True), ("only", [])])
def test_an_export_that_breaks_a_privacy_rule_is_refused(tmp_path, key, value):
    folder = copy_export(tmp_path)
    edit_json(folder, "model.json", lambda m: m["provider"].__setitem__(key, value))
    with pytest.raises(ExportError, match="model.json"):
        load_export(folder)


def test_a_free_endpoint_is_refused(tmp_path):
    folder = copy_export(tmp_path)
    edit_json(folder, "model.json", lambda m: m.__setitem__("model", "google/gemini-3.1-flash-lite:free"))
    with pytest.raises(ExportError, match="model"):
        load_export(folder)


def test_a_new_reasoning_order_is_picked_up_from_the_folder(tmp_path):
    folder = copy_export(tmp_path)

    def reasoning_first(schema):
        schema["properties"] = {"reasoning": schema["properties"]["reasoning"],
                                **{k: v for k, v in schema["properties"].items() if k != "reasoning"}}

    edit_json(folder, "model.json", lambda m: m.__setitem__("reasoning_position", "before"))
    with pytest.raises(ExportError, match="reasoning_position"):
        load_export(folder)  # the schemas still say "after"

    edit_json(folder, "schema.json", reasoning_first)
    edit_json(folder, "schema_validate.json", reasoning_first)
    body = build_request(load_export(folder), "data:image/jpeg;base64,AA==", "seed")
    assert list(body["response_format"]["json_schema"]["schema"]["properties"])[0] == "reasoning"


def test_an_input_the_export_cannot_serve_is_refused(tmp_path):
    folder = copy_export(tmp_path)
    edit_json(folder, "model.json", lambda m: m.__setitem__("input", "photo_description"))
    with pytest.raises(ExportError, match="photo_description"):
        load_export(folder)


class FakeProvider:
    def __init__(self):
        self.fetched = []

    def fetch_image(self, pano_id, heading):
        self.fetched.append(pano_id)
        return picture()

    def estimated_cost_usd(self, calls):
        return calls * 0.007


def run(photos, cfg, provider=None):
    provider = provider or FakeProvider()
    plan = senses_mod.plan_rating(photos, cfg)
    return list(senses_mod.rate_events(plan, cfg, provider if plan.to_rate else None)), provider


def photo_events(events, status=None):
    return [e for e in events if e["type"] == "photo" and (status is None or e["status"] == status)]


def test_an_invalid_reply_is_retried_once_then_used(calls, cfg):
    made, answers = calls
    answers += [reply("not json", cost=0.0001), reply(json.dumps(GOOD), cost=0.0004)]
    events, _ = run([(PANO, HEADING)], cfg)
    assert len(made) == 2
    ok = photo_events(events, "ok")[0]
    assert ok["result"]["comfort"] == 4
    assert [e["code"] for e in ok["result"]["bothers"]] == ["traffic_trams_crowds"]
    assert ok["cost_usd"] == pytest.approx(0.0005)  # what was paid, both tries
    assert ok["cached"] is False


def test_still_invalid_is_marked_failed_with_the_text_shortened_and_not_cached(calls, cfg, tmp_path):
    made, answers = calls
    answers += [reply("x" * 500), reply("x" * 500)]
    events, _ = run([(PANO, HEADING)], cfg)
    assert len(made) == 2
    failed = photo_events(events, "failed")[0]
    assert "x" * 100 in failed["error"] and "x" * 300 not in failed["error"]
    assert events[-1]["failed"] == 1
    assert not (tmp_path / "senses" / "cache.json").exists()


def test_the_cache_keeps_only_the_output_costs_nothing_and_ignores_another_commit(calls, cfg, tmp_path, monkeypatch):
    made, answers = calls
    answers.append(reply(json.dumps(GOOD)))
    run([(PANO, HEADING)], cfg)

    events, provider = run([(PANO, HEADING)], cfg)  # reopening: no model call and no Street View image
    assert photo_events(events, "ok")[0]["cached"] is True
    assert len(made) == 1 and provider.fetched == []

    stored = json.loads((tmp_path / "senses" / "cache.json").read_text(encoding="utf-8"))
    entry = next(iter(stored.values()))
    assert set(entry) == {"output", "model", "latency_ms", "cost_usd"}
    assert "base64" not in json.dumps(stored)

    other = replace(load_export(), commit="abc1234")
    monkeypatch.setattr(senses_mod, "load_export", lambda: other)
    answers.append(reply(json.dumps(GOOD)))
    assert photo_events(run([(PANO, HEADING)], cfg)[0], "ok")[0]["cached"] is False
    assert len(made) == 2


def test_at_most_the_cap_is_rated_in_order_and_the_rest_is_estimated(calls, cfg):
    made, answers = calls
    cfg.update(cap_photos=2, estimate_call_usd=0.001)
    answers += [reply(json.dumps(GOOD)) for _ in range(2)]
    photos = [(f"pano_number_{i}", HEADING) for i in range(5)]
    events, provider = run(photos, cfg)
    assert sorted(provider.fetched) == ["pano_number_0", "pano_number_1"]
    assert events[0]["remaining"] == 3
    assert events[-1]["remaining"] == 3
    assert events[-1]["estimate_usd"] == pytest.approx(0.003)
    assert events[-1]["estimate_streetview_usd"] == pytest.approx(0.021)

    # Asking again goes on: those rated are now cached and do not count against the cap.
    answers += [reply(json.dumps(GOOD)) for _ in range(2)]
    events, provider = run(photos, cfg)
    assert sorted(provider.fetched) == ["pano_number_2", "pano_number_3"]
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
        return reply(json.dumps(GOOD))

    monkeypatch.setattr(senses_mod, "post_openrouter", slow)
    events, _ = run([(f"pano_number_{i}", HEADING) for i in range(12)], cfg)
    assert len(photo_events(events, "ok")) == 12
    assert 1 < most[0] <= 4


def test_a_refused_key_stops_the_run_instead_of_paying_for_every_image(cfg, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    cfg["concurrency"] = 1

    def refuse(body, key, cfg):
        raise PredictionError(502, "OpenRouter refused the request (401).", fatal=True)

    monkeypatch.setattr(senses_mod, "post_openrouter", refuse)
    events, provider = run([(f"pano_number_{i}", HEADING) for i in range(20)], cfg)
    assert events[-1] == {"type": "error", "message": "OpenRouter refused the request (401)."}
    assert len(provider.fetched) < 20


def test_a_photo_that_cannot_be_loaded_is_marked_failed_and_the_run_goes_on(calls, cfg):
    made, answers = calls
    answers.append(reply(json.dumps(GOOD)))

    class Flaky(FakeProvider):
        def fetch_image(self, pano_id, heading):
            if pano_id == "pano_number_0":
                raise requests.ConnectionError()
            return super().fetch_image(pano_id, heading)

    cfg["concurrency"] = 1
    events, _ = run([("pano_number_0", HEADING), ("pano_number_1", HEADING)], cfg, Flaky())
    assert len(photo_events(events, "failed")) == 1 and len(photo_events(events, "ok")) == 1


def test_the_endpoint_marks_unknown_photos_and_reports_a_missing_key(monkeypatch, tmp_path):
    client = TestClient(main_mod.app)
    body = {"photos": [{"pano_id": PANO, "heading": HEADING}]}
    monkeypatch.setitem(main_mod.cfg["senses"], "cache_file", str(tmp_path / "c.json"))
    res = client.post("/api/senses/rate", json=body)  # not a loaded photo: no model call, and it says so
    assert res.status_code == 200
    events = [json.loads(line) for line in res.text.strip().split("\n")]
    assert photo_events(events, "failed")[0]["error"] == "Not a photo of a loaded area."

    monkeypatch.setattr(main_mod, "_known_photos", {(PANO, HEADING)})
    res = client.post("/api/senses/rate", json=body)
    assert res.status_code == 503
    assert "OPENROUTER_API_KEY" in res.json()["detail"]
