// The in-app test (D197): nothing is sent without the test's own tick, the photos come in the server's fixed order and
// are walked through in it, a skipped photo's rating is null (never 0), and an earlier opt-in goes on where it left.
// The API is mocked; the estimates come from a fake rating stream.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ calls: [], session: null, rateFails: false, started: null }))
const PHOTOS = [
  { order: 1, id: 'sv:AAAAAAAAAAAA', source: 'streetview', pano_id: 'AAAAAAAAAAAA', heading: 10, name: 'One' },
  { order: 2, id: 'sv:BBBBBBBBBBBB', source: 'streetview', pano_id: 'BBBBBBBBBBBB', heading: 20, name: 'Two' },
  { order: 3, id: '123456789', source: 'mapillary', heading: 30, name: 'Three' },
]
const element = (code) => ({ code, n: 1, en: code, it: code, icon_key: 'sight' })
vi.mock('../lib/api.js', () => ({
  getAppTest: async () => ({ photos: PHOTOS, info_sheet_url: 'https://example.org/sheet', free_text_max: 500, session: api.session }),
  startAppTest: async (how) => { api.calls.push('start'); api.started = how; return { session: { finished: false, answered: [], rated: 0 } } },
  saveAppTestAnswer: async (a) => { api.calls.push(['answer', a]); return { saved: true } },
  finishAppTest: async () => { api.calls.push('finish'); return { session: { finished: true, answered: [], rated: 1 } } },
  rateSenses: async (photos, onEvent) => {
    api.calls.push(['rate', photos.map((p) => p.id)])
    if (api.rateFails) throw new Error('down')
    for (const p of photos.slice(0, 2)) {
      onEvent({ type: 'photo', id: p.id, heading: p.heading, status: 'ok',
        result: { comfort: 2, bothers: [element('traffic_trams')], feels_good: [], model: 'm', personal: true },
        stamp: { listed: [], model: 'm', commit: 'abcdef1', prompt: 'p3' } })
    }
    onEvent({ type: 'photo', id: photos[2].id, heading: 30, status: 'failed', error: 'x' })
  },
}))

class MemoryStorage {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
}
const PROFILE = { language: 'en', answers: { A11: 2, A12: { traffic_trams: 1 }, A13: {}, A16: '' }, version: 'v1' }
const saved = () => api.calls.filter((c) => Array.isArray(c) && c[0] === 'answer').map((c) => c[1])

let store
beforeEach(async () => {
  globalThis.localStorage = new MemoryStorage()
  api.calls = []
  api.session = null
  api.rateFails = false
  vi.resetModules()
  setActivePinia(createPinia())
  const { useAppTestStore } = await import('./appTest.js')
  store = useAppTestStore()
  await store.load()
})

async function answerAll(consented) {
  await store.choose(consented)
  await store.estimate(PROFILE)
  await store.submit({ rating: 4, reasonsRight: 'partly', freeText: ' ok ' })
  await store.submit({ rating: null }) // skipped
  await store.submit({ rating: 1, reasonsRight: 'yes' })
}

describe('the app test', () => {
  it('sends nothing without the tick, yet runs to the end', async () => {
    await answerAll(false)
    expect(store.consent).toBe('no')
    expect(api.calls.filter((c) => c === 'start' || c === 'finish')).toEqual([])
    expect(saved()).toEqual([])
    expect(store.atEnd).toBe(true)
    expect(store.rated).toBe(2) // counted here: the skipped one is not a rating
  })

  it('with the tick, opens a session and sends each answer in the fixed order', async () => {
    await answerAll(true)
    expect(api.calls[0]).toBe('start')
    expect(saved().map((a) => [a.order, a.photo_id])).toEqual(PHOTOS.map((p) => [p.order, p.id]))
    expect(api.calls.at(-1)).toBe('finish')
    expect(store.rated).toBe(1) // the server's count
  })

  it('keeps the server\'s order and asks for every estimate at once, in it', async () => {
    expect(store.photos.map((p) => p.id)).toEqual(PHOTOS.map((p) => p.id))
    await store.choose(true)
    await store.estimate(PROFILE)
    expect(api.calls.find((c) => c[0] === 'rate')[1]).toEqual(PHOTOS.map((p) => p.id))
    expect(store.photo.id).toBe(PHOTOS[0].id)
  })

  it('saves a skipped rating as null, never 0, and the reasons only with an estimate', async () => {
    await answerAll(true)
    const [first, second, third] = saved()
    expect(first.rating).toBe(4)
    expect(first.reasons_right).toBe('partly')
    expect(first.free_text).toBe('ok')
    expect(first.estimate).toMatchObject({ comfort: 2, level: 'hard', bothers: ['traffic_trams'], commit: 'abcdef1', profile_version: 'v1' })
    expect(second.rating).toBe(null)
    expect(second.reasons_right).toBe(null)
    expect(third.estimate).toBe(null) // the model failed for this photo
    expect(third.reasons_right).toBe(null)
    expect(saved().every((a) => a.rating !== 0)).toBe(true)
  })

  it('marks every estimate as failed when the rating stream fails', async () => {
    api.rateFails = true
    await store.choose(false)
    await store.estimate(PROFILE)
    expect(Object.values(store.estimates).map((e) => e.status)).toEqual(['failed', 'failed', 'failed'])
  })

  it('"Skip for now" sends nothing and keeps the way back in', async () => {
    store.skip()
    expect(api.calls).toEqual([])
    expect(globalThis.localStorage.getItem('sencity-app-test-skipped')).toBeTruthy()
    expect(store.available).toBe(true) // the "Rate 8 places" entry stays
    expect(store.started).toBe(false)
  })

  it('says where it started and whether it was skipped first', async () => {
    await store.choose(true, 'profile')
    expect(api.started).toEqual({ entry: 'profile', skippedFirst: false })
    setActivePinia(createPinia())
    const { useAppTestStore } = await import('./appTest.js')
    const later = useAppTestStore()
    await later.load()
    later.skip()
    await later.choose(true, 'later')
    expect(api.started).toEqual({ entry: 'later', skippedFirst: true })
  })

  it('offers the intro after a new profile only while the test is open and not started', async () => {
    const pushed = []
    const router = { push: (to) => pushed.push(to) }
    await store.offerAfterProfile(router)
    expect(pushed).toEqual([{ path: '/app-test', query: { from: 'profile' } }])
    await store.choose(true, 'profile')
    await store.offerAfterProfile(router)
    expect(pushed).toHaveLength(1) // started: not again
  })

  it('is gone from the entry point once the photos are done', async () => {
    await answerAll(true)
    expect(store.available).toBe(false)
  })

  it('goes on where an earlier opt-in left off', async () => {
    api.session = { finished: false, answered: [PHOTOS[0].id], rated: 1 }
    await store.load()
    expect(store.consent).toBe('yes')
    expect(store.index).toBe(1)
    expect(store.photo.id).toBe(PHOTOS[1].id) // the next unrated photo, in the fixed order
    await store.estimate(PROFILE)
    await store.submit({ rating: 3 })
    expect(saved().map((a) => [a.order, a.photo_id])).toEqual([[2, PHOTOS[1].id]]) // nothing sent again for photo 1
  })
})
