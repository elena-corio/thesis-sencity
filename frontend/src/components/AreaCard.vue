<script setup>
// "This area" (board Flow 4), once the area is analysed: "<n> street stretches … hard x%" as on a route row, the
// stretches of the selected layer as one bar by street length, the legend straight under it: the key (Senses, Overall) or
// the full thermal legend (Thermal), places by type and Print area report (not built yet). Designed, not built yet: the
// title "This area, for you", "Why hard" and the "Area ready" banner (docs/decisions.md). On a phone it is in the Results tab of the sheet. When the left
// panel gives way (below 1200 px), the card carries the area inputs (one row with Change), the layer
// choice and season and time (`controls`). Change in the inputs clears the area (no "Change area" here).
import { computed, onMounted, ref } from 'vue'
import { keyRows, lengthShares } from '../lib/legend.js'
import { PLACE_FILTERS, placeGroup, typeLabel } from '../lib/place.js'
import { formatDegrees } from '../lib/thermal.js'
import { useAreaStore } from '../stores/area.js'
import AppIcon from './AppIcon.vue'
import AreaInputs from './AreaInputs.vue'
import ComfortKey from './ComfortKey.vue'
import LayerButtons from './LayerButtons.vue'
import MarkerPin from './MarkerPin.vue'
import SeasonTime from './SeasonTime.vue'
import SensesFoot from './SensesFoot.vue'
import SensesPanel from './SensesPanel.vue'
import ThermalLegend from './ThermalLegend.vue'

const props = defineProps({
  phone: Boolean,
  /** The left panel is hidden: show the layer choice and season and time here. */
  controls: Boolean,
  getCentre: { type: Function, default: () => null },
})
/** Season and time matter for Thermal and Overall (and before analysis), not for Senses. */
const showWindow = computed(() => props.controls && area.layer !== 'senses')
const emit = defineEmits(['pick', 'recentre'])
const area = useAreaStore()
const titleEl = ref(null)

