import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import config from '../config.js'
import { haversine, limitRadius } from '../lib/geo.js'

/**
 * Two-click area selection (brief §6 "Study area", boards Flow 1, 1b, 1c).
 * step: 'centre' (Flow 1) → 'radius' (1b) → 'set' (1c) → 'analysed'.
 */
export const useAreaStore = defineStore('area', () => {
  const step = ref('centre')
  /** @type {import('vue').Ref<{lat:number, lon:number} | null>} */
  const centre = ref(null)
  const radius = ref(config.radius.default)
  const capped = ref(false)
  /** The area sent for analysis. @type {import('vue').Ref<{lat:number, lon:number, radius:number} | null>} */
  const analysed = ref(null)
  /** True when the last step was done with the keyboard, so focus can follow. */
  const byKeyboard = ref(false)

  const hasCircle = computed(() => step.value !== 'centre' && centre.value !== null)

  function placeCentre(point, keyboard = false) {
    centre.value = { lat: point.lat, lon: point.lon }
    radius.value = config.radius.default
    capped.value = false
    byKeyboard.value = keyboard
    step.value = 'radius'
  }

  /** Radius from a point on the map: ground distance, rounded, snapped and capped. */
  function radiusTo(point) {
    if (!centre.value) return
    const r = limitRadius(haversine(centre.value, point), config.radius)
    radius.value = r.radius
    capped.value = r.capped
  }

  /** Keyboard: change the radius in 10 m steps within the limits. */
  function nudge(deltaM) {
    const { min, max } = config.radius
    const next = radius.value + deltaM
    capped.value = next > max
    radius.value = Math.min(max, Math.max(min, next))
  }

  function fix(keyboard = false) {
    if (step.value !== 'radius') return
    byKeyboard.value = keyboard
    capped.value = false
    step.value = 'set'
  }

  function analyse(keyboard = false) {
    if (step.value !== 'set' || !centre.value) return
    byKeyboard.value = keyboard
    analysed.value = { lat: centre.value.lat, lon: centre.value.lon, radius: radius.value }
    step.value = 'analysed'
  }

  function reset() {
    step.value = 'centre'
    centre.value = null
    capped.value = false
    radius.value = config.radius.default
  }

  return { step, centre, radius, capped, analysed, byKeyboard, hasCircle, placeCentre, radiusTo, nudge, fix, analyse, reset }
})
