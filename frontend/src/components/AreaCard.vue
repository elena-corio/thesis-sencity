<script setup>
// "This area" (boards Flow 1c, Flow 4): before analysis, with Analyse / Start again; once the area
// has loaded, Change area, the street stretches of the selected layer as one stacked bar with counts
// and %, places by type and Print area report (not built yet). Only Thermal exists so far, so "Why
// hard" waits for Senses. A bottom sheet on a phone. When the left panel gives way (phone and below
// 1200 px), the card carries the layer choice and, under it, season and time (`controls`).
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import config from '../config.js'
import { estimatePhotos, formatCoords } from '../lib/geo.js'
import { PLACE_FILTERS, placeGroup, typeLabel } from '../lib/place.js'
import { formatDegrees } from '../lib/thermal.js'
import { useAreaStore } from '../stores/area.js'
import AppIcon from './AppIcon.vue'
import LayerButtons from './LayerButtons.vue'
import MarkerPin from './MarkerPin.vue'
import SeasonTime from './SeasonTime.vue'

const props = defineProps({
  phone: Boolean,
  /** The left panel is hidden: show the layer choice and season and time here. */
  controls: Boolean,
})
/** Season and time matter for Thermal and Overall (and before analysis), not for Senses. */
const showWindow = computed(() => props.controls && area.layer !== 'senses')
const emit = defineEmits(['focus-map'])
const area = useAreaStore()
const analyseBtn = ref(null)
const changeBtn = ref(null)

const place = computed(() => (area.step === 'analysed' ? area.analysed : { ...area.centre, radius: area.radius }))
const photos = computed(() => estimatePhotos(area.radius, config.photosPerKm2))
const ROWS = [
  { id: 'easy', label: 'Easy', color: 'var(--easy)' },
  { id: 'mixed', label: 'Mixed', color: 'var(--mixed)' },
  { id: 'hard', label: 'Hard', color: 'var(--hard)' },
  { id: 'none', label: 'No value', color: 'var(--no-photo)' },
]
const features = computed(() => area.segments?.features ?? [])
/** Street stretches per thermal state ("none": no grid value there, e.g. under a building). */
const stack = computed(() => {
  const n = { easy: 0, mixed: 0, hard: 0, none: 0 }
  for (const f of features.value) n[f.properties.thermal_state ?? 'none']++
  const total = features.value.length || 1
  return ROWS.filter((r) => r.id !== 'none' || n.none)
    .map((r) => ({ ...r, n: n[r.id], pct: Math.round((100 * n[r.id]) / total) }))
})
const stackLabel = computed(() => stack.value.map((r) => `${r.label} ${r.n}`).join(', '))
/** "Parks: 2 of 3 easy": the most common state per place type (a tie goes to the worse one). */
const PLACE_GROUPS = PLACE_FILTERS.filter((g) => g.id === 'parks' || g.id === 'squares')
const placesHere = computed(() => PLACE_GROUPS.map((g) => {
  const fs = features.value.filter((f) => placeGroup(f.properties, f.geometry.type) === g.id
    && f.properties.thermal_state)
  if (!fs.length) return null
  const count = (st) => fs.filter((f) => f.properties.thermal_state === st).length
  const state = ['hard', 'mixed', 'easy'].reduce((best, st) => (count(st) > count(best) ? st : best))
  return { label: g.label, state, text: `${count(state)} of ${fs.length} ${state}` }
}).filter(Boolean))

// "Likely easiest for you": the marked places, numbered as their pins (suggestions now, chat later).
const LEVEL_LABEL = { easy: 'Easy', mixed: 'Mixed', hard: 'Hard' }
const showMarkers = computed(() => area.markerKind === 'chat' || area.layer === 'thermal')
const markerRows = computed(() => area.markers.map((m) => {
  const p = m.f.properties
  return { m, id: p.id, name: p.name, type: typeLabel(p, m.f.geometry.type), temp: formatDegrees(p.utci),
    level: LEVEL_LABEL[m.level], seen: area.seenIds.has(p.id) }
}))

// Keyboard: after Enter fixes the radius, focus goes to Analyse; after Analyse, to Change area.
watch(() => area.step, async (step) => {
  if (!area.byKeyboard) return
  await nextTick()
  if (step === 'set') analyseBtn.value?.focus()
  if (step === 'analysed') changeBtn.value?.focus()
})
// Back from a loading or place card with the keyboard: focus Change area.
onMounted(() => { if (area.byKeyboard && area.step === 'analysed') changeBtn.value?.focus() })

