"""The optional formula paragraph (app/formula.py; the study's V2 + x̂ and V2 + f, thesis D159, D161, D164).

The expected texts were made by the study's own code (thesis-personas personas.formula_persona_v9 and formula.s_value)
for the made-up profiles of frontend/src/dev/test-profiles.json, with made-up numbers (never fitted on anyone):
tests/fixtures/formula_parity.json. No API calls.
"""
import json
from pathlib import Path

import pytest

from app import formula as formula_mod
from app import profile as profile_mod
from app import senses as senses_mod
from app.senses import ExportError, load_export
from tests.test_profile import CASES, DEV
from tests.test_senses import GOOD, HEADING, PANO, SEEN, FakeProvider, calls, cfg, copy_export, edit_json, edit_text, photo_events, reply  # noqa: F401

XHAT_REF = json.loads((Path(__file__).parent / "fixtures" / "xhat_reference.json").read_text(encoding="utf-8"))
PARITY = json.loads((Path(__file__).parent / "fixtures" / "formula_parity.json").read_text(encoding="utf-8"))["cases"]
COEF = {"intercept": 0.4, "others": 0.65, "s": -0.123}


@pytest.fixture(scope="module")
def fe():
    return formula_mod.load()


@pytest.fixture(scope="module")
def labels():
    return {c: e["en"] for c, e in load_export().elements.items()}


class Crowd:
    def __init__(self, value):
        self.value = value

    def average(self, photo_id, heading):
        return self.value


class Coef:
    def __init__(self, value):
        self.value = value

    def coefficients(self):
        return self.value


# The texts, word for word

@pytest.mark.parametrize("case", PARITY, ids=[f"{c['profile']}-photo{c['photo']}-{c['mode']}" for c in PARITY])
def test_the_formula_versions_are_the_studys_word_for_word(fe, labels, case):
    prof = CASES[case["profile"]]
    pe = profile_mod.load()
    base = profile_mod.build(prof["answers"], prof["language"], pe)
    s = formula_mod.s_value(prof["answers"], case["listed"])
    assert s == pytest.approx(case["s"]) if case["s"] is not None else s is None
    para = formula_mod.paragraph(fe, case["mode"], case["listed"], labels, prof["answers"], case["others"], case["coef"])
    if case["expected"] is None:  # f without s: the study has no text; the app keeps the plain V2
        assert para is None and formula_mod.with_paragraph(base, para) == base
        return
    if case["mode"] == "xhat":  # the study is given x̂; the app computes it from the same formula, so give it that x̂
        xhat = case["xhat"]
        para = fe.texts["xhat"].replace("{XHAT}", formula_mod.fixed(xhat, fe.rules["decimals"]["xhat"]))
    assert formula_mod.with_paragraph(base, para) == case["expected"]


def test_xhat_is_the_formulas_prediction_kept_between_1_and_5_with_one_decimal(fe, labels):
    answers = DEV["answers"]
    listed = ["greenery_trees", "shade"]
    s = formula_mod.s_value(answers, listed)
    text = formula_mod.paragraph(fe, "xhat", listed, labels, answers, 3.0, COEF)
    expected = min(max(0.4 + 0.65 * 3.0 - 0.123 * s, 1), 5)
    assert text == fe.texts["xhat"].replace("{XHAT}", formula_mod.fixed(expected, 1))
    assert "{XHAT}" not in text and text.count(".") >= 1
    high = formula_mod.paragraph(fe, "xhat", listed, labels, answers, 9.0, {"intercept": 2, "others": 1, "s": 0})
    low = formula_mod.paragraph(fe, "xhat", listed, labels, answers, 1.0, {"intercept": -9, "others": 0, "s": 0})
    assert "5.0" in high and "1.0" in low


@pytest.mark.parametrize("case", XHAT_REF["cases"], ids=[c["text"] for c in XHAT_REF["cases"]])
def test_xhat_matches_the_thesis_formula_clip_and_rounding(fe, case):
    """The thesis's path (sklearn Ridge.predict, formula.clip, personas.fixed) on made-up fits, against the app's: the
    formula, then 1-5, then one decimal. Clipped at both ends among the cases."""
    assert XHAT_REF["clip"] == list(formula_mod.CLIP) and XHAT_REF["decimals"] == fe.rules["decimals"]["xhat"]
    x = formula_mod.xhat(case["coef"], case["others"], case["s"])
    assert x == pytest.approx(case["xhat"], abs=1e-9)
    assert formula_mod.fixed(x, fe.rules["decimals"]["xhat"]) == case["text"]


