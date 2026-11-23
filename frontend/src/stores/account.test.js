// With accounts (Elena, 2026-11-22): the profile and own ratings come from and go to the API under the account;
// nothing is saved before the privacy notice is agreed; sign-out keeps the account's data on the server; "Delete my
// account and data" deletes on the server, then signs out. Clerk and the API are mocked; local storage is in memory.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  server: { consented: false, profile: null, ratings: [] },
  calls: [],
}))
vi.mock('../lib/auth.js', () => ({ AUTH_ON: true, PUBLISHABLE_KEY: 'pk_test', signOut: vi.fn(async () => api.calls.push('signOut')) }))
vi.mock('../lib/api.js', () => ({
  loadSurvey: async () => null,
  getAccount: async () => ({ consented: api.server.consented }),
  agreeConsent: async () => { api.calls.push('consent'); api.server.consented = true; return { consented: true } },
  getProfile: async () => ({ profile: api.server.profile, consented: api.server.consented }),
  putProfile: async (p) => { api.calls.push('putProfile'); api.server.profile = p; return { saved: true } },
  getOwnRatings: async () => api.server.ratings,
  putOwnRatings: async (list) => { api.calls.push(`putRatings:${list.length}`); api.server.ratings = list; return {} },
  deleteAccount: async () => { api.calls.push('deleteAccount'); api.server = { consented: false, profile: null, ratings: [] }; return {} },
}))

class MemoryStorage {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}
const PROFILE = { language: 'en', answers: { A11: 2, A12: {}, A13: {}, A16: '' }, text: 't', version: 'v1', saved: '2026-11-22', weather: {}, thermal: null, prepare: null }

let useProfileStore, myRatings
beforeEach(async () => {
  globalThis.localStorage = new MemoryStorage()
  globalThis.sessionStorage = new MemoryStorage()
  api.server = { consented: false, profile: null, ratings: [] }
  api.calls = []
  vi.resetModules()
  ;({ useProfileStore } = await import('./profile.js'))
  myRatings = await import('../lib/myRatings.js')
  setActivePinia(createPinia())
})

describe('your profile with an account', () => {
  it('starts empty: nothing is read from this browser', () => {
    globalThis.localStorage.setItem('sencity-profile', JSON.stringify(PROFILE))
    expect(useProfileStore().profile).toBe(null)
  })

  it('asks for the privacy notice when it was never agreed', async () => {
    expect(await useProfileStore().syncAccount()).toBe('notice')
    expect(api.calls).toEqual([])
  })

  it('records the notice agreed before sign-up, then loads the account’s profile and ratings', async () => {
    api.server.profile = PROFILE
    api.server.ratings = [{ id: 'r1', photo: { id: 'p' }, rating: { B1: 3, B2: null, B2_other: null }, prediction: null, at: 'x', from: 'map' }]
    const store = useProfileStore()
    store.consentPending()
    expect(await store.syncAccount()).toBe('ok')
    expect(api.calls).toEqual(['consent'])
    expect(store.consented).toBe(true)
    expect(store.profile).toEqual(PROFILE)
    expect(myRatings.allRatings()).toHaveLength(1)
    expect(globalThis.sessionStorage.getItem('sencity-consent-pending')).toBe(null)
  })

  it('a new rating goes to the account', async () => {
    api.server.consented = true
    const store = useProfileStore()
    await store.syncAccount()
    myRatings.addRating({ photo: { id: 'p1', heading: 0, source: 'mapillary' }, B1: 4, prediction: null, from: 'map' })
    expect(api.calls).toContain('putRatings:1')
    expect(globalThis.localStorage.getItem('sencity-my-ratings')).toBe(null) // not in this browser
  })

  it('sign-out forgets everything here and keeps the account’s data on the server', async () => {
    api.server.consented = true
    api.server.profile = PROFILE
    api.server.ratings = [{ id: 'r1', photo: { id: 'p' }, rating: { B1: 3, B2: null, B2_other: null }, prediction: null, at: 'x', from: 'map' }]
    const store = useProfileStore()
    await store.syncAccount()
    await store.signOutAll()
    expect(store.profile).toBe(null)
    expect(api.calls).toEqual(['signOut']) // no empty list sent: the ratings stay
    expect(api.server.ratings).toHaveLength(1)
    expect(api.server.profile).toEqual(PROFILE)
  })

  it('"Delete my account and data": the server first, then sign-out', async () => {
    api.server.consented = true
    api.server.profile = PROFILE
    const store = useProfileStore()
    await store.syncAccount()
    expect(await store.deleteAll()).toBe('')
    expect(api.calls).toEqual(['deleteAccount', 'signOut'])
    expect(api.server.profile).toBe(null)
    expect(store.profile).toBe(null)
  })

  it('a profile from this browser is offered once for the account, then leaves the browser', async () => {
    api.server.consented = true
    globalThis.localStorage.setItem('sencity-profile', JSON.stringify(PROFILE))
    const store = useProfileStore()
    await store.syncAccount()
    expect(store.deviceProfile).toEqual(PROFILE)
    store.dropDeviceProfile()
    expect(store.deviceProfile).toBe(null)
    expect(globalThis.localStorage.getItem('sencity-profile')).toBe(null)
  })
})
