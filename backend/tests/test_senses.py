"""Senses mode: the request is built from model/app_v0/ as it is on disk, and replies are validated. No API calls."""
import base64
import io
import json
import shutil

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main as main_mod
from app import senses as senses_mod
from app.senses import EXPORT_DIR, ExportError, PredictionError, build_request, encode_image, load_export, parse_reply

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
    return {"url": "https://example.invalid", "timeout_s": 1, "cache_file": str(tmp_path / "senses" / "cache.json")}


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

    body = build_request(export, encode_image(data, export.model["image"]))

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
    assert len(user_message["content"]) == 1  # the image is the only user content
    part = user_message["content"][0]
    assert part["type"] == "image_url"
    prefix = f"data:{model['image']['mime_type']};base64,"
    assert part["image_url"]["url"] == prefix + base64.b64encode(data).decode("ascii")  # a small JPEG goes unchanged


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


@pytest.mark.parametrize("name", ["system_instructions.txt", "schema.json", "schema_validate.json", "elements.json",
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
    body = build_request(load_export(folder), "data:image/jpeg;base64,AA==")
    assert list(body["response_format"]["json_schema"]["schema"]["properties"])[0] == "reasoning"


def test_an_input_the_export_cannot_serve_is_refused(tmp_path):
    folder = copy_export(tmp_path)
    edit_json(folder, "model.json", lambda m: m.__setitem__("input", "photo_description"))
    with pytest.raises(ExportError, match="photo_description"):
        load_export(folder)


def test_an_invalid_reply_is_retried_once_then_used(calls, cfg):
    made, answers = calls
    answers += [reply("not json", cost=0.0001), reply(json.dumps(GOOD), cost=0.0004)]
    result = senses_mod.predict(picture(), PANO, HEADING, cfg, lambda: True)
    assert len(made) == 2
    assert result["comfort"] == 4
    assert [e["code"] for e in result["bothers"]] == ["traffic_trams_crowds"]
    assert result["cost_usd"] == pytest.approx(0.0005)  # what was paid, both tries
    assert result["cached"] is False


def test_still_invalid_is_an_error_with_the_text_shortened_and_nothing_cached(calls, cfg, tmp_path):
    made, answers = calls
    answers += [reply("x" * 500), reply("x" * 500)]
    with pytest.raises(PredictionError) as e:
        senses_mod.predict(picture(), PANO, HEADING, cfg, lambda: True)
    assert len(made) == 2
    assert e.value.status == 502 and "x" * 100 in e.value.message and "x" * 300 not in e.value.message
    assert not (tmp_path / "senses" / "cache.json").exists()


def test_the_cache_keeps_only_the_output_and_ignores_another_commit(calls, cfg, tmp_path, monkeypatch):
    made, answers = calls
    answers.append(reply(json.dumps(GOOD)))
    senses_mod.predict(picture(), PANO, HEADING, cfg, lambda: True)

    again = senses_mod.predict(picture(), PANO, HEADING, cfg, lambda: False)  # no model call needed, so no limit
    assert again["cached"] is True and len(made) == 1

    stored = json.loads((tmp_path / "senses" / "cache.json").read_text(encoding="utf-8"))
    entry = next(iter(stored.values()))
    assert set(entry) == {"output", "model", "latency_ms", "cost_usd"}
    assert "base64" not in json.dumps(stored)

    export = load_export()
    other = senses_mod.Export(export.system, export.schema, export.validator, export.elements, export.model, "abc1234")
    monkeypatch.setattr(senses_mod, "load_export", lambda: other)
    answers.append(reply(json.dumps(GOOD)))
    assert senses_mod.predict(picture(), PANO, HEADING, cfg, lambda: True)["cached"] is False
    assert len(made) == 2


def test_the_endpoint_refuses_unknown_photos_and_reports_a_missing_key(monkeypatch):
    client = TestClient(main_mod.app)
    url = f"/api/senses/predict?pano_id={PANO}&heading={HEADING}"
    assert client.post(url, content=picture()).status_code == 404

    monkeypatch.setattr(main_mod, "_known_photos", {(PANO, HEADING)})
    monkeypatch.setitem(main_mod.cfg["senses"], "cache_file", "runs/senses/does-not-exist-in-tests.json")
    res = client.post(url, content=picture())
    assert res.status_code == 503
    assert "OPENROUTER_API_KEY" in res.json()["detail"]
