<script setup>
import { KEPT } from '../lib/auth.js'
// "Rate this place" (boards 2c, Routes 5; Elena, 2026-11-16): your own 1–5 for the photo on screen, kept in this browser
// with the prediction that was shown before you rated (lib/myRatings.js). The prediction is taken from what is on
// screen when the buttons appear, and kept up to date only while it changes before you rate (it can arrive while they
// are shown); never after, and never asked again. After rating: "You: 2 · SenCity: 3". Nothing goes to the server.
import { computed, ref, watch } from 'vue'
import { OTHER_MAX, addRating, b2From, latestFor, nextTick, predictionOf, tickOf, updateRating } from '../lib/myRatings.js'
import { senseName } from '../lib/senses.js'
import config from '../config.js'
import SenseIcon from './SenseIcon.vue'
import { useProfileStore } from '../stores/profile.js'
import { useAdjustStore } from '../stores/adjust.js'

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
const adjustments = useAdjustStore()

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

// After rating: "What made the difference? (optional)", the photo's listed elements as chips (one tap +, two taps −, a
// third clears), stored as B2 as the study does; "Something else?" opens a short text, B2_other (Elena, 2026-11-16).
const rows = computed(() => {
  const survey = profile.survey
  if (!survey || !last.value?.prediction?.elements?.length) return []
  const byCode = Object.fromEntries(survey.questions.flatMap((q) => q.rows ?? []).map((r) => [r.code, r]))
  return last.value.prediction.elements.map((code) => byCode[code]).filter(Boolean)
})
const ticks = computed(() => Object.fromEntries(rows.value.map((r) => [r.code, tickOf(last.value?.rating.B2, r.code)])))
function tap(code) {
  const next = { ...ticks.value, [code]: nextTick(ticks.value[code]) }
  last.value = updateRating(last.value.id, { B2: b2From(next) }) ?? last.value
}
const otherOpen = ref(false)
const other = ref('')
// A new rating (or another photo): its own text, open only if it has one.
watch(() => last.value?.id, () => { other.value = last.value?.rating.B2_other ?? ''; otherOpen.value = !!last.value?.rating.B2_other })
function saveOther() {
  if (last.value?.id) last.value = updateRating(last.value.id, { B2_other: other.value }) ?? last.value
}
const word = (t) => (t === '+' ? 'pleasant' : t === '−' ? 'unpleasant' : 'not marked')
const lang = config.language

function rate(n) {
  if (!props.photo) return
  ratedHere = true
  last.value = addRating({ photo: props.photo, B1: n, prediction: shown.value, from: props.from })
  adjustments.refresh() // the gap and "How close" follow the new rating
  profile.ensureSurvey() // the chips' names (part_a.json, nothing personal)
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
      <span><span class="who">SenCity:</span> <strong>{{ last.prediction ? (last.prediction.shown ?? last.prediction.B1) : '–' }}</strong></span>
      <span v-if="!last.prediction" class="muted">(no prediction was shown)</span>
    </p>
    <div v-if="last?.id" class="why" data-testid="rate-why">
      <template v-if="rows.length">
        <p :id="`${titleId}-why`" class="why-title">What made the difference? <span class="muted">(optional)</span></p>
        <p class="muted hint">Tap once for +, twice for −, a third time to clear.</p>
        <div class="chips" role="group" :aria-labelledby="`${titleId}-why`">
          <button v-for="r in rows" :key="r.code" type="button" class="chip" :class="{ plus: ticks[r.code] === '+', minus: ticks[r.code] === '−' }"
                  :aria-label="`${r[lang]}: ${word(ticks[r.code])}`" :data-chip="r.code" @click="tap(r.code)">
            <span class="sign" aria-hidden="true">{{ ticks[r.code] || '' }}</span>
            <SenseIcon :sense="r.icon_key" :label="senseName(r.icon_key)" />
            <span>{{ r[lang] }}</span>
          </button>
        </div>
      </template>
      <button v-if="!otherOpen" type="button" class="link" :aria-expanded="false" @click="otherOpen = true">Something else?</button>
      <label v-else class="other">
        <span class="muted">Something else (optional, kept {{ KEPT }} only)</span>
        <input v-model="other" type="text" :maxlength="OTHER_MAX" data-testid="rate-other" @change="saveOther" @blur="saveOther">
      </label>
    </div>
    <p class="rate-foot">From the photo. Kept {{ KEPT }}; never sent to the model.</p>
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
.why { display: flex; flex-direction: column; gap: var(--space-2); }
.why-title { font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
.hint { font-size: var(--fs-xs); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip {
  display: inline-flex; align-items: center; gap: var(--space-1); min-height: var(--touch); padding: 0 var(--space-3);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-pill); background: transparent; font-size: var(--fs-sm);
}
.chip :deep(.sense-icon) { width: var(--icon-sm); height: var(--icon-sm); color: var(--text-muted); }
.chip .sign { min-width: 0.6em; font-weight: var(--fw-bold); }
.chip.plus { border-color: var(--easy); }
.chip.plus .sign { color: var(--easy); }
.chip.minus { border-color: var(--hard); }
.chip.minus .sign { color: var(--hard-text); }
.link { align-self: flex-start; border: 0; background: none; padding: var(--space-1) 0; min-height: var(--touch); color: var(--text-2); text-decoration: underline; font-size: var(--fs-sm); }
.other { display: flex; flex-direction: column; gap: var(--space-1); }
.other input { min-height: var(--touch); padding: 0 var(--space-3); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn); background: transparent; }
</style>
