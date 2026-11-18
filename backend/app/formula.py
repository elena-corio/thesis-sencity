"""The optional formula paragraph of a personal prediction (the study's V2 + x̂ and V2 + f; thesis D159, D161, D164).

`senses.formula_mode` in config/tool.yaml: none (the study's V2, the default), xhat or f. The texts, their decimals,
placement and words come from model/app_v9/ (formula_xhat.txt, formula_f.txt, formula_rules.json), hash-checked with
the rest of the export; none is written here.

Both versions need numbers learned from other people's answers: the average rating others gave the place, and the
formula's coefficients (x̂ is that formula's prediction, kept between 1 and 5). The app holds no participant data, so
both sources answer None for now (NoCrowdAverage, NoCoefficients): the paragraph is then left out and the prediction is
the plain V2, with nothing said about a formula. s, the mean of your own ratings of the photo's elements, is computed
here, never by the model. Only personal predictions get the paragraph: V0 has no profile.
"""
import hashlib
import json
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Protocol

from . import senses

MODES = ("none", "xhat", "f")
FILES = ("formula_xhat.txt", "formula_f.txt", "formula_rules.json")
GRIDS = ("A12", "A13")
CLIP = (1, 5)  # "kept between 1 and 5" (formula_f.txt); the 1-5 rating scale


class CrowdAverage(Protocol):
    def average(self, photo_id: str, heading: float) -> float | None:
        """The average rating other people gave this photo, or None."""


class Coefficients(Protocol):
    def coefficients(self) -> dict | None:
        """{intercept, others, s} of the formula learned from other people's answers, or None."""


class NoCrowdAverage:
    """No others' averages in the app yet (no participant data): always None."""

    def average(self, photo_id: str, heading: float) -> None:
        return None


class NoCoefficients:
    """No fitted formula in the app (no coefficients fitted on participants): always None."""

    def coefficients(self) -> None:
        return None


@dataclass(frozen=True)
class FormulaExport:
    texts: dict  # mode → its text with placeholders
    rules: dict  # formula_rules.json


def load(folder: Path = senses.EXPORT_DIR) -> FormulaExport:
    """Read and check the formula files. Raises senses.ExportError."""
    files, _commit, _presence = senses.verified_files(folder)
    missing = [n for n in FILES if n not in files]
    if missing:
        raise senses.ExportError(f"MANIFEST.md has no sha256 for: {', '.join(missing)}.")
    rules = senses._json(folder, "formula_rules.json", files["formula_rules.json"])
    try:
        modes, dec, terms = rules["modes"], rules["decimals"], rules["terms"]
        ok = (modes == {"none": None, "xhat": "formula_xhat.txt", "f": "formula_f.txt"}
              and all(isinstance(dec[k], int) and 0 <= dec[k] <= 4 for k in ("xhat", "coef", "others", "s"))
              and all(isinstance(terms[k], str) and terms[k] for k in ("others", "s")))
    except (KeyError, TypeError):
        ok = False
    if not ok:
        raise senses.ExportError("formula_rules.json is not in the expected form.")
    texts = {m: senses._text(folder, name, files[name]).rstrip("\n") for m, name in modes.items() if name}
    for mode, keys in (("xhat", ("{XHAT}",)), ("f", ("{FORMULA}", "{OTHERS}", "{S}", "{ELEMENTS}"))):
        if any(texts[mode].count(k) != 1 for k in keys):
            raise senses.ExportError(f"{modes[mode]} must have {', '.join(keys)} once each.")
    return FormulaExport(texts, rules)


def fixed(x: float, decimals: int) -> str:
    """x with a fixed number of decimals, halves rounded up (2.25 -> 2.3), never "-0.0" (as the study writes them)."""
    q = Decimal(str(x)).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP)
    return format(q + 0, "f")


def s_value(answers: dict, listed: list) -> float | None:
    """s: the unweighted mean of your A12/A13 answers for the photo's listed elements; if none of them is answered, the
    mean of all your A12/A13 answers; None without any (formula_rules.json {S}; the study's formula.s_value)."""
    ratings = {c: v for g in GRIDS for c, v in (answers.get(g) or {}).items()
               if isinstance(v, int) and not isinstance(v, bool)}
    values = [ratings[c] for c in listed if c in ratings] or list(ratings.values())
    return sum(values) / len(values) if values else None


def xhat(coef: dict, others: float, s: float) -> float:
    """x̂ as the thesis computes it: the formula (intercept + others' average and s, raw scales), then clipped to 1-5.
    Rounding to one decimal comes after, when it is written (fixed). tests/fixtures/xhat_reference.json pins it."""
    return min(max(coef["intercept"] + coef["others"] * others + coef["s"] * s, CLIP[0]), CLIP[1])


