import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { predictSenses } from '../lib/api.js'

/**
 * General predictions (Senses mode, no profile): one per street clicked, for the photo on its card. They stay
 * for the session, also across areas, so places can be compared; nothing is written to the browser's storage.
 * Each: { id, name, photo, point, status: 'loading' | 'ready' | 'error', result, error, token }.
 */
export const useSensesStore = defineStore('senses', () => {
  const entries = ref({})
  const list = computed(() => Object.values(entries.value))
  let last = 0

  const forSegment = (id) => entries.value[id] ?? null

  async function run(id) {
    const entry = entries.value[id]
    const token = ++last
    Object.assign(entry, { token, status: 'loading', result: null, error: '' })
    try {
      const result = await predictSenses(entry.photo)
      if (entries.value[id].token === token) Object.assign(entries.value[id], { status: 'ready', result })
    } catch (err) {
      if (entries.value[id].token === token) Object.assign(entries.value[id], { status: 'error', error: err.message })
    }
  }

  /** Called when a photo is shown in Senses mode. A photo already asked about is not asked again; a failed
   *  one waits for Retry, so reopening a card never spends anything by itself. */
  function ask(id, name, photo, point) {
    const known = entries.value[id]
    if (known && known.photo.pano_id === photo.pano_id && known.photo.heading === photo.heading) {
      known.point = point
      return
    }
    entries.value[id] = { id, name, photo, point, status: 'loading', result: null, error: '', token: 0 }
    run(id)
  }

  return { entries, list, forSegment, ask, retry: run }
})