def test_the_references_cover_both_clips():
    assert any(c["raw"] < 1 for c in XHAT_REF["cases"]) and any(c["raw"] > 5 for c in XHAT_REF["cases"])


def test_fixed_rounds_halves_up_and_never_writes_minus_zero():
    assert formula_mod.fixed(2.25, 1) == "2.3" and formula_mod.fixed(3.45, 1) == "3.5" and formula_mod.fixed(1.005, 2) == "1.01"
    assert formula_mod.fixed(-0.004, 2) == "0.00" and formula_mod.fixed(-0.04, 1) == "0.0" and formula_mod.fixed(3, 1) == "3.0"


# s, in code

def test_s_is_the_unweighted_mean_of_your_answers_for_the_listed_elements():
    answers = {"A11": 3, "A12": {"greenery_trees": 5, "traffic_trams": 1, "signs_ads": 2}, "A13": {"shade": 4}, "A16": ""}
    assert formula_mod.s_value(answers, ["greenery_trees", "shade"]) == 4.5
    assert formula_mod.s_value(answers, ["greenery_trees", "traffic_trams", "shade"]) == pytest.approx(10 / 3)
    assert formula_mod.s_value(answers, ["shade", "crowds"]) == 4  # an unanswered element does not count
    # None of the listed elements answered (or nothing listed): the mean of all your answers, as the study.
    assert formula_mod.s_value(answers, ["crowds"]) == 3 and formula_mod.s_value(answers, []) == 3
    assert formula_mod.s_value({"A11": 3, "A12": {}, "A13": {}}, ["shade"]) is None


# Falling back to none

@pytest.mark.parametrize("crowd, coef", [(None, COEF), (3.2, None), (None, None)])
def test_a_missing_number_falls_back_to_the_plain_v2_and_says_nothing(crowd, coef, labels):
    pe = profile_mod.load()
    base = profile_mod.build(DEV["answers"], "en", pe)
    for mode in ("xhat", "f"):
        plan = formula_mod.plan(mode, DEV["answers"], Crowd(crowd), Coef(coef))
        assert plan.mode_for(PANO, HEADING) == "none"
        used, text = plan.profile_for(base, PANO, HEADING, SEEN, labels)
        assert used == "none" and text == base and "formula" not in text


def test_the_default_sources_have_no_numbers_so_every_mode_is_none(labels):
    assert formula_mod.NoCrowdAverage().average(PANO, HEADING) is None and formula_mod.NoCoefficients().coefficients() is None
    for mode in formula_mod.MODES:
        plan = formula_mod.plan(mode, DEV["answers"])
        assert plan.mode_for(PANO, HEADING) == "none"


def test_an_unknown_mode_is_refused():
    with pytest.raises(ExportError, match="formula_mode"):
        formula_mod.plan("x-hat", DEV["answers"])


def test_the_config_default_is_none():
    from app import main as main_mod
    assert main_mod.cfg["senses"]["formula_mode"] == "none"


# The request

def run_with(photos, cfg, text, plan, stamps=None):
    p = senses_mod.plan_rating(photos, cfg, text, stamps, plan)
    return list(senses_mod.rate_events(p, cfg, FakeProvider() if p.to_rate else None))


@pytest.mark.parametrize("mode", ["none", "xhat", "f"])
def test_the_rating_call_has_the_paragraph_for_its_mode_and_the_stamp_says_which(calls, cfg, fe, labels, mode):
    calls.ratings.append(reply(GOOD))
    export = load_export()
    base = profile_mod.build(DEV["answers"], "en", profile_mod.load())
    plan = formula_mod.plan(mode, DEV["answers"], Crowd(3.45), Coef(COEF))
    events = run_with([(PANO, HEADING)], cfg, base, plan)
    system = calls.made[1]["messages"][0]["content"]
    para = formula_mod.paragraph(fe, mode, SEEN, labels, DEV["answers"], 3.45, COEF)
    assert system == export.system.rstrip() + "\n\n" + formula_mod.with_paragraph(base, para)
    if mode == "none":
        assert system == export.system.rstrip() + "\n\n" + base
    else:
        assert para in system and system.endswith("\n\n" + base.rpartition("\n\n")[2])
    ok = photo_events(events, "ok")[0]
    key = ok["stamp"]["formula"]
    assert key == "none" if mode == "none" else key == f"{mode}:{formula_mod.inputs_hash(COEF, 3.45)}"
    # The presence call never has the profile or the formula.
    assert all(m["role"] == "user" for m in calls.made[0]["messages"])