def inputs_hash(coef: dict, others: float) -> str:
    """The first 12 hex digits of the sha256 of the numbers a formula paragraph is made from (the coefficients and the
    others' average): part of a personal rating's stamp, so new numbers make a kept rating stale. s is not in it: it
    comes from your profile, whose version already keys the rating."""
    data = json.dumps({"coef": {k: coef[k] for k in ("intercept", "others", "s")}, "others": others}, sort_keys=True)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()[:12]


def _formula_text(fe: FormulaExport, coef: dict) -> str:
    d, terms = fe.rules["decimals"]["coef"], fe.rules["terms"]

    def term(c, words):
        return f" {'-' if c < 0 else '+'} {fixed(abs(c), d)} × {words}"
    return fixed(coef["intercept"], d) + term(coef["others"], terms["others"]) + term(coef["s"], terms["s"])


def paragraph(fe: FormulaExport, mode: str, listed: list, labels: dict, answers: dict, others: float | None,
              coef: dict | None) -> str | None:
    """The filled formula text for one photo, or None when it cannot be filled (mode none, no others' average, no
    coefficients, or no s): the prediction is then the plain V2. labels: code → en name, in elements.json order."""
    s = s_value(answers, listed)
    if mode == "none" or others is None or coef is None or s is None:
        return None
    dec = fe.rules["decimals"]
    if mode == "xhat":
        return fe.texts["xhat"].replace("{XHAT}", fixed(xhat(coef, others, s), dec["xhat"]))
    names = "; ".join(labels[c] for c in labels if c in listed)
    return (fe.texts["f"].replace("{FORMULA}", _formula_text(fe, coef)).replace("{OTHERS}", fixed(others, dec["others"]))
            .replace("{S}", fixed(s, dec["s"])).replace("{ELEMENTS}", names))


def with_paragraph(profile_text: str, text: str | None) -> str:
    """The profile text with the formula paragraph before its closing line, blank lines around it (formula_rules.json
    placement); unchanged without one."""
    if not text:
        return profile_text
    head, _, closing = profile_text.rpartition("\n\n")
    return f"{head}\n\n{text}\n\n{closing}"


@dataclass(frozen=True)
class FormulaPlan:
    """The formula of one personal request: the mode in config, the export, your answers and the two sources."""
    mode: str
    export: FormulaExport | None
    answers: dict
    crowd: CrowdAverage
    coef: Coefficients

    def mode_for(self, photo_id: str, heading: float) -> str:
        """The mode this photo gets: none whenever a number is missing (s is always there for a checked profile)."""
        return self.key_for(photo_id, heading).partition(":")[0]

    def key_for(self, photo_id: str, heading: float) -> str:
        """What a personal rating of this photo is made from, for its stamp: "none", or "<mode>:<inputs_hash>"."""
        if self.mode == "none":
            return "none"
        others, coef = self.crowd.average(photo_id, heading), self.coef.coefficients()
        if others is None or coef is None:
            return "none"
        return f"{self.mode}:{inputs_hash(coef, others)}"

    def text(self, photo_id: str, heading: float, listed: list, labels: dict) -> tuple[str, str | None]:
        """(the stamp key used, the paragraph or None) for this photo and its listed elements."""
        key = self.key_for(photo_id, heading)
        if key == "none":
            return "none", None
        para = paragraph(self.export, self.mode, listed, labels, self.answers, self.crowd.average(photo_id, heading),
                         self.coef.coefficients())
        return (key, para) if para else ("none", None)

    def profile_for(self, profile_text: str, photo_id: str, heading: float, listed: list,
                    labels: dict) -> tuple[str, str]:
        """(the stamp key used, the profile text for this photo): with the paragraph before the closing line, or
        unchanged."""
        mode, para = self.text(photo_id, heading, listed, labels)
        return mode, with_paragraph(profile_text, para)


def plan(mode: str, answers: dict, crowd: CrowdAverage | None = None, coef: Coefficients | None = None) -> FormulaPlan:
    """The formula plan for a personal request. Raises senses.ExportError for an unknown mode or broken files."""
    if mode not in MODES:
        raise senses.ExportError(f"senses.formula_mode must be one of {', '.join(MODES)}, not {mode!r}.")
    return FormulaPlan(mode, load() if mode != "none" else None, answers, crowd or NoCrowdAverage(),
                       coef or NoCoefficients())
