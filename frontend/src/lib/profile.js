// Your sensory profile, in the browser: the answers to Part A, the text built from them, and the file you can export.
// Every question and template word comes from model/app_v9/ through GET /api/profile/survey; none is written here.
// The text is built as the server and the study build it (backend/app/profile.py); the tests check both against texts
// made by the study's own code (src/dev/test-profiles.json).

export const GRIDS = ['A12', 'A13']
export const A16_MAX = 2000
/** The export file: what it is and its format, so an older or foreign file is refused. */
export const FILE_KIND = 'SenCity sensory profile'
export const FILE_FORMAT = 1

const question = (survey, code) => survey.questions.find((q) => q.code === code)
export const gridRows = (survey, grid) => question(survey, grid)?.rows ?? []

const isScore = (v) => Number.isInteger(v) && v >= 1 && v <= 5

/** A new, empty set of answers. */
export function emptyAnswers() {
  return { A11: null, A12: {}, A13: {}, A16: '' }
}

/** Whether a question is answered as the survey requires: A11 1–5, every row of a grid 1–5; A16 is optional. */
export function answered(survey, answers, code) {
  if (code === 'A11') return isScore(answers.A11)
  if (GRIDS.includes(code)) return gridRows(survey, code).every((r) => isScore(answers[code]?.[r.code]))
  return true
}

/** Every required answer is there. */
export const complete = (survey, answers) => ['A11', ...GRIDS].every((c) => answered(survey, answers, c))

/** The answers as the profile and the server use them: only known rows, scores 1–5, A16 trimmed. */
export function clean(survey, answers) {
  const out = { A11: isScore(answers?.A11) ? answers.A11 : null, A16: typeof answers?.A16 === 'string' ? answers.A16.trim().slice(0, A16_MAX) : '' }
  for (const g of GRIDS) {
    out[g] = {}
    for (const r of gridRows(survey, g)) if (isScore(answers?.[g]?.[r.code])) out[g][r.code] = answers[g][r.code]
  }
  return out
}

/**
 * The filled profile_template.txt, as profile_rules.json says (and as the study does): the A11 line left out if A11
 * is missing; one line per answered element, A12 rows then A13 rows, "  - <en name>: <answer>, <scale word>", and those
 * lines and the line above them left out if none is answered; the A16 line left out if A16 is empty. English labels;
 * A16 verbatim. No trailing newline.
 */
export function buildProfile(survey, answers, language) {
  const { template, constants, scale_words_en: scale, languages } = survey.profile
  const grid = { ...(answers.A12 ?? {}), ...(answers.A13 ?? {}) }
  const elements = GRIDS.flatMap((g) => gridRows(survey, g))
    .filter((r) => Number.isInteger(grid[r.code]))
    .map((r) => `  - ${r.en}: ${grid[r.code]}, ${scale[grid[r.code] - 1]}`)
  let text = template
  for (const [key, value] of Object.entries(constants)) text = text.replaceAll(key, value)
  text = text.replaceAll('{LANGUAGE}', languages[language])
  const lines = text.replace(/\n+$/, '').split('\n')
  const above = lines.findIndex((l) => l.includes('{ELEMENTS}')) - 1
  const out = []
  lines.forEach((line, i) => {
    if (line.includes('{A11}')) {
      if (Number.isInteger(answers.A11)) out.push(line.replace('{A11}', String(answers.A11)))
    } else if (line.includes('{ELEMENTS}')) {
      out.push(...elements)
    } else if (line.includes('{A16}')) {
      if (answers.A16) out.push(line.replace('{A16}', () => answers.A16))
    } else if (i === above) {
      if (elements.length) out.push(line)
    } else {
      out.push(line)
    }
  })
  return out.join('\n')
}

/** The profile version: the first 12 hex digits of the text's sha256, as on the server. */
export async function profileVersion(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}

/** The answers a prediction may use: Part A's profile questions only. Anything else kept with the profile (the weather,
 *  how you prepare for new places, A15) stays on this device and never goes into the model call. */
export const PROMPT_CODES = ['A11', 'A12', 'A13', 'A16']

/** What a rating request carries: the profile answers and the language, never the text (the server builds it). */
export const requestProfile = (profile) => profile && ({
  language: profile.language,
  ...Object.fromEntries(PROMPT_CODES.filter((c) => c in (profile.answers ?? {})).map((c) => [c, profile.answers[c]])),
})

