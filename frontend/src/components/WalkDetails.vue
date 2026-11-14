<script setup>
// The stretch ahead, in the walk's right column (WalkView): name, length and time; the comfort
// label and its reason; what might bother and what might feel good, in two columns; and "Rate this place", drawn as on
// the boards and not built yet (Elena, 2026-11-11: Coming soon). Details are always shown. Everything comes from what is
// loaded: the Senses ratings already here, never a new call.
import { computed } from 'vue'
import { stretchLine } from '../lib/routes.js'
import { bySense } from '../lib/senses.js'
import { comfortLine } from '../lib/walk.js'
import { useSensesStore } from '../stores/senses.js'
import { useWalkStore } from '../stores/walk.js'
import SenseItem from './SenseItem.vue'

defineProps({ phone: Boolean })
const walk = useWalkStore()
const senses = useSensesStore()

const p = computed(() => walk.feature?.properties ?? {})
/** Senses: the rating of the photo in the window, never of another (null: no photo; pending while it is found). */
const place = computed(() => {
  if (walk.ratedPhoto === undefined) return { status: 'pending' }
  if (walk.photoState === 'unloaded') return { status: 'unloaded' }
  return walk.ratedPhoto ? senses.placeFor([walk.ratedPhoto.photo]) : null
})
/** No photo along the stretch faces the walk, so the window shows (and the card rates) the street's photo. */
const streetPhoto = computed(() => walk.photo && walk.ratedPhoto?.from === 'street')
const comfort = computed(() => comfortLine(walk.layer, p.value, walk.layer === 'senses' ? place.value : null))
const rated = computed(() => walk.layer === 'senses' && place.value?.status === 'rated')
const columns = computed(() => [
  { title: 'Might bother you', kind: 'bother', rows: rated.value ? bySense(place.value.bothers) : [] },
  { title: 'Might feel good', kind: 'good', rows: rated.value ? bySense(place.value.feelsGood) : [] },
])
const swatch = computed(() => `var(--${comfort.value.state === 'none' ? 'no-photo' : comfort.value.state})`)
</script>

<template>
  <div v-if="walk.current" class="details" :class="{ phone }">
    <section class="head" data-panel="walk-card" aria-label="Stretch ahead">
      <p class="title"><span class="name" lang="de">{{ p.name }}</span><span class="meta">{{ stretchLine(walk.current) }}</span></p>
      <p class="state" data-testid="walk-state">
        <span class="swatch" :style="{ background: swatch }" />
        <strong :class="['label', comfort.state]">{{ comfort.label }}</strong>
        <span class="muted">{{ comfort.reason }}</span>
      </p>
      <p v-if="streetPhoto" class="note" data-testid="walk-street-photo">The street's photo: none along this stretch faces this way.</p>
      <p class="note">A prediction, not a reason.</p>
    </section>
    <div class="rule" />
    <section id="walk-details" class="body" aria-label="Details of the stretch">
      <div class="columns">
        <div v-for="c in columns" :key="c.kind" class="column">
          <h3>{{ c.title }}</h3>
          <ul v-if="c.rows.length">
            <SenseItem v-for="r in c.rows" :key="r.sense" :row="r" :kind="c.kind" :small="phone" />
          </ul>
          <p v-else class="none">{{ walk.layer === 'senses' ? 'Nothing named here' : 'Only on Senses' }}</p>
        </div>
      </div>
      <div class="rule" />
      <div class="rate">
        <div class="rate-row">
          <span id="walk-rate-title" class="rate-title">Rate this place</span>
          <div role="group" aria-labelledby="walk-rate-title" aria-describedby="walk-rate-soon" class="rate-buttons">
            <button v-for="n in 5" :key="n" type="button" class="rate-btn" :aria-label="`Rate ${n} of 5`" aria-disabled="true"
                    title="Coming soon">{{ n }}</button>
          </div>
        </div>
        <div class="rate-foot">
          <span>From the photo. It tunes your profile.</span>
          <button type="button" class="link" aria-disabled="true" title="Coming soon" aria-describedby="walk-rate-soon">How this works</button>
        </div>
        <span id="walk-rate-soon" class="visually-hidden">Coming soon</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
p { margin: 0; }
.details { display: flex; flex-direction: column; gap: var(--space-3); }
.details.phone { gap: calc(var(--space-2) + 2px); }
.head { display: flex; flex-direction: column; gap: calc(var(--space-2) - 2px); }
.body { display: flex; flex-direction: column; gap: calc(var(--space-3) + 2px); }
.phone .body { gap: calc(var(--space-2) + 2px); }

.title { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-3); }
.name { font-size: var(--fs-lg); font-weight: var(--fw-semibold); overflow-wrap: anywhere; }
.phone .name { font-size: var(--fs-md); }
.meta { font-size: var(--fs-sm); color: var(--text-2); }
.phone .meta { font-size: var(--fs-xs); }
.state { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) calc(var(--space-2) + 2px); }
.swatch { flex: none; width: calc(var(--space-5) - 2px); height: calc(var(--swatch-h) + 1px); border-radius: var(--radius-pill); }
.label { font-weight: var(--fw-semibold); }
.label.hard { color: var(--hard-text); }
.muted { color: var(--text-2); }
.note { font-size: var(--fs-xs); color: var(--text-2); }
.rule { height: var(--hairline); background: var(--line); }

.columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.column h3 { margin: 0; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); }
.phone .column h3 { font-size: var(--fs-xs); }
.column ul { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: flex; flex-direction: column; }
.phone .column ul { margin-top: var(--space-1); }
.none { margin-top: var(--space-2); font-size: var(--fs-xs); color: var(--text-2); }

.rate { display: flex; flex-direction: column; gap: calc(var(--space-2) - 2px); }
.rate-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.rate-title { font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); }
.rate-buttons { display: flex; gap: var(--space-1); }
.rate-btn {
  width: var(--rate-w); height: var(--rate-h); padding: 0;
  border: var(--hairline) solid var(--line); border-radius: var(--radius-chip); background: transparent;
  color: var(--text); font-size: var(--fs-xs); font-variant-numeric: tabular-nums;
}
.phone .rate-btn { width: var(--rate-w-phone); height: var(--rate-h-phone); }
/* --text-2, not the board's muted grey, which is under 4.5:1 on white. */
.rate-foot { display: flex; justify-content: space-between; gap: var(--space-3); font-size: var(--fs-2xs); color: var(--text-2); }
.link { flex: none; padding: 0; border: 0; background: transparent; color: var(--text-2); font-size: inherit; text-decoration: underline; }
</style>
