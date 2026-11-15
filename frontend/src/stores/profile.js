import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import config from '../config.js'
import { loadSurvey } from '../lib/api.js'
import { buildProfile, clean, complete, emptyAnswers, exportFile, profileVersion, readFile } from '../lib/profile.js'

// On this device only (phase 1, brief §12): no server, no sign-in. "Delete my profile" removes both keys.
export const SAVED_KEY = 'sencity-profile'
export const DRAFT_KEY = 'sencity-profile-draft'
/** The onboarding, one question group per screen: the eight-senses intro, A11, A12, A13, A16 (part_a.json). */
export const STEPS = ['intro', 'A11', 'A12', 'A13', 'A16']

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
 * Your sensory profile. `profile`: { language, answers, text, version, saved } once the onboarding is finished, else null
 * ("not personalised yet"). `draft`: the onboarding in progress, { answers, step, editing }, kept when you leave halfway.
 * The text and version are built here from the survey (lib/profile.js), as the server builds them for each rating.
 */
export const useProfileStore = defineStore('profile', () => {
  const survey = ref(null)
  const surveyStatus = ref('idle') // 'idle' | 'loading' | 'ready' | 'error'
  const surveyError = ref('')
  const profile = ref(read(SAVED_KEY))
  const draft = ref(read(DRAFT_KEY))
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

  async function save(answers, language) {
    const s = await ensureSurvey()
    if (!s) return false
    const a = clean(s, answers)
    if (!complete(s, a)) return false
    const text = buildProfile(s, a, language)
    profile.value = { language, answers: a, text, version: await profileVersion(text), saved: new Date().toISOString() }
    write(SAVED_KEY, profile.value)
    return true
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
      draft.value = { answers: editing ? JSON.parse(JSON.stringify(profile.value.answers)) : emptyAnswers(), step: 0, editing }
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
  /** One answer: A11 or A16 (row null), or a grid row. */
  function answer(code, value, row = null) {
    if (!draft.value) return
    if (row) draft.value.answers[code] = { ...draft.value.answers[code], [row]: value }
    else draft.value.answers[code] = value
    write(DRAFT_KEY, draft.value)
  }
  /** Finish the onboarding (or an edit): build and save the profile. */
  async function finish() {
    if (!draft.value) return false
    const ok = await save(draft.value.answers, config.language)
    if (ok) discardDraft()
    return ok
  }
  function discardDraft() {
    draft.value = null
    write(DRAFT_KEY, null)
  }

  /** "Delete my profile": answers, text, draft; the app goes back to "not personalised yet". */
  function deleteAll() {
    profile.value = null
    draft.value = null
    write(SAVED_KEY, null)
    write(DRAFT_KEY, null)
  }

  const fileData = () => (profile.value ? exportFile(profile.value) : null)

  /** Import a file saved with "Download my data". Returns '' or the error to show. */
  async function importData(data) {
    const s = await ensureSurvey()
    if (!s) return surveyError.value
    const read = readFile(s, data)
    if (read.error) return read.error
    await save(read.answers, read.language)
    discardDraft()
    return ''
  }

  /** Dev mode only: the made-up profile of the tests (src/dev/test-profiles.json). Never in a production build. */
  async function loadTestProfile() {
    if (!import.meta.env.DEV) return
    const { default: cases } = await import('../dev/test-profiles.json')
    await save(cases[0].answers, cases[0].language)
    discardDraft()
  }

  return { survey, surveyStatus, surveyError, profile, draft, personal, version, ensureSurvey, begin, setStep, answer,
    finish, discardDraft, deleteAll, fileData, importData, loadTestProfile }
})