/** The file "Download my data" saves. */
export function exportFile(profile, myRatings = []) {
  return {
    kind: FILE_KIND,
    format: FILE_FORMAT,
    saved: profile.saved,
    language: profile.language,
    answers: profile.answers,
    profile: profile.text,
    version: profile.version,
    weather: profile.weather ?? {}, // the Weather step: local only, never in the profile text
    thermal: profile.thermal ?? null, // the starts of hot and cold moved by hand on the profile's bar
    myRatings, // your own photo ratings, with the prediction shown before each (lib/myRatings.js)
  }
}

/**
 * The answers and language of an imported file, or an error message. The text in the file is not trusted: it is
 * built again from the answers.
 */
export function readFile(survey, data) {
  if (!data || data.kind !== FILE_KIND || data.format !== FILE_FORMAT) return { error: 'This is not a SenCity profile file.' }
  if (!['en', 'it'].includes(data.language)) return { error: 'The file names a language the app does not know.' }
  const answers = clean(survey, data.answers)
  if (!complete(survey, answers)) return { error: 'The file does not answer every question the profile needs.' }
  const thermal = data.thermal && typeof data.thermal === 'object' ? data.thermal : null
  return { answers, language: data.language, weather: data.weather ?? {}, thermal, myRatings: Array.isArray(data.myRatings) ? data.myRatings : [] }
}

/** The elements as bothers / feels good, strongest first (board 5, "Strongest for you"): 1–2 bother, 4–5 feel good. */
export function strongest(survey, answers, count = 4) {
  const rows = GRIDS.flatMap((g) => gridRows(survey, g))
  const score = (r) => answers[GRIDS.find((g) => r.code in (answers[g] ?? {}))]?.[r.code]
  const bothers = rows.filter((r) => score(r) <= 2).sort((a, b) => score(a) - score(b))
  const good = rows.filter((r) => score(r) >= 4).sort((a, b) => score(b) - score(a))
  const pick = []
  for (let i = 0; pick.length < count && (i < bothers.length || i < good.length); i++) {
    if (bothers[i]) pick.push({ row: bothers[i], kind: 'bothers', score: score(bothers[i]) })
    if (good[i] && pick.length < count) pick.push({ row: good[i], kind: 'good', score: score(good[i]) })
  }
  return pick
}

/** The eight senses in the order the onboarding first shows them (the main sense of each grid row, A12 then A13). */
export function senseOrder(survey) {
  return [...new Set(GRIDS.flatMap((g) => gridRows(survey, g).map((r) => r.icon_key)))]
}

/**
 * The radar of the profile (board 5; Elena, 2026-11-15: the first version, with tapping and a list): one axis per sense,
 * in the onboarding's order; each element counts only for its main sense (icon_key). Per sense, on 1–5: what bothers
 * you = 6 − the lowest answer (its most unpleasant element), what feels good = the highest answer (its most pleasant
 * one); all "neither" is 3 and 3. A sense with no answered element has null for both: a gap. From the stored answers.
 */
export function senseScores(survey, answers) {
  const rows = GRIDS.flatMap((g) => gridRows(survey, g).map((r) => ({ ...r, value: answers[g]?.[r.code] })))
  return senseOrder(survey).map((sense) => {
    const elements = rows.filter((r) => r.icon_key === sense && Number.isInteger(r.value))
      .map((r) => ({ code: r.code, en: r.en, it: r.it, value: r.value }))
    if (!elements.length) return { sense, elements, bothers: null, good: null }
    const values = elements.map((e) => e.value)
    return { sense, elements, bothers: 6 - Math.min(...values), good: Math.max(...values) }
  })
}

/**
 * One shape of the radar (what feels good, or what bothers) as an SVG path: a line between two neighbouring senses that
 * both have answers; a sense without is a gap. Filled only when no sense is missing. `xy(i, value)` gives "x y".
 * Shared by the profile's radar and the printed report.
 */
export function radarShape(scores, key, xy) {
  if (scores.every((x) => x[key] != null)) return { d: `M ${scores.map((x, i) => xy(i, x[key])).join(' L ')} Z`, filled: true }
  const parts = []
  scores.forEach((x, i) => {
    const next = scores[(i + 1) % scores.length]
    if (x[key] != null && next[key] != null) parts.push(`M ${xy(i, x[key])} L ${xy((i + 1) % scores.length, next[key])}`)
  })
  return { d: parts.join(' '), filled: false }
}
