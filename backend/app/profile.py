"""Your sensory profile: the survey's Part A (part_a.json) and the profile text built from its answers.

model/app_v9/ is the only source: part_a.json (the eight-senses intro, A11, A12, A13, A16 in EN and IT),
profile_template.txt and profile_rules.json, all checked against MANIFEST.md first (senses.verified_files). The text is
filled exactly as the study does it (thesis-personas, personas.persona_texts_v9, "V2"); the test checks it against
texts made by the study's own code for made-up people (frontend/src/dev/test-profiles.json).

Phase 1 has no profile storage on the server (brief §12): the browser keeps the answers and sends them with each
rating request; the text is built here for that one model call and never stored or logged. Only its hash goes into the
rating cache key, so a changed profile is never answered with the ratings of the old one.
"""
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from . import senses

FILES = ("part_a.json", "profile_template.txt", "profile_rules.json", "elements.json")
GRIDS = ("A12", "A13")
LANGUAGES = {"en": "English", "it": "Italian"}  # profile_rules.json: {LANGUAGE} is "English or Italian"
CONSTANTS = ("{A11_LOW}", "{A11_HIGH}", "{SCALE_1}", "{SCALE_5}")
A16_MAX = 2000  # characters of the open answer


class ProfileError(Exception):
    """The answers do not fit part_a.json. The message names the question, never the answer."""


@dataclass(frozen=True)
class ProfileExport:
    part_a: dict
    template: str
    rules: dict
    icons: dict  # element code → icon_key (its main sense), from elements.json


def load(folder: Path = senses.EXPORT_DIR) -> ProfileExport:
    """Read and check the profile files. Raises senses.ExportError on the first problem."""
    files, _commit, _presence = senses.verified_files(folder)
    missing = [n for n in FILES if n not in files]
    if missing:
        raise senses.ExportError(f"MANIFEST.md has no sha256 for: {', '.join(missing)}.")
    part_a = senses._json(folder, "part_a.json", files["part_a.json"])
    template = senses._text(folder, "profile_template.txt", files["profile_template.txt"])
    rules = senses._json(folder, "profile_rules.json", files["profile_rules.json"])
    elements = senses._json(folder, "elements.json", files["elements.json"])
    try:
        codes = {q["code"]: q for q in part_a["questions"]}
        rows = [r["code"] for g in GRIDS for r in codes[g]["rows"]]
        icons = {e["code"]: e["icon_key"] for e in elements}
        placeholders = rules["placeholders"]
        scale = rules["scale_words_en"]
    except (KeyError, TypeError):
        raise senses.ExportError("part_a.json or profile_rules.json is not in the expected form.") from None
    if [c for c in ("A11", "A12", "A13", "A16") if c not in codes] or sorted(rows) != sorted(icons) or len(scale) != 5:
        raise senses.ExportError("part_a.json must ask A11, A12, A13 and A16, with the 20 elements of elements.json.")
    for key in (*CONSTANTS, "{A11}", "{ELEMENTS}", "{A16}", "{LANGUAGE}"):
        if key not in placeholders or template.count(key) != 1:
            raise senses.ExportError(f"profile_template.txt and profile_rules.json must both have {key} once.")
    return ProfileExport(part_a, template, rules, icons)


def survey(pe: ProfileExport) -> dict:
    """What the onboarding shows and what the browser needs to build the same text: part_a.json as it is, each grid row
    with the icon of its main sense, and the template with its fixed words. No answers, nothing personal."""
    part_a = json.loads(json.dumps(pe.part_a))
    for q in part_a["questions"]:
        for row in q.get("rows", []):
            row["icon_key"] = pe.icons[row["code"]]
    return {
        **part_a,
        "profile": {
            "template": pe.template,
            "constants": {k: pe.rules["placeholders"][k] for k in CONSTANTS},
            "scale_words_en": pe.rules["scale_words_en"],
            "languages": LANGUAGES,
        },
    }


def _questions(pe: ProfileExport) -> dict:
    return {q["code"]: q for q in pe.part_a["questions"]}


def check(answers: dict, language: str, pe: ProfileExport) -> dict:
    """The answers as the profile uses them, after checking them against part_a.json: A11 and every grid row answered
    1-5 (all required in the survey), A16 optional text, trimmed. Raises ProfileError."""
    if language not in LANGUAGES:
        raise ProfileError("The profile's language must be en or it.")
    qs = _questions(pe)
    a11 = answers.get("A11")
    if not isinstance(a11, int) or isinstance(a11, bool) or not 1 <= a11 <= 5:
        raise ProfileError("A11 must be answered 1-5.")
    out = {"A11": a11}
    for grid in GRIDS:
        given = answers.get(grid)
        rows = [r["code"] for r in qs[grid]["rows"]]
        if not isinstance(given, dict) or sorted(given) != sorted(rows):
            raise ProfileError(f"{grid} must answer each of its {len(rows)} elements.")
        if any(not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 5 for v in given.values()):
            raise ProfileError(f"{grid} answers must be 1-5.")
        out[grid] = {c: given[c] for c in rows}
    a16 = answers.get("A16") or ""
    if not isinstance(a16, str) or len(a16) > A16_MAX:
        raise ProfileError(f"A16 must be text of at most {A16_MAX} characters.")
    out["A16"] = a16.strip()
    return out


def build(answers: dict, language: str, pe: ProfileExport) -> str:
    """The filled profile_template.txt, as profile_rules.json says: the A11 line left out if A11 is missing; one line per
    answered element, A12 rows then A13 rows, '  - <en name>: <answer>, <scale word>', and those lines and the line above
    them left out if none is answered; the A16 line left out if A16 is empty. No trailing newline (the study's text)."""
    qs = _questions(pe)
    scale = pe.rules["scale_words_en"]
    grid = {**(answers.get("A12") or {}), **(answers.get("A13") or {})}
    elements = [f"  - {r['en']}: {grid[r['code']]}, {scale[grid[r['code']] - 1]}"
                for g in GRIDS for r in qs[g]["rows"] if isinstance(grid.get(r["code"]), int)]
    a11, a16 = answers.get("A11"), answers.get("A16") or ""
    text = pe.template
    for key in CONSTANTS:
        text = text.replace(key, pe.rules["placeholders"][key])
    text = text.replace("{LANGUAGE}", LANGUAGES[language])
    lines = text.rstrip("\n").split("\n")
    above = next(i for i, line in enumerate(lines) if "{ELEMENTS}" in line) - 1
    out = []
    for i, line in enumerate(lines):
        if "{A11}" in line:
            if isinstance(a11, int):
                out.append(line.replace("{A11}", str(a11)))
        elif "{ELEMENTS}" in line:
            out += elements
        elif "{A16}" in line:
            if a16:
                out.append(line.replace("{A16}", a16))
        elif i == above:
            if elements:
                out.append(line)
        else:
            out.append(line)
    return "\n".join(out)


def version(text: str) -> str:
    """The profile version: the first 12 hex digits of the text's sha256 (the same in the browser)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
