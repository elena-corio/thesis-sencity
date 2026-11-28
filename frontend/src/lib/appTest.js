// The in-app test (D197; docs/decisions.md 2026-11-28), pure parts: the survey's wording, the app's estimate as it is
// shown, and the answer as it is saved. Exploratory and separate from the survey study.
import { comfortLevel } from './senses.js'

/** The survey's own words (thesis codebook 2026-11-12, form v9), word for word. */
export const SCENARIO = 'Imagine walking through this place as it is in the photo, at that time of day and in the weather you see.'
export const B1 = {
  title: 'How sensory-comfortable would you be walking through here?',
  help: 'Think of what you can see in the photo.',
  ends: ['Not at all, too much for my senses', 'Very much'],
}
/** The words of each B1 value for screen readers, as the form shows them (only 1 and 5 have words). */
export const B1_WORDS = [B1.ends[0], '', '', '', B1.ends[1]]
export const REASONS = [
  { code: 'yes', label: 'Yes' },
  { code: 'partly', label: 'Partly' },
  { code: 'no', label: 'No' },
]
export const CONSENT_TEXT = 'My ratings and answers may be saved and used anonymously in the thesis.'

const isScore = (v) => Number.isInteger(v) && v >= 1 && v <= 5

/**
 * The app's estimate as the screen shows it, from a rating result and its stamp (POST /api/senses/rate), or null.
 * @param {object | null} result { comfort, bothers: [element], feels_good: [element], model, personal }
 * @param {object | null} stamp { model, commit, prompt }
 * @param {string | null} profileVersion
 */
export function estimateOf(result, stamp, profileVersion) {
  if (!result || !isScore(result.comfort) || !stamp?.commit) return null
  return {
    comfort: result.comfort,
    level: comfortLevel(result.comfort),
    bothers: (result.bothers ?? []).map((e) => e.code),
    feels_good: (result.feels_good ?? []).map((e) => e.code),
    model: stamp.model ?? result.model ?? '',
    commit: stamp.commit,
    prompt: stamp.prompt ?? '',
    profile_version: profileVersion ?? null,
    personal: !!result.personal,
  }
}

/**
 * One photo's answer as it is sent (POST /api/app-test/answer). A rating that is not 1–5 is sent as null, never 0;
 * the reasons answer only with an estimate; the free text trimmed.
 */
export function answerOf({ photo, estimate, rating, reasonsRight, freeText, shownAt, answeredAt }) {
  return {
    photo_id: photo.id,
    order: photo.order,
    estimate: estimate ?? null,
    rating: isScore(rating) ? rating : null,
    reasons_right: estimate && REASONS.some((r) => r.code === reasonsRight) ? reasonsRight : null,
    free_text: (freeText ?? '').trim(),
    shown_at: shownAt,
    answered_at: answeredAt ?? null,
  }
}

/** Where to go on: the first photo, in the fixed order, without an answer yet (photos.length when all have one). */
export function nextIndex(photos, answeredIds = []) {
  const done = new Set(answeredIds)
  const i = photos.findIndex((p) => !done.has(p.id))
  return i < 0 ? photos.length : i
}
