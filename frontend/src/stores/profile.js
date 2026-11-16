import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import config from '../config.js'
import { loadSurvey } from '../lib/api.js'
import * as personalRatings from '../lib/personalRatings.js'
import { buildProfile, clean, complete, emptyAnswers, exportFile, profileVersion, readFile } from '../lib/profile.js'
import { clampStart, personalLimits, setPersonalLimits, standardLimits } from '../lib/thermal.js'
import { cleanWeather } from '../lib/weather.js'
import { allRatings, clearRatings, setRatings } from '../lib/myRatings.js'

// On this device only (phase 1, brief §12): no server, no sign-in. "Delete my profile" removes both keys and the
// personal ratings (lib/personalRatings.js).
export const SAVED_KEY = 'sencity-profile'
export const DRAFT_KEY = 'sencity-profile-draft'
export const CONSENT_KEY = 'sencity-consent'
/** The onboarding, one question group per screen: the eight-senses intro, A11, A12, A13, A16 (part_a.json), then the
 *  app's own Weather step (lib/weather.js; Elena, 2026-11-15). */
export const STEPS = ['intro', 'A11', 'A12', 'A13', 'A16', 'weather']

/** A start moved by hand: a number in the bar's range, or nothing. */
function cleanThermal(t) {
  if (!t || typeof t !== 'object') return null
  const out = {}
  for (const side of ['heat', 'cold']) if (Number.isFinite(t[side])) out[side] = t[side]
  return Object.keys(out).length ? out : null
}

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null')
    return v && typeof v === 'object' ? v : null
  } catch {
    return null // blocked storage or a broken value: as if nothing was saved
  }
}
function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked (private mode): the profile lasts for this visit only.
  }
}

/**
 * Your sensory profile. `profile`: { language, answers, text, version, saved, weather, thermal } once the onboarding is
 * finished, else null ("not personalised yet"). `draft`: the onboarding in progress, { answers, weather, step, editing },
 * kept when you leave halfway. The text and version are built here from the survey (lib/profile.js), as the server
 * builds them for each rating. `weather` ({ hot, cold, wind }: 1–5) and `thermal` (the start of hot and of cold moved by
 * hand on the profile's bar, °C, or null) set the personal Thermal limits; they are kept apart from `answers`, so they
 * never enter the profile text or a request to the model.
 */
