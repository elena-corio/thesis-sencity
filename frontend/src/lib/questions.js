// The profile questions' layout (Elena, 2026-11-28): config/profile_questions.json, checked by the API and served with
// the survey as `layout`. It sets which onboarding questions are shown, their order inside each part, and the words on
// screen. Only the screen changes: the stored keys and answers stay, and the profile text is built from the export's
// own labels (lib/profile.js), never from these.

export const PROFILE_KEYS = ['intro', 'A11', 'A12', 'A13', 'A16', 'weather']
export const PREPARE_KEYS = ['Q1', 'Q2', 'Q3', 'Q4']

const entries = (survey, part) => survey?.layout?.[part] ?? (part === 'profile' ? PROFILE_KEYS : PREPARE_KEYS).map((key) => ({ key }))
const entry = (survey, key) => [...entries(survey, 'profile'), ...entries(survey, 'prepare')].find((e) => e.key === key) ?? null

/** The shown steps of one part, in the layout's order (the usual order without a layout). */
export function stepsOf(survey, part) {
  return entries(survey, part).filter((e) => e.shown !== false).map((e) => e.key)
}

/** A question's title or help on screen: the layout's words in this language, else the given ones. */
export function textOf(survey, key, field, fallback, lang) {
  const t = entry(survey, key)?.[field]
  return t?.[lang] ?? t?.en ?? fallback
}

/** A grid row's, weather row's or option's label on screen: the layout's, else the given one. */
export function rowText(survey, key, code, fallback, lang) {
  const t = entry(survey, key)?.rows?.[code]
  return t?.[lang] ?? t?.en ?? fallback
}