const features = computed(() => area.rated?.features ?? [])
/** The Senses view of the card: the same bar and places as Thermal, from the ratings so far. */
const sensesView = computed(() => area.layer === 'senses' && area.load === 'ready')
/** Overall: the worse of the two per street (lib/overall.js), as soon as the area is here. */
const overallView = computed(() => area.layer === 'overall' && area.load === 'ready')
const stateKey = computed(() => `${area.layer}_state`)
const layerName = computed(() => ({ senses: 'Senses', thermal: 'Thermal', overall: 'Overall' })[area.layer])
const known = (f) => ['easy', 'mixed', 'hard'].includes(f.properties[stateKey.value])
/** By street length, as a route's bar (Elena, 2026-11-11); "none": no value there (e.g. under a building) or no rating. */
const shares = computed(() => lengthShares(features.value, (f) => (known(f) ? f.properties[stateKey.value] : null)))
const keyLayer = computed(() => area.layer)
const stack = computed(() => keyRows(keyLayer.value).map((r) => ({ ...r, m: shares.value.metres[r.id] })).filter((r) => r.m > 0))
const hardPct = computed(() => Math.round(shares.value.hard * 100))
/** The counts the rows used to show, for a screen reader: "21 easy, 18 mixed, 13 hard, 6 without a photo". */
const stackLabel = computed(() => {
  const c = shares.value.counts
  const none = { senses: 'without a rating', thermal: 'without a value', overall: 'without data' }[area.layer]
  return `${layerName.value}: ${c.easy} easy, ${c.mixed} mixed, ${c.hard} hard, ${c.none} ${none}. Hard ${hardPct.value}% of the street length.`
})
/** Thermal: the full thermal legend at the bottom of the card, from the area's feels-like values. */
const thermalValues = computed(() => features.value.map((f) => f.properties.utci).filter((v) => v != null))
/** "Parks: 2 of 3 easy": the most common state per place type (a tie goes to the worse one). */
const PLACE_GROUPS = PLACE_FILTERS.filter((g) => g.id === 'parks' || g.id === 'squares')
const placesHere = computed(() => PLACE_GROUPS.map((g) => {
  const fs = features.value.filter((f) => placeGroup(f.properties, f.geometry.type) === g.id && known(f))
  if (!fs.length) return null
  const count = (st) => fs.filter((f) => f.properties[stateKey.value] === st).length
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

// After loading, or back from a place card, with the keyboard: focus the card's title.
onMounted(() => { if (area.byKeyboard && area.step === 'analysed') titleEl.value?.focus() })
</script>

<template>
  <section class="card panel" :class="{ sheet: phone }" data-panel="area-card" data-scrollable aria-labelledby="area-title">
    <div class="title-row">
      <h2 id="area-title" ref="titleEl" class="title" tabindex="-1">This area</h2>
      <button v-if="phone" type="button" class="icon-btn" aria-label="Re-centre the map" @click="emit('recentre')">
        <AppIcon name="locate" />
      </button>
    </div>
    <p v-if="!controls && area.step === 'analysed'" class="meta"><span lang="de">{{ area.centreName }}</span> · {{ area.analysed.radius }} m radius</p>
    <AreaInputs v-if="controls" class="inputs" id-suffix="-card" :get-centre="getCentre" @pan="emit('pick', $event)" />

    <template v-if="area.step === 'analysed'">
      <div v-if="controls" class="controls">
        <LayerButtons />
        <SeasonTime v-if="showWindow" :store="area" />
      </div>

      <template v-if="sensesView || overallView || (area.mapLayer === 'thermal' && area.thermal === 'ready')">
        <div class="stack-head">
          <span>{{ area.counts.all }} street stretches</span>
          <span class="hard" :class="{ clear: hardPct === 0 }" title="Share of the street length that is hard">hard {{ hardPct }}%</span>
        </div>
        <div class="stack" role="img" :aria-label="stackLabel" data-testid="area-bar">
          <span v-for="r in stack" :key="r.id" :style="{ flexGrow: r.m, background: r.color }" />
        </div>
        <!-- The legend straight after the bar (Elena, 2026-11-11): the key, or on Thermal the full legend (bands in °C, info tip). -->
        <!-- On a phone the key floats on the map instead (the phone's right card), so not here too. -->
        <ComfortKey v-if="sensesView && !phone" layer="senses" rule />
        <ComfortKey v-else-if="overallView && !phone" layer="overall" :window="area.thermalInfo" rule />
        <div v-else-if="!phone" class="thermal-block" aria-label="Legend" role="group">
          <ThermalLegend :values="thermalValues" :window="area.thermalInfo" :extra="[{ label: 'No value', color: 'var(--no-photo)' }]" />
        </div>
        <p class="muted small">{{ area.counts.withPhotos }} of {{ area.counts.all }} have street photos.</p>
        <p v-if="area.thermalError" class="thermal-error" role="status">{{ area.thermalError }}</p>
        <SensesPanel v-if="sensesView" scope="area" />

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

      <SensesFoot v-if="sensesView || overallView" scope="area" />
      <p class="foot">
        {{ props.phone ? 'Tap' : 'Click' }} a street to see {{ area.layer === 'senses' ? 'its rating' : ['thermal', 'overall'].includes(area.mapLayer) ? 'why' : 'its photos' }}.
        Predictions, not reasons.
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
/* The inputs, then a divider before the layer and the rest. */
.inputs { margin-top: var(--space-3); padding-bottom: var(--space-3); border-bottom: var(--hairline) solid var(--line); }
.stack-head { display: flex; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-5); } /* as a route row */
.hard { color: var(--text-2); }
.hard.clear { color: var(--easy); }
.thermal-block { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.stack {
  display: flex; gap: var(--hairline); height: var(--bar-h); margin-top: var(--space-2);
  border-radius: var(--radius-pill); overflow: hidden;
}
.stack span { flex-basis: 0; min-width: var(--hairline); }
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
.buttons { display: flex; gap: var(--space-3); margin-top: var(--space-4); flex-wrap: wrap; }
.buttons .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); }

.title-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
/* Inside the phone sheet, which is the panel and does the scrolling. */
.card.sheet { padding: 0; overflow: visible; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.sheet .btn { min-height: var(--touch-phone); }
.sheet .icon-btn { width: var(--touch-phone); height: var(--touch-phone); }
</style>