export const useProfileStore = defineStore('profile', () => {
  const survey = ref(null)
  const surveyStatus = ref('idle') // 'idle' | 'loading' | 'ready' | 'error'
  const surveyError = ref('')
  const profile = ref(read(SAVED_KEY))
  const draft = ref(read(DRAFT_KEY))
  // "Before you start" (ConsentScreen): agreed once on this device, before a new profile or an import.
  const consent = ref(read(CONSENT_KEY))
  const consented = computed(() => !!consent.value?.agreed)
  /** An import waiting for the consent screen. */
  const consentFor = ref(null)
  /** The consent screen shows: an import is waiting for it, or a new profile is about to start without it. */
  const askingConsent = computed(() => !consented.value && (!!consentFor.value || (!!draft.value && !draft.value.editing)))
  function agree() {
    consent.value = { agreed: new Date().toISOString() }
    write(CONSENT_KEY, consent.value)
    const next = consentFor.value
    consentFor.value = null
    return next
  }
  /** Not now: nothing is kept (a new profile's empty start goes too). */
  function decline() {
    consentFor.value = null
    if (draft.value && !draft.value.editing) discardDraft()
  }
  if (profile.value && !(profile.value.answers && ['en', 'it'].includes(profile.value.language))) profile.value = null

  const personal = computed(() => !!profile.value)
  /** Changes when the profile changes: ratings made with another one are not used (stores/senses.js). */
  const version = computed(() => profile.value?.version ?? null)

  let loading = null
  function ensureSurvey() {
    if (survey.value) return Promise.resolve(survey.value)
    if (loading) return loading
    surveyStatus.value = 'loading'
    surveyError.value = ''
    loading = loadSurvey().then((s) => {
      survey.value = s
      surveyStatus.value = 'ready'
      return s
    }).catch((err) => {
      surveyStatus.value = 'error'
      surveyError.value = err.status === 404 ? 'The API is out of date. Restart npm run dev, then retry.'
        : err.message || 'The questions could not be loaded. Retry.'
      return null
    }).finally(() => { loading = null })
    return loading
  }

  async function save(answers, language, weather = profile.value?.weather ?? {}, thermal = profile.value?.thermal ?? null) {
    const s = await ensureSurvey()
    if (!s) return false
    const a = clean(s, answers)
    if (!complete(s, a)) return false
    const text = buildProfile(s, a, language)
    profile.value = { language, answers: a, text, version: await profileVersion(text), saved: new Date().toISOString(),
      weather: cleanWeather(weather), thermal: cleanThermal(thermal) }
    write(SAVED_KEY, profile.value)
    personalRatings.keepOnly(profile.value.version) // ratings made with an earlier version are not used again
    return true
  }

  // The personal Thermal limits follow the weather answers and the starts moved by hand; none without a profile.
  const limits = computed(() => (profile.value ? personalLimits(profile.value.weather, profile.value.thermal) : null))
  watch(limits, (l) => setPersonalLimits(l), { immediate: true })

  /** Move the start of hot ('heat') or of cold ('cold') on the profile's bar: kept with the profile, local only. */
  function setStart(side, value) {
    const p = profile.value
    if (!p) return
    const l = personalLimits(p.weather, p.thermal) ?? standardLimits()
    const other = side === 'heat' ? l.cold[0] : l.heat[0]
    p.thermal = { ...(p.thermal ?? {}), [side]: clampStart(side, value, other) }
    profile.value = { ...p }
    write(SAVED_KEY, profile.value)
  }
  /** One answer changed on the profile page (the overall comfort bar): the profile is built again, as after an edit. */
  async function setAnswer(code, value) {
    const p = profile.value
    if (!p || p.answers[code] === value) return false
    return save({ ...p.answers, [code]: value }, p.language)
  }
  /** Reset: the starts from the weather answers again. */
  function resetStarts() {
    if (!profile.value) return
    profile.value = { ...profile.value, thermal: null }
    write(SAVED_KEY, profile.value)
  }

  // A changed export (a new template) gives a new text: built again when the survey arrives, so the version shown is
  // the one the server uses.
  watch(survey, async (s) => {
    const p = profile.value
    if (!s || !p) return
    const text = buildProfile(s, clean(s, p.answers), p.language)
    if (text !== p.text) await save(p.answers, p.language)
  })

  /** Open the onboarding: where you left it, or from the start; with your answers when you edit them. */
  function begin(step = null) {
    if (!draft.value) {
      const editing = !!profile.value
      draft.value = { answers: editing ? JSON.parse(JSON.stringify(profile.value.answers)) : emptyAnswers(),
        weather: editing ? { ...(profile.value.weather ?? {}) } : {}, step: 0, editing }
    }
    if (step != null) draft.value.step = Math.max(0, Math.min(STEPS.length - 1, step))
    write(DRAFT_KEY, draft.value)
    ensureSurvey()
  }
  function setStep(step) {
    if (!draft.value) return
    draft.value.step = Math.max(0, Math.min(STEPS.length - 1, step))
    write(DRAFT_KEY, draft.value)
  }
  /** One answer: A11 or A16 (row null), a grid row, or a weather row ('weather', hot | cold | wind). */
  function answer(code, value, row = null) {
    if (!draft.value) return
    if (code === 'weather') draft.value.weather = { ...(draft.value.weather ?? {}), [row]: value }
    else if (row) draft.value.answers[code] = { ...draft.value.answers[code], [row]: value }
    else draft.value.answers[code] = value
    write(DRAFT_KEY, draft.value)
  }
  /** Finish the onboarding (or an edit): build and save the profile. */
  async function finish() {
    if (!draft.value) return false
    const before = profile.value
    const weather = cleanWeather(draft.value.weather)
    // New weather answers: the bar follows them again (a start moved by hand goes back to the answers).
    const sameWeather = before && JSON.stringify(cleanWeather(before.weather)) === JSON.stringify(weather)
    const ok = await save(draft.value.answers, config.language, weather, sameWeather ? before.thermal : null)
    if (ok) discardDraft()
    return ok
  }
  function discardDraft() {
    draft.value = null
    write(DRAFT_KEY, null)
  }

  /** "Delete my profile": answers, text, draft, consent and the personal ratings; "not personalised yet" again. */
  function deleteAll() {
    profile.value = null
    draft.value = null
    consent.value = null
    write(SAVED_KEY, null)
    write(DRAFT_KEY, null)
    write(CONSENT_KEY, null)
    personalRatings.clearAll()
    clearRatings() // your own photo ratings too
  }

  const fileData = () => (profile.value ? exportFile(profile.value, allRatings()) : null)

  /** Import a file saved with "Download my data". Returns '' or the error to show. */
  async function importData(data) {
    const s = await ensureSurvey()
    if (!s) return surveyError.value
    const read = readFile(s, data)
    if (read.error) return read.error
    await save(read.answers, read.language, read.weather ?? {}, read.thermal ?? null)
    setRatings(read.myRatings) // the file's own ratings replace this browser's
    discardDraft()
    return ''
  }

  /** Dev mode only: the made-up profile of the tests (src/dev/test-profiles.json). Never in a production build. */
  async function loadTestProfile() {
    if (!import.meta.env.DEV) return
    const { default: cases } = await import('../dev/test-profiles.json')
    if (!consented.value) agree()
    await save(cases[0].answers, cases[0].language, cases[0].weather ?? {}, null)
    discardDraft()
  }

  return { survey, surveyStatus, surveyError, profile, draft, personal, version, consented, consentFor, askingConsent, agree,
    decline, ensureSurvey, begin, setStep, answer, limits, setStart, resetStarts, setAnswer,
    finish, discardDraft, deleteAll, fileData, importData, loadTestProfile }
})
