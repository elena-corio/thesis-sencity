<script setup>
// The report's area (board 8, "The area you looked at"): a light map of the area with its streets in the print colours
// and the legend on it, the centre, radius and season and time, the four counts, "Why hard" (Overall only) and
// "Places here". All on the layer the area is shown in. The map is drawn once, when the report opens (map/print.js);
// if it cannot be drawn, it is left out.
import { computed, onMounted, ref } from 'vue'
import { formatCoords } from '../lib/geo.js'
import { keyRows, keyTitle } from '../lib/legend.js'
import { areaCounts, placesHere, whyHard } from '../lib/report.js'
import { areaSnapshot, mapSize } from '../map/print.js'
import { useAreaStore } from '../stores/area.js'
import { useReportStore } from '../stores/report.js'
import { useSensesStore } from '../stores/senses.js'

const area = useAreaStore()
const report = useReportStore()
const senses = useSensesStore()
const features = computed(() => area.rated?.features ?? [])
const layer = area.layer
const LAYER = { senses: 'Senses', thermal: 'Thermal', overall: 'Overall' }
/** What the map's colours and the counts show, as the app's legend names it: "Overall comfort · summer, 15:00". */
const key = computed(() => keyTitle(layer, area.thermalInfo))
const counts = computed(() => areaCounts(features.value, layer))
const noneLabel = keyRows(layer).find((r) => r.id === 'none').label
const CELLS = [
  { id: 'easy', label: 'easy' }, { id: 'mixed', label: 'mixed' }, { id: 'hard', label: 'hard' },
  { id: 'none', label: noneLabel.toLowerCase() },
]
const LEGEND = [...CELLS.slice(0, 3).map((c) => ({ ...c, label: c.label[0].toUpperCase() + c.label.slice(1) })), { id: 'none', label: noneLabel }]
const pct = (x) => `${Math.round(x * 100)}%`
const bothersOf = (f) => (f.properties.photos?.length ? (senses.placeFor(f.properties.photos).bothers ?? []).map((e) => e.en) : [])
const why = computed(() => whyHard(features.value, layer, bothersOf))
const places = computed(() => placesHere(features.value, layer))
const centre = area.analysed
const ha = (Math.PI * centre.radius ** 2 / 10000).toFixed(1)
const when = computed(() => (layer !== 'senses' && area.thermalInfo ? `${area.thermalInfo.season[0].toUpperCase()}${area.thermalInfo.season.slice(1)}, ${area.thermalInfo.time}` : null))

// The map: the page's width inside its margins, --report-map-h high; drawn at twice that.
const map = ref(null)
const drawn = ref(false)
onMounted(async () => {
  report.pending++
  try {
    map.value = await areaSnapshot({ ...mapSize('--report-map-h'), features: features.value, layer, centre, radius: centre.radius })
  } finally {
    drawn.value = true
    report.pending = Math.max(0, report.pending - 1)
  }
})
</script>

<template>
  <section class="area" data-section="area" aria-labelledby="report-area-title">
    <div class="title-row">
      <h2 id="report-area-title">The area you looked at</h2>
    </div>
    <div v-if="map || !drawn" class="map" data-testid="report-area-map">
      <img v-if="map" :src="map" :alt="`Map of the area: streets coloured easy, mixed or hard on the ${LAYER[layer]} layer.`" />
      <p v-else class="muted waiting">Drawing the map…</p>
      <p class="legend" aria-hidden="true">
        <strong data-testid="report-area-key">{{ key.name }}{{ key.when ? ` · ${key.when}` : '' }}</strong>
        <span v-for="r in LEGEND" :key="r.id"><i :class="['sw', r.id]" />{{ r.label }}</span>
      </p>
    </div>

    <dl class="facts">
      <div><dt class="label">Centre</dt><dd>{{ area.centreLabel ? `${area.centreLabel}, ` : '' }}{{ formatCoords(centre) }}</dd></div>
      <div><dt class="label">Radius</dt><dd>{{ centre.radius }} m (≈ {{ ha }} ha)</dd></div>
      <div v-if="when"><dt class="label">Thermal for</dt><dd>{{ when }}</dd></div>
    </dl>

    <h3 class="label counts-title">Streets by {{ key.name.toLowerCase() }}</h3>
    <ul class="counts" data-testid="report-area-counts">
      <li v-for="c in CELLS" :key="c.id" :class="c.id">
        <strong>{{ counts.counts[c.id] }}</strong>
        <span>{{ c.label }}, {{ pct(counts.share[c.id]) }}</span>
      </li>
    </ul>

    <div v-if="why || places.length" class="two">
      <div v-if="why" class="col">
        <h3 class="label">Why hard</h3>
        <p class="row"><span>Thermal ({{ why.weather }})</span><span>{{ why.thermal }} of {{ why.of }}</span></p>
        <p class="row"><span>Senses{{ why.sensesWhat.length ? ` (${why.sensesWhat.join(', ')})` : '' }}</span><span>{{ why.senses }} of {{ why.of }}</span></p>
      </div>
      <div v-if="places.length" class="col">
        <h3 class="label">Places here</h3>
        <p v-for="pl in places" :key="pl.label" class="row"><span>{{ pl.label }}</span><span>{{ pl.text }}</span></p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.area { display: flex; flex-direction: column; gap: var(--space-3); }
.title-row { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-4); }
.map { position: relative; height: var(--report-map-h); border-radius: var(--radius-btn); overflow: hidden; border: var(--hairline) solid var(--report-line); background: var(--report-soft); }
.map img { display: block; width: 100%; height: 100%; object-fit: cover; }
.waiting { padding: var(--space-4); }
.legend {
  position: absolute; left: var(--space-3); bottom: var(--space-3); display: flex; gap: var(--space-4);
  padding: var(--space-1) var(--space-3); border-radius: var(--radius-chip); background: var(--report-bg); font-size: var(--report-fs-sm);
}
.legend span { display: inline-flex; align-items: center; gap: var(--space-2); }
.sw { display: inline-block; width: var(--report-swatch-w); height: var(--report-swatch-h); border-radius: var(--radius-pill); }
.sw.easy, .counts .easy { --c: var(--report-easy); }
.sw.mixed, .counts .mixed { --c: var(--report-mixed); }
.sw.hard, .counts .hard { --c: var(--report-hard); }
.sw.none, .counts .none { --c: var(--report-none); }
.sw { background: var(--c); }
.facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); margin: 0; }
.facts dd { margin: 0; font-size: var(--report-fs-lead); font-weight: var(--fw-medium); }
.counts-title { margin-bottom: calc(-1 * var(--space-2)); }
.counts { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); }
.counts li { display: flex; flex-direction: column; padding-top: var(--space-2); border-top: var(--report-count-rule) solid var(--c); }
.counts strong { font-size: var(--report-fs-big); font-weight: var(--fw-semibold); line-height: 1.1; }
.counts span { color: var(--report-ink-2); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); }
.col { display: flex; flex-direction: column; gap: var(--space-1); }
.row { display: flex; justify-content: space-between; gap: var(--space-4); }
.row span:last-child { font-weight: var(--fw-medium); white-space: nowrap; }
</style>
