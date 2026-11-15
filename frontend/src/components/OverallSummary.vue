<script setup>
// The place card on Overall (Elena, 2026-11-15; boards 1, 2b): the overall level; what decides, in plain words ("Hard
// because of heat: feels like 34 °C"); then both parts as small rows, Senses and Thermal, so nothing is hidden; and what
// might bother or feel good. From the values already here: no new call.
import { computed } from 'vue'
import { overallOf, overallReason } from '../lib/overall.js'
import { bySense } from '../lib/senses.js'
import { formatDegrees, isCold } from '../lib/thermal.js'
import SenseItem from './SenseItem.vue'

const props = defineProps({
  /** The street's properties: senses_state, senses_comfort, thermal_state, utci, photos. */
  street: { type: Object, required: true },
  /** The senses place from its photos (stores/senses.js placeFor), or null without a photo. */
  place: { type: Object, default: null },
  /** { season, time } of the thermal part. */
  info: { type: Object, default: null },
  /** The senses part is the person's (else "not personalised yet"). */
  personal: Boolean,
})
const WORD = { easy: 'Easy', mixed: 'Mixed', hard: 'Hard' }
const o = computed(() => overallOf(props.street.senses_state, props.street.thermal_state))
const reason = computed(() => overallReason(o.value, {
  utci: props.street.utci, hot: props.street.utci == null || !isCold(props.street.utci), place: props.place,
  comfort: props.street.senses_comfort ?? props.place?.comfort, personal: props.personal,
}))
const sensesRow = computed(() => {
  const s = props.street.senses_state
  if (WORD[s]) return { state: s, text: `${WORD[s]} · ${props.street.senses_comfort ?? props.place?.comfort} of 5` }
  if (!props.street.photos?.length) return { state: null, text: 'No photo' }
  if (props.place?.status === 'failed' || s === 'failed') return { state: null, text: 'Couldn’t rate this photo' }
  return { state: null, text: 'Waiting for its rating…' }
})
const thermalRow = computed(() => {
  const t = props.street.thermal_state
  if (WORD[t] && props.street.utci != null) return { state: t, text: `${WORD[t]} · feels like ${formatDegrees(props.street.utci)}` }
  return { state: null, text: 'No value' }
})
const when = computed(() => (props.info ? `${props.info.season}, ${props.info.time}` : ''))
const lists = computed(() => (props.place?.status === 'rated' ? [
  { title: 'Might bother you', kind: 'bother', rows: bySense(props.place.bothers) },
  { title: 'Might feel good', kind: 'good', rows: bySense(props.place.feelsGood) },
] : []))
</script>

<template>
  <div class="overall" data-testid="overall">
    <p class="level">
      <span v-if="o.state" class="swatch" :style="{ background: o.partial ? `color-mix(in srgb, var(--${o.state}) var(--partial-mix), transparent)` : `var(--${o.state})` }" />
      <strong v-if="o.state" :class="['state-label', o.state]">{{ WORD[o.state] }}</strong>
      <span>overall</span>
    </p>
    <p class="reason" data-testid="overall-reason">{{ reason }}</p>

    <ul class="parts">
      <li data-testid="overall-senses">
        <span class="part-name">Senses ·</span>
        <span :class="['part-value', sensesRow.state]">{{ sensesRow.text }}</span>
        <span v-if="!personal && sensesRow.state" class="muted">not personalised yet</span>
      </li>
      <li data-testid="overall-thermal">
        <span class="part-name">Thermal ·</span>
        <span :class="['part-value', thermalRow.state]">{{ thermalRow.text }}</span>
        <span v-if="when && thermalRow.state" class="muted">{{ when }}</span>
      </li>
    </ul>

    <section v-for="l in lists" :key="l.kind" class="list">
      <h3>{{ l.title }}</h3>
      <ul v-if="l.rows.length" :class="l.kind">
        <SenseItem v-for="r in l.rows" :key="r.sense" :row="r" :kind="l.kind" />
      </ul>
      <p v-else class="muted">Nothing named.</p>
    </section>
    <p class="foot">The photo rating is from when the photo was taken; the thermal part follows the season and time. A
      prediction, not a reason.</p>
  </div>
</template>

<style scoped>
p, ul, h3 { margin: 0; }
ul { padding: 0; list-style: none; }
.overall { margin-top: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
.level { display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-lg); }
.swatch { width: var(--space-5); height: var(--swatch-h); border-radius: var(--radius-pill); }
.reason { color: var(--text); }
.parts { margin-top: var(--space-2); padding: var(--space-3) var(--space-4); border: var(--hairline) solid var(--line); border-radius: var(--radius-btn); display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--fs-sm); }
.parts li { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-2); align-items: baseline; }
.part-name { color: var(--text-2); }
.part-value { font-weight: var(--fw-semibold); }
.part-value.hard, .state-label.hard { color: var(--hard-text); }
.part-value.mixed, .state-label.mixed { color: var(--mixed); }
.part-value.easy, .state-label.easy { color: var(--easy); }
.muted { color: var(--text-muted); font-size: var(--fs-xs); }
.list { margin-top: var(--space-3); }
.list h3 { font-size: var(--fs-md); font-weight: var(--fw-semibold); }
.list ul { margin-top: var(--space-2); display: flex; flex-direction: column; gap: var(--space-1); }
.foot { margin-top: var(--space-3); font-size: var(--fs-xs); color: var(--text-muted); }
</style>