function startAgain() {
  area.reset()
  emit('focus-map')
}
</script>

<template>
  <section v-if="area.step === 'set' || area.step === 'analysed'" class="card panel"
           :class="{ sheet: phone }" data-panel="area-card" data-scrollable aria-labelledby="area-title">
    <div v-if="phone" class="grip" aria-hidden="true" />
    <h2 id="area-title" class="title">This area</h2>
    <p class="meta">{{ formatCoords(place) }} · {{ place.radius }} m radius</p>

    <template v-if="area.step === 'set'">
      <p v-if="phone" class="meta">Drag the edge of the circle to adjust.</p>
      <ul class="facts">
        <li><AppIcon name="image" /> About {{ photos }} street photos</li>
        <li><AppIcon name="thermometer" /> Thermal for {{ area.thermalWindow.season }}, {{ area.thermalWindow.time }}</li>
        <li><AppIcon name="clock" /> Ready in about a minute</li>
      </ul>
      <SeasonTime v-if="showWindow" :store="area" />
      <div class="buttons">
        <button ref="analyseBtn" type="button" class="btn btn-primary grow" @click="area.analyse($event.detail === 0)">
          Analyse this area
        </button>
        <button type="button" class="btn" @click="startAgain">Start again</button>
      </div>
    </template>

    <template v-else>
      <div class="buttons change-row">
        <button ref="changeBtn" type="button" class="btn" @click="startAgain">
          <AppIcon name="area" /> Change area
        </button>
      </div>
      <div v-if="controls" class="controls">
        <LayerButtons />
        <SeasonTime v-if="showWindow" :store="area" />
      </div>

      <template v-if="area.thermal === 'ready'">
        <div class="stack-head">
          <span>Thermal · {{ area.counts.all }} street stretches</span>
          <span class="muted">{{ area.thermalInfo.season }}, {{ area.thermalInfo.time }}</span>
        </div>
        <div class="stack" role="img" :aria-label="`Thermal: ${stackLabel}`">
          <span v-for="r in stack" :key="r.id" :style="{ flexGrow: r.n, background: r.color }" />
        </div>
        <ul class="rows">
          <li v-for="r in stack" :key="r.id">
            <span class="swatch" :style="{ background: r.color }" />
            <span class="row-label">{{ r.label }}</span>
            <span class="num"><strong>{{ r.n }}</strong> · {{ r.pct }}%</span>
          </li>
        </ul>
        <p class="muted small">{{ area.counts.withPhotos }} of {{ area.counts.all }} have street photos.</p>
        <p v-if="area.thermalError" class="thermal-error" role="status">{{ area.thermalError }}</p>

        <section v-if="showMarkers" class="sub" data-testid="suggestions">
          <div class="sub-head">
            <h3 class="sub-title">{{ area.markerKind === 'chat' ? 'From your question' : 'Likely easiest for you' }}</h3>
            <button v-if="area.markerKind === 'chat'" type="button" class="btn small-btn" @click="area.clearChatResults()">Clear</button>
          </div>
          <ol v-if="markerRows.length" class="markers">
            <li v-for="r in markerRows" :key="r.id">
              <button type="button" class="marker-row" :aria-label="`${r.m.n}. ${r.name}, ${r.type}, ${r.temp}, ${r.level}${r.seen ? ', seen' : ''}`"
                      @click="area.selectMarker(r.m, $event.detail === 0)">
                <MarkerPin :n="r.m.n" :level="r.m.level" />
                <span class="marker-text">
                  <span class="marker-name" lang="de">{{ r.name }}</span>
                  <span class="muted">{{ r.type }} · {{ r.temp }} · <span :class="['state-text', r.m.level]">{{ r.level }}</span></span>
                </span>
                <AppIcon v-if="r.seen" name="check" class="seen" />
              </button>
            </li>
          </ol>
          <p v-else class="muted small">Nothing easy here at this time. Try another time or a nearby area.</p>
        </section>

        <section v-if="placesHere.length" class="sub">
          <h3 class="sub-title">Places here</h3>
          <p v-for="pl in placesHere" :key="pl.label" class="place-row">
            <span>{{ pl.label }}</span><span :class="['state-text', pl.state]">{{ pl.text }}</span>
          </p>
        </section>
      </template>
      <template v-else>
        <p v-if="area.load === 'ready'" class="summary">
          {{ area.counts.all }} street stretches · {{ area.counts.withPhotos }} with photos
        </p>
        <p v-if="area.thermal === 'error'" class="thermal-error">{{ area.thermalError }}</p>
      </template>

      <p class="foot">
        {{ props.phone ? 'Tap' : 'Click' }} a street to see {{ area.thermal === 'ready' ? 'why' : 'its photos' }}.
        Change area: {{ props.phone ? 'tap' : 'click' }} a new centre, then the radius. Predictions, not reasons.
      </p>
      <div class="buttons">
        <button v-if="area.thermal === 'error'" type="button" class="btn btn-primary" @click="area.retryThermal()">
          Try again
        </button>
        <button type="button" class="btn" aria-disabled="true" title="Coming soon">
          <AppIcon name="print" /> Print area report
        </button>
      </div>
    </template>

    <slot />
  </section>
