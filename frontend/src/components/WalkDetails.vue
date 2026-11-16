<script setup>
// The stretch ahead, in the walk's right column (WalkView): name, length and time; the comfort
// label and its reason; what might bother and what might feel good, in two columns; and "Rate this place" (RateThisPlace,
// Elena 2026-11-16: kept in this browser with the prediction shown; rating pauses the walk). Details are always shown.
// Everything comes from what is loaded: the Senses ratings already here, never a new call.
import { computed } from 'vue'
import { sizeLabel, typeLabel } from '../lib/place.js'
import { stretchLine } from '../lib/routes.js'
import { bySense } from '../lib/senses.js'
import { comfortLine } from '../lib/walk.js'
import { useWalkStore } from '../stores/walk.js'
import RateThisPlace from './RateThisPlace.vue'
import SenseItem from './SenseItem.vue'
import { useSensesStore } from '../stores/senses.js'

defineProps({ phone: Boolean })
const walk = useWalkStore()

const p = computed(() => walk.feature?.properties ?? {})
/** Senses: the stretch's rating as the Routes view and the stretch card have it (null: no photo). */
const place = computed(() => {
  if (walk.photoState === 'unloaded') return { status: 'unloaded' }
  return walk.ratedPhoto ? walk.ratedPhoto.place : null
})
/** A stretch: its length and walking time; a place of an area: what it is and its size, as on its card. */
const meta = computed(() => (walk.mode === 'place'
  ? `${typeLabel(p.value, walk.feature.geometry.type)} · ${sizeLabel(p.value)}`
  : stretchLine(walk.current)))
const comfort = computed(() => comfortLine(walk.layer, p.value, walk.layer === 'senses' ? place.value : null))
const rated = computed(() => walk.layer === 'senses' && place.value?.status === 'rated')
const columns = computed(() => [
  { title: 'Might bother you', kind: 'bother', rows: rated.value ? bySense(place.value.bothers) : [] },
  { title: 'Might feel good', kind: 'good', rows: rated.value ? bySense(place.value.feelsGood) : [] },
])
const senses = useSensesStore()
/** The photo on screen and its rating as shown, for "Rate this place"; the walk itself or the enlarged photo. */
const shownResult = computed(() => {
  const r = walk.photo ? senses.ratingOf(walk.photo) : null
  return r?.status === 'ok' ? r.result : null
})
const rateFrom = computed(() => (walk.back === 'comparison' ? 'walk' : 'photo'))
const swatch = computed(() => `var(--${comfort.value.state === 'none' ? (walk.layer === 'thermal' ? 'no-photo' : 'no-photo-grey') : comfort.value.state})`)
</script>

<template>
  <div v-if="walk.current" class="details" :class="{ phone }">
    <section class="head" data-panel="walk-card" aria-label="Stretch ahead">
      <p class="title"><span class="name" lang="de">{{ p.name }}</span><span class="meta">{{ meta }}</span></p>
      <p class="state" data-testid="walk-state">
        <span class="swatch" :style="{ background: swatch }" />
        <strong :class="['label', comfort.state]">{{ comfort.label }}</strong>
        <span v-if="comfort.context" class="context">{{ comfort.context }}</span>
      </p>
      <p class="detail" data-testid="walk-detail">{{ comfort.detail }}</p>
      <p class="note">A prediction, not a reason.</p>
    </section>
    <template v-if="walk.layer === 'senses'">
    <div class="rule" />
    <section id="walk-details" class="body" aria-label="Details of the stretch">
      <div class="columns">
        <div v-for="c in columns" :key="c.kind" class="column">
          <h3>{{ c.title }}</h3>
          <ul v-if="c.rows.length">
            <SenseItem v-for="r in c.rows" :key="r.sense" :row="r" :kind="c.kind" :small="phone" />
          </ul>
          <p v-else class="none">Nothing named here</p>
        </div>
      </div>
      <div class="rule" />
      <RateThisPlace :photo="walk.photo" :result="shownResult" :from="rateFrom" :phone="phone" @rated="walk.pause()" />
    </section>
    </template>
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
.muted, .context { color: var(--text-2); }
.detail { font-size: var(--fs-sm); }
.note { font-size: var(--fs-xs); color: var(--text-2); }
.rule { height: var(--hairline); background: var(--line); }

.columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.column h3 { margin: 0; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text-2); }
.phone .column h3 { font-size: var(--fs-xs); }
.column ul { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: flex; flex-direction: column; }
.phone .column ul { margin-top: var(--space-1); }
.none { margin-top: var(--space-2); font-size: var(--fs-xs); color: var(--text-2); }

</style>
