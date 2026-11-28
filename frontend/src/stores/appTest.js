import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { finishAppTest, getAppTest, rateSenses, saveAppTestAnswer, startAppTest } from '../lib/api.js'
import { SKIPPED_KEY, answerOf, estimateOf, nextIndex } from '../lib/appTest.js'
import * as personalRatings from '../lib/personalRatings.js'
import { requestProfile } from '../lib/profile.js'

/**
 * The in-app test (D197; docs/decisions.md 2026-11-28): optional, after sign-in and the profile. The same photos for
 * everyone, in the order the server gives (config/app_test.json). For each: the app's estimate for this person (the
 * same personal prediction as the map, POST /api/senses/rate), then their own B1, then whether the reasons were right.
 *
 * It is offered right after the profile questions (Elena, 2026-11-28): an intro with the consent box, Start (only once
 * ticked) or "Skip for now" (to the map; nothing is saved, only this browser remembers the skip). The "Rate 8 places"
 * entry (account menu, Profile) opens the same intro until the test is finished; an unfinished test goes on at the next
 * photo without an answer. Each answer is sent as it is given, so leaving halfway keeps what was answered.
 */

function skippedHere() {
  try { return !!localStorage.getItem(SKIPPED_KEY) } catch { return false }
}
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
  /** The entry point shows: the test is open and not finished (an unfinished one goes on where it stopped). */
  const available = computed(() => status.value === 'ready' && !finished.value)
  const started = computed(() => consent.value === 'yes')

  /** Load once (the menu, the profile page and the end of the profile all ask). */
  let loading = null
  function ensureLoaded() {
    if (status.value === 'ready' || status.value === 'closed') return Promise.resolve()
    loading ??= load().finally(() => { loading = null })
    return loading
  }

  /** Right after a new profile is saved: the intro, if the test is open and not started yet (Elena, 2026-11-28). */
  async function offerAfterProfile(router) {
    await ensureLoaded()
    if (available.value && !started.value) router.push({ path: '/app-test', query: { from: 'profile' } })
  }

  /** "Skip for now": nothing is sent; this browser remembers it, for skipped_first if the person starts later. */
  function skip() {
    try { localStorage.setItem(SKIPPED_KEY, new Date().toISOString()) } catch { /* blocked: not remembered */ }
  }

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

  /** The consent screen answered: with the tick a session is opened on the server (with where it started and whether
   *  it was skipped before); without, nothing is sent. */
  async function choose(agreed, entry = 'later') {
    saveError.value = ''
    if (!agreed) {
      consent.value = 'no'
      return true
    }
    try {
      await startAppTest({ entry, skippedFirst: skippedHere() })
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
    photo, atEnd, rated, saving, available, started, load, ensureLoaded, offerAfterProfile, skip, choose, estimate, shown, submit }
})
