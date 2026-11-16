<script setup>
// "Rate this place" (boards 2c, Routes 5; Elena, 2026-11-16): your own 1–5 for the photo on screen, kept in this browser
// with the prediction that was shown before you rated (lib/myRatings.js). The prediction is taken from what is on
// screen when the buttons appear, and kept up to date only while it changes before you rate (it can arrive while they
// are shown); never after, and never asked again. After rating: "You: 2 · SenCity: 3". Nothing goes to the server.
import { computed, ref, watch } from 'vue'
import { addRating, latestFor, predictionOf } from '../lib/myRatings.js'
import { useProfileStore } from '../stores/profile.js'

const props = defineProps({
  /** The photo on screen: { id, heading, source }. */
  photo: { type: Object, default: null },
  /** Its rating as shown (the model's result), or null: not rated yet, or could not be rated. */
  result: { type: Object, default: null },
  /** Where you rate from: 'map' (a place or stretch card), 'photo' (enlarged), 'walk'. */
  from: { type: String, required: true },
  phone: Boolean,
})
const emit = defineEmits(['rated'])
const profile = useProfileStore()

const key = computed(() => (props.photo ? `${props.photo.id}|${props.photo.heading}` : null))
/** The prediction on screen for this photo, kept for the rating. */
const shown = ref(null)
/** The last rating of this photo, in this browser. */
const last = ref(null)
function capture() {
  shown.value = predictionOf(props.result, profile.version)
}
/** You rated while these buttons are shown: what was on screen is kept as it was. */
let ratedHere = false
// When the buttons appear for a photo: what is on screen then, and its last rating.
watch(key, () => {
  ratedHere = false
  capture()
  last.value = props.photo ? latestFor(props.photo.id) : null
}, { immediate: true })
// A prediction that appears while the buttons are shown, before you rate, was on screen before you rated.
watch(() => props.result, () => { if (!ratedHere) capture() })

function rate(n) {
  if (!props.photo) return
  ratedHere = true
  last.value = addRating({ photo: props.photo, B1: n, prediction: shown.value, from: props.from })
  emit('rated', last.value)
}
const titleId = `rate-title-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <div v-if="photo" class="rate" :class="{ phone }" data-testid="rate-this-place">
    <div class="rate-row">
      <span :id="titleId" class="rate-title">Rate this place</span>
      <div role="group" :aria-labelledby="titleId" class="rate-buttons">
        <button v-for="n in 5" :key="n" type="button" class="rate-btn" :class="{ on: last?.rating.B1 === n }"
                :aria-label="`Rate ${n} of 5`" :aria-pressed="last?.rating.B1 === n" @click="rate(n)">{{ n }}</button>
      </div>
    </div>
    <p v-if="last" class="compare" aria-live="polite" data-testid="rate-compare">
      <span><span class="who">You:</span> <strong>{{ last.rating.B1 }}</strong></span>
      <span class="sep" aria-hidden="true">·</span>
      <span><span class="who">SenCity:</span> <strong>{{ last.prediction ? last.prediction.B1 : '–' }}</strong></span>
      <span v-if="!last.prediction" class="muted">(no prediction was shown)</span>
    </p>
    <p class="rate-foot">From the photo. Kept on this device; not used by the model yet.</p>
  </div>
</template>

<style scoped>
p { margin: 0; }
.rate { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-4); }
.rate-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.rate-title { font-weight: var(--fw-semibold); }
.rate-buttons { display: flex; gap: var(--space-2); }
.rate-btn {
  width: var(--rate-w); height: var(--rate-h); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn);
  background: transparent; font-weight: var(--fw-semibold);
}
.rate-btn.on { background: var(--btn-primary-bg); border-color: var(--btn-primary-bg); color: var(--btn-primary-text); }
.phone .rate-btn { width: var(--rate-w-phone); height: var(--rate-h-phone); }
.compare { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); font-size: var(--fs-sm); }
.who { color: var(--text-2); }
.sep { color: var(--text-muted); }
.muted { color: var(--text-muted); font-size: var(--fs-xs); }
.rate-foot { font-size: var(--fs-xs); color: var(--text-muted); }
</style>
