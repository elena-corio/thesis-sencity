import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { adjustedCloseness, meanGap, personalEntries } from '../lib/adjust.js'
import { MIN_RATINGS, allRatings } from '../lib/myRatings.js'
import { ENABLE_ADJUST } from '../config.js'

/** "Adjust to my own ratings (experimental)": on or off, on this device only; off when nothing is kept. */
export const ADJUST_KEY = 'sencity-adjust'

function readOn() {
  try {
    return JSON.parse(localStorage.getItem(ADJUST_KEY) ?? 'null')?.on === true
  } catch {
    return false // blocked storage or a broken value: off
  }
}
function writeOn(on) {
  try {
    if (on) localStorage.setItem(ADJUST_KEY, JSON.stringify({ on: true }))
    else localStorage.removeItem(ADJUST_KEY)
  } catch {
    // Storage blocked: the setting lasts for this visit only.
  }
}

/**
 * The on-device correction of personal predictions (lib/adjust.js; Elena, 2026-11-21). `entries`: your own ratings,
 * read again after each new rating, an import or a delete (`refresh`). `gap`: the shift in use, or null (off, or under
 * MIN_RATINGS personal ratings, or the feature is disabled: config.js ENABLE_ADJUST). Never in a request: the senses
 * store applies it to what is shown. `enabled`: the feature is shown at all.
 */
export const useAdjustStore = defineStore('adjust', () => {
  const entries = ref(allRatings())
  const on = ref(readOn())
  const refresh = () => { entries.value = allRatings() }

  const count = computed(() => personalEntries(entries.value).length)
  const available = computed(() => count.value >= MIN_RATINGS)
  const enabled = ENABLE_ADJUST
  const gap = computed(() => (enabled && on.value ? meanGap(entries.value) : null))
  const closeness = computed(() => adjustedCloseness(entries.value))

  function setOn(value) {
    on.value = !!value
    writeOn(on.value)
  }
  /** "Delete my profile": the setting goes too. */
  function reset() {
    on.value = false
    writeOn(false)
    refresh()
  }

  return { enabled, entries, on, count, available, gap, closeness, refresh, setOn, reset }
})