</template>

<style scoped>
.card { padding: var(--space-5); overflow-y: auto; }
.title { font-size: var(--fs-lg); font-weight: var(--fw-semibold); margin: 0; }
.meta { margin: var(--space-1) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.summary { margin: var(--space-4) 0 0; }
.change-row { margin-top: var(--space-3); }
.stack-head { display: flex; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-5); font-size: var(--fs-sm); }
.stack {
  display: flex; gap: var(--hairline); height: var(--space-2); margin-top: var(--space-2);
  border-radius: var(--radius-pill); overflow: hidden;
}
.stack span { flex-basis: 0; min-width: var(--hairline); }
.rows { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: grid; gap: var(--space-2); }
.rows li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-3); }
.num { font-variant-numeric: tabular-nums; color: var(--text-2); }
.num strong { color: var(--text); }
.swatch { width: var(--space-5); height: var(--swatch-h); border-radius: var(--radius-pill); }
.muted { color: var(--text-2); }
.small { margin: var(--space-3) 0 0; font-size: var(--fs-sm); }
.sub { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.sub-title { margin: 0; font-size: var(--fs-md); font-weight: var(--fw-semibold); }
.sub-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.small-btn { min-height: var(--chip-h); padding: 0 var(--space-3); font-size: var(--fs-sm); }
.markers { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: grid; gap: var(--space-1); }
.marker-row {
  display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: var(--touch-phone);
  padding: var(--space-1) var(--space-2);
  border: 0; border-radius: var(--radius-btn); background: transparent; color: var(--text); text-align: left;
}
.marker-row:hover { background: var(--btn-selected-bg); }
.marker-text { display: flex; flex-direction: column; flex: 1; min-width: 0; font-size: var(--fs-sm); }
.marker-name { font-size: var(--fs-md); font-weight: var(--fw-semibold); overflow-wrap: anywhere; }
.seen { color: var(--text-2); }
.place-row { display: flex; justify-content: space-between; gap: var(--space-3); margin: var(--space-2) 0 0; }
.state-text.easy { color: var(--easy); }
.state-text.mixed { color: var(--mixed); }
.state-text.hard { color: var(--hard-text); }
.thermal-error { margin: var(--space-4) 0 0; font-size: var(--fs-sm); }
.foot { margin: var(--space-4) 0 0; font-size: var(--fs-sm); color: var(--text-2); }
.facts { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-2); }
.facts li { display: flex; align-items: center; gap: var(--space-3); color: var(--text); }
.facts :deep(.icon) { color: var(--text-2); }
.buttons { display: flex; gap: var(--space-3); margin-top: var(--space-4); flex-wrap: wrap; }
.buttons .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); }
.grow { flex: 1; }

.sheet {
  border-radius: var(--radius-panel) var(--radius-panel) 0 0;
  border-bottom: 0;
  padding: var(--space-2) var(--space-4) var(--space-4);
}
.sheet .btn { min-height: var(--touch-phone); }
.grip {
  width: var(--space-5); height: var(--space-1); margin: 0 auto var(--space-3);
  border-radius: var(--radius-pill); background: var(--line);
}
</style>