def test_a_kept_rating_is_asked_again_when_its_formula_mode_changes(calls, cfg):
    calls.ratings.append(reply(GOOD))
    base = profile_mod.build(DEV["answers"], "en", profile_mod.load())
    none = formula_mod.plan("none", DEV["answers"])
    stamp = photo_events(run_with([(PANO, HEADING)], cfg, base, none), "ok")[0]["stamp"]
    assert senses_mod.plan_rating([(PANO, HEADING)], cfg, base, {(PANO, HEADING): stamp}, none).kept
    xhat = formula_mod.plan("xhat", DEV["answers"], Crowd(3.0), Coef(COEF))
    assert not senses_mod.plan_rating([(PANO, HEADING)], cfg, base, {(PANO, HEADING): stamp}, xhat).kept
    # The same mode with no numbers is none: the kept rating still holds.
    assert senses_mod.plan_rating([(PANO, HEADING)], cfg, base, {(PANO, HEADING): stamp},
                                  formula_mod.plan("xhat", DEV["answers"])).kept


def test_new_numbers_alone_make_a_kept_rating_stale(calls, cfg):
    """Same mode, same profile, same photo: a new others' average or new coefficients ask again; the same numbers keep."""
    calls.ratings.append(reply(GOOD))
    base = profile_mod.build(DEV["answers"], "en", profile_mod.load())
    first = formula_mod.plan("f", DEV["answers"], Crowd(3.4), Coef(COEF))
    stamp = photo_events(run_with([(PANO, HEADING)], cfg, base, first), "ok")[0]["stamp"]
    kept = lambda plan: bool(senses_mod.plan_rating([(PANO, HEADING)], cfg, base, {(PANO, HEADING): stamp}, plan).kept)  # noqa: E731
    assert kept(formula_mod.plan("f", DEV["answers"], Crowd(3.4), Coef(dict(COEF))))
    assert not kept(formula_mod.plan("f", DEV["answers"], Crowd(3.5), Coef(COEF)))
    assert not kept(formula_mod.plan("f", DEV["answers"], Crowd(3.4), Coef({**COEF, "s": -0.124})))
    assert not kept(formula_mod.plan("xhat", DEV["answers"], Crowd(3.4), Coef(COEF)))  # same numbers, other mode


def test_the_endpoint_accepts_the_stamp_it_gave():
    from app.main import RatingStamp
    key = f"xhat:{formula_mod.inputs_hash(COEF, 3.0)}"
    assert RatingStamp(listed=[], model="m", commit="abc1234", formula=key).formula == key
    with pytest.raises(ValueError):
        RatingStamp(listed=[], model="m", commit="abc1234", formula="xhat")


def test_general_predictions_never_get_a_formula(calls, cfg):
    calls.ratings.append(reply(GOOD))
    plan = formula_mod.plan("f", DEV["answers"], Crowd(3.0), Coef(COEF))
    events = run_with([(PANO, HEADING)], cfg, None, plan)
    rating = calls.made[1]
    assert rating["messages"][0]["content"] == load_export().system.rstrip()
    assert "stamp" not in photo_events(events, "ok")[0]


# The export

def test_the_formula_files_are_hash_checked_and_their_placeholders_required(tmp_path):
    folder = copy_export(tmp_path)
    (folder / "formula_f.txt").write_text("changed", encoding="utf-8")
    with pytest.raises(ExportError, match="formula_f.txt does not match"):
        formula_mod.load(folder)
    folder = copy_export(tmp_path / "again")
    edit_text(folder, "formula_xhat.txt", "{XHAT}", "{X}")
    with pytest.raises(ExportError, match="formula_xhat.txt must have"):
        formula_mod.load(folder)
    folder = copy_export(tmp_path / "rules")
    edit_json(folder, "formula_rules.json", lambda r: r["decimals"].update(xhat="one"))
    with pytest.raises(ExportError, match="formula_rules.json"):
        formula_mod.load(folder)


def test_the_exported_texts_are_the_studys_and_carry_no_numbers(fe):
    assert fe.texts["xhat"].startswith("A formula learned from other people's answers predicts that you would rate")
    assert fe.rules["decimals"]["xhat"] == 1
    for text in fe.texts.values():
        assert not any(ch.isdigit() for ch in text.replace("1 to 5", "").replace("1 and 5", ""))
