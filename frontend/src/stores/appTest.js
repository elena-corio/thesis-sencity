import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { finishAppTest, getAppTest, rateSenses, saveAppTestAnswer, startAppTest } from '../lib/api.js'
import { answerOf, estimateOf, nextIndex } from '../lib/appTest.js'
import * as personalRatings from '../lib/personalRatings.js'
import { requestProfile } from '../lib/profile.js'

/**
 * The in-app test (D197; docs/decisions.md 2026-11-28): optional, after sign-in and the profile. The same photos for
 * everyone, in the order the server gives (config/app_test.json). For each: the app's estimate for this person (the
 * same personal prediction as the map, POST /api/senses/rate), then their own B1, then whether the reasons were right.
 *
 * Saving needs the test's own tick (`consent` 'yes'). Without it the flow works the same, but nothing is sent: no
 * session, no answer, no end. With it, each answer is sent as it is given, so leaving halfway keeps what was answered.
 */
export const useAppTestStore = defineStore('appTest', () => {
  const status = ref('idle') // 'idle' | 'loading' | 'ready' | 'closed' | 'error'
  const error = ref('')
  const photos = ref([])
  const infoSheetUrl = ref('')
  const freeTextMax = ref(500)
  /** 'unset' until the consent screen is answered, then 'yes' (saved) or 'no' (nothing saved). */
  const consent = ref('unset')
  /** The photo on screen (0-based, in the fixed order); photos.length = the end. */
  const index = ref(0)
  /** Per photo id: { status: 'pending' | 'ok' | 'failed', estimate, result } */
  const estimates = ref({})
  /** Per photo id: the answer as given here ({ rating, … }), whether or not it is saved. */
  const answers = ref({})
  const shownAt = ref({})
  const saveError = ref('')
  const finished = ref(false)
  /** The places rated, from the server once saved, else counted here. */
  const ratedOnServer = ref(null)

  const photo = computed(() => photos.value[index.value] ?? null)
  const atEnd = computed(() => photos.value.length > 0 && index.value >= photos.value.length)
  const rated = computed(() => ratedOnServer.value ?? Object.values(answers.value).filter((a) => a.rating != null).length)
  const saving = computed(() => consent.value === 'yes')

  /** The photos and, with an earlier opt-in, where the person left off. */
  async function load() {
    status.value = 'loading'
    error.value = ''
    try {
      const data = await getAppTest()
      photos.value = data.photos
      infoSheetUrl.value = data.info_sheet_url
      freeTextMax.value = data.free_text_max ?? 500
      if (data.session) { // agreed before: go on where they left, or the end
        consent.value = 'yes'
        finished.value = data.session.finished
        ratedOnServer.value = data.session.rated
        index.value = data.session.finished ? photos.value.length : nextIndex(photos.value, data.session.answered)
      }
      status.value = 'ready'
    } catch (err) {
      status.value = err.status === 503 ? 'closed' : 'error'
      error.value = err.message || 'The test could not be loaded. Try again.'
    }
  }

  /** The consent screen answered: with the tick a session is opened on the server; without, nothing is sent. */
  async function choose(agreed) {
    saveError.value = ''
    if (!agreed) {
      consent.value = 'no'
      return true
    }
    try {
      await startAppTest()
      consent.value = 'yes'
      return true
    } catch (err) {
      saveError.value = err.message || 'Your consent could not be recorded. Try again.'
      return false
    }
  }

  /** The app's estimates for every photo, with the profile as it is now (cached ones answer at once, at no cost). */
  async function estimate(profile) {
    if (!profile) return
    const req = photos.value.map((p) => {
      const mine = profile.version && personalRatings.find(p, profile.version)
      estimates.value[p.id] = { status: 'pending', estimate: null, result: null }
      return { id: p.id, heading: p.heading, ...(mine ? { cached: mine.stamp } : {}) }
    })
    const byId = Object.fromEntries(photos.value.map((p) => [p.id, p]))
    try {
      await rateSenses(req, (e) => {
        if (e.type !== 'photo' || !byId[e.id]) return // an 'error' event ends the stream: the rest count as failed
        const p = byId[e.id]
        let result = null
        let stamp = null
        if (e.status === 'keep') {
          const mine = personalRatings.find(p, profile.version)
          result = mine?.result ?? null
          stamp = mine?.stamp ?? null
        } else if (e.status === 'ok') {
          result = e.result
          stamp = e.stamp ?? null
          if (stamp && profile.version) personalRatings.keep(p, profile.version, stamp, result)
        }
        const est = estimateOf(result, stamp, profile.version)
        estimates.value[e.id] = est ? { status: 'ok', estimate: est, result } : { status: 'failed', estimate: null, result: null }
      }, undefined, requestProfile(profile))
    } catch {
      // the stream failed: what has not arrived counts as failed below
    }
    for (const p of photos.value) {
      if (estimates.value[p.id]?.status === 'pending') estimates.value[p.id] = { status: 'failed', estimate: null, result: null }
    }
  }

  /** The photo is on screen (its estimate settled): the "shown" time, once. */
  function shown(id) {
    if (!shownAt.value[id]) shownAt.value[id] = new Date().toISOString()
  }

  /** One photo answered (rating null: skipped). Saved only with the tick; the next photo either way. */
  async function submit({ rating, reasonsRight = null, freeText = '' }) {
    const p = photo.value
    if (!p) return false
    saveError.value = ''
    const est = estimates.value[p.id]?.estimate ?? null
    const body = answerOf({ photo: p, estimate: est, rating, reasonsRight, freeText, shownAt: shownAt.value[p.id] ?? new Date().toISOString(),
      answeredAt: new Date().toISOString() })
    if (saving.value) {
      try {
        await saveAppTestAnswer(body)
      } catch (err) {
        saveError.value = err.message || 'Your answer could not be saved. Check your connection and try again.'
        return false
      }
    }
    answers.value[p.id] = { rating: body.rating, reasons_right: body.reasons_right }
    index.value += 1
    if (atEnd.value) await finish()
    return true
  }

  async function finish() {
    if (finished.value) return
    finished.value = true
    if (!saving.value) return
    try {
      const { session } = await finishAppTest()
      ratedOnServer.value = session?.rated ?? null
    } catch {
      // the answers are saved one by one already; only the end time is missing
    }
  }

  return { status, error, photos, infoSheetUrl, freeTextMax, consent, index, estimates, answers, saveError, finished,
    photo, atEnd, rated, saving, load, choose, estimate, shown, submit }
})
